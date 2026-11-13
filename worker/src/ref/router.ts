import { z } from 'zod';
import { initWRPC } from '@robotools.app/wrpc/server';
import { WRPCError } from '@robotools.app/wrpc/server/types';
import {
	IncidentInputSchema,
	IncidentSchema,
	LinkedDivisionSchema,
	RefLinkCodeSchema,
	RefCloseReason,
	RefEmailSendResultSchema,
	RefereeNameSchema,
	RefereeRoleSchema,
	RefereeSchema,
	RefJoiningKitSchema,
	RefMatchesSnapshotSchema,
	RefTeamSchema,
	buildRefRoomJoinUrl,
	type LinkedDivision,
	type RefEmailSendResult,
	type RefTeam,
	type RefMatchesSnapshot
} from '@robotools.app/protocol/src/ref';
import { JudgeEmailSchema, MAX_ACCESS_LINK_EMAILS_PER_SEND } from '@robotools.app/protocol/src/email';
import { SEND_CONCURRENCY, claimSendWindow, mapWithConcurrency, recordSend } from '../email/throttle';
import type { AppDatabase } from '../runtime/storage';
import type { EmailContext } from '../server-router';
import type { RefClientRouter } from '@robotools.app/web/src/lib/ref/ref-client-router-def';
import { buildRefAccessLinkEmail } from '../email/template';
import { describeSmtpFailure } from '../email/smtp';
import {
	addReferee,
	getIncidents,
	getLinkedDivisions,
	getRefEvent,
	getRefereeRow,
	getRefereeRows,
	getReferees,
	getRefTeams,
	removeIncident,
	removeReferee,
	replaceRefTeams,
	rotateRefereeToken,
	saveIncident,
	updateReferee,
	type RefereeRow
} from './store';

/** What the room does on a route's behalf that the route cannot do with the database alone. */
export interface RefRoomOps {
	/** Disconnect every device signed in as this ref, except the one asking. */
	kickReferee(refereeId: string, reason: RefCloseReason, exceptClientId?: string): Promise<void>;
	matches(force: boolean): Promise<RefMatchesSnapshot>;
	destroy(): Promise<void>;
	/** This room's teams plus every linked division's. */
	teams(): Promise<RefTeam[]>;
	linkWithCode(code: string): Promise<LinkedDivision[]>;
	unlink(judgesRoomId: string | null): Promise<void>;
	/** Signal linked Judges' Rooms that their view of the notes may have changed. */
	notesChanged(): void;
}

export interface RefServerContext {
	db: AppDatabase;
	roomId: string;
	/** The ref this socket was opened as. Their role is re-read on every call, never trusted from here. */
	refereeId: string;
	email: EmailContext;
	ops: RefRoomOps;
}

const w = initWRPC.createServer<RefServerContext>();

/**
 * Who is calling, read fresh from the database.
 *
 * Never from the socket. A ref demoted, renamed or removed a moment ago must be treated as
 * what they are now, not what they were when they connected — and reading it per call means
 * a role change needs no reconnect to take effect.
 */
async function requireReferee(ctx: RefServerContext): Promise<RefereeRow> {
	const row = await getRefereeRow(ctx.db, ctx.refereeId);
	if (!row) {
		throw new WRPCError('Your access to this ref room has been removed');
	}
	return row;
}

async function requireHeadReferee(ctx: RefServerContext): Promise<RefereeRow> {
	const row = await requireReferee(ctx);
	if (row.role !== 'head_referee') {
		throw new WRPCError('Only a Head Referee can do that');
	}
	return row;
}

/**
 * Run a store call and pass its refusals through to the ref.
 *
 * wrpc reports anything that is not a WRPCError as "Internal server error", which would hide
 * answers like "keep at least one Head Referee" — those are the ref's to read, not faults.
 */
async function userFacing<T>(fn: () => Promise<T>): Promise<T> {
	try {
		return await fn();
	} catch (error) {
		if (error instanceof WRPCError) {
			throw error;
		}
		throw new WRPCError(error instanceof Error ? error.message : String(error));
	}
}

function linkFor(ctx: RefServerContext, row: RefereeRow): string {
	return buildRefRoomJoinUrl(ctx.email.publicOrigin, ctx.roomId, row.authToken);
}

const RefereeInputSchema = z.object({
	name: RefereeNameSchema,
	role: RefereeRoleSchema,
	email: JudgeEmailSchema.nullable()
});

export const refServerRouter = w.router({
	session: {
		join: w.procedure.output(RefJoiningKitSchema).mutation(async ({ ctx }) => {
			const self = await requireReferee(ctx);
			const event = await getRefEvent(ctx.db);
			if (!event) {
				throw new WRPCError('Ref room not found');
			}
			return {
				event,
				self: { refereeId: self.id, name: self.name, role: self.role },
				referees: await getReferees(ctx.db),
				teams: await ctx.ops.teams(),
				incidents: await getIncidents(ctx.db),
				emailCapability: { enabled: ctx.email.sender.enabled, fromAddress: ctx.email.sender.fromAddress },
				linkedDivisions: await getLinkedDivisions(ctx.db)
			};
		})
	},

	incidents: {
		save: w.procedure
			.input(IncidentInputSchema)
			.output(IncidentSchema)
			.mutation(async ({ ctx, input, session }) => {
				const self = await requireReferee(ctx);
				const saved = await userFacing(() => saveIncident(ctx.db, input, { refereeId: self.id, role: self.role, name: self.name }));
				void session.broadcast<RefClientRouter>().onIncidentSaved.mutation(saved);
				// Including a note just made refs only: Judge Advisors must stop seeing it.
				ctx.ops.notesChanged();
				return saved;
			}),

		remove: w.procedure
			.input(z.object({ id: z.uuidv4() }))
			.output(z.object({ removed: z.boolean() }))
			.mutation(async ({ ctx, input, session }) => {
				const self = await requireReferee(ctx);
				const removed = await userFacing(() => removeIncident(ctx.db, input.id, { refereeId: self.id, role: self.role }));
				if (removed) {
					void session.broadcast<RefClientRouter>().onIncidentRemoved.mutation({ id: input.id });
					ctx.ops.notesChanged();
				}
				return { removed };
			})
	},

	referees: {
		add: w.procedure
			.input(RefereeInputSchema)
			.output(RefereeSchema)
			.mutation(async ({ ctx, input, session }) => {
				await requireHeadReferee(ctx);
				const row = await addReferee(ctx.db, input);
				void session.broadcast<RefClientRouter>().onRefereesUpdate.mutation(await getReferees(ctx.db));
				return { id: row.id, name: row.name, role: row.role, email: row.email };
			}),

		update: w.procedure
			.input(RefereeInputSchema.extend({ refereeId: z.uuidv4() }))
			.output(RefereeSchema)
			.mutation(async ({ ctx, input, session }) => {
				await requireHeadReferee(ctx);
				const { after } = await userFacing(() => updateReferee(ctx.db, input.refereeId, input));
				void session.broadcast<RefClientRouter>().onRefereesUpdate.mutation(await getReferees(ctx.db));
				return { id: after.id, name: after.name, role: after.role, email: after.email };
			}),

		remove: w.procedure.input(z.object({ refereeId: z.uuidv4() })).mutation(async ({ ctx, input, session }) => {
			await requireHeadReferee(ctx);
			await userFacing(() => removeReferee(ctx.db, input.refereeId));
			await ctx.ops.kickReferee(input.refereeId, RefCloseReason.ACCESS_CHANGED);
			void session.broadcast<RefClientRouter>().onRefereesUpdate.mutation(await getReferees(ctx.db));
			// Their incidents lost the author id; resend them so every device agrees.
			for (const incident of (await getIncidents(ctx.db)).filter((item) => item.authorRefereeId === null)) {
				void session.broadcast<RefClientRouter>().onIncidentSaved.mutation(incident);
			}
		}),

		/**
		 * A ref's link token, for the Head Ref to copy or show as a QR code.
		 *
		 * The token rather than a whole link, because the page builds the link from its own
		 * address: a server with no email set up has no public address configured to build one
		 * from, and copying a link must not depend on email being set up.
		 */
		getLink: w.procedure
			.input(z.object({ refereeId: z.uuidv4() }))
			.output(z.object({ authToken: z.string() }))
			.query(async ({ ctx, input }) => {
				await requireHeadReferee(ctx);
				const row = await getRefereeRow(ctx.db, input.refereeId);
				if (!row) {
					throw new WRPCError('Referee not found');
				}
				return { authToken: row.authToken };
			}),

		/**
		 * Replace a ref's link. Every device using the old one is signed out at once — except
		 * the one asking, so a Head Ref replacing their own link keeps working.
		 */
		rotateLink: w.procedure
			.input(z.object({ refereeId: z.uuidv4() }))
			.output(z.object({ authToken: z.string() }))
			.mutation(async ({ ctx, input, session }) => {
				await requireHeadReferee(ctx);
				const row = await userFacing(() => rotateRefereeToken(ctx.db, input.refereeId));
				await ctx.ops.kickReferee(
					input.refereeId,
					RefCloseReason.ACCESS_CHANGED,
					input.refereeId === ctx.refereeId ? session.currentClient.clientId : undefined
				);
				return { authToken: row.authToken };
			}),

		/**
		 * Email one ref, several, or every ref with an address, their own link.
		 *
		 * The same rules as emailing judges (routes/access.ts): never automatic, paced by the
		 * shared send window, capped per send, and reported per recipient so a send-all that
		 * hits one bad address still says who did get theirs. Runs outside the room lock
		 * (REF_LOCK_FREE_REQUESTS) because SMTP can take seconds; it writes nothing.
		 */
		sendLinks: w.procedure
			.input(z.object({ refereeIds: z.array(z.uuidv4()).min(1).max(MAX_ACCESS_LINK_EMAILS_PER_SEND).nullable() }))
			.output(z.object({ results: z.array(RefEmailSendResultSchema) }))
			.mutation(async ({ ctx, input }) => {
				await requireHeadReferee(ctx);
				if (!ctx.email.sender.enabled) {
					throw new WRPCError('Email is not set up on this server. Copy the link or show the QR code instead.');
				}

				const retryAfterMs = claimSendWindow(ctx.roomId);
				if (retryAfterMs > 0) {
					throw new WRPCError(`Sending too quickly — try again in ${Math.ceil(retryAfterMs / 1000)}s`);
				}

				const event = await getRefEvent(ctx.db);
				const all = await getRefereeRows(ctx.db);
				// Filtered against this room's own refs rather than trusted, so an id from
				// elsewhere cannot be used to probe whether it exists here.
				const wanted = input.refereeIds === null ? all : all.filter((row) => input.refereeIds!.includes(row.id));
				if (wanted.length > MAX_ACCESS_LINK_EMAILS_PER_SEND) {
					throw new WRPCError(`Cannot send more than ${MAX_ACCESS_LINK_EMAILS_PER_SEND} emails at once`);
				}

				const addressed = wanted.filter((row) => !!row.email);
				recordSend(ctx.roomId, addressed.length);

				const sent = await mapWithConcurrency(addressed, SEND_CONCURRENCY, async (row): Promise<RefEmailSendResult> => {
					const email = row.email!;
					try {
						await ctx.email.sender.send(
							buildRefAccessLinkEmail({
								to: email,
								refereeName: row.name,
								eventName: event?.eventName ?? 'your event',
								link: linkFor(ctx, row),
								headReferee: row.role === 'head_referee'
							})
						);
						return { refereeId: row.id, name: row.name, email, outcome: 'sent' };
					} catch (error) {
						const reason = describeSmtpFailure(error);
						// Without the message body: it holds the link, and logs are no place for one.
						console.error(`Failed to email a referee ${row.id} their link:`, reason);
						return { refereeId: row.id, name: row.name, email, outcome: 'failed', error: reason.slice(0, 300) };
					}
				});

				const byId = new Map(sent.map((result) => [result.refereeId, result]));
				return {
					results: wanted.map(
						(row) => byId.get(row.id) ?? { refereeId: row.id, name: row.name, email: null, outcome: 'no_address' as const }
					)
				};
			})
	},

	event: {
		/** For late registrations: replace the team list. Incidents are kept. */
		replaceTeams: w.procedure.input(z.object({ teams: z.array(RefTeamSchema).max(2000) })).mutation(async ({ ctx, input, session }) => {
			await requireHeadReferee(ctx);
			replaceRefTeams(ctx.db, input.teams);
			void session.broadcast<RefClientRouter>().onTeamsUpdate.mutation(await getRefTeams(ctx.db));
		}),

		destroy: w.procedure.mutation(async ({ ctx }) => {
			await requireHeadReferee(ctx);
			await ctx.ops.destroy();
		})
	},

	/**
	 * Linking to Judges' Rooms. Head Refs only. A link lets this room read each division's
	 * team list and schedule; each Judges' Room decides for itself, every time, whether that
	 * is still allowed.
	 */
	links: {
		link: w.procedure
			.input(z.object({ code: RefLinkCodeSchema }))
			.output(z.array(LinkedDivisionSchema))
			.mutation(async ({ ctx, input }) => {
				await requireHeadReferee(ctx);
				return userFacing(() => ctx.ops.linkWithCode(input.code));
			}),

		/** Unlink one division, or all of them. */
		unlink: w.procedure.input(z.object({ judgesRoomId: z.uuidv4().nullable() })).mutation(async ({ ctx, input }) => {
			await requireHeadReferee(ctx);
			await userFacing(() => ctx.ops.unlink(input.judgesRoomId));
		})
	},

	matches: {
		/** The schedule across every division. Runs outside the room lock; see REF_LOCK_FREE_REQUESTS. */
		getSnapshot: w.procedure
			.input(z.object({ force: z.boolean().default(false) }).default({ force: false }))
			.output(RefMatchesSnapshotSchema)
			.query(async ({ ctx, input }) => {
				await requireReferee(ctx);
				return ctx.ops.matches(input.force);
			})
	}
});

export type RefServerRouter = typeof refServerRouter;
