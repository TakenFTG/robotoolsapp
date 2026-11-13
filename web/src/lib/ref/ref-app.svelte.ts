import { m } from '$lib/paraglide/messages.js';
import { ConnectionCloseCode, createClientManager, type ConnectionState, type WRPCClientManager } from '@robotools.app/wrpc/client';
import {
	CreateRefRoomResponseSchema,
	REF_RPC_PATH,
	REF_WS_PATH,
	buildRefRoomJoinUrl,
	RefCloseReason,
	RefRoomIdSchema,
	isRefCloseReason,
	type CreateRefRoomRequest,
	type Incident,
	type LinkedDivision,
	type IncidentInput,
	type RefEmailSendResult,
	type RefEvent,
	type Referee,
	type RefereeRole,
	type RefMatchesSnapshot,
	type RefSelf,
	type RefTeam
} from '@robotools.app/protocol/src/ref';
import type { RefServerRouter } from '@robotools.app/worker/src/ref/router';
import { buildRefClientRouter, type RefClientRouter } from './ref-client-router-def';
import { generateUUID } from '$lib/utils.svelte';
import { SvelteURL } from 'svelte/reactivity';
import { AuthTokenSchema } from '@robotools.app/protocol/src/access';
import type { EmailCapability } from '@robotools.app/protocol/src/email';
import { describeEvent, readSavedEvents, removeEvent, sortByRecent, upsertLink, type RefLink, type SavedRefEvent } from './saved-events';

/**
 * The referee app's state and its one connection to a ref room.
 *
 * Separate from the judging app's `App` on purpose: different storage keys, different
 * socket path, different permit. A device can hold a ref link and a judging link at once
 * and neither can see the other.
 *
 * A device can hold links to several ref rooms, one per event, and is connected to one at a
 * time. Switching closes one socket and opens the other.
 */

export type RefPhase = 'loading' | 'begin' | 'setup' | 'joining' | 'workspace' | 'signed_out';

type RefPermit = RefLink;

/** Where older versions kept their one link. Read once, moved into the list, then removed. */
const LEGACY_PERMIT_KEY = 'refPermit';
const EVENTS_KEY = 'refEvents';
/** The event this device last had open, so a reload returns to it. */
const CURRENT_KEY = 'refCurrentRoomId';
const DEVICE_KEY = 'refDeviceId';

function readStorage(key: string): string | null {
	try {
		return localStorage.getItem(key);
	} catch {
		return null;
	}
}

function writeStorage(key: string, value: string | null): void {
	try {
		if (value === null) {
			localStorage.removeItem(key);
		} else {
			localStorage.setItem(key, value);
		}
	} catch {
		// Private browsing or blocked storage: the session still works, it just will not
		// survive a reload.
	}
}

/** The API server. Same origin in production; the dev web server is on another port. */
function apiOrigin(): string {
	if (import.meta.env.DEV) {
		return `http://${window.location.hostname}:8787`;
	}
	return window.location.origin;
}

function wsOrigin(): string {
	if (import.meta.env.DEV) {
		return `ws://${window.location.hostname}:8787`;
	}
	return `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}`;
}

/** Pull a ref room link apart. Accepts a full URL or just its query string. */
export function parseRefLink(text: string): RefPermit | null {
	try {
		const trimmed = text.trim();
		const url = new SvelteURL(trimmed.startsWith('?') ? `https://x/ref${trimmed}` : trimmed);
		const roomId = RefRoomIdSchema.safeParse(url.searchParams.get('roomId'));
		const authToken = AuthTokenSchema.safeParse(url.searchParams.get('auth'));
		if (!roomId.success || !authToken.success) {
			return null;
		}
		return { roomId: roomId.data, authToken: authToken.data };
	} catch {
		return null;
	}
}

function closeReasonMessage(reason: RefCloseReason): string {
	switch (reason) {
		case RefCloseReason.ACCESS_LINK_REQUIRED:
		case RefCloseReason.INVALID_ACCESS_LINK:
			return m.ref_signed_out_invalid_link();
		case RefCloseReason.ROOM_NOT_FOUND:
			return m.ref_signed_out_room_not_found();
		case RefCloseReason.ACCESS_CHANGED:
			return m.ref_signed_out_access_changed();
	}
}

export class RefApp {
	phase: RefPhase = $state('loading');
	event: RefEvent | null = $state(null);
	self: RefSelf | null = $state(null);
	referees: Referee[] = $state([]);
	teams: RefTeam[] = $state([]);
	/** Newest first. */
	incidents: Incident[] = $state([]);
	connectionState: ConnectionState = $state('offline');
	matches: RefMatchesSnapshot | null = $state(null);
	signedOutMessage: string | null = $state(null);
	emailCapability: EmailCapability = $state({ enabled: false, fromAddress: null });
	/** Judges' Rooms linked to this event, one per division. */
	linkedDivisions: LinkedDivision[] = $state([]);
	/** Every event this device has a link for, most recently opened first. */
	savedEvents: SavedRefEvent[] = $state([]);

	private permit: RefPermit | null = $state(null);
	private manager: WRPCClientManager<RefServerRouter, RefClientRouter> | null = null;
	private hasConnected = false;
	private leaving = false;

	private readonly clientRouter = buildRefClientRouter({
		onIncidentSaved: (incident) => this.upsertIncident(incident),
		onIncidentRemoved: ({ id }) => {
			this.incidents = this.incidents.filter((incident) => incident.id !== id);
		},
		onRefereesUpdate: (referees) => {
			this.referees = referees;
			// A role change takes effect without a reconnect; keep our own view in step.
			const me = referees.find((referee) => referee.id === this.self?.refereeId);
			if (me && this.self) {
				this.self = { refereeId: me.id, name: me.name, role: me.role };
				this.rememberDetails();
			}
		},
		onTeamsUpdate: (teams) => {
			this.teams = teams;
		},
		onLinkedDivisionsUpdate: (divisions) => {
			this.linkedDivisions = divisions;
			// The schedule's sources just changed.
			if (this.phase === 'workspace') {
				void this.refreshMatches().catch((error) => console.error('Failed to reload matches:', error));
			}
		}
	});

	get isHeadReferee(): boolean {
		return this.self?.role === 'head_referee';
	}

	get roomId(): string | null {
		return this.permit?.roomId ?? null;
	}

	/** The saved events other than the one open now. */
	get otherEvents(): SavedRefEvent[] {
		return this.savedEvents.filter((event) => event.roomId !== this.permit?.roomId);
	}

	/** Start from the page URL: a link in the address bar wins over a saved one. */
	async start(url: URL): Promise<void> {
		this.loadSavedEvents();

		const fromUrl = parseRefLink(url.search);
		if (fromUrl) {
			this.addLink(fromUrl);
		} else {
			const currentId = readStorage(CURRENT_KEY);
			const current = this.savedEvents.find((event) => event.roomId === currentId) ?? this.savedEvents[0] ?? null;
			this.permit = current ? { roomId: current.roomId, authToken: current.authToken } : null;
		}

		if (this.permit) {
			await this.join();
		} else {
			this.phase = 'begin';
		}
	}

	/** Open a link someone was handed. Adds it to this device's events; the others are kept. */
	async joinWithLink(text: string): Promise<void> {
		const permit = parseRefLink(text);
		if (!permit) {
			throw new Error(m.ref_link_not_recognised());
		}
		this.leaveCurrent();
		this.addLink(permit);
		await this.join();
	}

	/** Open another saved event. */
	async switchTo(roomId: string): Promise<void> {
		if (roomId === this.permit?.roomId && this.phase === 'workspace') {
			return;
		}
		const target = this.savedEvents.find((event) => event.roomId === roomId);
		if (!target) {
			return;
		}
		this.leaveCurrent();
		this.addLink({ roomId: target.roomId, authToken: target.authToken });
		await this.join();
	}

	/** Go to the new-event screen. An open event stays connected until the new one exists. */
	openSetup(): void {
		this.phase = 'setup';
	}

	/** Back out of the new-event screen, to the event that was open if there was one. */
	closeSetup(): void {
		this.phase = this.permit && this.manager ? 'workspace' : 'begin';
	}

	async createRoom(request: CreateRefRoomRequest): Promise<void> {
		const response = await fetch(`${apiOrigin()}${REF_RPC_PATH}`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(request)
		});
		if (!response.ok) {
			throw new Error(m.ref_create_failed());
		}
		const created = CreateRefRoomResponseSchema.parse(await response.json());
		this.leaveCurrent();
		this.addLink({ roomId: created.roomId, authToken: created.authToken });
		await this.join();
	}

	/** Forget the open event's link on this device and go back to the start. */
	signOut(): void {
		this.leaving = true;
		this.disconnect();
		this.forgetCurrent();
		this.clearState();
		this.leaving = false;
		this.phase = 'begin';
	}

	/** Forget a saved event that is not open. Use `signOut` for the open one. */
	forgetEvent(roomId: string): void {
		if (roomId === this.permit?.roomId) {
			this.signOut();
			return;
		}
		this.saveEvents(removeEvent(this.savedEvents, roomId));
	}

	// ============================================================================
	// Calls
	// ============================================================================

	private get wrpc() {
		if (!this.manager) {
			throw new Error('CRITICAL: not connected to a ref room');
		}
		return this.manager.getClient()[1];
	}

	async saveIncident(input: IncidentInput): Promise<Incident> {
		const saved = await this.wrpc.incidents.save.mutation(input);
		this.upsertIncident(saved);
		return saved;
	}

	async removeIncident(id: string): Promise<void> {
		await this.wrpc.incidents.remove.mutation({ id });
		this.incidents = this.incidents.filter((incident) => incident.id !== id);
	}

	async addReferee(input: { name: string; role: RefereeRole; email: string | null }): Promise<Referee> {
		return this.wrpc.referees.add.mutation(input);
	}

	async updateReferee(refereeId: string, input: { name: string; role: RefereeRole; email: string | null }): Promise<Referee> {
		return this.wrpc.referees.update.mutation({ refereeId, ...input });
	}

	async removeReferee(refereeId: string): Promise<void> {
		await this.wrpc.referees.remove.mutation({ refereeId });
	}

	/** Built here from this page's own address, which is where the ref will open it. */
	private linkFor(authToken: string): string {
		if (!this.permit) {
			throw new Error('CRITICAL: no ref permit');
		}
		return buildRefRoomJoinUrl(window.location.origin, this.permit.roomId, authToken);
	}

	async getRefereeLink(refereeId: string): Promise<string> {
		const { authToken } = await this.wrpc.referees.getLink.query({ refereeId });
		return this.linkFor(authToken);
	}

	async rotateRefereeLink(refereeId: string): Promise<string> {
		const { authToken } = await this.wrpc.referees.rotateLink.mutation({ refereeId });
		// Our own link changed: keep the new one, or the next reload would be refused.
		if (refereeId === this.self?.refereeId && this.permit) {
			this.addLink({ roomId: this.permit.roomId, authToken });
			this.rememberDetails();
		}
		return this.linkFor(authToken);
	}

	/** Email the listed refs their links, or every ref with an address when given null. */
	async sendRefereeLinks(refereeIds: string[] | null): Promise<RefEmailSendResult[]> {
		return (await this.wrpc.referees.sendLinks.mutation({ refereeIds })).results;
	}

	/** Link Judges' Rooms with a code from a Judge Advisor. */
	async linkJudgesRooms(code: string): Promise<LinkedDivision[]> {
		const linked = await this.wrpc.links.link.mutation({ code });
		this.linkedDivisions = linked;
		return linked;
	}

	/** Unlink one division, or every one when given null. */
	async unlinkJudgesRoom(judgesRoomId: string | null): Promise<void> {
		await this.wrpc.links.unlink.mutation({ judgesRoomId });
	}

	/** Whether there is a schedule to show: from VEX Events, or from a linked division. */
	get hasScheduleSource(): boolean {
		return !!this.event?.robotEventsEventId || this.linkedDivisions.length > 0;
	}

	async replaceTeams(teams: RefTeam[]): Promise<void> {
		await this.wrpc.event.replaceTeams.mutation({ teams });
	}

	async destroyRoom(): Promise<void> {
		this.leaving = true;
		try {
			await this.wrpc.event.destroy.mutation();
		} catch {
			// The socket closes as the room goes, which can beat the reply.
		}
		this.disconnect();
		this.forgetCurrent();
		this.clearState();
		this.leaving = false;
		this.phase = 'begin';
	}

	async refreshMatches(force = false): Promise<void> {
		this.matches = await this.wrpc.matches.getSnapshot.query({ force });
	}

	// ============================================================================
	// Connection
	// ============================================================================

	private async join(): Promise<void> {
		this.phase = 'joining';
		this.signedOutMessage = null;
		this.hasConnected = false;
		this.manager = createClientManager<RefServerRouter, RefClientRouter>(() => this.clientOptions(), this.clientRouter);

		try {
			await this.loadKit();
			this.phase = 'workspace';
		} catch (error) {
			// A refusal arrives as a close reason, which signedOut has already handled.
			if ((this.phase as RefPhase) !== 'signed_out') {
				console.error('Failed to join ref room:', error);
				// Most likely the connection, not the link: keep it so it can be tried again.
				this.signOutWith(m.ref_join_failed(), { forget: false });
			}
		}
	}

	private async loadKit(): Promise<void> {
		const kit = await this.wrpc.session.join.mutation();
		this.event = kit.event;
		this.self = kit.self;
		this.referees = kit.referees;
		this.teams = kit.teams;
		this.incidents = [...kit.incidents].sort((a, b) => b.createdAt - a.createdAt);
		this.emailCapability = kit.emailCapability;
		this.linkedDivisions = kit.linkedDivisions;
		this.rememberDetails();
	}

	private clientOptions() {
		if (!this.permit) {
			throw new Error('CRITICAL: no ref permit');
		}
		return {
			wsUrl: `${wsOrigin()}${REF_WS_PATH}?auth=${encodeURIComponent(this.permit.authToken)}`,
			roomId: this.permit.roomId,
			clientId: generateUUID(),
			deviceId: this.deviceId(),
			deviceName: 'Referee device',
			onContext: async () => ({}),
			onOpen: () => {},
			onClosed: (code: number, reason: string) => {
				if (this.leaving) {
					return;
				}
				if (code === ConnectionCloseCode.KICKED && isRefCloseReason(reason)) {
					this.signOutWith(closeReasonMessage(reason.trim() as RefCloseReason));
				} else if (code === ConnectionCloseCode.ROOM_DESTROYED) {
					this.signOutWith(m.ref_signed_out_room_destroyed());
				}
			},
			onConnectionStateChange: (state: ConnectionState) => {
				this.connectionState = state;
				if (state === 'connected') {
					// Anything broadcast while we were away was missed, so a reconnect reloads.
					if (this.hasConnected && this.phase === 'workspace') {
						void this.loadKit().catch((error) => console.error('Failed to resync ref room:', error));
					}
					this.hasConnected = true;
				}
			}
		};
	}

	/** Leave the open event because the room said no. The link is forgotten unless told otherwise. */
	private signOutWith(message: string, { forget = true }: { forget?: boolean } = {}): void {
		this.leaving = true;
		this.disconnect();
		this.leaving = false;
		if (forget) {
			this.forgetCurrent();
		} else {
			this.permit = null;
		}
		this.clearState();
		this.signedOutMessage = message;
		this.phase = 'signed_out';
	}

	private disconnect(): void {
		this.manager?.resetClient();
		this.manager = null;
		this.connectionState = 'offline';
	}

	private clearState(): void {
		this.event = null;
		this.self = null;
		this.referees = [];
		this.teams = [];
		this.incidents = [];
		this.matches = null;
		this.linkedDivisions = [];
	}

	private upsertIncident(incident: Incident): void {
		const rest = this.incidents.filter((item) => item.id !== incident.id);
		this.incidents = [incident, ...rest].sort((a, b) => b.createdAt - a.createdAt);
	}

	/** Close the open event's socket and clear what it showed, keeping its link saved. */
	private leaveCurrent(): void {
		this.leaving = true;
		this.disconnect();
		this.clearState();
		this.leaving = false;
	}

	private loadSavedEvents(): void {
		const listJson = readStorage(EVENTS_KEY);
		const legacy = readStorage(LEGACY_PERMIT_KEY);
		this.savedEvents = readSavedEvents(listJson, legacy);
		if (legacy !== null) {
			this.saveEvents(this.savedEvents);
			writeStorage(LEGACY_PERMIT_KEY, null);
		}
	}

	/** Save a link and make it the open event. */
	private addLink(link: RefPermit): void {
		this.permit = link;
		this.saveEvents(upsertLink(this.savedEvents, link, Date.now()));
		writeStorage(CURRENT_KEY, link.roomId);
	}

	private forgetCurrent(): void {
		if (this.permit) {
			this.saveEvents(removeEvent(this.savedEvents, this.permit.roomId));
		}
		this.permit = null;
		writeStorage(CURRENT_KEY, null);
	}

	/** Copy the open event's name and who we are into the saved list, for showing offline. */
	private rememberDetails(): void {
		if (!this.permit || !this.event || !this.self) {
			return;
		}
		this.saveEvents(
			describeEvent(this.savedEvents, this.permit.roomId, {
				eventName: this.event.eventName,
				refName: this.self.name,
				role: this.self.role
			})
		);
	}

	private saveEvents(events: SavedRefEvent[]): void {
		this.savedEvents = sortByRecent(events);
		writeStorage(EVENTS_KEY, JSON.stringify(this.savedEvents));
	}

	private deviceId(): string {
		let id = readStorage(DEVICE_KEY);
		if (!id) {
			id = generateUUID();
			writeStorage(DEVICE_KEY, id);
		}
		return id;
	}
}

export const refApp = new RefApp();
