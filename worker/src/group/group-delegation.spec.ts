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
import { setRoomGroupId } from './gateway';
import type { EventGroupGateway } from './gateway';

/**
 * Cross-room trust.
 *
 * The claim being tested is narrow and worth stating plainly: a room admits a group
 * credential only because the group, asked live on this connect, says so — and refuses the
 * moment the group stops saying so. Everything here is about that "moment".
 */

const ROOM_ID = '550e8400-e29b-41d4-a716-446655441001';
const OTHER_ROOM_ID = '550e8400-e29b-41d4-a716-446655441002';
const GROUP_ID = '550e8400-e29b-41d4-a716-446655441003';
const DEVICE_ID = '550e8400-e29b-41d4-a716-4466554400aa';
const GROUP_ADVISOR_ID = '550e8400-e29b-41d4-a716-4466554400cc';
const GROUP_TOKEN = 'GrPtoken1234';

/**
 * A stand-in for the EventGroup Durable Object, holding the only two facts a room's
 * connect decision depends on: which tokens the group knows, and which rooms it holds.
 */
function createFakeGroup() {
	const state = {
		advisors: new Map<string, { groupAdvisorId: string; name: string }>([
			[GROUP_TOKEN, { groupAdvisorId: GROUP_ADVISOR_ID, name: 'Group Advisor' }]
		]),
		rooms: new Set<string>([ROOM_ID]),
		kicked: [] as string[]
	};

	const gateway: EventGroupGateway = {
		async validateSession(groupId, input) {
			if (groupId !== GROUP_ID) {
				return { valid: false, reason: 'no_group' };
			}
			const advisor = state.advisors.get(input.authToken);
			if (!advisor) {
				return { valid: false, reason: 'unknown_token' };
			}
			if (!state.rooms.has(input.roomId)) {
				return { valid: false, reason: 'not_a_member' };
			}
			return {
				valid: true,
				groupId: GROUP_ID,
				groupAdvisorId: advisor.groupAdvisorId,
				name: advisor.name
			};
		},

		async describe(groupId, roomId) {
			if (groupId !== GROUP_ID || !state.rooms.has(roomId)) {
				return null;
			}
			return {
				groupId: GROUP_ID,
				name: 'Test Competition',
				divisions: Array.from(state.rooms).map((id, index) => ({ roomId: id, label: `Division ${index + 1}`, position: index })),
				advisors: Array.from(state.advisors.values()).map((advisor) => ({
					groupAdvisorId: advisor.groupAdvisorId,
					name: advisor.name
				}))
			};
		},

		async advisorCount(groupId, roomId) {
			if (groupId !== GROUP_ID || !state.rooms.has(roomId)) {
				return 0;
			}
			return state.advisors.size;
		},

		async create() {
			return { ok: true, groupAdvisorId: GROUP_ADVISOR_ID, authToken: GROUP_TOKEN };
		},

		async attach(groupId, input) {
			state.rooms.add(input.roomId);
			return { ok: true };
		},

		async detach(groupId, roomId) {
			state.rooms.delete(roomId);
		}
	};

	return { state, gateway };
}

describe('event group delegation', () => {
	let context: ServerContext & { cleanup: () => void };
	let group: ReturnType<typeof createFakeGroup>;

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

	beforeEach(async () => {
		group = createFakeGroup();
		context = createTestServerContext({ roomId: ROOM_ID, group: group.gateway });
		await seedTestDatabase(context);
		await upsertJudgeAdvisorAuthToken(context.db, generateAuthToken());
		await serverRouter.essential.updateEssentialData._def._resolver!({
			input: { ...(await getEssentialData(context.db)), accessControlEnabled: true },
			session,
			ctx: context
		});
		await setRoomGroupId(context.db, GROUP_ID);
	});

	afterEach(async () => {
		await new Promise((resolve) => setTimeout(resolve, 10));
		context.cleanup();
	});

	it('admits a group advisor the group vouches for', async () => {
		const result = await context.network.authorizeConnect(DEVICE_ID, GROUP_TOKEN, ROOM_ID);

		expect(result.allowed).toBe(true);
		if (result.allowed) {
			expect(result.authentication).toMatchObject({
				isAccessControlled: true,
				role: 'judge_advisor',
				judgeAdvisorId: groupScopedAdvisorId(GROUP_ADVISOR_ID),
				groupOrigin: { groupId: GROUP_ID, groupAdvisorId: GROUP_ADVISOR_ID }
			});
		}
	});

	it('refuses a group advisor the group has removed, on the next connect', async () => {
		expect((await context.network.authorizeConnect(DEVICE_ID, GROUP_TOKEN, ROOM_ID)).allowed).toBe(true);

		group.state.advisors.delete(GROUP_TOKEN);

		const denied = await context.network.authorizeConnect(DEVICE_ID, GROUP_TOKEN, ROOM_ID);
		expect(denied.allowed).toBe(false);
		if (!denied.allowed) {
			expect(denied.reason).toMatch(/invalid or expired/i);
		}
	});

	it('stops accepting group sessions once the room is removed from the group', async () => {
		expect((await context.network.authorizeConnect(DEVICE_ID, GROUP_TOKEN, ROOM_ID)).allowed).toBe(true);

		group.state.rooms.delete(ROOM_ID);

		const denied = await context.network.authorizeConnect(DEVICE_ID, GROUP_TOKEN, ROOM_ID);
		expect(denied.allowed).toBe(false);
	});

	it('refuses a group session for a room the group does not hold', async () => {
		// The same valid token, presented to a room outside the group. The group is asked
		// per room, so possession of the credential is not enough.
		const denied = await context.network.authorizeConnect(DEVICE_ID, GROUP_TOKEN, OTHER_ROOM_ID);
		expect(denied.allowed).toBe(false);
	});

	it('refuses a group session when the room belongs to no group at all', async () => {
		await setRoomGroupId(context.db, null);

		const denied = await context.network.authorizeConnect(DEVICE_ID, GROUP_TOKEN, ROOM_ID);
		expect(denied.allowed).toBe(false);
	});

	it("leaves the room's own Judge Advisors working exactly as before", async () => {
		const roomToken = (await getJudgeAdvisorAuthToken(context.db))!;

		const result = await context.network.authorizeConnect(DEVICE_ID, roomToken, ROOM_ID);
		expect(result.allowed).toBe(true);
		if (result.allowed) {
			expect(result.authentication).toEqual({
				isAccessControlled: true,
				authToken: roomToken,
				role: 'judge_advisor',
				judgeAdvisorId: JUDGE_ADVISOR_SINGLETON_ID
			});
		}
	});

	it('lists group advisors alongside the room’s own, without their links', async () => {
		context.auth.setAuthentication({
			isAccessControlled: true,
			authToken: (await getJudgeAdvisorAuthToken(context.db))!,
			role: 'judge_advisor',
			judgeAdvisorId: JUDGE_ADVISOR_SINGLETON_ID
		});

		const links = await serverRouter.access.listAccessLinks._def._resolver!({
			input: undefined,
			session,
			ctx: context
		});

		const groupRow = links.judgeAdvisors.find((advisor) => advisor.origin === 'group');
		expect(groupRow).toBeTruthy();
		expect(groupRow!.authToken).toBeNull();
		expect(groupRow!.judgeAdvisorId).toBe(groupScopedAdvisorId(GROUP_ADVISOR_ID));

		const roomRow = links.judgeAdvisors.find((advisor) => advisor.origin === 'room');
		expect(roomRow!.authToken).toBeTruthy();
	});

	it('refuses room actions that would rewrite a group-administered credential', async () => {
		context.auth.setAuthentication({
			isAccessControlled: true,
			authToken: GROUP_TOKEN,
			role: 'judge_advisor',
			judgeAdvisorId: groupScopedAdvisorId(GROUP_ADVISOR_ID),
			groupOrigin: { groupId: GROUP_ID, groupAdvisorId: GROUP_ADVISOR_ID, name: 'Group Advisor' }
		});

		await expect(serverRouter.access.rotateJudgeAdvisorAuth._def._resolver!({ input: undefined, session, ctx: context })).rejects.toThrow(
			/event group/i
		);

		await expect(
			serverRouter.access.removeJudgeAdvisor._def._resolver!({
				input: { judgeAdvisorId: groupScopedAdvisorId(GROUP_ADVISOR_ID) },
				session,
				ctx: context
			})
		).rejects.toThrow(/event group/i);
	});

	it('counts group advisors when guarding the last Judge Advisor', async () => {
		// A second local advisor, so removing one is a question about the *last* one rather
		// than about removing yourself.
		const secondId = '550e8400-e29b-41d4-a716-4466554400ee';
		await upsertJudgeAdvisorAuthToken(context.db, generateAuthToken(), secondId, 'Second Advisor');

		context.auth.setAuthentication({
			isAccessControlled: true,
			authToken: (await getJudgeAdvisorAuthToken(context.db))!,
			role: 'judge_advisor',
			judgeAdvisorId: JUDGE_ADVISOR_SINGLETON_ID
		});

		await expect(
			serverRouter.access.removeJudgeAdvisor._def._resolver!({
				input: { judgeAdvisorId: secondId },
				session,
				ctx: context
			})
		).resolves.toEqual({ success: true });
	});
});
