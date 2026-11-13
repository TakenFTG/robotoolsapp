import { eq } from 'drizzle-orm';
import type { AppDatabase } from '../runtime/storage';
import { groupAdvisors, groupMetadata, groupRooms } from './schema';
import { buildEventGroupJoinUrl } from '@robotools.app/protocol/src/group';
import {
	countGroupAdvisors,
	findGroupAdvisorByToken,
	getGroupMetadata,
	isGroupMember,
	listGroupAdvisors,
	listGroupDivisions,
	removeGroupRoom,
	upsertGroupRoom
} from './store';
import { generateAuthToken } from '@robotools.app/protocol/src/access';
import { uuidv4 } from '@robotools.app/protocol/src/utils';
import type { GroupRequest, GroupResponse, GroupSessionState } from '@robotools.app/protocol/src/group';
import type { GroupDescription, GroupSessionValidation } from './types';
import type { EmailContext } from '../server-router';
import { buildAdvisorAccessLinkEmail } from '../email/template';
import { describeSmtpFailure } from '../email/smtp';

/**
 * Results are returned rather than thrown across every boundary in this file.
 *
 * Durable Object RPC preserves an error's message and little else, so an exception would
 * arrive at the caller as an untyped string. A room deciding whether to admit a connection
 * must not be making that decision by parsing text.
 */
export type GroupRequestResult = { ok: true; response: GroupResponse } | { ok: false; status: number; error: string };

export type { GroupDescription, GroupSessionValidation } from './types';

/**
 * What a group needs in order to reach back into its member rooms.
 *
 * Injected rather than looked up, so the group has no knowledge of how rooms are hosted
 * and can be tested without any of them.
 */
export interface GroupRoomAccess {
	kickGroupAdvisor(roomId: string, groupAdvisorId: string, exceptDeviceId: string | null): Promise<void>;
	clearGroupId(roomId: string, groupId: string): Promise<void>;
}

/**
 * An event group.
 *
 * It owns three things and nothing else: what the group is called, which rooms belong to
 * it, and who its advisors are. Judging data never crosses into it, which is what keeps
 * "one link for four divisions" from also meaning "one database for four divisions".
 *
 * Member rooms trust it by asking it, live, on every connect — there is no shared secret
 * to distribute and no signed assertion to wait out. Removing an advisor here, or removing
 * a room here, takes effect on the next connect to any division.
 */
export class EventGroup {
	private readonly db: AppDatabase;
	private readonly rooms: GroupRoomAccess;
	private readonly email: EmailContext;

	constructor(options: { db: AppDatabase; rooms: GroupRoomAccess; email: EmailContext }) {
		this.db = options.db;
		this.rooms = options.rooms;
		this.email = options.email;
	}

	// ============================================================================
	// Called by a member room
	// ============================================================================

	/**
	 * Create the group and enrol its first room and first advisor.
	 *
	 * Called by a room whose own Judge Advisor asked for it, so the authority for this is
	 * the room's — the group has no advisors yet to authorise anything.
	 */
	async createGroup(input: {
		groupId: string;
		name: string;
		roomId: string;
		divisionLabel: string;
		advisorName: string;
		/**
		 * Inherited from the room advisor who is creating the group — the same person, whose
		 * address was already recorded at event setup. Asking again would be asking twice.
		 */
		advisorEmail: string | null;
	}): Promise<{ ok: true; groupAdvisorId: string; authToken: string } | { ok: false; error: string }> {
		if (await getGroupMetadata(this.db)) {
			return { ok: false, error: 'That event group already exists' };
		}

		const groupAdvisorId = uuidv4();
		const authToken = generateAuthToken();

		await this.db.insert(groupMetadata).values({ groupId: input.groupId, name: input.name, createdAt: new Date() });
		await this.db.insert(groupRooms).values({ roomId: input.roomId, label: input.divisionLabel, position: 0 });
		await this.db.insert(groupAdvisors).values({ id: groupAdvisorId, name: input.advisorName, authToken, email: input.advisorEmail });

		return { ok: true, groupAdvisorId, authToken };
	}

	/**
	 * Enrol another room, on the authority of a group advisor's token.
	 *
	 * The room half of this consent is proved by the caller: only a room that has already
	 * authenticated one of its own Judge Advisors calls here. Both sides must agree, so
	 * neither a group advisor nor a room JA can quietly annex the other.
	 */
	async attachRoom(input: { authToken: string; roomId: string; label: string }): Promise<{ ok: true } | { ok: false; error: string }> {
		const metadata = await getGroupMetadata(this.db);
		if (!metadata) {
			return { ok: false, error: 'That event group does not exist' };
		}

		const advisor = await findGroupAdvisorByToken(this.db, input.authToken);
		if (!advisor) {
			return { ok: false, error: 'That event group link is not valid' };
		}

		await upsertGroupRoom(this.db, input.roomId, input.label);
		return { ok: true };
	}

	/** Drop a room that is detaching itself. Idempotent: leaving twice is not an error. */
	async detachRoom(input: { roomId: string }): Promise<void> {
		await removeGroupRoom(this.db, input.roomId);
	}

	/**
	 * Live delegation: may this token open this room?
	 *
	 * Both halves are checked every time — the token must still name an advisor, and the
	 * room must still be a member. That is why revocation is instant and why a group
	 * session cannot wander into a room the group does not hold.
	 */
	async validateGroupSession(input: { authToken: string; roomId: string }): Promise<GroupSessionValidation> {
		const metadata = await getGroupMetadata(this.db);
		if (!metadata) {
			return { valid: false, reason: 'no_group' };
		}

		const advisor = await findGroupAdvisorByToken(this.db, input.authToken);
		if (!advisor) {
			return { valid: false, reason: 'unknown_token' };
		}

		if (!(await isGroupMember(this.db, input.roomId))) {
			return { valid: false, reason: 'not_a_member' };
		}

		return { valid: true, groupId: metadata.groupId, groupAdvisorId: advisor.groupAdvisorId, name: advisor.name };
	}

	/**
	 * What a member room may say about its group: division list and advisor names.
	 * Never tokens — a room compromise must not yield credentials to its siblings.
	 */
	async describeForRoom(input: { roomId: string }): Promise<GroupDescription | null> {
		const metadata = await getGroupMetadata(this.db);
		if (!metadata || !(await isGroupMember(this.db, input.roomId))) {
			return null;
		}

		return {
			groupId: metadata.groupId,
			name: metadata.name,
			divisions: await listGroupDivisions(this.db),
			advisors: await listGroupAdvisors(this.db)
		};
	}

	/**
	 * How many advisors this group would still reach the room with.
	 *
	 * A room's "you cannot remove the last Judge Advisor" guard exists so a room can never
	 * become unadministrable. With a group attached that is no longer a question of local
	 * rows alone, so the room asks.
	 */
	async advisorCountForRoom(input: { roomId: string }): Promise<number> {
		if (!(await getGroupMetadata(this.db)) || !(await isGroupMember(this.db, input.roomId))) {
			return 0;
		}
		return countGroupAdvisors(this.db);
	}

	// ============================================================================
	// Called by the Worker gateway on behalf of a client
	// ============================================================================

	/**
	 * What a group link's preview may say, with no credential presented.
	 *
	 * Deliberately just the name and a count: enough for a Judge Advisor to tell a group
	 * link apart from a room link before opening it, and no room ids for anyone who has
	 * merely guessed at a uuid.
	 */
	async getPublicSummary(): Promise<{ name: string; divisionCount: number } | null> {
		const metadata = await getGroupMetadata(this.db);
		if (!metadata) {
			return null;
		}
		return { name: metadata.name, divisionCount: (await listGroupDivisions(this.db)).length };
	}

	async handleGroupRequest(request: GroupRequest): Promise<GroupRequestResult> {
		const metadata = await getGroupMetadata(this.db);
		if (!metadata || metadata.groupId !== request.groupId) {
			return { ok: false, status: 404, error: 'Event group not found' };
		}

		const advisor = await findGroupAdvisorByToken(this.db, request.auth);
		if (!advisor) {
			return { ok: false, status: 401, error: 'Invalid or expired event group link' };
		}

		const { action } = request;

		if (action.kind === 'resolve') {
			return { ok: true, response: { state: await this.sessionState(metadata.name, advisor.groupAdvisorId) } };
		}

		return this.handleAction(metadata.name, advisor.groupAdvisorId, request, action);
	}

	private async handleAction(
		groupName: string,
		callerId: string,
		request: GroupRequest,
		action: Exclude<GroupRequest['action'], { kind: 'resolve' }>
	): Promise<GroupRequestResult> {
		let issuedAuthToken: string | undefined;
		let name = groupName;

		switch (action.kind) {
			case 'add_advisor': {
				const groupAdvisorId = uuidv4();
				issuedAuthToken = generateAuthToken();
				const email = action.email?.trim().toLowerCase() || null;
				await this.db.insert(groupAdvisors).values({ id: groupAdvisorId, name: action.name, authToken: issuedAuthToken, email });

				if (email) {
					// Best-effort, and after the row is written: the advisor exists whether or
					// not the message lands, and the caller is still shown the link.
					await this.emailAdvisorTheirLink(request.groupId, action.name, email, issuedAuthToken);
				}
				break;
			}

			case 'rename_advisor': {
				const updated = await this.db
					.update(groupAdvisors)
					.set({ name: action.name })
					.where(eq(groupAdvisors.id, action.groupAdvisorId))
					.returning({ id: groupAdvisors.id });
				if (updated.length === 0) {
					return { ok: false, status: 404, error: 'Judge Advisor not found' };
				}
				break;
			}

			case 'remove_advisor': {
				// The same two refusals a room makes, for the same two reasons: removing
				// yourself would sign you out of every division with no way back, and
				// removing the last one would leave the group unadministrable.
				if (action.groupAdvisorId === callerId) {
					return { ok: false, status: 400, error: 'You cannot remove yourself from the event group' };
				}
				if ((await countGroupAdvisors(this.db)) <= 1) {
					return { ok: false, status: 400, error: 'An event group must keep at least one Judge Advisor' };
				}

				const deleted = await this.db
					.delete(groupAdvisors)
					.where(eq(groupAdvisors.id, action.groupAdvisorId))
					.returning({ id: groupAdvisors.id });
				if (deleted.length === 0) {
					return { ok: false, status: 404, error: 'Judge Advisor not found' };
				}

				// Their live connections in member rooms are not torn down from here — the
				// rooms revalidate on the next connect and refuse. Kick them now so removal
				// is felt immediately rather than at the next reload.
				await this.kickAdvisorFromMemberRooms(action.groupAdvisorId);
				break;
			}

			case 'rotate_own_auth': {
				issuedAuthToken = generateAuthToken();
				await this.db.update(groupAdvisors).set({ authToken: issuedAuthToken }).where(eq(groupAdvisors.id, callerId));
				// SAFETY: rotating is how an advisor cuts off a lost device. Every other device
				// on the old link is signed out; this one asked, so it stays.
				await this.kickAdvisorFromMemberRooms(callerId, request.deviceId);
				break;
			}

			case 'rename_group': {
				await this.db.update(groupMetadata).set({ name: action.name }).where(eq(groupMetadata.groupId, request.groupId));
				name = action.name;
				break;
			}

			case 'rename_division': {
				if (!(await isGroupMember(this.db, action.roomId))) {
					return { ok: false, status: 404, error: 'That division is not in this event group' };
				}
				await this.db.update(groupRooms).set({ label: action.label }).where(eq(groupRooms.roomId, action.roomId));
				break;
			}

			case 'remove_room': {
				if (!(await removeGroupRoom(this.db, action.roomId))) {
					return { ok: false, status: 404, error: 'That division is not in this event group' };
				}
				// The room's own groupId is now stale. It grants nothing on its own — every
				// check is live against this table — but clearing it keeps the room from
				// showing group advisors it can no longer be opened by.
				await this.detachRoomRemotely(action.roomId, request.groupId);
				break;
			}
		}

		return {
			ok: true,
			response: { state: await this.sessionState(name, callerId), issuedAuthToken }
		};
	}

	private async sessionState(groupName: string, groupAdvisorId: string): Promise<GroupSessionState> {
		const advisors = await listGroupAdvisors(this.db);
		const advisor = advisors.find((candidate) => candidate.groupAdvisorId === groupAdvisorId) ?? {
			groupAdvisorId,
			name: 'Judge Advisor'
		};

		return {
			groupId: (await getGroupMetadata(this.db))?.groupId ?? '',
			name: groupName,
			advisor,
			divisions: await listGroupDivisions(this.db),
			advisors
		};
	}

	/** Best-effort: a room that cannot be reached will refuse the stale session anyway. */
	private async kickAdvisorFromMemberRooms(groupAdvisorId: string, exceptDeviceId?: string): Promise<void> {
		const divisions = await listGroupDivisions(this.db);
		for (const division of divisions) {
			try {
				await this.rooms.kickGroupAdvisor(division.roomId, groupAdvisorId, exceptDeviceId ?? null);
			} catch (error) {
				console.error('Failed to kick group advisor from room', division.roomId, error);
			}
		}
	}

	private async detachRoomRemotely(roomId: string, groupId: string): Promise<void> {
		try {
			await this.rooms.clearGroupId(roomId, groupId);
		} catch (error) {
			console.error('Failed to clear groupId on room', roomId, error);
		}
	}

	/**
	 * Mail a group advisor their link.
	 *
	 * Every failure is swallowed and logged. The advisor row is already committed by the
	 * time this runs, and the caller is shown the link on screen regardless, so a mail
	 * problem costs a convenience rather than the action.
	 */
	private async emailAdvisorTheirLink(groupId: string, advisorName: string, to: string, authToken: string): Promise<void> {
		if (!this.email.sender.enabled) {
			return;
		}

		try {
			const [group] = await this.db.select({ name: groupMetadata.name }).from(groupMetadata).limit(1);
			await this.email.sender.send(
				buildAdvisorAccessLinkEmail({
					to,
					advisorName,
					contextName: group?.name ?? 'this event group',
					link: buildEventGroupJoinUrl(this.email.publicOrigin, groupId, authToken),
					forGroup: true
				})
			);
		} catch (error) {
			console.error('Failed to email a group advisor their access link:', describeSmtpFailure(error));
		}
	}
}
