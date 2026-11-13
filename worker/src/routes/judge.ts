import type { Judge } from '@robotools.app/protocol/src/judging';
import { JudgeGroupSchema, JudgeSchema } from '@robotools.app/protocol/src/judging';
import type { RoomState } from '@robotools.app/protocol/src/room';
import { WRPCError } from '@robotools.app/wrpc/server/types';
import { getEssentialData, updateEssentialData } from './essential';
import { getTeamData } from './team';
import { getFinalAwardNominations } from './judging';
import type { WRPCRootObject } from '@robotools.app/wrpc/server';
import type { DatabaseOrTransaction, ServerContext } from '../server-router';
import { judges } from '../db/schema';
import { eq } from 'drizzle-orm';
import z from 'zod';
import type { ClientRouter } from '../client-router';
import { transaction } from '../utils';
import { assertAuthenticatedJudgeAdvisor, generateAuthToken } from '../access/tokens';
import { broadcastDeviceListUpdate } from './device';

export async function getJudges(db: DatabaseOrTransaction): Promise<Judge[]> {
	return db.select({ id: judges.id, name: judges.name, groupId: judges.groupId }).from(judges);
}

export async function upsertJudge(db: DatabaseOrTransaction, judge: Judge): Promise<void> {
	// An absent `email` means "not mentioned", not "clear it".
	//
	// getJudges does not return addresses, so most callers are round-tripping a list they
	// were never shown them in. Treating undefined as null there would quietly wipe every
	// judge's address the first time anyone reordered a judging group.
	const emailUpdate = judge.email === undefined ? {} : { email: judge.email };

	await db
		.insert(judges)
		.values({
			id: judge.id,
			name: judge.name,
			groupId: judge.groupId,
			authToken: generateAuthToken(),
			email: judge.email ?? null
		})
		.onConflictDoUpdate({
			target: [judges.id],
			set: {
				name: judge.name,
				groupId: judge.groupId,
				...emailUpdate
			}
		});
}

export function buildJudgeRoute(w: WRPCRootObject<object, ServerContext, Record<string, never>>) {
	return {
		getJudges: w.procedure.output(z.array(JudgeSchema)).query(async ({ ctx }) => {
			return getJudges(ctx.db);
		}),
		updateJudge: w.procedure.input(JudgeSchema).mutation(async ({ ctx, input, session }) => {
			if (ctx.auth.isAuthenticated()) {
				assertAuthenticatedJudgeAdvisor(ctx.auth);
			}

			await upsertJudge(ctx.db, input);

			// Do not wait for the broadcast to complete
			getJudges(ctx.db).then((judgesList) => {
				session.broadcast<ClientRouter>().onAllJudgesUpdate.mutation(judgesList);
			});
		}),
		/**
		 * Replace judge groups and their team assignments (Judges overview tab).
		 *
		 * Reuses the same writer as event setup so the two paths cannot drift, but is a
		 * narrow procedure: it never touches awards, teams, or the access-control flag, so
		 * the Judge Advisor can reorganise the roster mid-event without re-running setup.
		 *
		 * Broadcasts the whole room state because moving a team between groups changes what
		 * every connected judge is scoped to see.
		 */
		updateJudgeGroups: w.procedure.input(z.array(JudgeGroupSchema).min(1)).mutation(async ({ ctx, input, session }) => {
			if (ctx.auth.isAuthenticated()) {
				assertAuthenticatedJudgeAdvisor(ctx.auth);
			}

			// The .min(1) on the input schema only runs in the WRPC layer. Re-check here so
			// the invariant holds for any caller: an empty list would delete every group and
			// leave the room unable to satisfy EssentialDataSchema.
			if (input.length === 0) {
				throw new WRPCError("CRITICAL: A Judges' Room needs at least one judge group");
			}

			const assignedTeamIds = input.flatMap((group) => group.assignedTeams);
			if (new Set(assignedTeamIds).size !== assignedTeamIds.length) {
				throw new WRPCError('CRITICAL: A team cannot be assigned to more than one judge group');
			}

			const essentialData = await getEssentialData(ctx.db);
			if (!essentialData) {
				throw new WRPCError("CRITICAL: Judges' Room not found");
			}

			const knownTeamIds = new Set(essentialData.teamInfos.map((team) => team.id));
			const unknownTeamId = assignedTeamIds.find((teamId) => !knownTeamIds.has(teamId));
			if (unknownTeamId) {
				throw new WRPCError("CRITICAL: Cannot assign a team that is not in this Judges' Room");
			}

			// Judges reference groups by id, so a group cannot be dropped while judges remain in it.
			const remainingGroupIds = new Set(input.map((group) => group.id));
			const orphaned = (await getJudges(ctx.db)).filter((judge) => !remainingGroupIds.has(judge.groupId));
			if (orphaned.length > 0) {
				throw new WRPCError(
					`CRITICAL: Move or remove these judges before removing their group: ${orphaned.map((judge) => judge.name).join(', ')}`
				);
			}

			await updateEssentialData(ctx.db, { ...essentialData, judgeGroups: input });

			// Do not wait for the broadcast to complete
			transaction(ctx.db, async (tx) => {
				return {
					essentialData: await getEssentialData(tx),
					teamData: await getTeamData(tx),
					judges: await getJudges(tx),
					finalAwardNominations: await getFinalAwardNominations(tx)
				} satisfies RoomState;
			})
				.then((message) => {
					session.broadcast<ClientRouter>().onEventSetupUpdate.mutation(message);
				})
				// The write has already committed; a failed fan-out must not surface as an
				// unhandled rejection (which would take down the isolate). Clients recover on
				// their next sync.
				.catch((error) => {
					console.error('Failed to broadcast judge group update:', error);
				});
		}),

		updateAllJudges: w.procedure.input(z.array(JudgeSchema)).mutation(async ({ ctx, input, session }) => {
			if (ctx.auth.isAuthenticated()) {
				assertAuthenticatedJudgeAdvisor(ctx.auth);
			}

			const removedJudges = await transaction(ctx.db, async (tx) => {
				const allJudges = await tx.select().from(judges);
				const rtn = new Set<string>();

				for (const v of allJudges) {
					if (!input.some((v2) => v2.id === v.id)) {
						rtn.add(v.id);
						await tx.delete(judges).where(eq(judges.id, v.id));
					}
				}

				for (const judge of input) {
					await upsertJudge(tx, judge);
				}

				return Array.from(rtn);
			});

			// Do not wait for the broadcast to complete
			getJudges(ctx.db).then((judgesList) => {
				session.broadcast<ClientRouter>().onAllJudgesUpdate.mutation(judgesList);
			});

			await Promise.all(removedJudges.map((judgeId) => ctx.network.kickJudge(judgeId)));

			// Always broadcast: already-offline kicks do not get a webSocketClose update.
			broadcastDeviceListUpdate(ctx, session);
		})
	};
}
