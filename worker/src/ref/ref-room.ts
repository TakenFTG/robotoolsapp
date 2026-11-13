import { createWebSocketHandler } from '@robotools.app/wrpc/server';
import { ConnectionCloseCode } from '@robotools.app/wrpc/client';
import type { WebSocket as NodeWebSocket } from 'ws';
import {
	RefCloseReason,
	buildRefRoomJoinUrl,
	type CreateRefRoomRequest,
	type LinkedDivision,
	type RefDivisionMatches,
	type RefMatchesSnapshot,
	type JudgeRefNote,
	type JudgeRefNoteInput,
	type RefEvent,
	type RefTeam
} from '@robotools.app/protocol/src/ref';
import type { RefClientRouter } from '@robotools.app/web/src/lib/ref/ref-client-router-def';
import { MATCH_POLL_INTERVAL_MS } from '@robotools.app/protocol/src/matches';
import type { OpenDatabase, AppDatabase } from '../runtime/storage';
import type { Mutex } from '../runtime/mutex';
import { adaptSocket, type AdaptedSocket } from '../runtime/socket';
import { isLockFreeFrameFor } from '../runtime/lock-free';
import type { EmailContext } from '../server-router';
import { fetchEventMatches } from '../matches/source';
import { buildRefRetentionWarningEmail } from '../email/template';
import { describeSmtpFailure } from '../email/smtp';
import { refMetadata, referees } from './schema';
import {
	addLinkedDivisions,
	createRefRoom,
	createUnclaimedRefRoom,
	getIncidentRows,
	getLinkedDivisions,
	getLinkedGroupId,
	getRefereeByToken,
	getRefMetadata,
	getRefTeams,
	getSharedIncidents,
	hasReferees,
	importIncidentRows,
	isLinkedDivision,
	removeJudgeNote,
	removeLinkedDivision,
	saveJudgeNote,
	type IncidentRow
} from './store';
import type { JudgesLinkGateway, RedeemedDivision } from './link-gateway';
import { refServerRouter, type RefServerContext } from './router';
import { eq } from 'drizzle-orm';

/** The shortest gap the refresh button can force between two RobotEvents calls. */
const MATCH_REFRESH_FLOOR_MS = 30 * 1000;

/**
 * Requests that run without the room's lock. Same bar as the Judges' Room's list in
 * runtime/lock-free.ts: each can wait seconds on something outside the server, and none
 * writes room state.
 *
 *   matches.getSnapshot   may fetch every division's schedule from RobotEvents
 *   referees.sendLinks    SMTP
 */
const REF_LOCK_FREE_REQUESTS = new Map<string, 'query' | 'mutation'>([
	['matches.getSnapshot', 'query'],
	['referees.sendLinks', 'mutation']
]);

export type RefRoomOptions = {
	roomId: string;
	storage: OpenDatabase;
	email: EmailContext;
	/** How this room reaches the Judges' Rooms linked to it. */
	links: JudgesLinkGateway;
	/** Called when the room destroys itself, so the hub can drop it and delete its file. */
	onDestroyed: (roomId: string) => void;
};

export type RefConnectIntention = {
	clientId: string;
	deviceId: string;
	deviceName: string;
	auth: string | null;
};

type RefAttachment = {
	clientId: string;
	deviceId: string;
	refereeId: string;
};

/**
 * One ref room: a database, the sockets attached to it, and who may attach.
 *
 * Built the same way as a Judges' Room (runtime/room.ts) and simpler, because there is no
 * mode without access control: every connection presents a ref's link, and a link that
 * matches nobody is refused. The room is set up over HTTP before anyone connects, so there
 * is no "empty room, first device creates it" path to guard either.
 */
export class RefRoom {
	readonly roomId: string;
	private readonly db: AppDatabase;
	private readonly storage: OpenDatabase;
	private readonly sockets = new Set<AdaptedSocket>();
	private destroyed = false;
	private readonly persisted = new Map<string, unknown>();

	private readonly wsHandler = createWebSocketHandler({
		router: refServerRouter,
		loadData: async () => this.persisted.get('wrpc-data'),
		saveData: async (data) => {
			this.persisted.set('wrpc-data', data);
		},
		destroy: async () => {
			this.destroyed = true;
			this.opts.onDestroyed(this.roomId);
		},
		getWebSocket: (clientId) => this.socketFor(clientId) as unknown as WebSocket | null,
		getClientIdByWebSocket: (ws) => (ws as unknown as AdaptedSocket).clientId,
		onError: (opts) => {
			console.error('Ref WRPC Error:', opts.error.message, opts.error);
		}
	});

	constructor(private readonly opts: RefRoomOptions) {
		this.roomId = opts.roomId;
		this.storage = opts.storage;
		this.db = opts.storage.db;
		void this.wsHandler.initialize();
	}

	get mutex(): Mutex {
		return this.storage.mutex;
	}

	get hasConnections(): boolean {
		return this.sockets.size > 0;
	}

	get isDestroyed(): boolean {
		return this.destroyed;
	}

	private socketFor(clientId: string): AdaptedSocket | null {
		for (const socket of this.sockets) {
			if (socket.clientId === clientId) {
				return socket;
			}
		}
		return null;
	}

	private contextFor(socket: AdaptedSocket): RefServerContext {
		const attachment = socket.deserializeAttachment() as RefAttachment | null;
		if (!attachment) {
			throw new Error('CRITICAL: Missing WebSocket attachment');
		}
		return {
			db: this.db,
			roomId: this.roomId,
			refereeId: attachment.refereeId,
			email: this.opts.email,
			ops: {
				kickReferee: (refereeId, reason, exceptClientId) => this.kickReferee(refereeId, reason, exceptClientId),
				matches: (force) => this.matches(force),
				destroy: () => this.destroy(),
				teams: () => this.teams(),
				linkWithCode: (code) => this.linkWithCode(code),
				unlink: (judgesRoomId) => this.unlink(judgesRoomId),
				notesChanged: () => this.notesChanged()
			}
		};
	}

	// ============================================================================
	// Setup
	// ============================================================================

	create(input: CreateRefRoomRequest): { refereeId: string; authToken: string } {
		return createRefRoom(this.db, input);
	}

	/** Set up with no referees: the room made alongside a Judges' Room. See createUnclaimedRefRoom. */
	createUnclaimed(event: RefEvent): void {
		createUnclaimedRefRoom(this.db, event);
	}

	async metadataRow() {
		return getRefMetadata(this.db);
	}

	/** Whether any ref can open this room. A plain read, safe without the lock. */
	hasReferees(): boolean {
		if (this.destroyed) {
			return false;
		}
		return hasReferees(this.db);
	}

	// ============================================================================
	// Connections
	// ============================================================================

	/**
	 * Attach an accepted socket, if its link belongs to a ref in this room.
	 *
	 * Refusals are an accepted socket closed with a readable reason, because browser code
	 * cannot read the status of a failed upgrade but can read a close reason.
	 */
	async attach(raw: NodeWebSocket, intention: RefConnectIntention): Promise<void> {
		const socket = adaptSocket(raw);
		raw.pause();

		const admission = await this.admit(intention.auth);
		if (!admission.allowed) {
			socket.close(ConnectionCloseCode.KICKED, admission.reason);
			// Reading has to resume for the close to finish: the client answers our close frame,
			// and a paused socket never reads that answer, so the refused device would sit
			// waiting about thirty seconds for ws's close timeout before learning why.
			raw.resume();
			return;
		}

		socket.clientId = intention.clientId;
		socket.serializeAttachment({
			clientId: intention.clientId,
			deviceId: intention.deviceId,
			refereeId: admission.refereeId
		} satisfies RefAttachment);

		this.sockets.add(socket);
		void this.stampActivity();

		raw.on('message', (data: unknown) => {
			const message = typeof data === 'string' ? data : Buffer.isBuffer(data) ? data.toString('utf8') : String(data);

			// Replies, pings and the slow read-only requests skip the lock. See runtime/room.ts
			// for why replies in particular must: a handler awaiting a client's reply while
			// holding the lock would otherwise wait for itself.
			if (isLockFreeFrameFor(REF_LOCK_FREE_REQUESTS, message)) {
				try {
					void this.wsHandler.handleMessage(socket as unknown as WebSocket, message, this.contextFor(socket));
				} catch (error) {
					console.error('Failed to handle a lock-free ref frame:', error);
				}
				return;
			}

			void this.mutex.run(() => this.wsHandler.handleMessage(socket as unknown as WebSocket, message, this.contextFor(socket)));
		});

		raw.on('close', (code: number, reason: Buffer) => {
			void this.mutex.run(async () => {
				this.sockets.delete(socket);
				if (this.destroyed) {
					return;
				}
				await this.wsHandler.handleClose(socket as unknown as WebSocket, code, reason.toString());
				await this.stampActivity();
			});
		});

		raw.on('error', (error: Error) => {
			this.wsHandler.handleError(socket as unknown as WebSocket, error);
		});

		await this.wsHandler.handleConnection(socket as unknown as WebSocket, {
			roomId: this.roomId,
			clientId: intention.clientId,
			deviceId: intention.deviceId,
			deviceName: intention.deviceName
		});

		raw.resume();
	}

	private async admit(auth: string | null): Promise<{ allowed: true; refereeId: string } | { allowed: false; reason: RefCloseReason }> {
		if (!(await getRefMetadata(this.db))) {
			return { allowed: false, reason: RefCloseReason.ROOM_NOT_FOUND };
		}
		if (!auth) {
			return { allowed: false, reason: RefCloseReason.ACCESS_LINK_REQUIRED };
		}
		const referee = await getRefereeByToken(this.db, auth);
		if (!referee) {
			return { allowed: false, reason: RefCloseReason.INVALID_ACCESS_LINK };
		}
		return { allowed: true, refereeId: referee.id };
	}

	/**
	 * Disconnect every device signed in as this ref.
	 *
	 * Closed with a reason the client recognises, so a removed ref is told why rather than
	 * left retrying a link that will never work again.
	 */
	async kickReferee(refereeId: string, reason: RefCloseReason, exceptClientId?: string): Promise<void> {
		for (const socket of [...this.sockets]) {
			const attachment = socket.deserializeAttachment() as RefAttachment | null;
			if (!attachment || attachment.refereeId !== refereeId || attachment.clientId === exceptClientId) {
				continue;
			}
			try {
				socket.close(ConnectionCloseCode.KICKED, reason);
			} catch {
				// Already closing.
			}
			await this.wsHandler.connectionManager.kickClient(attachment.clientId);
		}
	}

	async destroy(): Promise<void> {
		// Release the linked divisions first, so none is left pointing at a room that is gone.
		for (const division of await getLinkedDivisions(this.db)) {
			try {
				await this.opts.links.unlink(division.judgesRoomId, this.roomId);
				this.opts.links.notesChanged(division.judgesRoomId, this.roomId);
			} catch (error) {
				console.error('Failed to unlink division while destroying ref room', division.judgesRoomId, error);
			}
		}
		// Closes every socket with ROOM_DESTROYED, then calls back into destroy above.
		await this.wsHandler.connectionManager.destroy();
	}

	closeConnections(): void {
		for (const socket of this.sockets) {
			try {
				socket.close(ConnectionCloseCode.GOING_AWAY, 'Server shutting down');
			} catch {
				// Already closing.
			}
		}
		this.sockets.clear();
	}

	close(): void {
		this.closeConnections();
		this.storage.close();
	}

	// ============================================================================
	// Linked Judges' Rooms
	// ============================================================================

	/**
	 * The team list: this room's own, plus every linked division's.
	 *
	 * Read from the linked rooms each time rather than copied in, so a late registration
	 * entered by the Judge Advisor shows up here without anyone re-importing. A linked room
	 * that says it is no longer linked is dropped from the list. Runs under this room's lock.
	 */
	async teams(): Promise<RefTeam[]> {
		const byNumber = new Map<string, RefTeam>();
		for (const team of await getRefTeams(this.db)) {
			byNumber.set(team.number, team);
		}

		let dropped = false;
		for (const division of await getLinkedDivisions(this.db)) {
			const teams = await this.opts.links.teams(division.judgesRoomId, this.roomId);
			if (teams === null) {
				await removeLinkedDivision(this.db, division.judgesRoomId);
				dropped = true;
				continue;
			}
			for (const team of teams) {
				byNumber.set(team.number, team);
			}
		}
		if (dropped) {
			this.invalidateMatches();
			void this.broadcastLinkedDivisions();
		}

		return [...byNumber.values()].sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true }));
	}

	/**
	 * Notes a linked division may see, for its Judge Advisors.
	 *
	 * Called without this room's lock, on purpose: a Judges' Room asks while holding its own,
	 * and must never be left waiting on a ref room. It only reads, and each read is a single
	 * statement, so there is nothing half-written for it to see. Answers null for a division
	 * this room does not list, whatever the Judges' Room believes.
	 */
	async notesForDivision(judgesRoomId: string, teamNumbers: string[]): Promise<JudgeRefNote[] | null> {
		if (this.destroyed || !(await isLinkedDivision(this.db, judgesRoomId))) {
			return null;
		}
		return getSharedIncidents(this.db, teamNumbers, judgesRoomId);
	}

	/**
	 * A linked division's Judge Advisor wrote down a note for the refs. Under this room's lock.
	 *
	 * Only about that division's own teams, checked by the Judges' Room before asking. Shown to
	 * any refs here at once, like a ref's own note, and signalled to every linked division.
	 */
	async saveJudgeNote(
		judgesRoomId: string,
		input: JudgeRefNoteInput,
		authorName: string,
		options: { createOnly?: boolean } = {}
	): Promise<void> {
		if (this.destroyed || !(await isLinkedDivision(this.db, judgesRoomId))) {
			throw new Error('This division is no longer linked to these referee notes');
		}
		const saved = await saveJudgeNote(this.db, input, { judgesRoomId, name: authorName }, options);
		void this.wsHandler.broadcast<RefClientRouter>().onIncidentSaved.mutation(saved);
		this.notesChanged();
		await this.stampActivity();
	}

	async removeJudgeNote(judgesRoomId: string, id: string): Promise<void> {
		if (this.destroyed || !(await isLinkedDivision(this.db, judgesRoomId))) {
			throw new Error('This division is no longer linked to these referee notes');
		}
		if (await removeJudgeNote(this.db, id, judgesRoomId)) {
			void this.wsHandler.broadcast<RefClientRouter>().onIncidentRemoved.mutation({ id });
			this.notesChanged();
			await this.stampActivity();
		}
	}

	/** Everything logged here, for the hub to move into another ref room. Under this room's lock. */
	incidentRows(): IncidentRow[] {
		return getIncidentRows(this.db);
	}

	/**
	 * Stop answering, ahead of the hub deleting this room once its notes have moved elsewhere.
	 * A Judge Advisor's note arriving in between is refused rather than lost with the file.
	 */
	retire(): void {
		this.destroyed = true;
	}

	/** Notes moved in from a division's own ref room when it linked here. Under this room's lock. */
	importIncidents(rows: IncidentRow[]): void {
		if (rows.length === 0) {
			return;
		}
		for (const incident of importIncidentRows(this.db, rows)) {
			void this.wsHandler.broadcast<RefClientRouter>().onIncidentSaved.mutation(incident);
		}
		this.notesChanged();
	}

	/** Tell every linked division its notes may have changed. They fetch what they may see. */
	notesChanged(): void {
		void getLinkedDivisions(this.db)
			.then((divisions) => {
				for (const division of divisions) {
					this.opts.links.notesChanged(division.judgesRoomId, this.roomId);
				}
			})
			.catch((error) => console.error('Failed to signal linked divisions about notes', this.roomId, error));
	}

	/** A Head Ref entered a link code. Returns the divisions now linked. */
	async linkWithCode(code: string): Promise<LinkedDivision[]> {
		const row = await this.metadataRow();
		if (!row) {
			throw new Error('Ref room not found');
		}
		const result = await this.opts.links.redeem(code, this.roomId, {
			eventName: row.eventName,
			robotEventsEventId: row.robotEventsEventId
		});
		if (!result.ok) {
			throw new Error(result.error);
		}
		addLinkedDivisions(
			this.db,
			result.divisions.map((division) => this.labelled(division, row.divisions)),
			result.groupId
		);
		await this.afterLinksChanged();
		return getLinkedDivisions(this.db);
	}

	/** Unlink one division, or every division when given null. */
	async unlink(judgesRoomId: string | null): Promise<void> {
		const targets = (await getLinkedDivisions(this.db)).filter(
			(division) => judgesRoomId === null || division.judgesRoomId === judgesRoomId
		);
		for (const division of targets) {
			await this.opts.links.unlink(division.judgesRoomId, this.roomId);
			await removeLinkedDivision(this.db, division.judgesRoomId);
			// So its Judge Advisors' Ref notes tab empties now, not on their next reload.
			this.opts.links.notesChanged(division.judgesRoomId, this.roomId);
		}
		await this.afterLinksChanged();
	}

	/** A Judges' Room unlinked itself. Called by the hub, under this room's lock. */
	async divisionUnlinked(judgesRoomId: string): Promise<void> {
		if (await removeLinkedDivision(this.db, judgesRoomId)) {
			// Its other Judge Advisor devices clear their Ref notes tab too.
			this.opts.links.notesChanged(judgesRoomId, this.roomId);
			// A room with no refs and no division left is one nobody can ever reach again.
			if (!hasReferees(this.db) && (await getLinkedDivisions(this.db)).length === 0) {
				await this.destroy();
				return;
			}
			await this.afterLinksChanged();
		}
	}

	/**
	 * A division joined an event group this room was linked through.
	 *
	 * Returns whether this room wants it: only while still linked through that same group.
	 * The hub links the division's side only after this says yes.
	 */
	async wantsGroupDivision(groupId: string): Promise<boolean> {
		return (await getLinkedGroupId(this.db)) === groupId;
	}

	async acceptGroupDivision(division: RedeemedDivision, groupId: string): Promise<void> {
		await this.acceptLinkedDivisions([division], groupId);
	}

	/** Record divisions the hub has already linked on their side. */
	async acceptLinkedDivisions(divisions: RedeemedDivision[], groupId: string | null): Promise<void> {
		const row = await this.metadataRow();
		addLinkedDivisions(
			this.db,
			divisions.map((division) => this.labelled(division, row?.divisions ?? [])),
			groupId
		);
		await this.afterLinksChanged();
	}

	/** A linked division's teams changed. */
	async linkedTeamsChanged(): Promise<void> {
		void this.wsHandler.broadcast<RefClientRouter>().onTeamsUpdate.mutation(await this.teams());
	}

	/** Prefer the division's name from RobotEvents, which is what refs see on the schedule. */
	private labelled(division: RedeemedDivision, divisions: { id: number; name: string }[]): RedeemedDivision {
		const known = division.divisionId === null ? undefined : divisions.find((item) => item.id === division.divisionId);
		return { ...division, label: known?.name ?? division.label };
	}

	private async afterLinksChanged(): Promise<void> {
		this.notesChanged();
		this.invalidateMatches();
		await this.broadcastLinkedDivisions();
		void this.wsHandler.broadcast<RefClientRouter>().onTeamsUpdate.mutation(await this.teams());
	}

	private async broadcastLinkedDivisions(): Promise<void> {
		void this.wsHandler.broadcast<RefClientRouter>().onLinkedDivisionsUpdate.mutation(await getLinkedDivisions(this.db));
	}

	private invalidateMatches(): void {
		this.matchesCache = { ...this.matchesCache, fetchedAt: null };
	}

	// ============================================================================
	// Retention
	// ============================================================================

	async stampActivity(): Promise<void> {
		try {
			if (this.destroyed) {
				return;
			}
			await this.db.update(refMetadata).set({ lastActivityAt: new Date() });
		} catch (error) {
			console.error('Failed to stamp ref room activity', this.roomId, error);
		}
	}

	async clearRetentionWarning(): Promise<void> {
		await this.db.update(refMetadata).set({ retentionWarningSentAt: null });
	}

	/** Warn every Head Ref with an email address. Marked as sent whether or not it lands. */
	async sendRetentionWarning(daysRemaining: number): Promise<void> {
		const row = await this.metadataRow();
		if (!row) {
			return;
		}
		await this.db.update(refMetadata).set({ retentionWarningSentAt: new Date() });

		if (!this.opts.email.sender.enabled) {
			return;
		}

		const heads = await this.db.select().from(referees).where(eq(referees.role, 'head_referee'));
		for (const head of heads.filter((referee) => referee.email)) {
			try {
				await this.opts.email.sender.send(
					buildRefRetentionWarningEmail({
						to: head.email!,
						refereeName: head.name,
						eventName: row.eventName,
						daysRemaining,
						link: buildRefRoomJoinUrl(this.opts.email.publicOrigin, this.roomId, head.authToken)
					})
				);
			} catch (error) {
				console.error(`Failed to warn Head Referee ${head.id} about retention:`, describeSmtpFailure(error));
			}
		}
	}

	// ============================================================================
	// Match schedule
	// ============================================================================

	/** In memory only: it is RobotEvents' data, and can always be fetched again. */
	private matchesCache: RefMatchesSnapshot = { divisions: [], fetchedAt: null, error: null, available: true };
	private matchesFetchInFlight: Promise<void> | null = null;

	async matches(force: boolean): Promise<RefMatchesSnapshot> {
		if (this.destroyed) {
			return { divisions: [], fetchedAt: null, error: null, available: false };
		}
		if (!(await this.hasScheduleSource())) {
			return { divisions: [], fetchedAt: null, error: null, available: false };
		}

		const age = this.matchesCache.fetchedAt === null ? Infinity : Date.now() - this.matchesCache.fetchedAt;
		if (age >= (force ? MATCH_REFRESH_FLOOR_MS : MATCH_POLL_INTERVAL_MS)) {
			await this.refreshMatches();
		}
		return this.matchesCache;
	}

	/** Whether there is anywhere to get a schedule from: RobotEvents, or a linked division. */
	private async hasScheduleSource(): Promise<boolean> {
		const row = await this.metadataRow();
		if (!row) {
			return false;
		}
		return (!!row.robotEventsEventId && row.divisions.length > 0) || (await getLinkedDivisions(this.db)).length > 0;
	}

	/**
	 * Build the schedule across every division.
	 *
	 * A linked division's schedule comes from its Judges' Room, which already fetches it, so
	 * linking costs RobotEvents nothing. Only divisions with no linked room are fetched here.
	 *
	 * Runs outside this room's lock (from the poll and from the Matches tab), so it writes
	 * nothing: a linked room that turns out to be unlinked is skipped here and dropped from
	 * the list by teams(), which runs under the lock.
	 *
	 * A failure keeps the last good schedule and records why, the same trade the Judges'
	 * Room makes: showing an old schedule while saying it is old beats showing nothing.
	 */
	async refreshMatches(): Promise<void> {
		if (this.matchesFetchInFlight) {
			return this.matchesFetchInFlight;
		}

		this.matchesFetchInFlight = (async () => {
			try {
				const row = await this.metadataRow();
				if (!row || !(await this.hasScheduleSource())) {
					this.matchesCache = { divisions: [], fetchedAt: null, error: null, available: false };
					return;
				}

				const linked = await getLinkedDivisions(this.db);
				const linkedById = new Map(
					linked.filter((division) => division.divisionId !== null).map((division) => [division.divisionId!, division])
				);
				const own = row.divisions.filter((division) => !linkedById.has(division.id));

				const ownMatches =
					row.robotEventsEventId && own.length > 0
						? await fetchEventMatches(
								row.robotEventsEventId,
								own.map((division) => division.id)
							)
						: new Map();

				const divisions: RefDivisionMatches[] = [];
				for (const division of row.divisions) {
					const link = linkedById.get(division.id);
					if (!link) {
						divisions.push({ divisionId: division.id, divisionName: division.name, matches: ownMatches.get(division.id) ?? [] });
						continue;
					}
					const matches = await this.opts.links.matches(link.judgesRoomId, this.roomId);
					divisions.push({ divisionId: division.id, divisionName: division.name, matches: matches ?? [] });
				}

				// Linked divisions this event's RobotEvents list does not name — a ref room set up
				// by hand, say. Each still needs its own id on the schedule.
				const listed = new Set(row.divisions.map((division) => division.id));
				let synthetic = -1;
				for (const link of linked) {
					if (link.divisionId !== null && listed.has(link.divisionId)) {
						continue;
					}
					const matches = await this.opts.links.matches(link.judgesRoomId, this.roomId);
					if (matches === null) {
						continue;
					}
					divisions.push({ divisionId: link.divisionId ?? synthetic--, divisionName: link.label, matches });
				}

				this.matchesCache = { divisions, fetchedAt: Date.now(), error: null, available: true };
			} catch (error) {
				this.matchesCache = { ...this.matchesCache, available: true, error: error instanceof Error ? error.message : String(error) };
				console.error('Failed to fetch matches for ref room', this.roomId, error);
			} finally {
				this.matchesFetchInFlight = null;
			}
		})();

		return this.matchesFetchInFlight;
	}

	async wantsMatchPolling(): Promise<boolean> {
		if (this.destroyed || !this.hasConnections) {
			return false;
		}
		return this.hasScheduleSource();
	}
}
