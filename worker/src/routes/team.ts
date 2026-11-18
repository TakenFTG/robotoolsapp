import type { TeamData, TeamScreening } from '@robotools.app/protocol/src/team';
import { TEAM_SCREENING_NOTE_MAX_LENGTH, TeamDataSchema, TeamScreeningSchema } from '@robotools.app/protocol/src/team';
import { WRPCError } from '@robotools.app/wrpc/server/types';
import type { WRPCRootObject } from '@robotools.app/wrpc/server';
import { teamScreenings, teams } from '../db/schema';
import type { DatabaseOrTransaction, ServerContext } from '../server-router';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { ClientRouter } from '../client-router';
import { transaction } from '../utils';

export async function getTeamData(db: DatabaseOrTransaction): Promise<TeamData[]> {
	return db
		.select({
			id: teams.id,
			notebookLink: teams.notebookLink,
			hasInnovateAwardSubmissionForm: teams.hasInnovateAwardSubmissionForm,
			notebookDevelopmentStatus: teams.notebookDevelopmentStatus,
			hasSeasonSummary: teams.hasSeasonSummary,
			absent: teams.absent
		})
		.from(teams) as Promise<TeamData[]>;
}

export async function updateTeamData(db: DatabaseOrTransaction, teamData: TeamData): Promise<void> {
	await db.update(teams).set(teamData).where(eq(teams.id, teamData.id));
}

export async function getTeamScreenings(db: DatabaseOrTransaction): Promise<TeamScreening[]> {
	return db.select().from(teamScreenings);
}

export function buildTeamRoute(w: WRPCRootObject<object, ServerContext, Record<string, never>>) {
	return {
		getTeamData: w.procedure.output(z.array(TeamDataSchema)).query(async ({ ctx }) => {
			return getTeamData(ctx.db);
		}),
		updateTeamData: w.procedure.input(TeamDataSchema).mutation(async ({ ctx, input, session }) => {
			await updateTeamData(ctx.db, input);
			// Do not wait for the broadcast to complete
			session.broadcast<ClientRouter>().onTeamDataUpdate.mutation(input);
		}),
		updateAllTeamData: w.procedure.input(z.array(TeamDataSchema)).mutation(async ({ ctx, input, session }) => {
			await transaction(ctx.db, async (tx) => {
				for (const teamData of input) {
					await tx.update(teams).set(teamData).where(eq(teams.id, teamData.id));
				}
			});
			// Do not wait for the broadcast to complete
			getTeamData(ctx.db).then((teamData) => {
				session.broadcast<ClientRouter>().onAllTeamDataUpdate.mutation(teamData);
			});
		}),

		getTeamScreenings: w.procedure.output(z.array(TeamScreeningSchema)).query(async ({ ctx }) => {
			return getTeamScreenings(ctx.db);
		}),

		/** Flag a team for a second interview or further discussion, or change the reason. */
		flagTeamForScreening: w.procedure
			.input(z.object({ teamId: z.uuidv4(), note: z.string().max(TEAM_SCREENING_NOTE_MAX_LENGTH) }))
			.mutation(async ({ ctx, input, session }) => {
				const [team] = await ctx.db.select({ id: teams.id }).from(teams).where(eq(teams.id, input.teamId)).limit(1);
				if (!team) {
					throw new WRPCError('CRITICAL: Team not found');
				}

				const screening = { teamId: input.teamId, note: input.note.trim(), updatedAt: Date.now() };
				await ctx.db
					.insert(teamScreenings)
					.values(screening)
					.onConflictDoUpdate({ target: [teamScreenings.teamId], set: { note: screening.note, updatedAt: screening.updatedAt } });

				// Do not wait for the broadcast to complete
				session.broadcast<ClientRouter>().onTeamScreeningUpdate.mutation({ teamId: input.teamId, screening });
			}),

		clearTeamScreening: w.procedure.input(z.object({ teamId: z.uuidv4() })).mutation(async ({ ctx, input, session }) => {
			await ctx.db.delete(teamScreenings).where(eq(teamScreenings.teamId, input.teamId));

			// Do not wait for the broadcast to complete
			session.broadcast<ClientRouter>().onTeamScreeningUpdate.mutation({ teamId: input.teamId, screening: null });
		})
	};
}
