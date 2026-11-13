import { createWebSocketHandler } from '@robotools.app/wrpc/server';
import { ConnectionCloseCode } from '@robotools.app/wrpc/client';
import { eq } from 'drizzle-orm';
import type { WebSocket as NodeWebSocket } from 'ws';
import { serverRouter, type EmailContext, type ServerContext, type ServerRouter } from '../server-router';
import type { ClientRouter } from '../client-router';
import { judgeAdvisors, judges, metadata, teams } from '../db/schema';
import { Authentication } from '../access/authentication';
import { JudgesRoomNetwork, type WsAttachment } from '../network/judges-room-network';
import { countJudgeAdvisors, generateAuthToken, getJudgeAdvisors, upsertJudgeAdvisorAuthToken } from '../access/tokens';
import { getJudgeGroups } from '../routes/essential';
import { getJudges, upsertJudge } from '../routes/judge';
import { broadcastDeviceListUpdate, cancelDeviceListBroadcast } from '../routes/device';
import { clearAllSubscriptions, unsubscribeTopics } from '../routes/subscriptions';
import { completePhotoUpload, getPhotoObject, listUploads } from '../routes/media';
import { createSqlitePhotosBucket } from '../media/sqlite-photos';
import { clearRoomGroupId, getRoomGroupId } from '../group/gateway';
import type { EventGroupGateway } from '../group/types';
import type { AdminRegistryGateway } from '../admin/gateway';
import { groupScopedAdvisorId, isGroupScopedAdvisorId } from '@robotools.app/protocol/src/group';
import { uuidv4 } from '@robotools.app/protocol/src/utils';
import type { AdminRoomDetail } from '@robotools.app/protocol/src/admin';
import { adaptSocket, type AdaptedSocket } from './socket';
import type { AppDatabase, OpenDatabase } from './storage';
import type { Mutex } from './mutex';
import { buildRetentionWarningEmail } from '../email/template';
import { describeSmtpFailure } from '../email/smtp';
import { buildJudgesRoomJoinUrl, isJudgeAdvisor } from '@robotools.app/protocol/src/access';
import { MATCH_POLL_INTERVAL_MS, type MatchesSnapshot } from '@robotools.app/protocol/src/matches';
import { fetchDivisionData } from '../matches/source';
import { isLockFreeFrame } from './lock-free';
import type { RefLinkGateway } from '../ref/link-gateway';
import type { RefTeam } from '@robotools.app/protocol/src/ref';
import type { MatchSummary } from '@robotools.app/protocol/src/matches';

/**
 * The shortest gap the refresh button can force between two RobotEvents calls.
 *
 * Long enough that a judge tapping repeatedly re-reads the cache, short enough that
 * pressing it after a match has clearly finished actually fetches something new.
 */
const MATCH_REFRESH_FLOOR_MS = 30 * 1000;

export type RoomOptions = {
	roomId: string;
	storage: OpenDatabase;
	group: EventGroupGateway;
	registry: AdminRegistryGateway;
	email: EmailContext;
	refLink: RefLinkGateway;
	/** Called when the room destroys itself, so the hub can drop it and delete its file. */
	onDestroyed: (roomId: string) => void;
};

export type ConnectIntention = {
	clientId: string;
	deviceId: string;
	deviceName: string;
	auth: string | null;
};

/**
 * One Judges' Room.
 *
 * This is what the Durable Object used to be: a database, the sockets currently attached
 * to it, and the rules for who may attach. The behaviour is unchanged; what has moved is
 * where the guarantees come from. Single-concurrency was the platform's and is now the
 * mutex's; storage was the platform's and is now a file; hibernation is simply gone,
 * because the process does not go away.
 */
export class Room {
	readonly roomId: string;
	private readonly db: AppDatabase;
	private readonly storage: OpenDatabase;
	private readonly sockets = new Set<AdaptedSocket>();
	private readonly network: JudgesRoomNetwork;
	private destroyed = false;

	/**
	 * The connection manager's own bookkeeping.
	 *
	 * It used to live in Durable Object storage because the object could be evicted
	 * mid-connection. Nothing here outlives the process, and neither do the sockets it
	 * describes, so keeping it in memory is not a downgrade — persisting it would leave
	 * stale clients behind after a restart.
	 */
	private readonly persisted = new Map<string, unknown>();

	private readonly wsHandler = createWebSocketHandler<ServerRouter>({
		router: serverRouter,
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
			console.error('WRPC Error:', opts.error.message, opts.error);
		}
	});

	constructor(private readonly opts: RoomOptions) {
		this.roomId = opts.roomId;
		this.storage = opts.storage;
		this.db = opts.storage.db;

		this.network = new JudgesRoomNetwork({
			inner: this.wsHandler.connectionManager,
			db: this.db,
			getWebSockets: () => Array.from(this.sockets),
			group: opts.group,
			matches: (force) => this.matches(force)
		});

		void this.wsHandler.initialize();

		// Subscriptions name clientIds, and a clientId belongs to a socket that dies with the
		// process. Anything still recorded here is from a previous run, so it can never be
		// delivered to — clear it before the first broadcast tries.
		void this.storage.mutex
			.run(() => clearAllSubscriptions(this.db))
			.catch((error) => console.error('Failed to clear stale subscriptions for room', opts.roomId, error));
	}

	get mutex(): Mutex {
		return this.storage.mutex;
	}

	get isDestroyed(): boolean {
		return this.destroyed;
	}

	/** Whether any socket is currently attached. */
	get hasConnections(): boolean {
		return this.sockets.size > 0;
	}

	/**
	 * Throw the room away if nobody ever set an event up in it.
	 *
	 * Opening a database creates its file, and the room is opened as soon as anyone
	 * connects — including with a roomId for a room that does not exist, which a stale
	 * bookmark or an old permit does all by itself. Those files are not events: they have
	 * no Metadata row, they will never gain one, and left alone they accumulate forever.
	 *
	 * Creating an event writes Metadata, so a real room is never caught by this. Neither is
	 * one being set up right now, because the check only runs once the last socket has gone.
	 *
	 * Returns true when the room was discarded, so the caller stops touching the database.
	 */
	private async discardIfNeverUsed(): Promise<boolean> {
		if (this.destroyed || this.hasConnections) {
			return false;
		}
		if (await this.metadataRow()) {
			return false;
		}

		this.destroyed = true;
		this.opts.onDestroyed(this.roomId);
		return true;
	}

	private socketFor(clientId: string): AdaptedSocket | null {
		for (const socket of this.sockets) {
			if (socket.clientId === clientId) {
				return socket;
			}
		}
		return null;
	}

	private context(roomId: string | null, auth: Authentication): ServerContext {
		return {
			db: this.db,
			network: this.network,
			photos: createSqlitePhotosBucket(this.db),
			auth,
			roomId,
			registry: this.opts.registry,
			email: this.opts.email,
			refLink: this.opts.refLink
		};
	}

	private httpContext(): ServerContext {
		return this.context(null, Authentication.unauthenticated());
	}

	private contextForSocket(socket: AdaptedSocket): ServerContext {
		const attachment = socket.deserializeAttachment() as WsAttachment | null;
		if (!attachment) {
			throw new Error('CRITICAL: Missing WebSocket attachment');
		}

		return this.context(
			attachment.roomId,
			new Authentication({
				authentication: attachment.authentication,
				persist: (nextAuthentication) => {
					const current = socket.deserializeAttachment() as WsAttachment | null;
					if (!current) {
						throw new Error('CRITICAL: Missing WebSocket attachment');
					}
					socket.serializeAttachment({ ...current, authentication: nextAuthentication } satisfies WsAttachment);
				}
			})
		);
	}

	// ============================================================================
	// Connections
	// ============================================================================

	/**
	 * Attach an accepted socket, after checking whether it is allowed in.
	 *
	 * A refused connection is accepted and then closed with a readable reason rather than
	 * rejected at the HTTP layer, because browser JavaScript cannot read a status code
	 * from a failed WebSocket upgrade — it can read a close reason.
	 */
	async attach(raw: NodeWebSocket, intention: ConnectIntention): Promise<void> {
		const socket = adaptSocket(raw);

		// The socket is already open and the client sends its first frame immediately, but
		// deciding whether to admit it means reading the database. Pause until the handlers
		// below are wired, or that first message is delivered to nobody and the connection
		// hangs looking perfectly healthy.
		raw.pause();

		const connectAuth = await this.network.authorizeConnect(intention.deviceId, intention.auth, this.roomId);

		if (!connectAuth.allowed) {
			socket.close(ConnectionCloseCode.KICKED, connectAuth.reason);
			// Reading has to resume for the close to finish: the client answers our close frame,
			// and a paused socket never reads that answer, so the refused device would wait for
			// ws's thirty-second close timeout before learning why it was turned away.
			raw.resume();
			// No close handler is registered on this path, so the check has to happen here or
			// a refused connection leaves an empty file behind.
			await this.discardIfNeverUsed();
			return;
		}

		socket.clientId = intention.clientId;
		socket.serializeAttachment({
			roomId: this.roomId,
			clientId: intention.clientId,
			deviceId: intention.deviceId,
			deviceName: intention.deviceName,
			authentication: connectAuth.authentication
		} satisfies WsAttachment);

		this.sockets.add(socket);
		void this.stampActivity();

		raw.on('message', (data: unknown) => {
			const message = typeof data === 'string' ? data : Buffer.isBuffer(data) ? data.toString('utf8') : String(data);

			// Replies, pings, pongs and a few slow read-only requests (match snapshot, email
			// sends) bypass the room lock. Everything else queues on it.
			//
			// This is not an optimisation, it is a deadlock fix. A handler that sends a
			// request to a client and awaits the reply holds the mutex while it waits; the
			// reply arrives as another message on this socket, and queues behind the very
			// handler that is waiting for it. Neither side can move, and thirty seconds
			// later the request times out and the caller is told "Internal server error".
			//
			// Unlocking a Judge Advisor with a PIN used to do exactly this: it pushed the new
			// authentication to the caller's own client and waited for the acknowledgement.
			//
			// These three frames are safe to run unserialised because they touch no room
			// state: a reply resolves a promise the connection manager is already holding,
			// and ping/pong write straight back to the socket. The match snapshot query is
			// one of a few requests that also skip the lock — see LOCK_FREE_REQUESTS.
			if (isLockFreeFrame(message)) {
				try {
					void this.wsHandler.handleMessage(socket as unknown as WebSocket, message, this.contextForSocket(socket));
				} catch (error) {
					console.error('Failed to handle a lock-free frame:', error);
				}
				return;
			}

			void this.mutex.run(() => this.wsHandler.handleMessage(socket as unknown as WebSocket, message, this.contextForSocket(socket)));
		});

		raw.on('close', (code: number, reason: Buffer) => {
			void this.mutex.run(async () => {
				this.sockets.delete(socket);

				// Destroying a room closes its database and deletes the file, and only then do
				// the sockets it just closed report back. There is nothing left to tidy up and
				// nothing left to query — carrying on here means talking to a closed handle.
				if (this.destroyed) {
					return;
				}

				const clientId = await this.wsHandler.handleClose(socket as unknown as WebSocket, code, reason.toString());
				if (clientId) {
					// Do not wait for the unsubscribe to complete. It can lose a race with shutdown,
					// which closes the database under it; that is harmless, so it must not surface
					// as an unhandled rejection.
					void unsubscribeTopics(this.db, clientId).catch((error) => {
						console.warn('Could not clear subscriptions for a closed connection', clientId, error instanceof Error ? error.message : error);
					});
				}

				// Retention counts from when the last person left, so the stamp on the way out
				// is the one that matters.
				await this.stampActivity();

				// Nobody left and nothing was ever set up here: discard the file.
				// Checked before the broadcast, which would query a database about to close.
				if (await this.discardIfNeverUsed()) {
					return;
				}

				broadcastDeviceListUpdate(this.httpContext(), this.wsHandler);
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

		// Everything is wired; let the buffered frames through.
		raw.resume();
	}

	// ============================================================================
	// Media
	// ============================================================================

	/**
	 * Email every Judge Advisor with an address that this event is about to be deleted.
	 *
	 * Marked as sent whether or not the mail lands. A mail server that is down should not
	 * cause the same warning to go out every hour until it recovers, and the deletion is
	 * governed by the clock rather than by the notice — the marker records that we tried.
	 *
	 * Group advisors are not written to here. Their address lives at the group, and a
	 * group spans divisions with their own clocks; warning them per division would mean
	 * several notices about events they would have to visit one at a time.
	 */
	async sendRetentionWarning(daysRemaining: number): Promise<void> {
		const row = await this.metadataRow();
		if (!row) {
			return;
		}

		await this.db.update(metadata).set({ retentionWarningSentAt: new Date() });

		if (!this.opts.email.sender.enabled) {
			return;
		}

		const advisors = (await getJudgeAdvisors(this.db)).filter((advisor) => advisor.email);
		for (const advisor of advisors) {
			try {
				await this.opts.email.sender.send(
					buildRetentionWarningEmail({
						to: advisor.email!,
						advisorName: advisor.name,
						eventName: row.eventName,
						daysRemaining,
						link: buildJudgesRoomJoinUrl(this.opts.email.publicOrigin, this.roomId, advisor.authToken)
					})
				);
			} catch (error) {
				console.error(`Failed to warn advisor ${advisor.id} about retention:`, describeSmtpFailure(error));
			}
		}
	}

	/**
	 * Record that a person used this room just now.
	 *
	 * Best-effort and never awaited by the caller: a room with no Metadata row yet is
	 * mid-setup and has nothing to stamp, and a failure here should never interfere with
	 * someone connecting.
	 */
	/** The room has been used again, so any earlier warning no longer applies. */
	async clearRetentionWarning(): Promise<void> {
		await this.db.update(metadata).set({ retentionWarningSentAt: null });
	}

	async stampActivity(): Promise<void> {
		try {
			if (this.destroyed) {
				return;
			}
			await this.db.update(metadata).set({ lastActivityAt: new Date() });
		} catch (error) {
			console.error('Failed to stamp room activity', this.roomId, error);
		}
	}

	/**
	 * The last match schedule fetched for this room.
	 *
	 * In memory, not in the database. It is derived data owned by RobotEvents that can be
	 * fetched again at any time, and persisting it would mean a restart serving a schedule
	 * from before the restart with no way to tell how old it was.
	 */
	private matchesCache: MatchesSnapshot = { matches: [], rankings: [], skills: [], fetchedAt: null, error: null, available: true };
	/** Guards against two refreshes overlapping, and against the button outrunning the poll. */
	private matchesFetchInFlight: Promise<void> | null = null;

	/**
	 * The schedule as it stands, refreshing first if it is old enough to be worth it.
	 *
	 * `force` comes from the refresh button and only shortens the interval it will accept —
	 * it cannot make the room hammer RobotEvents, because a judge tapping repeatedly is
	 * exactly the behaviour the server-side fetch exists to absorb.
	 */
	async matches(force: boolean): Promise<MatchesSnapshot> {
		// Runs outside the room lock (see LOCK_FREE_REQUESTS), so it can arrive while the room
		// is being destroyed. Its database is closed by then; there is nothing to report.
		if (this.destroyed) {
			return { matches: [], rankings: [], skills: [], fetchedAt: null, error: null, available: false };
		}
		const row = await this.metadataRow();
		if (!row?.robotEventsEventId) {
			// Never linked to RobotEvents: there is nothing to fetch, and saying so is more
			// use to a judge than an empty table.
			return { matches: [], rankings: [], skills: [], fetchedAt: null, error: null, available: false };
		}

		const age = this.matchesCache.fetchedAt === null ? Infinity : Date.now() - this.matchesCache.fetchedAt;
		const threshold = force ? MATCH_REFRESH_FLOOR_MS : MATCH_POLL_INTERVAL_MS;

		if (age >= threshold) {
			await this.refreshMatches();
		}

		return this.matchesCache;
	}

	/**
	 * Fetch the schedule from RobotEvents into the cache.
	 *
	 * A failure updates the error and leaves the previous matches in place: a room that has
	 * had a schedule all day should keep showing it when one poll fails, while saying that
	 * it could not be updated. Presenting a stale schedule as current is the outcome worth
	 * avoiding — a judge acts on it.
	 */
	async refreshMatches(): Promise<void> {
		// Coalesced: the poll and a judge's refresh landing together do one fetch, not two.
		if (this.matchesFetchInFlight) {
			return this.matchesFetchInFlight;
		}

		this.matchesFetchInFlight = (async () => {
			try {
				const row = await this.metadataRow();
				if (!row?.robotEventsEventId) {
					this.matchesCache = { matches: [], rankings: [], skills: [], fetchedAt: null, error: null, available: false };
					return;
				}

				const { matches, rankings, skills } = await fetchDivisionData(row.robotEventsEventId, row.divisionId);
				this.matchesCache = { matches, rankings, skills, fetchedAt: Date.now(), error: null, available: true };
			} catch (error) {
				this.matchesCache = {
					...this.matchesCache,
					available: true,
					error: error instanceof Error ? error.message : String(error)
				};
				console.error('Failed to fetch matches for room', this.roomId, error);
			} finally {
				this.matchesFetchInFlight = null;
			}
		})();

		return this.matchesFetchInFlight;
	}

	/** Whether this room is worth polling: someone is in it and it has a schedule to fetch. */
	async wantsMatchPolling(): Promise<boolean> {
		if (this.destroyed || !this.hasConnections) {
			return false;
		}
		const row = await this.metadataRow();
		return !!row?.robotEventsEventId;
	}

	async metadataRow() {
		const rows = await this.db.select().from(metadata).limit(1);
		return rows[0] ?? null;
	}

	async completeUpload(token: string, body: ArrayBuffer, contentType: string | null): Promise<{ status: number; payload: unknown }> {
		const photo = await completePhotoUpload(this.httpContext(), token, body, contentType);

		void this.wsHandler.broadcast<ClientRouter>().onTeamPhotoUpdate.mutation({ action: 'added', photo });

		return { status: 201, payload: photo };
	}

	async readPhoto(photoId: string, secret: string) {
		return getPhotoObject(this.httpContext(), photoId, secret);
	}

	// ============================================================================
	// Event group callbacks
	// ============================================================================

	async clearGroupId(groupId: string): Promise<void> {
		await clearRoomGroupId(this.db, groupId);
	}

	async kickGroupAdvisor(groupAdvisorId: string, exceptDeviceId: string | null): Promise<void> {
		await this.network.kickJudgeAdvisor(groupScopedAdvisorId(groupAdvisorId), exceptDeviceId);
		broadcastDeviceListUpdate(this.httpContext(), this.wsHandler);
	}

	// ============================================================================
	// Ref room link
	//
	// Called by the hub on a linked ref room's behalf. This room is the authority: every
	// read checks, here and now, that the asking ref room is still the one it is linked
	// to. Only the team list and the schedule cross — nothing about judging.
	// ============================================================================

	/** What the hub needs to decide whether a link code may link this division. */
	async refLinkInfo() {
		const row = await this.metadataRow();
		if (!row) {
			return null;
		}
		return {
			eventName: row.eventName,
			program: row.program,
			robotEventsSku: row.robotEventsSku,
			robotEventsEventId: row.robotEventsEventId,
			divisionId: row.divisionId,
			linkedRefRoomId: row.linkedRefRoomId,
			linkedRefEventName: row.linkedRefEventName
		};
	}

	async setRefLink(refRoomId: string, refEventName: string): Promise<void> {
		await this.db.update(metadata).set({ linkedRefRoomId: refRoomId, linkedRefEventName: refEventName });
	}

	/** Unlink, but only from the ref room asking: a stale request must not undo a newer link. */
	async clearRefLink(refRoomId: string): Promise<void> {
		const row = await this.metadataRow();
		if (row?.linkedRefRoomId === refRoomId) {
			await this.db.update(metadata).set({ linkedRefRoomId: null, linkedRefEventName: null });
		}
	}

	private async isLinkedTo(refRoomId: string): Promise<boolean> {
		if (this.destroyed) {
			return false;
		}
		return (await this.metadataRow())?.linkedRefRoomId === refRoomId;
	}

	/**
	 * Tell this room's Judge Advisors that ref notes changed, so their devices fetch them again.
	 *
	 * A bare signal, and only to Judge Advisors: judges cannot see ref notes yet, and
	 * there is no reason to tell them anything happened. Needs no lock — it reads only the
	 * in-memory socket list.
	 */
	notifyRefNotesChanged(): void {
		if (this.destroyed) {
			return;
		}
		for (const socket of this.sockets) {
			const attachment = socket.deserializeAttachment() as WsAttachment | null;
			if (!attachment || !isJudgeAdvisor(attachment.authentication)) {
				continue;
			}
			void this.wsHandler
				.getClient<ClientRouter>(attachment.clientId)
				.onRefNotesChanged.mutation()
				.catch(() => {
					// A device mid-reconnect misses this and reloads on reconnecting anyway.
				});
		}
	}

	/** Number, name and school for each team. Nothing else about a team leaves this room. */
	async teamsForRef(refRoomId: string): Promise<RefTeam[] | null> {
		if (!(await this.isLinkedTo(refRoomId))) {
			return null;
		}
		const rows = await this.db.select({ number: teams.number, name: teams.name, school: teams.school }).from(teams);
		return rows.map((row) => ({ number: row.number, name: row.name.slice(0, 200), school: row.school.slice(0, 200) }));
	}

	/**
	 * The schedule from this room's own RobotEvents cache, so a linked ref room adds no
	 * requests of its own. Safe without the lock for the same reasons the Matches tab is
	 * (see LOCK_FREE_REQUESTS): it reads the metadata row and the in-memory cache.
	 */
	async matchesForRef(refRoomId: string): Promise<MatchSummary[] | null> {
		if (!(await this.isLinkedTo(refRoomId))) {
			return null;
		}
		return (await this.matches(false)).matches;
	}

	// ============================================================================
	// Operator admin
	//
	// The shape of the event and the people working on it. No rubric, nomination,
	// ranking, score, photo or notebook link is reachable through any of it.
	// ============================================================================

	/**
	 * What this room can honestly say about itself.
	 *
	 * Not `createdAt`, `updatedAt` or `lastActivityAt`. A room has no record of when it was
	 * created, and the first two belong to the registry — they used to be filled in here
	 * with `Date.now()`, which meant the detail page reported both as the moment you opened
	 * it. The gateway composes the registry's values with these; the type says so, so the
	 * same shortcut cannot be taken again by accident.
	 */
	async adminRoomDetail(): Promise<Omit<AdminRoomDetail, 'createdAt' | 'updatedAt' | 'lastActivityAt'> | null> {
		const row = await this.metadataRow();
		if (!row) {
			return null;
		}

		const groups = await getJudgeGroups(this.db);
		const groupNames = new Map(groups.map((group) => [group.id, group.name]));
		const judgeRows = await getJudges(this.db);
		const localAdvisors = await getJudgeAdvisors(this.db);

		// Group advisors reach this room too, so "who administers this event" would be
		// misleading from the local rows alone.
		let groupAdvisors: { groupAdvisorId: string; name: string }[] = [];
		const groupId = await getRoomGroupId(this.db);
		if (groupId) {
			try {
				groupAdvisors = (await this.opts.group.describe(groupId, this.roomId))?.advisors ?? [];
			} catch (error) {
				console.error('Failed to read group advisors for admin detail:', error);
			}
		}

		const teamRows = await this.db.select({ id: teams.id }).from(teams);

		return {
			roomId: this.roomId,
			eventName: row.eventName,
			program: row.program,
			eventGradeLevel: row.eventGradeLevel,
			divisionId: row.divisionId,
			robotEventsSku: row.robotEventsSku,
			accessControlEnabled: row.accessControlEnabled,
			groupId: row.groupId,
			judgeGroups: groups.map((group) => ({ id: group.id, name: group.name })),
			judges: judgeRows.map((judge) => ({
				judgeId: judge.id,
				name: judge.name,
				groupId: judge.groupId,
				groupName: groupNames.get(judge.groupId) ?? ''
			})),
			judgeAdvisors: [
				...localAdvisors.map((advisor) => ({
					judgeAdvisorId: advisor.id,
					name: advisor.name,
					origin: 'room' as const
				})),
				...groupAdvisors.map((advisor) => ({
					judgeAdvisorId: groupScopedAdvisorId(advisor.groupAdvisorId),
					name: advisor.name,
					origin: 'group' as const
				}))
			],
			// A count, not a roster.
			teamCount: teamRows.length,
			onlineDeviceCount: this.network.getConnectedClients().length
		};
	}

	async adminAddJudge(name: string, groupId: string): Promise<void> {
		const groups = await getJudgeGroups(this.db);
		if (!groups.some((group) => group.id === groupId)) {
			throw new Error('That judge group does not exist in this room');
		}

		await upsertJudge(this.db, { id: crypto.randomUUID(), name, groupId });
		await this.broadcastJudges();
	}

	/**
	 * Add a Judge Advisor and return their access link, once.
	 *
	 * The link is their whole credential, so the operator should hand it over privately.
	 */
	async adminAddJudgeAdvisor(name: string): Promise<string> {
		const authToken = generateAuthToken();
		await upsertJudgeAdvisorAuthToken(this.db, authToken, uuidv4(), name);
		broadcastDeviceListUpdate(this.httpContext(), this.wsHandler);
		return authToken;
	}

	/**
	 * Remove a Judge Advisor.
	 *
	 * Keeps the room's own guard: it must not be left with nobody who can administer it.
	 * Group advisors are counted, since a room reachable through its group is not stranded
	 * — and a group advisor cannot be removed from here at all, only at the group.
	 */
	async adminRemoveJudgeAdvisor(judgeAdvisorId: string): Promise<void> {
		if (isGroupScopedAdvisorId(judgeAdvisorId)) {
			throw new Error('That Judge Advisor is managed by the event group — remove them there');
		}

		const local = await countJudgeAdvisors(this.db);
		let viaGroup = 0;
		const groupId = await getRoomGroupId(this.db);
		if (groupId) {
			try {
				viaGroup = await this.opts.group.advisorCount(groupId, this.roomId);
			} catch (error) {
				// Fails closed: an unreachable group means we cannot prove the room stays
				// administrable, so treat it as offering nothing.
				console.error('Failed to count group advisors:', error);
			}
		}

		if (local + viaGroup <= 1) {
			throw new Error("A Judges' Room must keep at least one Judge Advisor");
		}

		const deleted = await this.db.delete(judgeAdvisors).where(eq(judgeAdvisors.id, judgeAdvisorId)).returning({ id: judgeAdvisors.id });
		if (deleted.length === 0) {
			throw new Error('Judge Advisor not found');
		}

		await this.network.kickJudgeAdvisor(judgeAdvisorId);
		broadcastDeviceListUpdate(this.httpContext(), this.wsHandler);
	}

	async adminRemoveJudge(judgeId: string): Promise<void> {
		// Their submitted rubrics stay in the room; only the roster entry and access link
		// go away — the same contract the Judge Advisor's own remove-judge has.
		await this.db.delete(judges).where(eq(judges.id, judgeId));
		await this.network.kickJudge(judgeId);
		await this.broadcastJudges();
		broadcastDeviceListUpdate(this.httpContext(), this.wsHandler);
	}

	async destroy(): Promise<void> {
		await this.network.destroy();
	}

	/**
	 * Hang up on every device, without releasing the database.
	 *
	 * Separate from close() because shutdown has to happen in that order: the HTTP server
	 * will not finish closing while a socket is open, so the sockets go first, and the
	 * database stays available until any request already in flight has finished with it.
	 *
	 * GOING_AWAY rather than NORMAL. The client reads NORMAL as a deliberate end and stays
	 * offline; 1001 tells it to expect us back, which is what a restart is.
	 */
	closeConnections(): void {
		for (const socket of this.sockets) {
			try {
				socket.close(ConnectionCloseCode.GOING_AWAY, 'Server shutting down');
			} catch {
				// Already closing; nothing to do.
			}
		}
		this.sockets.clear();
	}

	/** Release the file handle. Sockets should already be gone. */
	close(): void {
		this.closeConnections();
		// Cancel anything scheduled against this database before the handle goes away.
		cancelDeviceListBroadcast(this.db);
		this.storage.close();
	}

	/** Photo ids held by this room, so its blobs go when the room does. */
	async photoIds(): Promise<string[]> {
		return Array.from(await listUploads(this.db));
	}

	private async broadcastJudges(): Promise<void> {
		void this.wsHandler.broadcast<ClientRouter>().onAllJudgesUpdate.mutation(await getJudges(this.db));
	}
}
