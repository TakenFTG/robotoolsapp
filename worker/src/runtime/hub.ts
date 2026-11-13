import { EventGroup, type GroupRoomAccess } from '../group/event-group';
import { AdminRegistry } from '../admin/registry';
import type { EventGroupGateway } from '../group/types';
import type { AdminRegistryGateway, RegisterRoomInput } from '../admin/gateway';
import { Room } from './room';
import { RefRoom } from '../ref/ref-room';
import type { JudgesLinkGateway, RedeemedDivision, RefLinkGateway, RefLinkTarget } from '../ref/link-gateway';
import {
	REF_LINK_CODE_ALPHABET,
	REF_LINK_CODE_TTL_MS,
	buildRefRoomJoinUrl,
	normalizeRefLinkCode,
	type RefLinkCodeResult
} from '@robotools.app/protocol/src/ref';
import { fetchEventSummary } from '../matches/source';
import { buildRefAccessLinkEmail } from '../email/template';
import { describeSmtpFailure } from '../email/smtp';
import { DataDirectory, migrationsPath, openDatabase, type OpenDatabase } from './storage';
import type { EmailContext } from '../server-router';

/**
 * How long an empty room file is left alone before it is treated as abandoned.
 *
 * Long enough that someone part-way through event setup — connected, nothing saved yet —
 * is never swept out from under, short enough that the junk does not pile up.
 */
const ABANDONED_EMPTY_ROOM_MS = 30 * 60 * 1000;

type CheckedLinkTarget = {
	room: Room;
	info: NonNullable<Awaited<ReturnType<Room['refLinkInfo']>>>;
	division: RedeemedDivision;
	/**
	 * The division's own ref room with no refs in it, which it is leaving. Its notes, written by
	 * the Judge Advisors, move into the room it links to, and then it is deleted.
	 */
	leaving: { refRoomId: string; eventName: string } | null;
};

type RefLinkInfo = NonNullable<Awaited<ReturnType<Room['refLinkInfo']>>>;

export type HubOptions = {
	dataDir: string;
	adminUsername: string | null;
	adminPassword: string | null;
	/** Shared by every room: one mail transport for the process, not one per event. */
	email: EmailContext;
	retention: RetentionPolicy;
};

export type RetentionPolicy = {
	/** Off entirely when false: nothing is ever deleted on a timer. */
	enabled: boolean;
	/** Days of inactivity after which an event is destroyed. */
	deleteAfterDays: number;
	/** Days of inactivity after which the Judge Advisor is warned. Must be less. */
	warnAfterDays: number;
};

/**
 * Everything the server owns, and the only place that knows how the pieces find each
 * other.
 *
 * On Workers this was three Durable Object namespaces and the bindings between them.
 * Here it is three maps and a directory. The important property is unchanged: a room, a
 * group and the registry each have their own storage, and the only ways between them are
 * the narrow gateways below — a room can ask its group a question, a group can ask a room
 * to drop an advisor, and neither can read the other's data.
 *
 * Instances are created on demand and then kept. A judging event is a day or two long and
 * the working set is a handful of rooms, so evicting them would trade a real risk
 * (closing a database out from under an in-flight request) for an imaginary saving.
 */
export class Hub {
	private readonly rooms = new Map<string, Room>();
	private readonly refRooms = new Map<string, RefRoom>();
	/**
	 * Unredeemed link codes. In memory on purpose: a code lives fifteen minutes, and one lost
	 * to a restart costs a Judge Advisor a click to make another.
	 */
	private readonly refLinkCodes = new Map<string, { target: RefLinkTarget; expiresAt: number }>();
	private readonly groups = new Map<string, { group: EventGroup; storage: OpenDatabase }>();
	private readonly data: DataDirectory;
	private adminStorage: OpenDatabase | null = null;
	private adminRegistry: AdminRegistry | null = null;

	constructor(private readonly opts: HubOptions) {
		this.data = new DataDirectory(opts.dataDir);
	}

	// ============================================================================
	// Rooms
	// ============================================================================

	room(roomId: string): Room {
		const existing = this.rooms.get(roomId);
		if (existing) {
			return existing;
		}

		const storage = openDatabase(this.data.roomFile(roomId), migrationsPath('migrations'));
		const room = new Room({
			roomId,
			storage,
			group: this.groupGatewayForRooms(),
			registry: this.registryGatewayForRooms(),
			email: this.opts.email,
			refLink: this.refLinkGatewayForRooms(),
			onDestroyed: (id) => this.forgetRoom(id)
		});

		this.rooms.set(roomId, room);
		return room;
	}

	/**
	 * A destroyed room's file goes with it.
	 *
	 * Deleting the file is the whole of it: the judging data, the access tokens and the
	 * team photos are all in there. There is no second store that can be left holding
	 * something, which is the main reason photos were moved into the room in the first
	 * place.
	 */
	private forgetRoom(roomId: string): void {
		const room = this.rooms.get(roomId);
		this.rooms.delete(roomId);

		try {
			room?.close();
		} catch (error) {
			console.error('Failed to close destroyed room', roomId, error);
		}

		try {
			this.data.removeRoom(roomId);
		} catch (error) {
			console.error('Failed to delete room storage', roomId, error);
		}
	}

	// ============================================================================
	// Ref rooms
	// ============================================================================

	/**
	 * Open a ref room, or null if there is no such room.
	 *
	 * Unlike Judges' Rooms, a ref room is only ever created by an explicit request, so a
	 * stale link to a deleted room must not quietly create an empty file. `create` is the
	 * one path allowed to bring a new file into existence.
	 */
	refRoom(roomId: string, options: { create?: boolean } = {}): RefRoom | null {
		const existing = this.refRooms.get(roomId);
		if (existing) {
			return existing;
		}
		if (!options.create && !this.data.refRoomExists(roomId)) {
			return null;
		}

		const storage = openDatabase(this.data.refRoomFile(roomId), migrationsPath('ref-migrations'));
		const room = new RefRoom({
			roomId,
			storage,
			email: this.opts.email,
			links: this.judgesGatewayForRefRooms(),
			onDestroyed: (id) => this.forgetRefRoom(id)
		});
		this.refRooms.set(roomId, room);
		return room;
	}

	/** A destroyed ref room's file goes with it, exactly as a Judges' Room's does. */
	forgetRefRoom(roomId: string): void {
		const room = this.refRooms.get(roomId);
		this.refRooms.delete(roomId);
		try {
			room?.close();
		} catch (error) {
			console.error('Failed to close destroyed ref room', roomId, error);
		}
		try {
			this.data.removeRefRoom(roomId);
		} catch (error) {
			console.error('Failed to delete ref room storage', roomId, error);
		}
	}

	// ============================================================================
	// Links between Judges' Rooms and ref rooms
	//
	// Locks wait in one direction only: a ref room may wait on a Judges' Room, never the
	// reverse. Everything a Judges' Room sends towards a ref room is fire-and-forget. See
	// ref/link-gateway.ts.
	// ============================================================================

	private createRefLinkCode(target: RefLinkTarget): RefLinkCodeResult {
		const now = Date.now();
		for (const [code, entry] of this.refLinkCodes) {
			if (entry.expiresAt <= now) {
				this.refLinkCodes.delete(code);
			}
		}

		let code: string;
		do {
			const bytes = new Uint8Array(8);
			crypto.getRandomValues(bytes);
			code = Array.from(bytes, (byte) => REF_LINK_CODE_ALPHABET[byte % REF_LINK_CODE_ALPHABET.length]).join('');
		} while (this.refLinkCodes.has(code));

		const expiresAt = now + REF_LINK_CODE_TTL_MS;
		this.refLinkCodes.set(code, { target, expiresAt });
		return { code, expiresAt, scope: target.scope };
	}

	private refRoomStillExists(refRoomId: string): boolean {
		try {
			return this.refRooms.has(refRoomId) || this.data.refRoomExists(refRoomId);
		} catch {
			return false;
		}
	}

	/**
	 * A Judges' Room, only if it really exists: opening a missing one would create its file.
	 * Anything an anonymous caller can reach must use this rather than room().
	 */
	existingRoom(roomId: string): Room | null {
		try {
			return this.rooms.get(roomId) ?? (this.data.roomExists(roomId) ? this.room(roomId) : null);
		} catch {
			return null;
		}
	}

	/** Run something on a ref room under its lock, without the caller waiting. */
	private onRefRoomLater(refRoomId: string, what: string, fn: (room: RefRoom) => Promise<void>): void {
		let room: RefRoom | null;
		try {
			room = this.refRoom(refRoomId);
		} catch {
			return;
		}
		if (!room) {
			return;
		}
		const target = room;
		void target.mutex.run(() => fn(target)).catch((error) => console.error(`Failed to ${what} for ref room`, refRoomId, error));
	}

	private refLinkGatewayForRooms(): RefLinkGateway {
		return {
			createCode: (target) => this.createRefLinkCode(target),
			createRefRoom: (target, headReferee) => this.createLinkedRefRoom(target, headReferee),
			createUnclaimedRefRoom: (judgesRoomId) => this.createUnclaimedRefRoom(judgesRoomId),
			refsUsingApp: (refRoomId) => this.refsUsingApp(refRoomId),
			saveJudgeNote: async (refRoomId, judgesRoomId, input, authorName, options) => {
				const refRoom = this.refRoom(refRoomId);
				if (!refRoom) {
					throw new Error('These referee notes no longer exist');
				}
				await refRoom.mutex.run(() => refRoom.saveJudgeNote(judgesRoomId, input, authorName, options));
			},
			removeJudgeNote: async (refRoomId, judgesRoomId, id) => {
				const refRoom = this.refRoom(refRoomId);
				if (!refRoom) {
					throw new Error('These referee notes no longer exist');
				}
				await refRoom.mutex.run(() => refRoom.removeJudgeNote(judgesRoomId, id));
			},
			emailEnabled: () => this.opts.email.sender.enabled,
			refRoomExists: (refRoomId) => this.refRoomStillExists(refRoomId),
			teamsChanged: (refRoomId) => this.onRefRoomLater(refRoomId, 'refresh linked teams', (room) => room.linkedTeamsChanged()),
			divisionUnlinked: (refRoomId, judgesRoomId) =>
				this.onRefRoomLater(refRoomId, 'drop an unlinked division', (room) => room.divisionUnlinked(judgesRoomId)),
			notes: async (refRoomId, judgesRoomId, teamNumbers) => {
				let refRoom: RefRoom | null;
				try {
					refRoom = this.refRoom(refRoomId);
				} catch {
					return null;
				}
				// No lock, deliberately: see RefRoom.notesForDivision.
				return refRoom ? refRoom.notesForDivision(judgesRoomId, teamNumbers) : null;
			},
			joinedGroup: (judgesRoomId, groupId) => {
				void this.linkDivisionJoiningGroup(judgesRoomId, groupId).catch((error) =>
					console.error('Failed to link a division that joined a linked group', judgesRoomId, error)
				);
			}
		};
	}

	private judgesGatewayForRefRooms(): JudgesLinkGateway {
		return {
			redeem: (code, refRoomId, refEvent) => this.redeemRefLinkCode(code, refRoomId, refEvent),
			teams: async (judgesRoomId, refRoomId) => {
				const room = this.existingRoom(judgesRoomId);
				return room ? room.mutex.run(() => room.teamsForRef(refRoomId)) : null;
			},
			// Without the lock, like the Matches tab: see Room.matchesForRef.
			matches: async (judgesRoomId, refRoomId) => this.existingRoom(judgesRoomId)?.matchesForRef(refRoomId) ?? null,
			unlink: async (judgesRoomId, refRoomId) => {
				const room = this.existingRoom(judgesRoomId);
				if (room) {
					await room.mutex.run(() => room.clearRefLink(refRoomId));
				}
			},
			// Only a signal, carrying nothing: the Judge Advisors' devices fetch what they may see.
			notesChanged: (judgesRoomId) => this.existingRoom(judgesRoomId)?.notifyRefNotesChanged()
		};
	}

	/** The divisions a link covers: one room, or every member of an event group. */
	private async resolveLinkTargets(target: RefLinkTarget): Promise<{ roomId: string; label: string | null }[] | null> {
		if (target.scope === 'room') {
			return [{ roomId: target.roomId, label: null }];
		}
		const description = await this.groupGatewayForRooms().describe(target.groupId, target.roomId);
		return description ? description.divisions.map((division) => ({ roomId: division.roomId, label: division.label })) : null;
	}

	/**
	 * Check every division before linking any, so a link covers all of them or none: a group
	 * half-linked because its third division belonged to another event would be harder to
	 * understand than a refusal.
	 */
	private async checkLinkTargets(
		targets: { roomId: string; label: string | null }[],
		refRoomId: string,
		robotEventsEventId: number | null
	): Promise<{ ok: true; checked: CheckedLinkTarget[] } | { ok: false; error: string }> {
		const checked: CheckedLinkTarget[] = [];
		for (const target of targets) {
			const room = this.existingRoom(target.roomId);
			const info = room ? await room.mutex.run(() => room.refLinkInfo()) : null;
			if (!room || !info) {
				return { ok: false, error: 'A division this covers no longer exists.' };
			}
			const label = target.label ?? info.eventName;
			let leaving: CheckedLinkTarget['leaving'] = null;
			if (info.linkedRefRoomId && info.linkedRefRoomId !== refRoomId && this.refRoomStillExists(info.linkedRefRoomId)) {
				// The division's own notes, kept by its Judge Advisors while the refs were not using
				// the app, give way to the refs' room. A room the refs are using does not.
				if (this.refsUsingApp(info.linkedRefRoomId)) {
					return { ok: false, error: `${label} is already linked to other referee notes. It has to be unlinked there first.` };
				}
				leaving = { refRoomId: info.linkedRefRoomId, eventName: info.linkedRefEventName ?? '' };
			}
			if (robotEventsEventId && info.robotEventsEventId && robotEventsEventId !== info.robotEventsEventId) {
				return { ok: false, error: `That is for a different event (${info.eventName}).` };
			}
			checked.push({ room, info, division: { judgesRoomId: target.roomId, divisionId: info.divisionId, label }, leaving });
		}
		return { ok: true, checked };
	}

	/** Link a ref room to an existing set of divisions, with a code. Called under that ref room's lock. */
	private async redeemRefLinkCode(
		rawCode: string,
		refRoomId: string,
		refEvent: { eventName: string; robotEventsEventId: number | null }
	): Promise<{ ok: true; divisions: RedeemedDivision[]; groupId: string | null } | { ok: false; error: string }> {
		const code = normalizeRefLinkCode(rawCode);
		const entry = this.refLinkCodes.get(code);
		if (!entry || entry.expiresAt <= Date.now()) {
			this.refLinkCodes.delete(code);
			return { ok: false, error: 'That code is wrong or has expired. Ask the Judge Advisor for a new one.' };
		}

		const targets = await this.resolveLinkTargets(entry.target);
		if (!targets) {
			return { ok: false, error: 'That event group no longer exists.' };
		}
		const result = await this.checkLinkTargets(targets, refRoomId, refEvent.robotEventsEventId);
		if (!result.ok) {
			return result;
		}

		for (const { room } of result.checked) {
			await room.mutex.run(() => room.setRefLink(refRoomId, refEvent.eventName));
		}
		this.refLinkCodes.delete(code);

		// Called under the redeeming room's lock, so its notes can be brought in directly.
		const into = this.refRooms.get(refRoomId);
		if (into) {
			await this.bringNotesAcross(into, result.checked);
		}

		return {
			ok: true,
			divisions: result.checked.map((item) => item.division),
			groupId: entry.target.scope === 'group' ? entry.target.groupId : null
		};
	}

	/**
	 * Create a ref room for a Judge Advisor, already linked, and email its link to the Head Ref.
	 *
	 * The Judge Advisor never sees the Head Ref's link: it goes to the address they typed and
	 * nowhere else, the same as a judge's. If the email cannot be sent, nothing is kept — a
	 * ref room whose only Head Ref never got their link would be one nobody can open, and it
	 * would hold the divisions so no other ref room could link them.
	 *
	 * Called from a Judges' Room request that runs without that room's lock (see
	 * LOCK_FREE_REQUESTS), so every lock here is taken in turn and none is held twice.
	 */
	private async createLinkedRefRoom(
		target: RefLinkTarget,
		headReferee: { name: string; email: string }
	): Promise<{ ok: true; sentTo: string } | { ok: false; error: string }> {
		if (!this.opts.email.sender.enabled) {
			return { ok: false, error: 'Email is not set up on this server, so the link cannot be sent. Make a code instead.' };
		}

		const targets = await this.resolveLinkTargets(target);
		if (!targets || targets.length === 0) {
			return { ok: false, error: 'That event group no longer exists.' };
		}
		const origin = this.existingRoom(target.roomId);
		const originInfo = origin ? await origin.mutex.run(() => origin.refLinkInfo()) : null;
		if (!originInfo) {
			return { ok: false, error: 'This division no longer exists.' };
		}

		const refRoomId = crypto.randomUUID();
		const checkedResult = await this.checkLinkTargets(targets, refRoomId, originInfo.robotEventsEventId);
		if (!checkedResult.ok) {
			return checkedResult;
		}

		const event = await this.refEventFor(target, originInfo);
		const room = this.refRoom(refRoomId, { create: true });
		if (!room) {
			return { ok: false, error: 'Could not create the referee notes' };
		}

		let authToken: string;
		try {
			({ authToken } = await room.mutex.run(() => room.create({ kind: 'create', event, teams: [], headReferee })));
			for (const { room: judgesRoom } of checkedResult.checked) {
				await judgesRoom.mutex.run(() => judgesRoom.setRefLink(refRoomId, event.eventName));
			}
			await room.mutex.run(() =>
				room.acceptLinkedDivisions(
					checkedResult.checked.map((item) => item.division),
					target.scope === 'group' ? target.groupId : null
				)
			);
		} catch (error) {
			console.error('Failed to create a linked ref room:', error);
			await this.discardNewRefRoom(refRoomId, checkedResult.checked);
			return { ok: false, error: 'Could not create the referee notes' };
		}

		const to = headReferee.email.trim().toLowerCase();
		try {
			await this.opts.email.sender.send(
				buildRefAccessLinkEmail({
					to,
					refereeName: headReferee.name,
					eventName: event.eventName,
					link: buildRefRoomJoinUrl(this.opts.email.publicOrigin, refRoomId, authToken),
					headReferee: true
				})
			);
		} catch (error) {
			const reason = describeSmtpFailure(error);
			console.error('Failed to email a new ref room link to its Head Referee:', reason);
			await this.discardNewRefRoom(refRoomId, checkedResult.checked);
			return { ok: false, error: `Could not send to ${to} (${reason}). Nothing was created; check the address and try again.` };
		}

		// Only now, with the Head Ref's link on its way, do the Judge Advisors' own notes move in.
		await room.mutex
			.run(() => this.bringNotesAcross(room, checkedResult.checked))
			.catch((error) => console.error('Failed to move Judge Advisor notes into a new ref room', refRoomId, error));

		return { ok: true, sentTo: to };
	}

	/** Undo a half-made ref room, putting each division back on the notes it had before. */
	private async discardNewRefRoom(refRoomId: string, checked: CheckedLinkTarget[]): Promise<void> {
		for (const { room, leaving } of checked) {
			await room.mutex
				.run(async () => {
					await room.clearRefLink(refRoomId);
					if (leaving && (await room.refLinkInfo())?.linkedRefRoomId === null) {
						await room.setRefLink(leaving.refRoomId, leaving.eventName);
					}
				})
				.catch(() => {});
		}
		this.forgetRefRoom(refRoomId);
	}

	/**
	 * The ref event a new ref room covers: the whole event, not one division, because refs work
	 * across divisions. Best effort: without RobotEvents the room still works from the linked
	 * divisions alone.
	 */
	private async refEventFor(target: RefLinkTarget, originInfo: RefLinkInfo) {
		let eventName =
			target.scope === 'group'
				? ((await this.groupGatewayForRooms().describe(target.groupId, target.roomId))?.name ?? originInfo.eventName)
				: originInfo.eventName;
		let divisions: { id: number; name: string }[] = [];
		if (originInfo.robotEventsEventId) {
			try {
				const summary = await fetchEventSummary(originInfo.robotEventsEventId);
				eventName = summary.name;
				divisions = summary.divisions;
			} catch (error) {
				console.warn('Could not read the event from RobotEvents for a new ref room:', error instanceof Error ? error.message : error);
			}
		}
		return {
			eventName: eventName.slice(0, 200),
			program: originInfo.program,
			robotEventsSku: originInfo.robotEventsSku,
			robotEventsEventId: originInfo.robotEventsEventId,
			divisions
		};
	}

	private refsUsingApp(refRoomId: string): boolean {
		try {
			return this.refRoom(refRoomId)?.hasReferees() ?? false;
		} catch {
			return false;
		}
	}

	/**
	 * Give a division its own ref room, with no refs in it yet, so its Judge Advisors can write
	 * down what the refs tell them when the refs are not using the app.
	 *
	 * Made with every new Judges' Room, and on request for one that has none. Does nothing if
	 * the division is already linked. Starts holding no lock and takes each in turn.
	 */
	private async createUnclaimedRefRoom(judgesRoomId: string): Promise<{ ok: true } | { ok: false; error: string }> {
		const origin = this.existingRoom(judgesRoomId);
		const info = origin ? await origin.mutex.run(() => origin.refLinkInfo()) : null;
		if (!origin || !info) {
			return { ok: false, error: 'This division has not been set up yet.' };
		}
		if (info.linkedRefRoomId && this.refRoomStillExists(info.linkedRefRoomId)) {
			return { ok: true };
		}

		const event = await this.refEventFor({ scope: 'room', roomId: judgesRoomId }, info);
		const refRoomId = crypto.randomUUID();
		const room = this.refRoom(refRoomId, { create: true });
		if (!room) {
			return { ok: false, error: 'Could not create the referee notes' };
		}

		try {
			await room.mutex.run(() => room.createUnclaimed(event));
			// Checked again under the division's lock: it may have been linked while we waited.
			const linked = await origin.mutex.run(async () => {
				const now = await origin.refLinkInfo();
				if (!now || (now.linkedRefRoomId && this.refRoomStillExists(now.linkedRefRoomId))) {
					return false;
				}
				await origin.setRefLink(refRoomId, event.eventName);
				return true;
			});
			if (!linked) {
				this.forgetRefRoom(refRoomId);
				return { ok: true };
			}
			await room.mutex.run(() => room.acceptLinkedDivisions([{ judgesRoomId, divisionId: info.divisionId, label: info.eventName }], null));
		} catch (error) {
			console.error('Failed to create referee notes for a division:', error);
			await origin.mutex.run(() => origin.clearRefLink(refRoomId)).catch(() => {});
			this.forgetRefRoom(refRoomId);
			return { ok: false, error: 'Could not create the referee notes' };
		}
		return { ok: true };
	}

	/**
	 * Move the notes from each division's own refless ref room into the room it just linked to,
	 * then delete the old one. The caller holds `into`'s lock.
	 *
	 * The old room's lock is taken while holding `into`'s. That cannot wait in a circle: `into`
	 * always has refs and the old room never does, so no old room is ever on the other side of
	 * this, and a refless room's own work waits on nothing but Judges' Rooms.
	 */
	private async bringNotesAcross(into: RefRoom, checked: CheckedLinkTarget[]): Promise<void> {
		const leaving = new Set(checked.flatMap((item) => (item.leaving ? [item.leaving.refRoomId] : [])));
		for (const refRoomId of leaving) {
			if (refRoomId === into.roomId) {
				continue;
			}
			const from = this.refRoom(refRoomId);
			if (!from) {
				continue;
			}
			const rows = await from.mutex.run(() => {
				// Refs started using it in the meantime: it is theirs now, so it stays.
				if (from.hasReferees()) {
					return null;
				}
				const rows = from.incidentRows();
				from.retire();
				return rows;
			});
			if (rows === null) {
				continue;
			}
			into.importIncidents(rows);
			this.forgetRefRoom(refRoomId);
		}
	}

	/**
	 * A division joined an event group. If the group was linked to a ref room with a group
	 * code, link this division to it too, as the Head Ref would expect.
	 *
	 * Starts holding no lock and takes each in turn, so nothing here can wait in a circle.
	 */
	private async linkDivisionJoiningGroup(judgesRoomId: string, groupId: string): Promise<void> {
		const description = await this.groupGatewayForRooms().describe(groupId, judgesRoomId);
		const joining = this.existingRoom(judgesRoomId);
		if (!description || !joining) {
			return;
		}

		const refRoomIds = new Set<string>();
		for (const division of description.divisions) {
			if (division.roomId === judgesRoomId) {
				continue;
			}
			const sibling = this.existingRoom(division.roomId);
			const linked = sibling ? (await sibling.mutex.run(() => sibling.refLinkInfo()))?.linkedRefRoomId : null;
			// A sibling's own refless room is not one the group was linked to.
			if (linked && this.refRoomStillExists(linked) && this.refsUsingApp(linked)) {
				refRoomIds.add(linked);
			}
		}

		const label = description.divisions.find((division) => division.roomId === judgesRoomId)?.label ?? description.name;
		for (const refRoomId of refRoomIds) {
			const refRoom = this.refRoom(refRoomId);
			if (!refRoom) {
				continue;
			}
			const joined = await refRoom.mutex.run(async () => {
				if (!(await refRoom.wantsGroupDivision(groupId))) {
					return false;
				}
				const refRow = await refRoom.metadataRow();
				const info = await joining.mutex.run(() => joining.refLinkInfo());
				if (!refRow || !info) {
					return false;
				}
				let leaving: CheckedLinkTarget['leaving'] = null;
				if (info.linkedRefRoomId && info.linkedRefRoomId !== refRoomId && this.refRoomStillExists(info.linkedRefRoomId)) {
					if (this.refsUsingApp(info.linkedRefRoomId)) {
						return false;
					}
					leaving = { refRoomId: info.linkedRefRoomId, eventName: info.linkedRefEventName ?? '' };
				}
				await joining.mutex.run(() => joining.setRefLink(refRoomId, refRow.eventName));
				const division = { judgesRoomId, divisionId: info.divisionId, label };
				await refRoom.acceptGroupDivision(division, groupId);
				await this.bringNotesAcross(refRoom, [{ room: joining, info, division, leaving }]);
				return true;
			});
			// A division is linked to one ref room at most.
			if (joined) {
				return;
			}
		}
	}

	// ============================================================================
	// Groups
	// ============================================================================

	group(groupId: string): EventGroup {
		const existing = this.groups.get(groupId);
		if (existing) {
			return existing.group;
		}

		const storage = openDatabase(this.data.groupFile(groupId), migrationsPath('group-migrations'));
		const group = new EventGroup({ db: storage.db, rooms: this.roomAccessForGroups(), email: this.opts.email });

		this.groups.set(groupId, { group, storage });
		return group;
	}

	/**
	 * How a group reaches back into a member room. Deliberately two narrow operations.
	 *
	 * Neither waits for the room's lock, and that is the point. A room calling into its
	 * group holds the room lock and wants the group lock; a group calling back into a room
	 * holds the group lock and would want the room lock. Awaiting both directions is a
	 * deadlock waiting for two people to act at once — a Judge Advisor attaching a division
	 * while another removes one is enough.
	 *
	 * Both operations are housekeeping: they make a revocation visible immediately, but the
	 * revocation itself is already enforced, because every group check is live on the next
	 * connect. Doing them slightly later is fine. Not doing them at all is fine.
	 */
	private roomAccessForGroups(): GroupRoomAccess {
		return {
			kickGroupAdvisor: async (roomId, groupAdvisorId, exceptDeviceId) => {
				// Only rooms that are currently open need telling. A room that is not loaded
				// has no live sessions to kick, and revalidates on its next connect anyway.
				const room = this.rooms.get(roomId);
				if (!room) {
					return;
				}
				void room.mutex
					.run(() => room.kickGroupAdvisor(groupAdvisorId, exceptDeviceId))
					.catch((error) => {
						console.error('Failed to kick group advisor from room', roomId, error);
					});
			},
			clearGroupId: async (roomId, groupId) => {
				const room = this.room(roomId);
				void room.mutex
					.run(() => room.clearGroupId(groupId))
					.catch((error) => {
						console.error('Failed to clear groupId on room', roomId, error);
					});
			}
		};
	}

	/** How a room reaches its group. Every call is serialized on the group's own storage. */
	private groupGatewayForRooms(): EventGroupGateway {
		const on = <T>(groupId: string, fn: (group: EventGroup) => Promise<T>): Promise<T> => {
			const entry = this.groups.get(groupId);
			const group = entry?.group ?? this.group(groupId);
			const storage = this.groups.get(groupId)!.storage;
			return storage.mutex.run(() => fn(group));
		};

		return {
			validateSession: (groupId, input) => on(groupId, (group) => group.validateGroupSession(input)),
			describe: (groupId, roomId) => on(groupId, (group) => group.describeForRoom({ roomId })),
			advisorCount: (groupId, roomId) => on(groupId, (group) => group.advisorCountForRoom({ roomId })),
			create: (groupId, input) => on(groupId, (group) => group.createGroup({ groupId, ...input })),
			attach: (groupId, input) => on(groupId, (group) => group.attachRoom(input)),
			detach: (groupId, roomId) => on(groupId, (group) => group.detachRoom({ roomId }))
		};
	}

	/** Run a group action from the HTTP layer, under that group's lock. */
	onGroup<T>(groupId: string, fn: (group: EventGroup) => Promise<T>): Promise<T> {
		const group = this.group(groupId);
		const storage = this.groups.get(groupId)!.storage;
		return storage.mutex.run(() => fn(group));
	}

	/**
	 * Like onGroup, but null for a group that does not exist rather than creating it.
	 *
	 * For anything an anonymous caller can reach: opening a group creates its file, so
	 * onGroup on a made-up id leaves a database on disk for every request.
	 */
	async onExistingGroup<T>(groupId: string, fn: (group: EventGroup) => Promise<T>): Promise<T | null> {
		let exists: boolean;
		try {
			exists = this.groups.has(groupId) || this.data.groupExists(groupId);
		} catch {
			return null;
		}
		return exists ? this.onGroup(groupId, fn) : null;
	}

	// ============================================================================
	// Admin registry
	// ============================================================================

	registry(): AdminRegistry {
		if (!this.adminRegistry) {
			this.adminStorage = openDatabase(this.data.adminFile(), migrationsPath('admin-migrations'));
			this.adminRegistry = new AdminRegistry({
				db: this.adminStorage.db,
				username: this.opts.adminUsername,
				password: this.opts.adminPassword
			});
		}
		return this.adminRegistry;
	}

	/** Run a registry action under its lock. */
	onRegistry<T>(fn: (registry: AdminRegistry) => Promise<T>): Promise<T> {
		const registry = this.registry();
		return this.adminStorage!.mutex.run(() => fn(registry));
	}

	/**
	 * Make the operator's index agree with what is actually on disk.
	 *
	 * Rooms announce themselves when created, but that only ever covered rooms created
	 * after the registry existed — and a registration can fail. Since every room is a file,
	 * the truth is readable: index anything present but unlisted, and drop anything listed
	 * but gone.
	 *
	 * A file with no Metadata row is a room that was opened and never set up (a link
	 * followed for a room that does not exist creates one). Those are skipped rather than
	 * listed, since there is no event there to show.
	 */
	/**
	 * Delete events that have gone quiet, having warned whoever runs them.
	 *
	 * Judging material is confidential and an event that is over has no reason to sit on a
	 * server. Until now the only thing that removed it was a Judge Advisor remembering to
	 * press Destroy, which makes the promise on the privacy page true only by discipline.
	 *
	 * "Quiet" is measured from the room's files, which the WAL sidecar keeps honest, and a
	 * room with anyone connected is never touched — so an event in use cannot be deleted
	 * underneath the people using it, however long it has been running.
	 *
	 * Warning first is the whole point. The window between warning and deletion is short,
	 * so the message leads with exporting the results, and any activity at all clears the
	 * warning: an event that gets picked up again starts over rather than being deleted on
	 * the strength of a notice sent a week earlier.
	 */
	async sweepRetention(): Promise<void> {
		const policy = this.opts.retention;
		if (!policy.enabled) {
			return;
		}

		const warnAfterMs = policy.warnAfterDays * 24 * 60 * 60 * 1000;
		const deleteAfterMs = policy.deleteAfterDays * 24 * 60 * 60 * 1000;

		for (const roomId of this.data.listRoomIds()) {
			try {
				const room = this.room(roomId);

				// Never delete a room somebody is sitting in, whatever the clock says. Checked
				// first so an event in use costs nothing beyond this.
				if (room.hasConnections) {
					continue;
				}

				const row = await room.mutex.run(() => room.metadataRow());
				if (!row) {
					// Not an event — the empty-file sweep in reconcileRegistry owns these.
					continue;
				}

				// lastActivityAt is when a person last connected or disconnected. The file's
				// timestamp is only a fallback for rooms that predate that column: it cannot
				// be relied on generally, because this sweep's own write of the warning flag
				// would touch the file and reset the clock it was reading.
				const lastActivity = row.lastActivityAt ?? this.data.roomModifiedAt(roomId);
				if (!lastActivity) {
					continue;
				}

				const idleMs = Date.now() - lastActivity.getTime();

				if (idleMs < warnAfterMs) {
					// Used since it was warned, so the warning no longer applies. Comparing the
					// two timestamps rather than tracking state in memory means this survives a
					// restart — otherwise an event warned, used for a week, then left alone
					// would be deleted with no fresh notice.
					if (row.retentionWarningSentAt && row.retentionWarningSentAt.getTime() < lastActivity.getTime()) {
						await room.mutex.run(() => room.clearRetentionWarning());
					}
					continue;
				}

				if (idleMs >= deleteAfterMs) {
					console.log(`Retention: destroying ${roomId} (${row.eventName}) after ${Math.floor(idleMs / 86400000)} days idle`);
					this.forgetRoom(roomId);
					continue;
				}

				// Warned already, and not used since — nothing more to say until the deadline.
				if (row.retentionWarningSentAt && row.retentionWarningSentAt.getTime() >= lastActivity.getTime()) {
					continue;
				}

				const daysRemaining = Math.max(1, Math.ceil((deleteAfterMs - idleMs) / 86400000));
				await room.mutex.run(() => room.sendRetentionWarning(daysRemaining));
			} catch (error) {
				// One unreadable room must not stop the sweep for the rest.
				console.error('Retention sweep failed for room', roomId, error);
			}
		}

		await this.sweepRefRetention(warnAfterMs, deleteAfterMs);
	}

	/** The same rules for ref rooms: never while someone is in it, warn first, any use resets it. */
	private async sweepRefRetention(warnAfterMs: number, deleteAfterMs: number): Promise<void> {
		for (const roomId of this.data.listRefRoomIds()) {
			try {
				const room = this.refRoom(roomId);
				if (!room || room.hasConnections) {
					continue;
				}
				const row = await room.mutex.run(() => room.metadataRow());
				if (!row) {
					// Creation failed part-way and left a file with no event. Nothing to keep.
					this.forgetRefRoom(roomId);
					continue;
				}

				const lastActivity = row.lastActivityAt ?? row.createdAt;
				const idleMs = Date.now() - lastActivity.getTime();

				if (idleMs < warnAfterMs) {
					if (row.retentionWarningSentAt && row.retentionWarningSentAt.getTime() < lastActivity.getTime()) {
						await room.mutex.run(() => room.clearRetentionWarning());
					}
					continue;
				}

				if (idleMs >= deleteAfterMs) {
					console.log(`Retention: destroying ref room ${roomId} (${row.eventName}) after ${Math.floor(idleMs / 86400000)} days idle`);
					this.forgetRefRoom(roomId);
					continue;
				}

				if (row.retentionWarningSentAt && row.retentionWarningSentAt.getTime() >= lastActivity.getTime()) {
					continue;
				}

				const daysRemaining = Math.max(1, Math.ceil((deleteAfterMs - idleMs) / 86400000));
				await room.mutex.run(() => room.sendRetentionWarning(daysRemaining));
			} catch (error) {
				console.error('Retention sweep failed for ref room', roomId, error);
			}
		}
	}

	/**
	 * Refresh the match schedule for rooms people are actually using.
	 *
	 * Only open rooms with someone connected and a RobotEvents link are polled, so an
	 * event that finished last week costs nothing and a server hosting twenty events makes
	 * requests for the two that are running. That is the whole point of moving this to the
	 * server: the external request rate now scales with rooms in use rather than with
	 * judges holding phones.
	 *
	 * Rooms are refreshed one after another rather than together. A burst of parallel
	 * requests on a shared token is exactly what gets an IP throttled, and nobody is
	 * waiting on this — a judge opening the tab reads whatever the cache holds.
	 */
	async sweepMatches(): Promise<void> {
		for (const [roomId, room] of this.rooms) {
			try {
				if (!(await room.mutex.run(() => room.wantsMatchPolling()))) {
					continue;
				}
				// Outside the mutex on purpose: this is a network call to RobotEvents that can
				// take seconds, and holding the room's lock for it would stall every judge in
				// that room. The cache write it performs is a single assignment.
				await room.refreshMatches();
			} catch (error) {
				console.error('Match poll failed for room', roomId, error);
			}
		}

		for (const [roomId, room] of this.refRooms) {
			try {
				if (!(await room.mutex.run(() => room.wantsMatchPolling()))) {
					continue;
				}
				await room.refreshMatches();
			} catch (error) {
				console.error('Match poll failed for ref room', roomId, error);
			}
		}
	}

	/**
	 * When a person was last in each of these rooms.
	 *
	 * Read from the rooms themselves rather than mirrored into the registry, because the
	 * registry is written on creation and on setup changes and nothing else — a room set up
	 * once and then judged all weekend would report the moment it was created. This is the
	 * same value the retention sweep counts from, so the operator's list and the deletion
	 * clock cannot disagree about whether an event is idle.
	 *
	 * The cost is one database open per room that is not already resident, on a list that a
	 * single operator loads occasionally. Rooms stay cached afterwards, so a refresh is
	 * cheap; an event in progress is open already.
	 *
	 * Never throws. A room whose metadata cannot be read reports null and the list still
	 * renders — this is bookkeeping, and losing the whole page over one unreadable file
	 * would be a poor trade.
	 */
	async lastActivityByRoom(roomIds: string[]): Promise<Map<string, number | null>> {
		const activity = new Map<string, number | null>();

		for (const roomId of roomIds) {
			try {
				const room = this.room(roomId);
				const row = await room.mutex.run(() => room.metadataRow());
				// Same fallback as retention: null on rooms predating the column, where the
				// file's own timestamp is the best available answer.
				const stamped = row?.lastActivityAt ?? this.data.roomModifiedAt(roomId);
				activity.set(roomId, stamped ? stamped.getTime() : null);
			} catch (error) {
				console.error('Failed to read last activity for room', roomId, error);
				activity.set(roomId, null);
			}
		}

		return activity;
	}

	async reconcileRegistry(): Promise<void> {
		const onDisk = new Set(this.data.listRoomIds());
		const indexed = new Set(await this.onRegistry((registry) => registry.listRoomIds()));

		let added = 0;
		let removed = 0;
		let empty = 0;
		let discarded = 0;

		for (const roomId of onDisk) {
			if (indexed.has(roomId)) {
				continue;
			}
			try {
				const room = this.room(roomId);
				const row = await room.mutex.run(() => room.metadataRow());

				if (!row) {
					// An empty file, not an event. Connecting with any roomId creates one — a
					// stale permit pointing at a room that no longer exists is enough — so they
					// accumulate, and without this the data directory grows for no reason.
					empty += 1;
					const modifiedAt = this.data.roomModifiedAt(roomId);
					const abandoned = !room.hasConnections && !!modifiedAt && Date.now() - modifiedAt.getTime() > ABANDONED_EMPTY_ROOM_MS;

					// Not while someone is connected, and not immediately: a room being set up
					// right now is legitimately empty until setup completes.
					if (abandoned) {
						this.forgetRoom(roomId);
						discarded += 1;
					}
					continue;
				}

				await this.onRegistry((registry) =>
					registry.registerRoom({
						roomId,
						eventName: row.eventName,
						program: row.program,
						eventGradeLevel: row.eventGradeLevel,
						divisionId: row.divisionId,
						robotEventsSku: row.robotEventsSku,
						accessControlEnabled: row.accessControlEnabled,
						groupId: row.groupId
					})
				);
				added += 1;
			} catch (error) {
				console.error('Failed to index room from disk', roomId, error);
			}
		}

		for (const roomId of indexed) {
			if (!onDisk.has(roomId)) {
				await this.onRegistry((registry) => registry.deregisterRoom(roomId));
				removed += 1;
			}
		}

		if (added || removed || empty) {
			// Says plainly why a file on disk is not in the list, which is otherwise a
			// confusing thing to have to work out from the outside.
			console.log(
				`Admin list: ${onDisk.size} room file(s) on disk, ${added} newly indexed, ${removed} missing removed, ` +
					`${empty} with no event set up (${discarded} abandoned and deleted).`
			);
		}
	}

	get adminEnabled(): boolean {
		return !!this.opts.adminUsername && !!this.opts.adminPassword;
	}

	/**
	 * A room's view of the registry.
	 *
	 * Every call swallows its own errors: being listed for the operator is bookkeeping,
	 * and must never be able to stop a room being created or destroyed.
	 */
	private registryGatewayForRooms(): AdminRegistryGateway {
		return {
			registerRoom: async (input: RegisterRoomInput) => {
				try {
					await this.onRegistry((registry) => registry.registerRoom(input));
				} catch (error) {
					console.error('Failed to register room with the admin registry:', error);
				}
			},
			deregisterRoom: async (roomId: string) => {
				try {
					await this.onRegistry((registry) => registry.deregisterRoom(roomId));
				} catch (error) {
					console.error('Failed to deregister room from the admin registry:', error);
				}
			}
		};
	}

	/** Close every open database. Called on shutdown so WAL files are checkpointed. */
	/**
	 * Hang up on every device, everywhere, leaving the databases open.
	 *
	 * Called first on shutdown: `server.close()` waits for connections to end, and a
	 * WebSocket does not end on its own, so nothing else can finish until these are gone.
	 */
	closeConnections(): void {
		for (const room of this.rooms.values()) {
			try {
				room.closeConnections();
			} catch (error) {
				console.error('Failed to close connections for room', room.roomId, error);
			}
		}
		for (const room of this.refRooms.values()) {
			try {
				room.closeConnections();
			} catch (error) {
				console.error('Failed to close connections for ref room', room.roomId, error);
			}
		}
	}

	close(): void {
		for (const room of this.rooms.values()) {
			try {
				room.close();
			} catch (error) {
				console.error('Failed to close room', room.roomId, error);
			}
		}
		this.rooms.clear();

		for (const room of this.refRooms.values()) {
			try {
				room.close();
			} catch (error) {
				console.error('Failed to close ref room', room.roomId, error);
			}
		}
		this.refRooms.clear();

		for (const [groupId, entry] of this.groups) {
			try {
				entry.storage.close();
			} catch (error) {
				console.error('Failed to close group', groupId, error);
			}
		}
		this.groups.clear();

		this.adminStorage?.close();
		this.adminStorage = null;
		this.adminRegistry = null;
	}
}
