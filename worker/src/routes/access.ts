import {
	AccessLinksSchema,
	AuthTokenSchema,
	JudgeAdvisorIdSchema,
	JudgeAdvisorNameSchema,
	JUDGE_ADVISOR_SINGLETON_ID,
	getGroupOrigin,
	buildJudgesRoomJoinUrl
} from '@robotools.app/protocol/src/access';
import {
	JudgeEmailSchema,
	MAX_ACCESS_LINK_EMAILS_PER_SEND,
	SendAccessLinkEmailsResultSchema,
	type EmailSendResult
} from '@robotools.app/protocol/src/email';
import { buildAccessLinkEmail, buildAdvisorAccessLinkEmail } from '../email/template';
import { describeSmtpFailure } from '../email/smtp';
import { SEND_CONCURRENCY, claimSendWindow, mapWithConcurrency, recordSend } from '../email/throttle';
import { groupScopedAdvisorId, isGroupScopedAdvisorId } from '@robotools.app/protocol/src/group';
import { getRoomGroupId } from '../group/gateway';
import type { GroupAdvisor } from '@robotools.app/protocol/src/group';
import { uuidv4 } from '@robotools.app/protocol/src/utils';
import { judgeAdvisors } from '../db/schema';
import type { WRPCRootObject } from '@robotools.app/wrpc/server';
import { eq } from 'drizzle-orm';
import z from 'zod';
import {
	assertAuthenticatedJudgeAdvisor,
	generateAuthToken,
	countJudgeAdvisors,
	getJudgeAdvisors,
	setJudgeAdvisorEmail,
	upsertJudgeAdvisorAuthToken
} from '../access/tokens';
import { judges, metadata } from '../db/schema';
import type { ClientRouter } from '../client-router';
import type { ServerContext } from '../server-router';
import { WRPCError } from '@robotools.app/wrpc/server/types';
import { broadcastDeviceListUpdate } from './device';
import { notifyAuthenticationChange } from './notify';

/**
 * The group's advisors, as this room sees them: names only, never tokens.
 * Empty for a standalone room, or for one whose group no longer lists it.
 */
async function listGroupAdvisorsForRoom(ctx: ServerContext): Promise<GroupAdvisor[]> {
	const groupId = await getRoomGroupId(ctx.db);
	if (!groupId || !ctx.roomId) {
		return [];
	}

	try {
		const description = await ctx.network.group.describe(groupId, ctx.roomId);
		return description?.advisors ?? [];
	} catch (error) {
		// A group that cannot be reached must not take the Users dialog down with it. The
		// room's own advisors are unaffected, and connect-time validation fails closed.
		console.error('Failed to read group advisors:', error);
		return [];
	}
}

/**
 * How many advisors the group would still reach this room with.
 *
 * Fails closed at zero: if the group cannot be reached, the room falls back to counting
 * only what it can see, and refuses a removal it cannot prove is safe.
 */
async function countGroupAdvisorsForRoom(ctx: ServerContext): Promise<number> {
	const groupId = await getRoomGroupId(ctx.db);
	if (!groupId || !ctx.roomId) {
		return 0;
	}

	try {
		return await ctx.network.group.advisorCount(groupId, ctx.roomId);
	} catch (error) {
		console.error('Failed to count group advisors:', error);
		return 0;
	}
}

/** Refuse an action that only makes sense for a Judge Advisor the room itself administers. */
function assertRoomAdministeredAdvisor(judgeAdvisorId: string): void {
	if (isGroupScopedAdvisorId(judgeAdvisorId)) {
		throw new WRPCError('That Judge Advisor is managed by the event group — change it there');
	}
}

export function buildAccessRoute(w: WRPCRootObject<object, ServerContext, Record<string, never>>) {
	return {
		listAccessLinks: w.procedure.output(AccessLinksSchema).query(async ({ ctx }) => {
			assertAuthenticatedJudgeAdvisor(ctx.auth);

			const advisors = await getJudgeAdvisors(ctx.db);
			// A room shows Judge Advisors from two places: its own rows, and the group's.
			// Both are Judge Advisors here with the same powers; what differs is where they
			// are administered, which is why group entries carry no token and no room
			// action can remove them.
			const groupAdvisors = await listGroupAdvisorsForRoom(ctx);

			if (advisors.length + groupAdvisors.length === 0) {
				throw new WRPCError('CRITICAL: No Judge Advisor access token');
			}

			const judgeRows = await ctx.db
				.select({ judgeId: judges.id, name: judges.name, authToken: judges.authToken, email: judges.email })
				.from(judges);

			return {
				emailCapability: {
					enabled: ctx.email.sender.enabled,
					fromAddress: ctx.email.sender.fromAddress
				},
				judgeAdvisors: [
					...advisors.map((advisor) => ({
						judgeAdvisorId: advisor.id,
						name: advisor.name,
						authToken: advisor.authToken,
						email: advisor.email,
						origin: 'room' as const
					})),
					...groupAdvisors.map((advisor) => ({
						// Prefixed so this row lines up with the connections it owns, which
						// carry the same scoped id.
						judgeAdvisorId: groupScopedAdvisorId(advisor.groupAdvisorId),
						name: advisor.name,
						// SAFETY: the group never hands a member room a credential, so there is
						// nothing here to leak even if this room is compromised.
						authToken: null,
						// Administered at the group, along with the token, so the room neither
						// holds it nor could change it.
						email: null,
						origin: 'group' as const
					}))
				],
				judges: judgeRows.map((row) => ({
					judgeId: row.judgeId,
					name: row.name,
					authToken: row.authToken,
					email: row.email
				}))
			};
		}),

		rotateJudgeAuth: w.procedure
			.input(z.object({ judgeId: z.uuidv4() }))
			.output(z.object({ authToken: AuthTokenSchema }))
			.mutation(async ({ ctx, input, session }) => {
				assertAuthenticatedJudgeAdvisor(ctx.auth);

				const authToken = generateAuthToken();
				const updated = await ctx.db.update(judges).set({ authToken }).where(eq(judges.id, input.judgeId)).returning();
				if (updated.length === 0) {
					throw new WRPCError('CRITICAL: Judge not found');
				}

				await ctx.network.kickJudge(input.judgeId);

				// Always broadcast: already-offline kicks do not get a webSocketClose update.
				broadcastDeviceListUpdate(ctx, session);

				return { authToken };
			}),

		/**
		 * Record, change or clear where a judge's link is emailed.
		 *
		 * Storing an address sends nothing. That separation is the point: a mistyped
		 * address caught before anyone presses Send costs nothing, whereas a save that
		 * also sends has already delivered a working credential to a stranger.
		 */
		setJudgeEmail: w.procedure
			.input(z.object({ judgeId: z.uuidv4(), email: JudgeEmailSchema.nullable() }))
			.output(z.object({ email: JudgeEmailSchema.nullable() }))
			.mutation(async ({ ctx, input }) => {
				assertAuthenticatedJudgeAdvisor(ctx.auth);

				const email = input.email?.trim().toLowerCase() || null;
				const updated = await ctx.db.update(judges).set({ email }).where(eq(judges.id, input.judgeId)).returning();
				if (updated.length === 0) {
					throw new WRPCError('CRITICAL: Judge not found');
				}

				return { email };
			}),

		/** Record, change or clear where a Judge Advisor's link is emailed. */
		setJudgeAdvisorEmail: w.procedure
			.input(z.object({ judgeAdvisorId: JudgeAdvisorIdSchema, email: JudgeEmailSchema.nullable() }))
			.output(z.object({ email: JudgeEmailSchema.nullable() }))
			.mutation(async ({ ctx, input }) => {
				assertAuthenticatedJudgeAdvisor(ctx.auth);
				assertRoomAdministeredAdvisor(input.judgeAdvisorId);

				const email = input.email?.trim().toLowerCase() || null;
				if (!(await setJudgeAdvisorEmail(ctx.db, input.judgeAdvisorId, email))) {
					throw new WRPCError('CRITICAL: Judge Advisor not found');
				}

				return { email };
			}),

		/**
		 * Email a Judge Advisor their own access link, or send another advisor theirs.
		 *
		 * Sending to somebody else is allowed on purpose. It looks like a privilege
		 * escalation and is not: this dialog already offers "Show access link" and "Copy
		 * access link" on every advisor's row, so any advisor can already take any other
		 * advisor's credential anywhere they like. Refusing to *mail* it protected nothing
		 * and blocked the one workflow that matters — a second advisor added mid-setup
		 * being able to receive their link the same way the first one did.
		 *
		 * The real boundary is elsewhere: only a Judge Advisor reaches this at all, every
		 * advisor in a room already holds equal powers, and a group-managed advisor is
		 * refused because their credential does not belong to this room.
		 */
		sendAdvisorAccessLinkEmail: w.procedure
			.input(z.object({ judgeAdvisorId: JudgeAdvisorIdSchema.nullable() }).default({ judgeAdvisorId: null }))
			.output(SendAccessLinkEmailsResultSchema)
			.mutation(async ({ ctx, input }) => {
				assertAuthenticatedJudgeAdvisor(ctx.auth);

				if (!ctx.email.sender.enabled) {
					throw new WRPCError('CRITICAL: This server is not configured to send email');
				}
				if (!ctx.roomId) {
					throw new WRPCError('CRITICAL: Room id unavailable');
				}

				// Null means "me", which is what the caller's own row sends.
				const judgeAdvisorId = input.judgeAdvisorId ?? ctx.auth.getJudgeAdvisorId();
				if (!judgeAdvisorId || isGroupScopedAdvisorId(judgeAdvisorId)) {
					throw new WRPCError('That Judge Advisor is managed by the event group — resend it there');
				}

				const retryAfterMs = claimSendWindow(ctx.roomId);
				if (retryAfterMs > 0) {
					throw new WRPCError(`CRITICAL: Sending too quickly — try again in ${Math.ceil(retryAfterMs / 1000)}s`);
				}

				const advisor = (await getJudgeAdvisors(ctx.db)).find((candidate) => candidate.id === judgeAdvisorId);
				if (!advisor) {
					throw new WRPCError('CRITICAL: Judge Advisor not found');
				}
				if (!advisor.email) {
					return { results: [{ judgeId: uuidv4(), name: advisor.name, email: null, outcome: 'no_address' as const }] };
				}

				const [room] = await ctx.db.select({ eventName: metadata.eventName }).from(metadata).limit(1);
				if (!room) {
					throw new WRPCError('CRITICAL: No metadata found');
				}

				// One message: the window claimed above already covers it.
				const result = { judgeId: uuidv4(), name: advisor.name, email: advisor.email };
				try {
					await ctx.email.sender.send(
						buildAdvisorAccessLinkEmail({
							to: advisor.email,
							advisorName: advisor.name,
							contextName: room.eventName,
							link: buildJudgesRoomJoinUrl(ctx.email.publicOrigin, ctx.roomId, advisor.authToken),
							forGroup: false
						})
					);
					return { results: [{ ...result, outcome: 'sent' as const }] };
				} catch (error) {
					const reason = describeSmtpFailure(error);
					console.error(`Failed to email access link to advisor ${judgeAdvisorId}:`, reason);
					return { results: [{ ...result, outcome: 'failed' as const, error: reason }] };
				}
			}),

		/**
		 * Email one judge, or every judge with an address, their own access link.
		 *
		 * One procedure for both because the difference is a list of ids, and having two
		 * would mean two places to keep the throttle, the cap and the failure reporting
		 * consistent.
		 */
		sendAccessLinkEmails: w.procedure
			.input(z.object({ judgeIds: z.array(z.uuidv4()).min(1).max(MAX_ACCESS_LINK_EMAILS_PER_SEND).nullable() }))
			.output(SendAccessLinkEmailsResultSchema)
			.mutation(async ({ ctx, input }) => {
				assertAuthenticatedJudgeAdvisor(ctx.auth);

				if (!ctx.email.sender.enabled) {
					throw new WRPCError('CRITICAL: This server is not configured to send email');
				}
				if (!ctx.roomId) {
					throw new WRPCError('CRITICAL: Room id unavailable');
				}

				const retryAfterMs = claimSendWindow(ctx.roomId);
				if (retryAfterMs > 0) {
					throw new WRPCError(`CRITICAL: Sending too quickly — try again in ${Math.ceil(retryAfterMs / 1000)}s`);
				}

				const [room] = await ctx.db.select({ eventName: metadata.eventName }).from(metadata).limit(1);
				if (!room) {
					throw new WRPCError('CRITICAL: No metadata found');
				}

				const all = await ctx.db
					.select({ judgeId: judges.id, name: judges.name, authToken: judges.authToken, email: judges.email })
					.from(judges);

				// null means "everyone with an address". An explicit list is filtered against
				// the room's own judges rather than trusted, so an id from another room
				// cannot be used to discover whether it exists here.
				const wanted = input.judgeIds === null ? all : all.filter((row) => input.judgeIds!.includes(row.judgeId));

				if (wanted.length > MAX_ACCESS_LINK_EMAILS_PER_SEND) {
					throw new WRPCError(`CRITICAL: Cannot send more than ${MAX_ACCESS_LINK_EMAILS_PER_SEND} emails at once`);
				}

				const addressed = wanted.filter((row) => !!row.email);
				const roomId = ctx.roomId;

				// Stretch the window claimed above to cover the whole batch, before any sending:
				// it has to be in place while the awaits below are outstanding.
				recordSend(roomId, addressed.length);

				const sent = await mapWithConcurrency(addressed, SEND_CONCURRENCY, async (row): Promise<EmailSendResult> => {
					const email = row.email!;
					const message = buildAccessLinkEmail({
						to: email,
						judgeName: row.name,
						eventName: room.eventName,
						link: buildJudgesRoomJoinUrl(ctx.email.publicOrigin, roomId, row.authToken)
					});

					try {
						await ctx.email.sender.send(message);
						return { judgeId: row.judgeId, name: row.name, email, outcome: 'sent' };
					} catch (error) {
						const reason = describeSmtpFailure(error);
						// Logged without the message body — it contains the access token, and
						// server logs are the one place a token has no business being.
						console.error(`Failed to email access link to judge ${row.judgeId}:`, reason);
						return { judgeId: row.judgeId, name: row.name, email, outcome: 'failed', error: reason };
					}
				});

				// Judges with no address are reported too, so a send-all accounts for every
				// judge the caller asked about rather than silently omitting some.
				const byId = new Map(sent.map((result) => [result.judgeId, result]));
				const results: EmailSendResult[] = wanted.map(
					(row) => byId.get(row.judgeId) ?? { judgeId: row.judgeId, name: row.name, email: null, outcome: 'no_address' as const }
				);

				return { results };
			}),

		/**
		 * Add another Judge Advisor with equal powers.
		 *
		 * They get their own access link immediately, which is their whole credential.
		 */
		addJudgeAdvisor: w.procedure
			.input(z.object({ name: JudgeAdvisorNameSchema }))
			.output(z.object({ judgeAdvisorId: JudgeAdvisorIdSchema, authToken: AuthTokenSchema }))
			.mutation(async ({ ctx, input, session }) => {
				assertAuthenticatedJudgeAdvisor(ctx.auth);

				const judgeAdvisorId = uuidv4();
				const authToken = generateAuthToken();
				await upsertJudgeAdvisorAuthToken(ctx.db, authToken, judgeAdvisorId, input.name);

				broadcastDeviceListUpdate(ctx, session);

				return { judgeAdvisorId, authToken };
			}),

		renameJudgeAdvisor: w.procedure
			.input(z.object({ judgeAdvisorId: JudgeAdvisorIdSchema, name: JudgeAdvisorNameSchema }))
			.output(z.object({ success: z.literal(true) }))
			.mutation(async ({ ctx, input }) => {
				assertAuthenticatedJudgeAdvisor(ctx.auth);
				assertRoomAdministeredAdvisor(input.judgeAdvisorId);

				const updated = await ctx.db
					.update(judgeAdvisors)
					.set({ name: input.name })
					.where(eq(judgeAdvisors.id, input.judgeAdvisorId))
					.returning({ id: judgeAdvisors.id });

				if (updated.length === 0) {
					throw new WRPCError('CRITICAL: Judge Advisor not found');
				}

				return { success: true as const };
			}),

		/**
		 * Remove another Judge Advisor and disconnect their devices.
		 *
		 * Two refusals worth stating plainly: you cannot remove yourself (an accidental tap
		 * would sign you out of your own room with no way back), and you cannot remove the
		 * last one (a room with no Judge Advisor and access control on can never be
		 * administered or destroyed again).
		 */
		removeJudgeAdvisor: w.procedure
			.input(z.object({ judgeAdvisorId: JudgeAdvisorIdSchema }))
			.output(z.object({ success: z.literal(true) }))
			.mutation(async ({ ctx, input, session }) => {
				assertAuthenticatedJudgeAdvisor(ctx.auth);
				assertRoomAdministeredAdvisor(input.judgeAdvisorId);

				if (ctx.auth.getJudgeAdvisorId() === input.judgeAdvisorId) {
					throw new WRPCError('You cannot remove yourself as a Judge Advisor');
				}

				// The guard exists so a room can never become unadministrable, and a room in
				// a group is still reachable through the group's advisors. Counting only
				// local rows would either strand a room that leaves its group, or refuse a
				// removal that was perfectly safe — so count both.
				if ((await countJudgeAdvisors(ctx.db)) + (await countGroupAdvisorsForRoom(ctx)) <= 1) {
					throw new WRPCError("CRITICAL: A Judges' Room must keep at least one Judge Advisor");
				}

				const deleted = await ctx.db
					.delete(judgeAdvisors)
					.where(eq(judgeAdvisors.id, input.judgeAdvisorId))
					.returning({ id: judgeAdvisors.id });

				if (deleted.length === 0) {
					throw new WRPCError('CRITICAL: Judge Advisor not found');
				}

				await ctx.network.kickJudgeAdvisor(input.judgeAdvisorId);

				// Always broadcast: already-offline kicks do not get a webSocketClose update.
				broadcastDeviceListUpdate(ctx, session);

				return { success: true as const };
			}),

		rotateJudgeAdvisorAuth: w.procedure.output(z.object({ authToken: AuthTokenSchema })).mutation(async ({ ctx, session }) => {
			assertAuthenticatedJudgeAdvisor(ctx.auth);

			// A group link opens every division, so rotating it is the group's decision, not
			// one division's. Minting a room-local token here would silently downgrade the
			// advisor to this room only.
			if (getGroupOrigin(ctx.auth.authentication)) {
				throw new WRPCError('Your access link belongs to the event group — rotate it there');
			}

			const judgeAdvisorId = ctx.auth.getJudgeAdvisorId();
			if (!judgeAdvisorId) {
				throw new WRPCError('CRITICAL: Only a Judge Advisor can rotate their own access link');
			}

			const authToken = generateAuthToken();
			const authentication = {
				isAccessControlled: true as const,
				authToken,
				role: 'judge_advisor' as const,
				judgeAdvisorId
			};

			// Client ACK first — if this fails, leave DB token and attachment unchanged.
			notifyAuthenticationChange(session.getClient<ClientRouter>(session.currentClient.clientId), authentication);

			// Update only this advisor's token; the others keep theirs.
			await upsertJudgeAdvisorAuthToken(ctx.db, authToken, judgeAdvisorId);

			// Set the authentication of the current client
			ctx.auth.setAuthentication(authentication);

			// Kick this advisor's other devices only — rotating your own link must not sign
			// out your colleagues, whose tokens are untouched.
			for (const c of ctx.network.getAllClientAuthentications()) {
				if (
					c.clientId !== session.currentClient.clientId &&
					c.authentication.isAccessControlled &&
					c.authentication.role === 'judge_advisor' &&
					c.authentication.judgeAdvisorId === judgeAdvisorId
				) {
					await ctx.network.kickClient(c.clientId);
				}
			}

			// Always broadcast: already-offline kicks do not get a webSocketClose update.
			broadcastDeviceListUpdate(ctx, session);

			return { authToken };
		})
	};
}
