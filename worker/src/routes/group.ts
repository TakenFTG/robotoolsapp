import z from 'zod';
import { WRPCError } from '@robotools.app/wrpc/server/types';
import type { WRPCRootObject } from '@robotools.app/wrpc/server';
import { AuthTokenSchema, JudgeAdvisorIdSchema, JudgeAdvisorNameSchema, getGroupOrigin } from '@robotools.app/protocol/src/access';
import {
	DivisionLabelSchema,
	GroupDivisionSchema,
	GroupIdSchema,
	GroupNameSchema,
	buildEventGroupJoinUrl
} from '@robotools.app/protocol/src/group';
import { uuidv4 } from '@robotools.app/protocol/src/utils';
import type { ServerContext } from '../server-router';
import { assertAuthenticatedJudgeAdvisor, getJudgeAdvisors } from '../access/tokens';
import { getRoomGroupId, setRoomGroupId } from '../group/gateway';
import { broadcastDeviceListUpdate } from './device';
import { buildAdvisorAccessLinkEmail } from '../email/template';
import { describeSmtpFailure } from '../email/smtp';

/**
 * A room's side of belonging to an EventGroup.
 *
 * Only three things happen here, and all three need the room's own authority: creating a
 * group from this room, joining this room to an existing one, and leaving. Everything
 * else about a group — its advisors, its other divisions — is administered at
 * the group itself, which is the only place that can revoke any of it.
 */

const GroupMembershipSchema = z.object({
	groupId: GroupIdSchema,
	name: GroupNameSchema,
	divisions: z.array(GroupDivisionSchema),
	advisors: z.array(z.object({ groupAdvisorId: JudgeAdvisorIdSchema, name: JudgeAdvisorNameSchema }))
});

export function buildGroupRoute(w: WRPCRootObject<object, ServerContext, Record<string, never>>) {
	return {
		/** The group this room belongs to, or null. Never includes any group credential. */
		getGroup: w.procedure.output(GroupMembershipSchema.nullable()).query(async ({ ctx }) => {
			assertAuthenticatedJudgeAdvisor(ctx.auth);

			const groupId = await getRoomGroupId(ctx.db);
			if (!groupId) {
				return null;
			}

			const description = await ctx.network.group.describe(groupId, ctx.roomId ?? '');
			if (!description) {
				// The group no longer holds this room. The stale id grants nothing, but there
				// is no reason to keep claiming a membership that has been revoked.
				await setRoomGroupId(ctx.db, null);
				return null;
			}

			return description;
		}),

		/**
		 * Create a group from this room and become its first advisor.
		 *
		 * The returned token is the group access link, shown once. It is the creator's whole
		 * credential, so nobody else is ever shown it.
		 */
		createGroup: w.procedure
			.input(
				z.object({
					name: GroupNameSchema,
					divisionLabel: DivisionLabelSchema
				})
			)
			.output(z.object({ groupId: GroupIdSchema, authToken: AuthTokenSchema }))
			.mutation(async ({ ctx, input }) => {
				assertAuthenticatedJudgeAdvisor(ctx.auth);
				assertRoomOwnAdvisor(ctx, 'create an event group');

				// SAFETY: a group link is a Judge Advisor credential for every room in the
				// group. Attaching a room whose own door is open would hand that room out to
				// anyone holding the group link while giving the group nothing to protect.
				if (!(await ctx.network.isAccessControlEnabled())) {
					throw new WRPCError('Turn on access control before joining this division to an event group');
				}

				if (!ctx.roomId) {
					throw new WRPCError('CRITICAL: The room does not know its own id');
				}

				if (await getRoomGroupId(ctx.db)) {
					throw new WRPCError('This division already belongs to an event group');
				}

				const identity = await callerIdentity(ctx);
				const groupId = uuidv4();
				const result = await ctx.network.group.create(groupId, {
					name: input.name,
					roomId: ctx.roomId,
					divisionLabel: input.divisionLabel,
					// The Judge Advisor creating the group becomes its first group advisor,
					// under the name they already go by here. Asking them to invent a second
					// identity for themselves was noise — it is the same person either way.
					advisorName: identity.name,
					advisorEmail: identity.email
				});

				if (!result.ok) {
					throw new WRPCError(result.error);
				}

				await setRoomGroupId(ctx.db, groupId);

				if (identity.email) {
					await emailGroupAdvisorTheirLink(ctx, {
						to: identity.email,
						advisorName: identity.name,
						groupName: input.name,
						groupId,
						authToken: result.authToken
					});
				}

				return { groupId, authToken: result.authToken };
			}),

		/**
		 * Join this room to a group that already exists.
		 *
		 * Both sides must consent: the caller proves they administer this room (an
		 * authenticated Judge Advisor of it) and presents a group link, which proves they
		 * administer the group. Neither alone is enough to annex the other.
		 */
		attachToGroup: w.procedure
			.input(
				z.object({
					groupId: GroupIdSchema,
					groupAuthToken: AuthTokenSchema,
					divisionLabel: DivisionLabelSchema
				})
			)
			.output(z.object({ success: z.literal(true) }))
			.mutation(async ({ ctx, input, session }) => {
				assertAuthenticatedJudgeAdvisor(ctx.auth);
				assertRoomOwnAdvisor(ctx, 'join this division to an event group');

				if (!(await ctx.network.isAccessControlEnabled())) {
					throw new WRPCError('Turn on access control before joining this division to an event group');
				}

				if (!ctx.roomId) {
					throw new WRPCError('CRITICAL: The room does not know its own id');
				}

				// One group per room. Two would mean two answers to "who may open this room"
				// and two places to revoke, and revocation is the point of the whole design.
				const existing = await getRoomGroupId(ctx.db);
				if (existing && existing !== input.groupId) {
					throw new WRPCError('This division already belongs to a different event group');
				}

				const result = await ctx.network.group.attach(input.groupId, {
					authToken: input.groupAuthToken,
					roomId: ctx.roomId,
					label: input.divisionLabel
				});

				if (!result.ok) {
					throw new WRPCError(result.error);
				}

				await setRoomGroupId(ctx.db, input.groupId);

				// If the group's divisions are linked to a ref room, this one joins that link too.
				ctx.refLink.joinedGroup(ctx.roomId, input.groupId);

				// Group advisors are Judge Advisors here now; the Users dialog should say so.
				broadcastDeviceListUpdate(ctx, session);

				return { success: true as const };
			}),

		/**
		 * Leave the group.
		 *
		 * Reserved for the room's own advisors: a group advisor's authority is over the
		 * group, and letting one detach a room they only reach *through* the group would
		 * let them strand a division nobody local asked to lose.
		 */
		detachFromGroup: w.procedure.output(z.object({ success: z.literal(true) })).mutation(async ({ ctx, session }) => {
			assertAuthenticatedJudgeAdvisor(ctx.auth);
			assertRoomOwnAdvisor(ctx, 'remove this division from its event group');

			const groupId = await getRoomGroupId(ctx.db);
			if (!groupId) {
				throw new WRPCError('This division does not belong to an event group');
			}

			// Local first. If the group call fails the room is already detached and refuses
			// group sessions on the next connect; the reverse order could leave a room that
			// still trusts a group which no longer lists it.
			await setRoomGroupId(ctx.db, null);
			await ctx.network.group.detach(groupId, ctx.roomId ?? '');

			// Every group advisor loses this room. They are still advisors of their own
			// group; they are simply no longer advisors here.
			for (const entry of ctx.network.getAllClientAuthentications()) {
				if (getGroupOrigin(entry.authentication)) {
					await ctx.network.kickClient(entry.clientId);
				}
			}

			broadcastDeviceListUpdate(ctx, session);

			return { success: true as const };
		})
	};
}

/**
 * The name the calling Judge Advisor already goes by in this room.
 *
 * Falls back to the default name rather than failing: a group whose first advisor is
 * called "Judge Advisor" is a cosmetic problem, and refusing to create the group over it
 * would not be.
 */
async function callerName(ctx: ServerContext): Promise<string> {
	return (await callerIdentity(ctx)).name;
}

/**
 * Who is making this request, as the room knows them.
 *
 * A group advisor creating a second group has no row here, so both fall back: the generic
 * name the column defaults to, and no address.
 */
async function callerIdentity(ctx: ServerContext): Promise<{ name: string; email: string | null }> {
	const judgeAdvisorId = ctx.auth.getJudgeAdvisorId();
	if (!judgeAdvisorId) {
		return { name: 'Judge Advisor', email: null };
	}

	const advisors = await getJudgeAdvisors(ctx.db);
	const advisor = advisors.find((candidate) => candidate.id === judgeAdvisorId);
	return { name: advisor?.name ?? 'Judge Advisor', email: advisor?.email ?? null };
}

/**
 * Send a group advisor their group link.
 *
 * Best-effort in the same way room creation is: the group exists by the time this runs, so
 * a mail failure must not undo it or surface as an error the person cannot act on.
 */
async function emailGroupAdvisorTheirLink(
	ctx: ServerContext,
	input: { to: string; advisorName: string; groupName: string; groupId: string; authToken: string }
): Promise<void> {
	if (!ctx.email.sender.enabled) {
		return;
	}

	try {
		await ctx.email.sender.send(
			buildAdvisorAccessLinkEmail({
				to: input.to,
				advisorName: input.advisorName,
				contextName: input.groupName,
				link: buildEventGroupJoinUrl(ctx.email.publicOrigin, input.groupId, input.authToken),
				forGroup: true
			})
		);
	} catch (error) {
		console.error('Failed to email the group advisor their access link:', describeSmtpFailure(error));
	}
}

/**
 * Refuse an action to a Judge Advisor who is only here by way of the group.
 *
 * Group advisors have every judging power a room advisor has. What they do not have is
 * authority over the room's relationship to the group itself — otherwise a single group
 * credential could quietly rewire which rooms it reaches.
 */
function assertRoomOwnAdvisor(ctx: ServerContext, action: string): void {
	if (getGroupOrigin(ctx.auth.authentication)) {
		throw new WRPCError(`Only a Judge Advisor of this division can ${action}`);
	}
}
