import z from 'zod';
import type { WRPCRootObject } from '@robotools.app/wrpc/server';
import { WRPCError } from '@robotools.app/wrpc/server/types';
import { getGroupOrigin } from '@robotools.app/protocol/src/access';
import {
	CreateLinkedRefRoomInputSchema,
	JudgeRefNoteInputSchema,
	JudgeRefNotesSchema,
	RefLinkCodeResultSchema,
	RefLinkStatusSchema
} from '@robotools.app/protocol/src/ref';
import type { ServerContext } from '../server-router';
import { assertAuthenticatedJudgeAdvisor } from '../access/tokens';
import { getRoomGroupId } from '../group/gateway';
import { judgeAdvisors, judgeGroupsAssignedTeams, judges, metadata, teams } from '../db/schema';
import { and, eq } from 'drizzle-orm';

/**
 * A Judges' Room's side of being linked to a ref room.
 *
 * Judge Advisors only. Linking lets the ref room read this division's team list and match
 * schedule, nothing more; the room checks the link on every one of those reads, so
 * unlinking here takes effect on the next request.
 */

async function readLink(ctx: ServerContext): Promise<{ refRoomId: string; eventName: string } | null> {
	const [row] = await ctx.db
		.select({ refRoomId: metadata.linkedRefRoomId, eventName: metadata.linkedRefEventName })
		.from(metadata)
		.limit(1);
	if (!row?.refRoomId) {
		return null;
	}
	return { refRoomId: row.refRoomId, eventName: row.eventName ?? '' };
}

/** How a Judge Advisor's note is signed: their name, and that a Judge Advisor wrote it down. */
async function advisorSignature(ctx: ServerContext): Promise<string> {
	const authentication = ctx.auth.authentication;
	const advisorId = authentication.isAccessControlled && authentication.role === 'judge_advisor' ? authentication.judgeAdvisorId : null;
	const [row] = advisorId
		? await ctx.db.select({ name: judgeAdvisors.name }).from(judgeAdvisors).where(eq(judgeAdvisors.id, advisorId)).limit(1)
		: [];
	const name = row?.name?.trim();
	return name && name !== 'Judge Advisor' ? `${name} (Judge Advisor)` : 'Judge Advisor';
}

/** The linked ref room, for a Judge Advisor writing in it. */
async function requireLink(ctx: ServerContext): Promise<{ refRoomId: string; roomId: string }> {
	const link = await readLink(ctx);
	if (!link || !ctx.roomId || !ctx.refLink.refRoomExists(link.refRoomId)) {
		throw new WRPCError("This division isn't linked to referee notes.");
	}
	return { refRoomId: link.refRoomId, roomId: ctx.roomId };
}

/** The room's event group, if this connection is one of its advisors. */
async function groupForAdvisor(ctx: ServerContext): Promise<{ groupId: string; name: string; divisionCount: number } | null> {
	if (!getGroupOrigin(ctx.auth.authentication)) {
		return null;
	}
	const groupId = await getRoomGroupId(ctx.db);
	if (!groupId || !ctx.roomId) {
		return null;
	}
	const description = await ctx.network.group.describe(groupId, ctx.roomId);
	return description ? { groupId, name: description.name, divisionCount: description.divisions.length } : null;
}

export function buildRefLinkRoute(w: WRPCRootObject<object, ServerContext, Record<string, never>>) {
	return {
		getStatus: w.procedure.output(RefLinkStatusSchema).query(async ({ ctx }) => {
			assertAuthenticatedJudgeAdvisor(ctx.auth);

			let link = await readLink(ctx);
			// A ref room deleted on its side leaves this pointing at nothing. Saying it is still
			// linked would be untrue, and would stop this division being linked anywhere else.
			if (link && !ctx.refLink.refRoomExists(link.refRoomId)) {
				await ctx.db.update(metadata).set({ linkedRefRoomId: null, linkedRefEventName: null });
				link = null;
			}

			const group = await groupForAdvisor(ctx);
			return {
				linkedTo: link ? { eventName: link.eventName, refsUsingApp: ctx.refLink.refsUsingApp(link.refRoomId) } : null,
				group: group ? { name: group.name, divisionCount: group.divisionCount } : null,
				emailEnabled: ctx.refLink.emailEnabled()
			};
		}),

		/**
		 * A one-time code the Head Ref enters to link their ref room.
		 *
		 * `group` covers every division of this room's event group, and is offered only to the
		 * group's own advisors: a division's advisor has no say over its sibling divisions.
		 */
		createCode: w.procedure
			.input(z.object({ scope: z.enum(['room', 'group']) }))
			.output(RefLinkCodeResultSchema)
			.mutation(async ({ ctx, input }) => {
				assertAuthenticatedJudgeAdvisor(ctx.auth);
				if (!ctx.roomId) {
					throw new WRPCError('CRITICAL: The room does not know its own id');
				}

				if (input.scope === 'room') {
					return ctx.refLink.createCode({ scope: 'room', roomId: ctx.roomId });
				}

				const group = await groupForAdvisor(ctx);
				if (!group) {
					throw new WRPCError('Only an advisor of the event group can link all of its divisions');
				}
				return ctx.refLink.createCode({ scope: 'group', roomId: ctx.roomId, groupId: group.groupId });
			}),

		/**
		 * Create referee notes for this division (or group), linked from the start, and email
		 * the Head Ref their link. The Judge Advisor never sees that link.
		 *
		 * Runs without the room's lock (runtime/lock-free.ts): it waits on email and on other
		 * rooms, and the link it records here is written by the hub under this room's lock.
		 */
		createRefRoom: w.procedure
			.input(CreateLinkedRefRoomInputSchema)
			.output(z.object({ sentTo: z.string() }))
			.mutation(async ({ ctx, input }) => {
				assertAuthenticatedJudgeAdvisor(ctx.auth);
				if (!ctx.roomId) {
					throw new WRPCError('CRITICAL: The room does not know its own id');
				}
				// The division's own notes, kept by its Judge Advisors, move into the new room. Notes
				// the refs are already using stay put until unlinked.
				const existing = await readLink(ctx);
				if (existing && ctx.refLink.refRoomExists(existing.refRoomId) && ctx.refLink.refsUsingApp(existing.refRoomId)) {
					throw new WRPCError('This division is already linked to referee notes. Unlink it first.');
				}

				let target: { scope: 'room'; roomId: string } | { scope: 'group'; roomId: string; groupId: string };
				if (input.scope === 'room') {
					target = { scope: 'room', roomId: ctx.roomId };
				} else {
					const group = await groupForAdvisor(ctx);
					if (!group) {
						throw new WRPCError('Only an advisor of the event group can set up referee notes for all of its divisions');
					}
					target = { scope: 'group', roomId: ctx.roomId, groupId: group.groupId };
				}

				const result = await ctx.refLink.createRefRoom(target, input.headReferee);
				if (!result.ok) {
					throw new WRPCError(result.error);
				}
				return { sentTo: result.sentTo };
			}),

		/**
		 * The ref notes about this division's teams, for its Judge Advisors.
		 *
		 * Judge Advisors only, for now. Showing judges the notes for the teams they are judging
		 * would be the same call with the team list narrowed to their judge group's teams — the
		 * narrowing has to happen here, on the server, so a judge's device never receives a note
		 * it should not show.
		 *
		 * The ref room has already dropped every note marked refs only before answering.
		 */
		listNotes: w.procedure.output(JudgeRefNotesSchema).query(async ({ ctx }) => {
			assertAuthenticatedJudgeAdvisor(ctx.auth);
			const link = await readLink(ctx);
			if (!link || !ctx.roomId || !ctx.refLink.refRoomExists(link.refRoomId)) {
				return { linked: false, refsUsingApp: false, notes: [] };
			}
			const teamNumbers = (await ctx.db.select({ number: teams.number }).from(teams)).map((row) => row.number);
			const notes = await ctx.refLink.notes(link.refRoomId, ctx.roomId, teamNumbers);
			return notes === null
				? { linked: false, refsUsingApp: false, notes: [] }
				: { linked: true, refsUsingApp: ctx.refLink.refsUsingApp(link.refRoomId), notes };
		}),

		/**
		 * Start referee notes for this division, with no refs in them yet, so its Judge Advisors
		 * can write down what the refs tell them. New rooms get these automatically; this is for
		 * a room that predates that, or was unlinked.
		 *
		 * Runs without the room's lock (runtime/lock-free.ts): the hub records the link under it.
		 */
		start: w.procedure.mutation(async ({ ctx }) => {
			assertAuthenticatedJudgeAdvisor(ctx.auth);
			if (!ctx.roomId) {
				throw new WRPCError('CRITICAL: The room does not know its own id');
			}
			const result = await ctx.refLink.createUnclaimedRefRoom(ctx.roomId);
			if (!result.ok) {
				throw new WRPCError(result.error);
			}
		}),

		/**
		 * Write down, or correct, a note the refs passed on. Judge Advisors only, and only about
		 * this division's own teams.
		 *
		 * Runs without the room's lock (runtime/lock-free.ts): it waits on the ref room's, and a
		 * Judges' Room must never hold its own while doing that. It only reads here.
		 */
		saveNote: w.procedure.input(JudgeRefNoteInputSchema).mutation(async ({ ctx, input }) => {
			assertAuthenticatedJudgeAdvisor(ctx.auth);
			const link = await requireLink(ctx);
			const [team] = await ctx.db.select({ number: teams.number }).from(teams).where(eq(teams.number, input.teamNumber)).limit(1);
			if (!team) {
				throw new WRPCError(`Team ${input.teamNumber} isn't in this division.`);
			}
			try {
				await ctx.refLink.saveJudgeNote(link.refRoomId, link.roomId, input, await advisorSignature(ctx));
			} catch (error) {
				throw new WRPCError(error instanceof Error ? error.message : String(error));
			}
		}),

		/**
		 * A judge passing on something about one of their teams. Judges only, and write-only:
		 * nothing comes back, not even the note they sent, because judges are not shown ref
		 * notes. The division's Judge Advisors see it, signed with the judge's name.
		 *
		 * "Their teams" are their judge group's assigned teams; with walk-in judging there are
		 * no assignments, so any team in the division.
		 *
		 * Runs without the room's lock (runtime/lock-free.ts), like saveNote. It only reads here.
		 */
		submitNote: w.procedure.input(JudgeRefNoteInputSchema).mutation(async ({ ctx, input }) => {
			const judgeId = ctx.auth.getJudgeId();
			if (!ctx.auth.isAuthenticatedJudge() || !judgeId) {
				throw new WRPCError('Only a judge can send a note this way');
			}
			const [judge] = await ctx.db
				.select({ name: judges.name, groupId: judges.groupId })
				.from(judges)
				.where(eq(judges.id, judgeId))
				.limit(1);
			if (!judge) {
				throw new WRPCError('Judge not found');
			}

			const [team] = await ctx.db.select({ id: teams.id }).from(teams).where(eq(teams.number, input.teamNumber)).limit(1);
			if (!team) {
				throw new WRPCError(`Team ${input.teamNumber} isn't in this division.`);
			}
			const [event] = await ctx.db.select({ judgingMethod: metadata.judgingMethod }).from(metadata).limit(1);
			if (event?.judgingMethod === 'assigned') {
				const [assigned] = await ctx.db
					.select({ teamId: judgeGroupsAssignedTeams.teamId })
					.from(judgeGroupsAssignedTeams)
					.where(and(eq(judgeGroupsAssignedTeams.judgeGroupId, judge.groupId), eq(judgeGroupsAssignedTeams.teamId, team.id)))
					.limit(1);
				if (!assigned) {
					throw new WRPCError(`Team ${input.teamNumber} isn't one of your judge group's teams.`);
				}
			}

			const link = await readLink(ctx);
			if (!link || !ctx.roomId || !ctx.refLink.refRoomExists(link.refRoomId)) {
				throw new WRPCError("Referee notes aren't set up for this division yet. Ask your Judge Advisor.");
			}
			try {
				await ctx.refLink.saveJudgeNote(link.refRoomId, ctx.roomId, input, `${judge.name} (Judge)`, { createOnly: true });
			} catch (error) {
				throw new WRPCError(error instanceof Error ? error.message : String(error));
			}
		}),

		removeNote: w.procedure.input(z.object({ id: z.uuidv4() })).mutation(async ({ ctx, input }) => {
			assertAuthenticatedJudgeAdvisor(ctx.auth);
			const link = await requireLink(ctx);
			try {
				await ctx.refLink.removeJudgeNote(link.refRoomId, link.roomId, input.id);
			} catch (error) {
				throw new WRPCError(error instanceof Error ? error.message : String(error));
			}
		}),

		unlink: w.procedure.mutation(async ({ ctx }) => {
			assertAuthenticatedJudgeAdvisor(ctx.auth);
			const link = await readLink(ctx);
			if (!link || !ctx.roomId) {
				return;
			}
			// Local first: from this moment the ref room's reads are refused. Telling it is
			// housekeeping so its list stays accurate.
			await ctx.db.update(metadata).set({ linkedRefRoomId: null, linkedRefEventName: null });
			ctx.refLink.divisionUnlinked(link.refRoomId, ctx.roomId);
		})
	};
}
