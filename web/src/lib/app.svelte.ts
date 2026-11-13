import { m } from '$lib/paraglide/messages.js';
import {
	ConnectionCloseCode,
	createClientManager,
	type ClientOptions,
	type ConnectionState,
	type WRPCClientManager
} from '@robotools.app/wrpc/client';
import type { Judge, JudgeGroup } from '@robotools.app/protocol/src/judging';
import type { DeviceInfo } from '@robotools.app/protocol/src/client';
import type { EssentialData } from '@robotools.app/protocol/src/event';
import type { TeamData, TeamInfo } from '@robotools.app/protocol/src/team';
import type { Award } from '@robotools.app/protocol/src/award';
import type { ServerRouter } from '@robotools.app/worker/src/server-router';
import { clientRouter, type ClientRouter } from './client-router';
import type { User } from './user.svelte';
import {
	buildJudgesRoomJoinUrl,
	generateUUID,
	getDeviceNameFromUserAgent,
	parseAuthTokenFromUrl,
	parseEventGroupUrl,
	parseJudgesRoomUrl,
	processTeamDataArray
} from './utils.svelte';
import { AppUI } from './index.svelte';
import type { TeamInfoAndData } from './team.svelte';
import type { AwardNomination } from '@robotools.app/protocol/src/rubric';
import type { JoiningKit, RoomState } from '@robotools.app/protocol/src/room';
import type { ClientAuthentication } from '@robotools.app/protocol/src/access';
import { AuthTokenSchema, isConnectAuthCloseReason } from '@robotools.app/protocol/src/access';
import { GroupDivisionSchema } from '@robotools.app/protocol/src/group';
import type { GroupAction, GroupDivision, GroupResponse, GroupSessionState } from '@robotools.app/protocol/src/group';
import { callGroupRpc, GroupRpcError } from './group-client';

import z from 'zod';
import { Preferences } from './preferences.svelte';

export interface Notice {
	id: string;
	message: string;
	type: 'success' | 'error';
	timestamp: number;
}

export class AppStorage {
	/**
	 * Save data to localStorage with the given key
	 * @param key - The storage key
	 * @param data - The data to save (must be JSON serializable)
	 */
	save(key: string, data: Record<string, unknown> | unknown[] | string | number | boolean | null): void {
		try {
			localStorage.setItem(key, JSON.stringify(data));
		} catch (error) {
			console.error(`Failed to save to localStorage with key "${key}":`, error);
		}
	}

	/**
	 * Load data from localStorage with the given key
	 * @param key - The storage key
	 * @returns The parsed data or null if not found or error occurred
	 */
	load<T>(key: string): T | null {
		try {
			const item = localStorage.getItem(key);
			if (item === null) {
				return null;
			}
			return JSON.parse(item) as T;
		} catch (error) {
			console.error(`Failed to load from localStorage with key "${key}":`, error);
			return null;
		}
	}

	/**
	 * Remove data from localStorage with the given key
	 * @param key - The storage key
	 */
	remove(key: string): void {
		try {
			localStorage.removeItem(key);
		} catch (error) {
			console.error(`Failed to remove from localStorage with key "${key}":`, error);
		}
	}

	/**
	 * Clear all data from localStorage
	 */
	clear(): void {
		try {
			localStorage.clear();
		} catch (error) {
			console.error('Failed to clear localStorage:', error);
		}
	}
}

export const PermitSchema = z.object({
	roomId: z.uuidv4(),
	createdAt: z.number().int().positive(),
	deviceId: z.uuidv4(),
	deviceName: z.string().min(1).max(100),
	authToken: AuthTokenSchema.optional(),
	/** Cached for the event switcher, so rooms can be labelled without connecting to each. */
	eventName: z.string().max(200).optional(),
	/**
	 * Set when this room came from an EventGroup's division list rather than its own link,
	 * so the switcher can group the divisions of one competition together.
	 */
	groupId: z.uuidv4().optional()
});

export type Permit = z.infer<typeof PermitSchema>;

/**
 * A group link held on this device.
 *
 * Separate from the room permits it produces: the group is the credential, the divisions
 * are what it opens. Its deviceId is shared with every division it seeded, so the group
 * and its rooms agree on which device is which — rotating your own group link signs out
 * your other devices and needs to recognise this one.
 */
export const GroupPermitSchema = z.object({
	groupId: z.uuidv4(),
	authToken: AuthTokenSchema,
	deviceId: z.uuidv4(),
	deviceName: z.string().min(1).max(100),
	createdAt: z.number().int().positive(),
	groupName: z.string().max(200).optional(),
	/**
	 * The group's division list as last seen.
	 *
	 * Cached here rather than inferred from room permits, because the group is what
	 * actually knows its divisions. A division must be listed whether or not this device
	 * has got round to making a permit for it — otherwise a division added from someone
	 * else's device is invisible here, which is precisely the case the group exists for.
	 */
	divisions: z.array(GroupDivisionSchema).optional()
});

export type GroupPermit = z.infer<typeof GroupPermitSchema>;

/**
 * Thrown when every stored permit turned out to point at a room that no longer exists.
 *
 * Not an error to show anyone: nothing failed, there is simply nothing to reconnect to.
 */
export class NoStoredRoomsError extends Error {
	constructor() {
		super("No stored Judges' Rooms remain");
		this.name = 'NoStoredRoomsError';
	}
}

export class App {
	private readonly storage: AppStorage;
	private readonly isDevelopment: boolean;
	private readonly clientManager: WRPCClientManager<ServerRouter, ClientRouter>;
	private readonly preferences: Preferences;
	private connectionState: ConnectionState = $state('offline');
	/**
	 * How many times the connection has come back after being lost.
	 *
	 * The server drops a client's subscriptions when its socket closes, and the client keeps
	 * the same id across reconnects — so after a Wi-Fi drop or a server restart, award
	 * rankings, submissions and the device list silently stopped updating, including for the
	 * judge making the change. Effects that subscribe read this so they run again, and fetch a
	 * fresh copy, each time the connection returns.
	 */
	private reconnections = $state(0);
	/** Whether the current client has connected at least once; reset for each new client. */
	private hasConnected = false;
	/** Suppress kick toast when the server closes us as part of leaveJudgesRoom. */
	private intentionalLeave = false;
	/** Set from onClosed when the server rejects connect with an auth close code/reason. */
	private lastConnectAuthError: string | null = null;
	private permit: Permit | null = $state(null);
	/** Every room this device holds a permit for; this.permit is the active one. */
	private permits: Permit[] = $state([]);
	/** Every event group link this device holds. */
	private groupPermits: GroupPermit[] = $state([]);
	/** The group being opened right now, once it has told us who we are. */
	private groupSession: GroupSessionState | null = $state(null);
	/** Where to go back to if a new-event setup is abandoned. */
	private returnToRoomId: string | null = $state(null);
	private currentUser: User | null = $state(null);
	private essentialData: EssentialData | null = $state(null);
	private allTeamData: Record<string, TeamData> = $state({});
	private allJudges: readonly Judge[] = $state([]);
	private allDevices: readonly DeviceInfo[] = $state([]);
	private allFinalAwardNominations: Record<string, AwardNomination[]> = $state({});
	public readonly version: string = '2.0.0';

	// Error handling
	private notices: Notice[] = $state([]);

	constructor(storage: AppStorage, isDevelopment: boolean = false) {
		this.storage = storage;
		this.isDevelopment = isDevelopment;
		this.clientManager = createClientManager(this.createClientOptions.bind(this), clientRouter);
		this.preferences = new Preferences(storage);

		if (typeof window !== 'undefined') {
			this.loadPermitFromStorage();
			this.loadUserFromStorage();
		}
	}

	// ============================================================================
	// Session, Judges' Room, Permit
	// ============================================================================

	private async joinJudgesRoom(): Promise<JoiningKit> {
		if (!this.hasPermit()) {
			throw new Error('CRITICAL: No permit');
		}

		if (this.getConnectionState() === 'connected') {
			throw new Error("CRITICAL: already connected to a Judges' Room");
		}

		// Just to be safe, reset the client manager
		this.clientManager.resetClient();

		const joiningKit = await this.wrpcClient.handshake.joinJudgesRoom.mutation();
		this.handleEventSetupUpdate(joiningKit);
		this.handleClientAuthenticationChange(joiningKit.authentication);
		return joiningKit;
	}

	/**
	 * Join a Judges' Room from URL
	 */
	async joinJudgesRoomFromUrl(url: string): Promise<void> {
		this.lastConnectAuthError = null;
		try {
			const roomId = parseJudgesRoomUrl(url);
			if (!roomId) {
				throw new Error("Invalid Judges' Room URL");
			}

			// A device may hold several rooms. Re-using the link for a room already on this
			// device switches to it (and refreshes the token) instead of duplicating it.
			const existing = this.permits.find((candidate) => candidate.roomId === roomId);
			const authToken = parseAuthTokenFromUrl(url) ?? undefined;

			this.detachFromCurrentEvent();
			this.permit = existing ? { ...existing, authToken: authToken ?? existing.authToken } : this.createNewPermit(roomId, authToken);
			this.savePermitToStorage();
			this.loadUserFromStorage();

			await this.joinJudgesRoom();
		} catch (error) {
			const message = this.lastConnectAuthError ?? (error instanceof Error ? error.message : 'Unknown error');
			this.lastConnectAuthError = null;
			this.permit = null;
			this.clearPermitFromStorage();
			this.clearUserFromStorage();
			this.addErrorNotice(m.failed_to_join_judges_room({ error: message }));
			// `message` is often lastConnectAuthError rather than this error's own text, so
			// without the cause the original — and its stack — is gone for good.
			throw new Error(message, { cause: error });
		}
	}

	// ============================================================================
	// Multiple events
	//
	// Every division is its own room on the server already; the only thing that made this
	// device single-event was storing one permit. Switching is therefore purely local:
	// drop the connection, make another permit active, and join that room.
	// ============================================================================

	/** Every room on this device, most recently added last. */
	getPermits(): Readonly<Permit>[] {
		return this.permits.map((permit) => $state.snapshot(permit) as Permit);
	}

	getActiveRoomId(): string | null {
		return this.permit?.roomId ?? null;
	}

	hasOtherEvents(): boolean {
		return this.permits.length > 1;
	}

	/**
	 * Tear down the live view of the current room without touching its stored permit or
	 * telling the server anything — unlike leaveJudgesRoom, which forgets the device.
	 */
	private detachFromCurrentEvent(): void {
		this.clientManager.resetClient();
		this.currentUser = null;
		this.essentialData = null;
		this.allTeamData = {};
		this.allJudges = [];
		this.allDevices = [];
		this.allFinalAwardNominations = {};
	}

	/**
	 * Make another room on this device the active one and join it.
	 */
	async switchToEvent(roomId: string): Promise<void> {
		if (roomId === this.permit?.roomId && this.getConnectionState() === 'connected') {
			return;
		}

		const target = this.permits.find((candidate) => candidate.roomId === roomId);
		if (!target) {
			throw new Error('CRITICAL: No permit for that event');
		}

		this.detachFromCurrentEvent();
		this.permit = { ...target };
		this.storage.save('activeRoomId', roomId);
		this.loadUserFromStorage();

		await this.joinJudgesRoom();
	}

	/**
	 * Leave the active event, keeping the others. Returns the room switched to, or null if
	 * this was the last one.
	 */
	async leaveCurrentEvent(): Promise<string | null> {
		const leftRoomId = this.permit?.roomId;
		await this.leaveJudgesRoom();

		const next = this.permits.find((permit) => permit.roomId !== leftRoomId);
		if (!next) {
			return null;
		}

		await this.switchToEvent(next.roomId);
		return next.roomId;
	}

	/**
	 * Step out of the active room so a new event can be set up, without discarding it.
	 * The caller sends the user to event setup; createJudgesRoom then adds a new permit.
	 */
	beginAdditionalEvent(seed: EssentialData | null = null): void {
		// Remember where we came from so abandoning the new setup returns there instead of
		// dumping the user at the start screen with their event apparently gone.
		this.returnToRoomId = this.permit?.roomId ?? null;
		this.detachFromCurrentEvent();
		this.permit = null;
		this.storage.remove('activeRoomId');

		// Seeding after the detach, since detaching clears the essential data.
		if (seed) {
			this.handleEssentialDataUpdate(seed);
		}
	}

	/** True while a new-event setup can be abandoned back to the event it was started from. */
	hasEventToReturnTo(): boolean {
		return !!this.returnToRoomId && this.permits.some((permit) => permit.roomId === this.returnToRoomId);
	}

	/**
	 * Abandon a new-event setup and go back to the event it was started from.
	 * Returns false when there is nothing to return to (a genuine first run).
	 */
	async cancelAdditionalEvent(): Promise<boolean> {
		const roomId = this.returnToRoomId;
		this.returnToRoomId = null;

		if (!roomId || !this.permits.some((permit) => permit.roomId === roomId)) {
			return false;
		}

		await this.switchToEvent(roomId);
		return true;
	}

	/**
	 * Everything about the current event's setup except its teams, for seeding a sibling
	 * division: same awards, judge groups and event details, different teams.
	 */
	getSetupTemplateFromCurrentEvent(): EssentialData | null {
		if (!this.essentialData) {
			return null;
		}
		const template = $state.snapshot(this.essentialData) as EssentialData;
		return {
			...template,
			// A sibling division has its own teams, its own division number, and starts fresh.
			teamInfos: [],
			divisionId: null,
			judgingStep: 'beginning',
			judgeGroups: template.judgeGroups.map((group) => ({ ...group, assignedTeams: [] }))
		};
	}

	// ============================================================================
	// Event groups
	//
	// A group is one credential that opens several divisions. Everything below is about
	// turning that one link into the room permits the switcher already understands: the
	// group is asked which divisions it holds, and each becomes an ordinary permit
	// carrying the group's token and the group's deviceId.
	// ============================================================================

	getGroupPermits(): Readonly<GroupPermit>[] {
		return this.groupPermits.map((permit) => $state.snapshot(permit) as GroupPermit);
	}

	getGroupPermit(groupId: string): Readonly<GroupPermit> | null {
		const found = this.groupPermits.find((permit) => permit.groupId === groupId);
		return found ? ($state.snapshot(found) as GroupPermit) : null;
	}

	/**
	 * A group's divisions as the group last reported them.
	 *
	 * This, not the permit list, is what the switcher shows. A division exists because the
	 * group says so — a permit for it is something this device makes when it first opens
	 * that division, and its absence must never hide the division from the list.
	 */
	getGroupDivisions(groupId: string): readonly GroupDivision[] {
		const permit = this.groupPermits.find((candidate) => candidate.groupId === groupId);
		return permit?.divisions ? ($state.snapshot(permit.divisions) as GroupDivision[]) : [];
	}

	/**
	 * Open one of a group's divisions, making a permit for it if this device has none.
	 *
	 * Lazily rather than up front: a Judge Advisor covering four divisions rarely opens all
	 * four, and a permit that has never been used is a credential sitting in storage for
	 * no reason.
	 */
	async switchToGroupDivision(groupId: string, roomId: string): Promise<void> {
		const groupPermit = this.groupPermits.find((candidate) => candidate.groupId === groupId);
		if (!groupPermit) {
			throw new Error('CRITICAL: No permit for that event group');
		}

		if (!this.permits.some((candidate) => candidate.roomId === roomId)) {
			const division = groupPermit.divisions?.find((candidate) => candidate.roomId === roomId);
			this.permits.push({
				roomId,
				createdAt: Date.now(),
				// Shared with the group on purpose, so every division recognises this
				// device as the one the group knows.
				deviceId: groupPermit.deviceId,
				deviceName: groupPermit.deviceName,
				authToken: groupPermit.authToken,
				eventName: division?.label,
				groupId
			});
			this.storage.save('permits', $state.snapshot(this.permits));
		}

		await this.switchToEvent(roomId);
	}

	/** The live group session, once a group link has been resolved. */
	getGroupSession(): Readonly<GroupSessionState> | null {
		return this.groupSession ? ($state.snapshot(this.groupSession) as GroupSessionState) : null;
	}

	/**
	 * Open an event group link.
	 */
	async joinEventGroupFromUrl(url: string): Promise<void> {
		const groupId = parseEventGroupUrl(url);
		const authToken = parseAuthTokenFromUrl(url);
		if (!groupId || !authToken) {
			throw new Error('Invalid event group link');
		}

		// Re-using a link for a group already on this device keeps its deviceId, so the
		// device stays the same one in every division.
		const existing = this.groupPermits.find((permit) => permit.groupId === groupId);
		const permit: GroupPermit = existing
			? { ...existing, authToken }
			: {
					groupId,
					authToken,
					deviceId: generateUUID(),
					deviceName: getDeviceNameFromUserAgent(),
					createdAt: Date.now()
				};

		this.upsertGroupPermit(permit);

		try {
			const response = await this.callGroup(groupId, { kind: 'resolve' });
			await this.applyGroupResponse(groupId, response);
		} catch (error) {
			if (error instanceof GroupRpcError && error.isRejected) {
				this.forgetGroup(groupId);
			}
			throw error;
		}
	}

	/**
	 * Run any other group action — adding advisors, renaming divisions, removing rooms.
	 * Kept as one entry point because the group answers all of them with its whole state,
	 * so the local division list is refreshed by every one of them for free.
	 */
	async runGroupAction(groupId: string, action: GroupAction): Promise<GroupResponse> {
		const response = await this.callGroup(groupId, action);
		await this.applyGroupResponse(groupId, response);
		return response;
	}

	/**
	 * Open a division of the group that was just resolved.
	 *
	 * Stays put if the active room is already one of the group's — following a link for a
	 * competition you are already working in should not throw away where you were.
	 */
	async openEventGroup(groupId: string): Promise<void> {
		const divisions = this.groupSession?.groupId === groupId ? this.groupSession.divisions : [];
		if (divisions.length === 0) {
			throw new Error('That event group has no divisions yet');
		}

		if (this.permit && divisions.some((division) => division.roomId === this.permit?.roomId)) {
			return;
		}

		await this.switchToEvent(divisions[0]!.roomId);
	}

	/**
	 * Forget a group link on this device.
	 *
	 * Local only: the group and its divisions are untouched on the server, and the link
	 * opens them again. What goes is this device's copy of the credential, along with the
	 * division permits that credential seeded — a permit whose only token came from a group
	 * you have dropped is not something to keep lying around.
	 *
	 * Two things deliberately survive: a division you also hold on its own room link, and
	 * the division you are standing in. Removing either would strand you mid-event over
	 * what is meant to be a tidying-up action.
	 */
	forgetGroup(groupId: string): void {
		const groupPermit = this.groupPermits.find((permit) => permit.groupId === groupId);

		this.groupPermits = this.groupPermits.filter((permit) => permit.groupId !== groupId);
		this.storage.save('groupPermits', $state.snapshot(this.groupPermits));

		if (groupPermit) {
			this.permits = this.permits.filter(
				(permit) => permit.groupId !== groupId || permit.authToken !== groupPermit.authToken || permit.roomId === this.permit?.roomId
			);
			for (const permit of this.permits) {
				if (permit.groupId === groupId) {
					permit.groupId = undefined;
				}
			}
			if (this.permit?.groupId === groupId) {
				this.permit.groupId = undefined;
			}
			this.storage.save('permits', $state.snapshot(this.permits));
		}

		if (this.groupSession?.groupId === groupId) {
			this.groupSession = null;
		}
	}

	/**
	 * Hold on to a group link that was just minted for this device.
	 *
	 * Used after creating a group, and after being handed one by pasting a link: the token
	 * is shown once and is the only way back in, so it is stored before anything else can
	 * go wrong.
	 */
	async adoptEventGroup(groupId: string, authToken: string): Promise<void> {
		const existing = this.groupPermits.find((permit) => permit.groupId === groupId);
		this.upsertGroupPermit(
			existing
				? { ...existing, authToken }
				: {
						groupId,
						authToken,
						deviceId: generateUUID(),
						deviceName: getDeviceNameFromUserAgent(),
						createdAt: Date.now()
					}
		);

		await this.applyGroupResponse(groupId, await this.callGroup(groupId, { kind: 'resolve' }));
	}

	private async callGroup(groupId: string, action: GroupAction): Promise<GroupResponse> {
		const permit = this.groupPermits.find((candidate) => candidate.groupId === groupId);
		if (!permit) {
			throw new Error('CRITICAL: No permit for that event group');
		}

		return callGroupRpc(this.getMediaOrigin(), {
			groupId,
			auth: permit.authToken,
			deviceId: permit.deviceId,
			action
		});
	}

	/**
	 * Record the division list a *room* reported for its group.
	 *
	 * A member room can describe its group without any group credential, so this is a
	 * second, independent way for the switcher to learn what divisions exist — useful
	 * exactly when the group RPC is the thing that is failing. No-op when this device
	 * holds no link for that group, since it could not open the divisions anyway.
	 */
	cacheGroupDivisions(groupId: string, divisions: readonly GroupDivision[]): void {
		const permit = this.groupPermits.find((candidate) => candidate.groupId === groupId);
		if (!permit) {
			return;
		}

		permit.divisions = divisions.map((division) => ({ ...division }));
		this.storage.save('groupPermits', $state.snapshot(this.groupPermits));
	}

	/**
	 * Bring every held group up to date.
	 *
	 * Divisions are added and removed at the group, often from another device, so the
	 * cached list goes stale the moment a colleague adds one. Called when the switcher
	 * opens, which is exactly when being stale would be noticed.
	 */
	async refreshEventGroups(): Promise<void> {
		for (const permit of this.getGroupPermits()) {
			try {
				await this.applyGroupResponse(permit.groupId, await this.callGroup(permit.groupId, { kind: 'resolve' }));
			} catch (error) {
				// A group that no longer exists, or a link that has been revoked, is a
				// definite answer: drop it rather than leaving a dead entry in the switcher
				// forever with no way to clear it. Anything else — offline, a bad gateway — is
				// not, so the cached divisions stay put.
				if (error instanceof GroupRpcError && error.isRejected) {
					this.forgetGroup(permit.groupId);
					continue;
				}
				console.debug('Could not refresh event group', permit.groupId, error);
			}
		}
	}

	/** Fold a group's answer into local state: its name and its divisions. */
	private async applyGroupResponse(groupId: string, response: GroupResponse): Promise<void> {
		const permit = this.groupPermits.find((candidate) => candidate.groupId === groupId);
		if (permit && permit.groupName !== response.state.name) {
			permit.groupName = response.state.name;
			this.storage.save('groupPermits', $state.snapshot(this.groupPermits));
		}

		this.groupSession = $state.snapshot(response.state) as GroupSessionState;
		this.adoptGroupDivisions(groupId, response.state.divisions);
	}

	/**
	 * Turn a group's division list into room permits.
	 *
	 * Merges rather than replaces: a Judge Advisor may already hold a division on its own
	 * access link, and that credential is theirs, not the group's. Where one exists it is
	 * kept and simply labelled as part of the group; only divisions this device has no
	 * permit for are seeded with the group token.
	 */
	private adoptGroupDivisions(groupId: string, divisions: readonly GroupDivision[]): void {
		const groupPermit = this.groupPermits.find((candidate) => candidate.groupId === groupId);
		if (!groupPermit) {
			return;
		}

		// Recorded first, and independently of the permits below. What the group holds is a
		// fact about the group; whether this device has a permit for each division is a
		// separate matter, and the switcher must not confuse the two.
		groupPermit.divisions = divisions.map((division) => ({ ...division }));
		this.storage.save('groupPermits', $state.snapshot(this.groupPermits));

		// A throwaway lookup, not state: built here, read on the next line, discarded. The
		// rule below guards against a plain Set being *held* in reactive state, where
		// mutations would go untracked; a SvelteSet here would add reactivity nothing observes.
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const divisionRoomIds = new Set<string>(divisions.map((division) => division.roomId));

		// A division the group no longer lists is no longer reachable with the group token.
		// Drop only the permits the group itself seeded; anything held on its own link stays.
		this.permits = this.permits.filter(
			(candidate) => candidate.groupId !== groupId || divisionRoomIds.has(candidate.roomId) || candidate.authToken !== groupPermit.authToken
		);

		for (const division of divisions) {
			const existing = this.permits.find((candidate) => candidate.roomId === division.roomId);
			if (existing) {
				existing.groupId = groupId;
				existing.eventName = existing.eventName ?? division.label;
				continue;
			}

			this.permits.push({
				roomId: division.roomId,
				createdAt: Date.now(),
				// Shared with the group on purpose, so every division recognises this
				// device as the one the group knows.
				deviceId: groupPermit.deviceId,
				deviceName: groupPermit.deviceName,
				authToken: groupPermit.authToken,
				eventName: division.label,
				groupId
			});
		}

		// The room being stood in right now is usually one of these divisions, and the active
		// permit is a copy that predates the group. Stamp it too, or the switcher would leave
		// the current division out of its own group until the next reload.
		if (this.permit && divisionRoomIds.has(this.permit.roomId)) {
			this.permit.groupId = groupId;
		}

		this.storage.save('permits', $state.snapshot(this.permits));
	}

	private upsertGroupPermit(permit: GroupPermit): void {
		const index = this.groupPermits.findIndex((candidate) => candidate.groupId === permit.groupId);
		if (index >= 0) {
			this.groupPermits[index] = permit;
		} else {
			this.groupPermits.push(permit);
		}
		this.storage.save('groupPermits', $state.snapshot(this.groupPermits));
	}

	/**
	 * Get permit
	 */
	getPermit(): Readonly<Permit> | null {
		return this.permit ? $state.snapshot(this.permit) : null;
	}

	/**
	 * Get Judges' Room URL for sharing
	 */
	getJudgesRoomUrl(authToken?: string | null): string {
		if (!this.permit?.roomId) {
			throw new Error("CRITICAL: No active Judges' Room");
		}
		// When AC is off, omit auth from share links even if the permit stores a JA token.
		// Pass an explicit token (including null) to override.
		const token = authToken !== undefined ? authToken : this.isAccessControlEnabled() ? (this.permit.authToken ?? null) : null;
		return buildJudgesRoomJoinUrl(window.location.origin, this.permit.roomId, token);
	}

	isAccessControlEnabled(): boolean {
		return this.essentialData?.accessControlEnabled ?? false;
	}

	handleClientAuthenticationChange(authentication: ClientAuthentication): void {
		if (!this.permit) {
			throw new Error('CRITICAL: No permit');
		}

		this.permit.authToken = authentication.isAccessControlled ? authentication.authToken : undefined;
		this.savePermitToStorage();

		if (!authentication.isAccessControlled) {
			return;
		}
		if (authentication.role === 'judge_advisor') {
			this.setCurrentUserLocally({ role: 'judge_advisor' });
			return;
		}
		const judge = this.allJudges.find((j) => j.id === authentication.judgeId);
		if (judge) {
			this.setCurrentUserLocally({ role: 'judge', judge });
		}
	}

	/**
	 * Create a new Judges' Room
	 */
	async createJudgesRoom(judgeAdvisorName?: string, judgeAdvisorEmail: string | null = null): Promise<void> {
		try {
			this.currentUser = null;
			this.clientManager.resetClient();

			// Deliberately does not clear other events' permits — creating a second division
			// must not evict the first from this device.
			this.clearUserFromStorage();

			if (!this.essentialData) {
				throw new Error('CRITICAL: No essential data');
			}

			const roomId = generateUUID();
			// Connect without auth; server mints the JA token and returns it in authentication.
			// The name is stamped on at creation: setup calls handleEssentialDataUpdate before
			// the permit exists, so the caching there has nothing to write to yet.
			this.permit = this.createNewPermit(roomId, undefined, this.essentialData.eventName);
			this.savePermitToStorage();

			const authentication = await this.wrpcClient.handshake.createJudgesRoom.mutation({
				essentialData: this.essentialData,
				teamData: [...Object.values(this.allTeamData)],
				judges: [...this.allJudges],
				judgeAdvisorName: judgeAdvisorName?.trim() || undefined,
				// The server sends this one message as the room is created. Failure there is
				// swallowed on purpose: the event exists either way, and the link can be
				// resent from the Users dialog.
				judgeAdvisorEmail: judgeAdvisorEmail?.trim().toLowerCase() || null
			});
			this.handleClientAuthenticationChange(authentication);
			this.returnToRoomId = null;
		} catch (error) {
			this.permit = null;
			this.clearPermitFromStorage();
			this.addErrorNotice(m.failed_to_create_judges_room({ error: error instanceof Error ? error.message : 'Unknown error' }));
			throw error;
		}
	}

	/**
	 * Check if the Judges' Room is joined, it doesn't mean we are connected to the server
	 */
	isJudgesRoomJoined(): boolean {
		return this.permit !== null && this.essentialData !== null;
	}

	/**
	 * Check if the Judges' Room is joined and the user is selected, we can now go to the workspace
	 */
	isJudgingReady(): boolean {
		return this.permit !== null && this.essentialData !== null && this.getCurrentUser() !== null;
	}

	hasPermit(): boolean {
		return this.permit !== null;
	}

	/**
	 * Leave current Judges' Room
	 */
	async leaveJudgesRoom(): Promise<void> {
		// Ask the server to kick siblings, forget this device, and force-close this socket.
		// The mutation often rejects when kickClient closes us; that is expected.
		this.intentionalLeave = true;
		try {
			if (this.getConnectionState() === 'connected') {
				await this.wrpcClient.handshake.leaveJudgesRoom.mutation();
			}
		} catch (error) {
			// Socket may already be closed by kickClient — ignore.
			console.debug('leaveJudgesRoom server notify finished:', error);
		}

		// Forget this room BEFORE dropping the reference to it: clearPermitFromStorage reads
		// this.permit to know which room to remove from the list. Nulling it first meant the
		// room being left stayed in storage, and the caller could pick it as the room to
		// switch to next — which then failed, because the server had just kicked the device.
		this.clearPermitFromStorage();
		this.clearUserFromStorage();

		// Clear local Judges' Room data
		this.permit = null;
		this.currentUser = null;
		this.essentialData = null;
		this.allTeamData = {};
		this.allJudges = [];
		this.allDevices = [];
		this.allFinalAwardNominations = {};
		// no client-held room id field to clear
		this.clientManager.resetClient();

		this.intentionalLeave = false;
	}

	/**
	 * Destroy all Judges' Room data (for admin)
	 */
	async destroyJudgesRoomData(): Promise<void> {
		try {
			await this.wrpcClient.handshake.destroyJudgesRoom.mutation();
		} finally {
			// The mutation usually rejects because the server closes the socket mid-call, so
			// forget the room either way — otherwise its permit stays in the switcher and the
			// app keeps trying to rejoin a room that no longer exists.
			this.detachFromCurrentEvent();
			this.clearPermitFromStorage();
			this.permit = null;
		}
	}

	/**
	 * Reconnect to stored Judges' Room
	 */
	/**
	 * Reconnect to a stored room, trying each in turn.
	 *
	 * A device can hold several permits, and rooms outlive neither servers nor events. If
	 * the active one is gone, move to the next rather than stopping — otherwise a stale
	 * permit at the front of the list means an error on every load, and one dialog per dead
	 * room before reaching a live one.
	 *
	 * Throws NoStoredRoomsError once nothing is left. That is not a failure worth an alert:
	 * the rooms were removed on the server, the user did not do anything wrong, and the
	 * start screen is the right place to end up.
	 */
	async joinJudgesRoomWithStoredPermit(): Promise<void> {
		while (this.permit) {
			this.lastConnectAuthError = null;
			try {
				await this.joinJudgesRoom();
				return;
			} catch (error) {
				const message = this.lastConnectAuthError ?? (error instanceof Error ? error.message : 'Unknown error');
				this.lastConnectAuthError = null;

				// A room that has been destroyed leaves its permit behind, and the app would
				// otherwise retry it on every load with no way to reach the switcher and remove
				// it — the start screen has no escape hatch. Treat "gone" as a reason to forget.
				const roomIsGone =
					message.includes("Judges' Room not found") || message.includes('No metadata found') || message.includes('no such table');
				const credentialRejected =
					message.includes('Access link') || message.includes('Invalid or expired') || message.includes('already bound');

				if (!roomIsGone && !credentialRejected) {
					// Something else went wrong — offline, a server fault. Keep the permit and
					// let the caller report it; retrying the rest of the list would only
					// produce the same failure several times over.
					this.addErrorNotice(m.failed_to_reconnect_to_judges_room({ error: message }));
					// Keep the original attached. This is the "offline or server fault" branch,
					// which is exactly the one worth being able to diagnose later.
					throw new Error(message, { cause: error });
				}

				// SAFETY: forget the room BEFORE dropping the reference to it.
				// clearPermitFromStorage reads this.permit to know which room to remove, so
				// nulling it first removed nothing at all — the dead permit stayed in storage
				// and was retried on every load, forever.
				this.clearUserFromStorage();
				this.clearPermitFromStorage();
				this.detachFromCurrentEvent();

				// On to the next one, if there is one.
				this.permit = this.permits[0] ? { ...this.permits[0] } : null;
				if (this.permit) {
					this.storage.save('activeRoomId', this.permit.roomId);
					this.loadUserFromStorage();
				}

				if (credentialRejected && !roomIsGone) {
					// Worth telling them: their link stopped working, which is a thing that
					// happened rather than a thing that was never there.
					this.addErrorNotice(m.failed_to_reconnect_to_judges_room({ error: message }));
				}
			}
		}

		throw new NoStoredRoomsError();
	}

	getConnectionState(): ConnectionState {
		return this.connectionState;
	}

	/** Increments each time the connection is re-established. See `reconnections`. */
	getReconnectionCount(): number {
		return this.reconnections;
	}

	handleEventSetupUpdate(data: Readonly<RoomState | JoiningKit>): void {
		this.handleEssentialDataUpdate(data.essentialData);
		this.handleAllTeamDataUpdate(data.teamData);
		this.handleAllJudgesUpdate(data.judges);
		this.allFinalAwardNominations = $state.snapshot(data.finalAwardNominations);
	}

	// ============================================================================
	// Essential Data
	// ============================================================================

	/**
	 * Handle EssentialData update from server
	 */
	handleEssentialDataUpdate(data: Readonly<EssentialData>): void {
		this.essentialData = $state.snapshot(data);

		// Cache the name on the permit so the event switcher can label this room without
		// connecting to it. Doing it here rather than only on join means a freshly created
		// room, and any later rename, are both picked up.
		if (this.permit && this.permit.eventName !== data.eventName) {
			this.permit.eventName = data.eventName;
			this.savePermitToStorage();
		}
	}

	getEssentialData(): Readonly<EssentialData> | null {
		return this.essentialData ? $state.snapshot(this.essentialData) : null;
	}

	hasEssentialData(): boolean {
		return this.essentialData !== null;
	}

	getEventName(): string | null {
		return this.essentialData?.eventName || null;
	}

	getAllTeams(): Readonly<Readonly<TeamInfo>[]> {
		return $state.snapshot(this.essentialData?.teamInfos || []);
	}

	getAllJudgeGroups(): Readonly<Readonly<JudgeGroup>[]> {
		return $state.snapshot(this.essentialData?.judgeGroups || []);
	}

	getJudgeGroupCount(): number {
		return this.essentialData?.judgeGroups.length || 0;
	}

	getAllAwards(): Readonly<Readonly<Award>[]> {
		if (!this.essentialData) return [];
		return this.essentialData.awards;
	}

	// ============================================================================
	// Team Data
	// ============================================================================

	/**
	 * Handle all team data update from server
	 */
	handleAllTeamDataUpdate(data: Readonly<Readonly<TeamData>[]>): void {
		this.allTeamData = $state.snapshot(processTeamDataArray(data));
	}

	/**
	 * Handle team data update from server
	 */
	handleTeamDataUpdate(data: Readonly<TeamData>): void {
		this.allTeamData[data.id] = $state.snapshot(data);
	}

	getAllTeamData(): Readonly<Record<string, Readonly<TeamData>>> {
		return $state.snapshot(this.allTeamData);
	}

	// ============================================================================
	// Judges
	// ============================================================================

	handleAllJudgesUpdate(data: Readonly<Readonly<Judge>[]>): void {
		this.allJudges = $state.snapshot(data);
	}

	getAllJudges(): Readonly<Readonly<Judge>[]> {
		return $state.snapshot(this.allJudges);
	}

	getJudgeCount(): number {
		return this.allJudges.length;
	}

	// ============================================================================
	// Roster editing (Judge Advisor)
	//
	// The server is the source of truth for all of these: each one round-trips and the
	// resulting broadcast updates local state, so two Judge Advisors editing at once
	// converge instead of silently overwriting each other.
	// ============================================================================

	/** Replace judge groups and their team assignments. */
	async updateJudgeGroups(judgeGroups: readonly JudgeGroup[]): Promise<void> {
		await this.wrpcClient.judge.updateJudgeGroups.mutation(judgeGroups.map((group) => $state.snapshot(group)));
	}

	/** Move a single team into a group, removing it from whichever group currently holds it. */
	async assignTeamToGroup(teamId: string, targetGroupId: string): Promise<void> {
		const next = this.getAllJudgeGroups().map((group) => ({
			...group,
			assignedTeams:
				group.id === targetGroupId
					? group.assignedTeams.includes(teamId)
						? group.assignedTeams
						: [...group.assignedTeams, teamId]
					: group.assignedTeams.filter((id) => id !== teamId)
		}));

		await this.updateJudgeGroups(next);
	}

	/** Remove a team from every group, leaving it unassigned. */
	async unassignTeam(teamId: string): Promise<void> {
		await this.updateJudgeGroups(
			this.getAllJudgeGroups().map((group) => ({
				...group,
				assignedTeams: group.assignedTeams.filter((id) => id !== teamId)
			}))
		);
	}

	async renameJudgeGroup(groupId: string, name: string): Promise<void> {
		await this.updateJudgeGroups(this.getAllJudgeGroups().map((group) => (group.id === groupId ? { ...group, name } : group)));
	}

	async addJudgeGroup(name: string): Promise<void> {
		await this.updateJudgeGroups([...this.getAllJudgeGroups(), { id: generateUUID(), name, assignedTeams: [] }]);
	}

	/**
	 * Remove a group. The server refuses while judges still reference it, so surface that
	 * as a clear failure rather than silently reassigning people.
	 */
	async removeJudgeGroup(groupId: string): Promise<void> {
		await this.updateJudgeGroups(this.getAllJudgeGroups().filter((group) => group.id !== groupId));
	}

	/** Add a judge to a group. Their access link is minted server-side. */
	async addJudge(name: string, groupId: string): Promise<Judge> {
		const judge: Judge = { id: generateUUID(), name, groupId };
		await this.wrpcClient.judge.updateJudge.mutation(judge);
		return judge;
	}

	/** Rename a judge, or move them to a different group. */
	async updateJudge(judge: Judge): Promise<void> {
		await this.wrpcClient.judge.updateJudge.mutation($state.snapshot(judge));
	}

	/**
	 * Remove a judge. Their submitted rubrics stay in the room; only their roster entry and
	 * access link go away, and any device signed in as them is kicked server-side.
	 */
	async removeJudge(judgeId: string): Promise<void> {
		await this.wrpcClient.judge.updateAllJudges.mutation(
			this.getAllJudges()
				.filter((judge) => judge.id !== judgeId)
				.map((judge) => $state.snapshot(judge))
		);
	}

	// ============================================================================
	// Device Management
	// ============================================================================

	/**
	 * Handle device list update from server
	 */
	handleDeviceListUpdate(clients: Readonly<Readonly<DeviceInfo>[]>): void {
		this.allDevices = $state.snapshot(clients);
	}

	/**
	 * Get connected clients
	 */
	getDevices(): Readonly<Readonly<DeviceInfo>[]> {
		return $state.snapshot(this.allDevices);
	}

	/**
	 * Kick a client from Judges' Room
	 */
	async kickDevice(deviceId: string): Promise<void> {
		try {
			await this.wrpcClient.device.kickDevice.mutation({ deviceId });
		} catch (error) {
			this.addErrorNotice(m.failed_to_kick_device({ error: error instanceof Error ? error.message : 'Unknown error' }));
			throw error;
		}
	}

	// ============================================================================
	// Final Award Rankings
	// ============================================================================

	handleFinalAwardNominationsUpdate(awardName: string, data: AwardNomination[]): void {
		this.allFinalAwardNominations[awardName] = $state.snapshot(data);
	}

	getAllFinalAwardNominations(): Readonly<Record<string, Readonly<AwardNomination>[]>> {
		return $state.snapshot(this.allFinalAwardNominations);
	}

	// ============================================================================
	// Utility Methods
	// ============================================================================

	getAllAwardsInMap(): Readonly<Record<string, Readonly<Award>>> {
		const awards = this.getAllAwards();
		return awards.reduce(
			(acc, award) => {
				acc[award.name] = award;
				return acc;
			},
			{} as Record<string, Readonly<Award>>
		);
	}

	getExistingJudgesGroupedByGroup(): Readonly<Record<string, Readonly<Judge>[]>> {
		const judgeGroups = this.getAllJudgeGroups();
		const allJudges = this.allJudges;

		const groups: Record<string, Readonly<Judge>[]> = {};
		judgeGroups.forEach((group) => {
			groups[group.id] = allJudges.filter((judge) => judge.groupId === group.id);
		});

		return $state.snapshot(groups);
	}

	getAllJudgeGroupsInMap(): Readonly<Record<string, Readonly<JudgeGroup>>> {
		const judgeGroups = this.getAllJudgeGroups();
		return judgeGroups.reduce(
			(acc, group) => {
				acc[group.id] = group;
				return acc;
			},
			{} as Record<string, Readonly<JudgeGroup>>
		);
	}

	getAllTeamInfoAndData(): Readonly<Record<string, Readonly<TeamInfoAndData>>> {
		const allTeamData = this.getAllTeamData();
		return this.getAllTeams().reduce(
			(acc, team) => ({
				...acc,
				[team.id]: {
					...team,
					...allTeamData[team.id]
				}
			}),
			{} as Record<string, Readonly<TeamInfoAndData>>
		);
	}

	findTeamById(teamId: string): Readonly<TeamInfo> | null {
		const allTeams = this.getAllTeams();
		const team = allTeams.find((t) => t.id === teamId);
		return team ? $state.snapshot(team) : null;
	}

	findTeamDataById(teamId: string): Readonly<TeamData> | null {
		const allTeamData = this.getAllTeamData();
		const teamData = allTeamData[teamId];
		return teamData ? $state.snapshot(teamData) : null;
	}

	findJudgeById(judgeId: string): Readonly<Judge> | null {
		const allJudges = this.getAllJudges();
		const judge = allJudges.find((j) => j.id === judgeId);
		return judge ? $state.snapshot(judge) : null;
	}

	findJudgeGroupByJudgeId(judgeId: string): Readonly<JudgeGroup> | null {
		const judge = this.findJudgeById(judgeId);
		if (!judge) return null;

		const judgeGroup = this.getAllJudgeGroups().find((g) => g.id === judge.groupId);
		return judgeGroup ? $state.snapshot(judgeGroup) : null;
	}

	getPreferences(): Preferences {
		return this.preferences;
	}

	// ============================================================================
	// User Management
	// ============================================================================

	async selectUser(user: User): Promise<void> {
		if (this.isAccessControlEnabled()) {
			throw new Error('CRITICAL: Switching roles is disabled when access control is enabled');
		}

		if (user.role === 'judge') {
			await this.wrpcClient.judge.updateJudge.mutation(user.judge);
		}

		this.setCurrentUserLocally(user);
	}

	/** Set local role without server roster mutations (used after access-control bind). */
	setCurrentUserLocally(user: User): void {
		this.currentUser = user;
		this.saveUserToStorage();
	}

	async unselectUser(): Promise<void> {
		this.clearCurrentUser();
	}

	getCurrentUser(): Readonly<User> | null {
		return this.currentUser ? $state.snapshot(this.currentUser) : null;
	}

	getCurrentUserJudge(): Readonly<Judge> | null {
		const user = this.getCurrentUser();
		if (!user || user.role !== 'judge') return null;
		return this.findJudgeById(user.judge.id);
	}

	getCurrentUserJudgeGroup(): Readonly<JudgeGroup> | null {
		const judge = this.getCurrentUserJudge();
		if (!judge) return null;
		return this.findJudgeGroupByJudgeId(judge.id);
	}

	/**
	 * Check if a user is selected
	 */
	hasCurrentUser(): boolean {
		return this.currentUser !== null;
	}

	// ============================================================================
	// Notice Management
	// ============================================================================

	/**
	 * Add notice with type
	 */
	addNotice(message: string, type: 'success' | 'error'): void {
		const notice: Notice = {
			id: `notice-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
			message,
			type,
			timestamp: Date.now()
		};

		this.notices.push(notice);

		// Auto-remove notices after 10 seconds
		setTimeout(() => {
			const index = this.notices.findIndex((n) => n.id === notice.id);
			if (index > -1) {
				this.notices.splice(index, 1);
			}
		}, 10000);
	}

	/**
	 * Add error notice (backward compatibility)
	 */
	addErrorNotice(message: string): void {
		this.addNotice(message, 'error');
	}

	/**
	 * Add success notice
	 */
	addSuccessNotice(message: string): void {
		this.addNotice(message, 'success');
	}

	/**
	 * Report a write that did not reach the server.
	 *
	 * Every mutation in the workspace used to end in `catch { console.error(...) }`. On a
	 * judge's screen a rejected save looked exactly like a successful one: the score they
	 * typed was still there, because it is local state, and nothing said otherwise. The
	 * work was gone and nobody knew until deliberations.
	 *
	 * That was survivable when the server sat on the same network. It is not now: the
	 * server is remote, so a dropped connection is an ordinary event rather than a rare
	 * one, and this is the difference between "the wifi went funny, redo that one" and
	 * silently losing an interview's worth of scoring.
	 *
	 * Deliberately a notice rather than a dialog. A judge mid-interview should be told,
	 * not interrupted — and the message says the change may not have been saved rather
	 * than claiming to know, because from here we cannot tell whether the server applied
	 * it before the connection went.
	 */
	reportWriteFailure(error: unknown, context: string): void {
		const reason = error instanceof Error ? error.message : String(error);
		console.error(`${context}:`, error);
		this.addErrorNotice(m.write_failed({ context, reason }));
	}

	/**
	 * Get all notices
	 */
	getNotices(): readonly Notice[] {
		return $state.snapshot(this.notices);
	}

	/**
	 * Clear a specific notice by ID
	 */
	clearNotice(id: string): void {
		const index = this.notices.findIndex((n) => n.id === id);
		if (index > -1) {
			this.notices.splice(index, 1);
		}
	}

	/**
	 * Clear all notices
	 */
	clearAllNotices(): void {
		this.notices = [];
	}

	get wrpcClient() {
		return this.clientManager.getClient()[1];
	}

	get developmentMode(): boolean {
		return this.isDevelopment;
	}

	getMediaOrigin(): string {
		return this.isDevelopment
			? `http://${typeof window !== 'undefined' ? window.location.hostname : 'localhost'}:8787`
			: typeof window !== 'undefined'
				? window.location.origin
				: '';
	}

	// ============================================================================
	// Private Methods
	// ============================================================================

	private createClientOptions(): ClientOptions<ClientRouter> {
		if (this.permit === null) {
			throw new Error('CRITICAL: No permit');
		}

		const baseWsUrl = this.isDevelopment
			? `ws://${window.location.hostname}:8787/ws` // Local development server
			: `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/ws`; // Production Cloudflare Worker

		const wsUrl = this.permit.authToken ? `${baseWsUrl}?auth=${encodeURIComponent(this.permit.authToken)}` : baseWsUrl;

		this.hasConnected = false;

		return {
			wsUrl,
			clientId: generateUUID(),
			roomId: this.permit.roomId,
			deviceId: this.permit.deviceId,
			deviceName: this.permit.deviceName,
			onContext: async () => ({}),
			onOpen: () => {},
			onClosed: (code, reason) => {
				if (code === ConnectionCloseCode.KICKED) {
					if (this.intentionalLeave) {
						// Server closed us as part of leaveJudgesRoom — cleanup continues there.
						return;
					}
					if (isConnectAuthCloseReason(reason)) {
						// Accept-then-close auth denial — join/reconnect catch uses this over the generic WS error.
						this.lastConnectAuthError = reason.trim();
						return;
					}
					this.permit = null;
					this.currentUser = null;
					this.clearPermitFromStorage();
					this.clearUserFromStorage();
					this.addErrorNotice(m.you_have_been_kicked_from_the_judges_room());
					AppUI.appPhase = 'leaving';
				} else if (code === ConnectionCloseCode.ROOM_DESTROYED) {
					this.addErrorNotice(m.the_judges_room_has_been_destroyed());
					AppUI.appPhase = 'leaving';
				}
			},
			onConnectionStateChange: (state) => {
				if (state === 'connected') {
					if (this.hasConnected) {
						this.reconnections++;
					}
					this.hasConnected = true;
				}
				this.connectionState = state;
			}
		};
	}

	/**
	 * Clear current user with reason
	 */
	private clearCurrentUser(): void {
		this.currentUser = null;
		this.clearUserFromStorage();
	}

	private createNewPermit(roomId: string, authToken?: string, eventName?: string): Permit {
		const deviceId = generateUUID();
		const deviceName = getDeviceNameFromUserAgent();
		return {
			roomId,
			deviceId,
			deviceName,
			createdAt: Date.now(),
			authToken,
			eventName
		};
	}

	/**
	 * Permits are a list so one device can hold several rooms — typically the divisions of
	 * one competition. Exactly one is active at a time; the rest sit dormant in storage.
	 */
	private loadPermitFromStorage(): Permit | null {
		const storedGroups = this.storage.load<GroupPermit[]>('groupPermits');
		this.groupPermits = Array.isArray(storedGroups) ? storedGroups : [];

		const stored = this.storage.load<Permit[]>('permits');

		if (stored && Array.isArray(stored)) {
			this.permits = stored;
		} else {
			// MIGRATION: devices from before multi-event hold a single 'permit'. Fold it into
			// the list rather than dropping it, or the user silently loses their room.
			const legacy = this.storage.load<Permit>('permit');
			this.permits = legacy ? [legacy] : [];
			if (legacy) {
				this.storage.save('permits', this.permits);
				this.storage.remove('permit');
			}
		}

		const activeRoomId = this.storage.load<string>('activeRoomId');
		this.permit = this.permits.find((candidate) => candidate.roomId === activeRoomId) ?? this.permits[0] ?? null;
		if (this.permit) {
			this.storage.save('activeRoomId', this.permit.roomId);
		}
		return this.permit;
	}

	private savePermitToStorage(): void {
		if (!this.permit) {
			return;
		}
		const snapshot = $state.snapshot(this.permit) as Permit;
		const index = this.permits.findIndex((candidate) => candidate.roomId === snapshot.roomId);
		if (index >= 0) {
			// Merge rather than replace. `this.permit` is a copy taken when the room became
			// active, so it is authoritative only for what it has since been told — its token,
			// its event name. Anything written to the stored permit afterwards, such as the
			// groupId stamped on when a group is created or joined, is absent from the copy
			// and would be silently dropped by an overwrite.
			this.permits[index] = { ...this.permits[index], ...snapshot };
		} else {
			this.permits.push(snapshot);
		}
		this.storage.save('permits', $state.snapshot(this.permits));
		this.storage.save('activeRoomId', snapshot.roomId);
	}

	/** Forget only the active room, leaving any other events on this device intact. */
	private clearPermitFromStorage(): void {
		const roomId = this.permit?.roomId;
		if (roomId) {
			this.permits = this.permits.filter((candidate) => candidate.roomId !== roomId);
			this.storage.remove(`currentUser:${roomId}`);
		}
		this.storage.save('permits', $state.snapshot(this.permits));
		this.storage.remove('activeRoomId');
	}

	/**
	 * The saved role is per room: the same person can be a Judge Advisor in one division
	 * and a judge in another, so a single 'currentUser' key would leak the wrong role
	 * across a switch.
	 */
	private userStorageKey(roomId: string | undefined = this.permit?.roomId): string | null {
		return roomId ? `currentUser:${roomId}` : null;
	}

	private loadUserFromStorage(): User | null {
		const key = this.userStorageKey();
		if (!key) {
			this.currentUser = null;
			return null;
		}

		let stored = this.storage.load<User>(key);
		if (!stored) {
			// MIGRATION: the pre-multi-event key was unscoped. Claim it for the first room.
			const legacy = this.storage.load<User>('currentUser');
			if (legacy) {
				this.storage.save(key, legacy);
				this.storage.remove('currentUser');
				stored = legacy;
			}
		}

		this.currentUser = stored ?? null;
		return this.currentUser;
	}

	private saveUserToStorage(): void {
		const key = this.userStorageKey();
		if (key && this.currentUser) {
			this.storage.save(key, this.currentUser);
		}
	}

	private clearUserFromStorage(): void {
		const key = this.userStorageKey();
		if (key) {
			this.storage.remove(key);
		}
	}
}
