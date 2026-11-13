import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { JUDGE_ADVISOR_SINGLETON_ID } from '@robotools.app/protocol/src/access';
import { groupScopedAdvisorId } from '@robotools.app/protocol/src/group';
import type { Session } from '@robotools.app/wrpc/server/session';
import type { AnyRouter } from '@robotools.app/wrpc/server/router';
import { createTestServerContext, seedTestDatabase } from '../test-utils';
import type { ServerContext } from '../server-router';
import { serverRouter } from '../server-router';
import { generateAuthToken, getJudgeAdvisorAuthToken, upsertJudgeAdvisorAuthToken } from '../access/tokens';
import { getEssentialData } from '../routes/essential';
import { getRoomGroupId } from '../group/gateway';
import type { EventGroupGateway } from '../group/gateway';

/**
 * The room's side of joining an event group.
 *
 * Both halves of the consent are what these tests are about: the caller must administer
 * this room, and must present a credential the group recognises. Neither alone lets one
 * side annex the other.
 */

const ROOM_ID = '550e8400-e29b-41d4-a716-446655442001';
const GROUP_ID = '550e8400-e29b-41d4-a716-446655442002';
const DEVICE_ID = '550e8400-e29b-41d4-a716-4466554420aa';
const GROUP_ADVISOR_ID = '550e8400-e29b-41d4-a716-4466554420cc';
const GROUP_TOKEN = 'GrPtoken1234';

function createRecordingGateway() {
	const calls = { created: 0, attached: [] as string[], detached: [] as string[] };
	const rooms = new Set<string>();

	const gateway: EventGroupGateway = {
		async validateSession(groupId, input) {
			if (input.authToken !== GROUP_TOKEN || !rooms.has(input.roomId)) {
				return { valid: false, reason: 'unknown_token' };
			}
			return { valid: true, groupId, groupAdvisorId: GROUP_ADVISOR_ID, name: 'Group Advisor' };
		},
		async describe(groupId, roomId) {
			if (!rooms.has(roomId)) return null;
			return {
				groupId,
				name: 'Test Competition',
				divisions: Array.from(rooms).map((id, index) => ({ roomId: id, label: `Division ${index + 1}`, position: index })),
				advisors: [{ groupAdvisorId: GROUP_ADVISOR_ID, name: 'Group Advisor' }]
			};
		},
		async advisorCount(_groupId, roomId) {
			return rooms.has(roomId) ? 1 : 0;
		},
		async create(_groupId, input) {
			calls.created += 1;
			rooms.add(input.roomId);
			return { ok: true, groupAdvisorId: GROUP_ADVISOR_ID, authToken: GROUP_TOKEN };
		},
		async attach(_groupId, input) {
			if (input.authToken !== GROUP_TOKEN) {
				return { ok: false, error: 'That event group link is not valid' };
			}
			calls.attached.push(input.roomId);
			rooms.add(input.roomId);
			return { ok: true };
		},
		async detach(_groupId, roomId) {
			calls.detached.push(roomId);
			rooms.delete(roomId);
		}
	};

	return { calls, rooms, gateway };
}

describe('room group membership', () => {
	let context: ServerContext & { cleanup: () => void };
	let group: ReturnType<typeof createRecordingGateway>;

	const session: Session<AnyRouter> = {
		getClient: () =>
			({
				onClientAuthenticationChange: { mutation: async () => undefined }
			}) as never,
		broadcast: () =>
			({
				onDeviceListUpdate: { mutation: async () => [] },
				onEventSetupUpdate: { mutation: async () => [] }
			}) as never,
		getServer: () => {
			throw new Error('getServer() cannot be called from server-side session');
		},
		roomId: ROOM_ID,
		currentClient: {
			clientId: `${DEVICE_ID}-client`,
			deviceId: DEVICE_ID,
			deviceName: 'Test Device'
		}
	};

	async function authenticateAsRoomAdvisor() {
		context.auth.setAuthentication({
			isAccessControlled: true,
			authToken: (await getJudgeAdvisorAuthToken(context.db))!,
			role: 'judge_advisor',
			judgeAdvisorId: JUDGE_ADVISOR_SINGLETON_ID
		});
	}

	function authenticateAsGroupAdvisor() {
		context.auth.setAuthentication({
			isAccessControlled: true,
			authToken: GROUP_TOKEN,
			role: 'judge_advisor',
			judgeAdvisorId: groupScopedAdvisorId(GROUP_ADVISOR_ID),
			groupOrigin: { groupId: GROUP_ID, groupAdvisorId: GROUP_ADVISOR_ID, name: 'Group Advisor' }
		});
	}

	async function enableAccessControl() {
		await upsertJudgeAdvisorAuthToken(context.db, generateAuthToken());
		await serverRouter.essential.updateEssentialData._def._resolver!({
			input: { ...(await getEssentialData(context.db)), accessControlEnabled: true },
			session,
			ctx: context
		});
	}

	beforeEach(async () => {
		group = createRecordingGateway();
		context = createTestServerContext({ roomId: ROOM_ID, group: group.gateway });
		await seedTestDatabase(context);
	});

	afterEach(async () => {
		await new Promise((resolve) => setTimeout(resolve, 10));
		context.cleanup();
	});

	it('refuses to create a group while the room is open to everyone', async () => {
		await authenticateAsRoomAdvisor();

		await expect(
			serverRouter.group.createGroup._def._resolver!({
				input: { name: 'Test Competition', divisionLabel: 'Division 1' },
				session,
				ctx: context
			})
		).rejects.toThrow(/access control/i);
	});

	it('creates a group and records the membership on the room', async () => {
		await enableAccessControl();
		await authenticateAsRoomAdvisor();

		const result = await serverRouter.group.createGroup._def._resolver!({
			input: { name: 'Test Competition', divisionLabel: 'Division 1' },
			session,
			ctx: context
		});

		expect(result.authToken).toBe(GROUP_TOKEN);
		expect(group.calls.created).toBe(1);
		expect(await getRoomGroupId(context.db)).toBe(result.groupId);
	});

	it('refuses a second group for a room that already has one', async () => {
		await enableAccessControl();
		await authenticateAsRoomAdvisor();

		await serverRouter.group.createGroup._def._resolver!({
			input: { name: 'Test Competition', divisionLabel: 'Division 1' },
			session,
			ctx: context
		});

		await expect(
			serverRouter.group.attachToGroup._def._resolver!({
				input: { groupId: GROUP_ID, groupAuthToken: GROUP_TOKEN, divisionLabel: 'Division 2' },
				session,
				ctx: context
			})
		).rejects.toThrow(/different event group/i);
	});

	it('refuses to attach with a link the group does not recognise', async () => {
		await enableAccessControl();
		await authenticateAsRoomAdvisor();

		await expect(
			serverRouter.group.attachToGroup._def._resolver!({
				input: { groupId: GROUP_ID, groupAuthToken: 'WrongToken12', divisionLabel: 'Division 2' },
				session,
				ctx: context
			})
		).rejects.toThrow(/not valid/i);

		expect(await getRoomGroupId(context.db)).toBeNull();
	});

	it('will not let a group advisor rewire the room’s membership', async () => {
		await enableAccessControl();
		authenticateAsGroupAdvisor();

		await expect(
			serverRouter.group.attachToGroup._def._resolver!({
				input: { groupId: GROUP_ID, groupAuthToken: GROUP_TOKEN, divisionLabel: 'Division 2' },
				session,
				ctx: context
			})
		).rejects.toThrow(/Judge Advisor of this division/i);

		await expect(serverRouter.group.detachFromGroup._def._resolver!({ input: undefined, session, ctx: context })).rejects.toThrow(
			/Judge Advisor of this division/i
		);
	});

	it('detaches, and forgets the group locally first', async () => {
		await enableAccessControl();
		await authenticateAsRoomAdvisor();

		await serverRouter.group.attachToGroup._def._resolver!({
			input: { groupId: GROUP_ID, groupAuthToken: GROUP_TOKEN, divisionLabel: 'Division 2' },
			session,
			ctx: context
		});
		expect(await getRoomGroupId(context.db)).toBe(GROUP_ID);

		await serverRouter.group.detachFromGroup._def._resolver!({ input: undefined, session, ctx: context });

		expect(await getRoomGroupId(context.db)).toBeNull();
		expect(group.calls.detached).toContain(ROOM_ID);
	});

	it('drops a stale membership when the group no longer holds the room', async () => {
		await enableAccessControl();
		await authenticateAsRoomAdvisor();

		await serverRouter.group.attachToGroup._def._resolver!({
			input: { groupId: GROUP_ID, groupAuthToken: GROUP_TOKEN, divisionLabel: 'Division 2' },
			session,
			ctx: context
		});

		// Removed at the group, which cannot always reach back to the room to say so.
		group.rooms.delete(ROOM_ID);

		expect(await serverRouter.group.getGroup._def._resolver!({ input: undefined, session, ctx: context })).toBeNull();
		expect(await getRoomGroupId(context.db)).toBeNull();
	});

	it('refuses to turn access control off while the room is in a group', async () => {
		await enableAccessControl();
		await authenticateAsRoomAdvisor();

		await serverRouter.group.attachToGroup._def._resolver!({
			input: { groupId: GROUP_ID, groupAuthToken: GROUP_TOKEN, divisionLabel: 'Division 2' },
			session,
			ctx: context
		});

		await expect(
			serverRouter.essential.updateEssentialData._def._resolver!({
				input: { ...(await getEssentialData(context.db)), accessControlEnabled: false },
				session,
				ctx: context
			})
		).rejects.toThrow(/event group/i);
	});
});
