import { JUDGE_ADVISOR_SINGLETON_ID } from '@robotools.app/protocol/src/access';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { serverRouter } from '../server-router';
import type { ServerContext } from '../server-router';
import type { Session } from '@robotools.app/wrpc/server/session';
import type { AnyRouter } from '@robotools.app/wrpc/server/router';
import { createTestServerContext, seedTestDatabase, sampleTeamInfoAndData } from '../test-utils';
import { Authentication } from '../access/authentication';
import { generateAuthToken } from '../access/tokens';
import { getEssentialData, getJudgeGroups } from './essential';
import { getJudges, upsertJudge } from './judge';
import { metadata } from '../db/schema';
import { uuidv4 } from '@robotools.app/protocol/src/utils';

const GROUP_ONE = 'group-1';

describe('judge group management', () => {
	let context: ServerContext & { cleanup: () => void };
	let session: Session<AnyRouter>;

	const groupTwoId = uuidv4();
	const judgeId = uuidv4();
	const teamOneId = sampleTeamInfoAndData[0]!.id;
	const teamTwoId = sampleTeamInfoAndData[1]!.id;

	function makeSession(): Session<AnyRouter> {
		return {
			getClient: () => ({ onClientAuthenticationChange: { mutation: async () => undefined } }) as never,
			broadcast: () =>
				({
					onEventSetupUpdate: { mutation: async () => [] },
					onAllJudgesUpdate: { mutation: async () => [] },
					onDeviceListUpdate: { mutation: async () => [] }
				}) as never,
			getServer: () => {
				throw new Error('getServer() cannot be called from server-side session');
			},
			roomId: 'test-room',
			currentClient: { clientId: 'client-1', deviceId: uuidv4(), deviceName: 'Test Device' }
		};
	}

	const updateJudgeGroups = (input: unknown, ctx: ServerContext = context) =>
		serverRouter.judge.updateJudgeGroups._def._resolver!({ input, session, ctx } as never);

	beforeEach(async () => {
		context = createTestServerContext();
		await seedTestDatabase(context);
		session = makeSession();
	});

	afterEach(async () => {
		// updateJudgeGroups broadcasts without awaiting, so let that settle before the
		// database closes underneath it (same pattern as access.spec.ts).
		await new Promise((resolve) => setTimeout(resolve, 10));
		context.cleanup();
	});

	it('assigns teams to a group', async () => {
		await updateJudgeGroups([{ id: GROUP_ONE, name: 'Group 1', assignedTeams: [teamOneId, teamTwoId] }]);

		const groups = await getJudgeGroups(context.db);
		expect(groups).toHaveLength(1);
		expect(groups[0]!.assignedTeams).toEqual([teamOneId, teamTwoId]);
	});

	it('moves a team from one group to another', async () => {
		await updateJudgeGroups([
			{ id: GROUP_ONE, name: 'Group 1', assignedTeams: [teamOneId, teamTwoId] },
			{ id: groupTwoId, name: 'Group 2', assignedTeams: [] }
		]);

		await updateJudgeGroups([
			{ id: GROUP_ONE, name: 'Group 1', assignedTeams: [teamTwoId] },
			{ id: groupTwoId, name: 'Group 2', assignedTeams: [teamOneId] }
		]);

		const groups = await getJudgeGroups(context.db);
		const byId = Object.fromEntries(groups.map((group) => [group.id, group]));
		expect(byId[GROUP_ONE]!.assignedTeams).toEqual([teamTwoId]);
		expect(byId[groupTwoId]!.assignedTeams).toEqual([teamOneId]);
	});

	it('refuses to assign the same team to two groups', async () => {
		await expect(
			updateJudgeGroups([
				{ id: GROUP_ONE, name: 'Group 1', assignedTeams: [teamOneId] },
				{ id: groupTwoId, name: 'Group 2', assignedTeams: [teamOneId] }
			])
		).rejects.toThrow(/more than one judge group/);
	});

	it('refuses to assign a team that is not in the room', async () => {
		await expect(updateJudgeGroups([{ id: GROUP_ONE, name: 'Group 1', assignedTeams: [uuidv4()] }])).rejects.toThrow(
			/not in this Judges' Room/
		);
	});

	it('refuses to drop a group that still has judges, naming them', async () => {
		await updateJudgeGroups([
			{ id: GROUP_ONE, name: 'Group 1', assignedTeams: [] },
			{ id: groupTwoId, name: 'Group 2', assignedTeams: [] }
		]);
		await upsertJudge(context.db, { id: judgeId, name: 'Judge One', groupId: groupTwoId });

		await expect(updateJudgeGroups([{ id: GROUP_ONE, name: 'Group 1', assignedTeams: [] }])).rejects.toThrow(/Judge One/);

		// The rejected write must not have partially applied.
		expect(await getJudgeGroups(context.db)).toHaveLength(2);
	});

	it('drops a group once its judges have moved out', async () => {
		await updateJudgeGroups([
			{ id: GROUP_ONE, name: 'Group 1', assignedTeams: [] },
			{ id: groupTwoId, name: 'Group 2', assignedTeams: [teamOneId] }
		]);
		await upsertJudge(context.db, { id: judgeId, name: 'Judge One', groupId: groupTwoId });

		await upsertJudge(context.db, { id: judgeId, name: 'Judge One', groupId: GROUP_ONE });
		await updateJudgeGroups([{ id: GROUP_ONE, name: 'Group 1', assignedTeams: [] }]);

		expect(await getJudgeGroups(context.db)).toHaveLength(1);
		// The dropped group's team is now unassigned rather than deleted.
		const essential = await getEssentialData(context.db);
		expect(essential!.teamInfos.some((team) => team.id === teamOneId)).toBe(true);
		expect((await getJudges(context.db))[0]!.groupId).toBe(GROUP_ONE);
	});

	it('renames a group without disturbing its assignments', async () => {
		await updateJudgeGroups([{ id: GROUP_ONE, name: 'Group 1', assignedTeams: [teamOneId] }]);
		await updateJudgeGroups([{ id: GROUP_ONE, name: 'Panel A', assignedTeams: [teamOneId] }]);

		const groups = await getJudgeGroups(context.db);
		expect(groups[0]!.name).toBe('Panel A');
		expect(groups[0]!.assignedTeams).toEqual([teamOneId]);
	});

	it('requires at least one group', async () => {
		await expect(updateJudgeGroups([])).rejects.toThrow();
	});

	it('leaves awards and teams untouched', async () => {
		const before = await getEssentialData(context.db);
		await updateJudgeGroups([{ id: GROUP_ONE, name: 'Group 1', assignedTeams: [teamOneId] }]);
		const after = await getEssentialData(context.db);

		expect(after!.awards).toEqual(before!.awards);
		expect(after!.teamInfos.map((team) => team.id).sort()).toEqual(before!.teamInfos.map((team) => team.id).sort());
		expect(after!.eventName).toBe(before!.eventName);
	});

	describe('with access control on', () => {
		beforeEach(async () => {
			await context.db.update(metadata).set({ accessControlEnabled: true });
		});

		it('rejects a judge trying to reorganise groups', async () => {
			const judgeCtx: ServerContext = {
				...context,
				auth: Authentication.withFixture({
					isAccessControlled: true,
					authToken: generateAuthToken(),
					role: 'judge',
					judgeId
				})
			};

			await expect(updateJudgeGroups([{ id: GROUP_ONE, name: 'Hijacked', assignedTeams: [] }], judgeCtx)).rejects.toThrow(
				/Only the Judge Advisor/
			);
		});

		it('allows a Judge Advisor', async () => {
			const jaCtx: ServerContext = {
				...context,
				auth: Authentication.withFixture({
					isAccessControlled: true,
					authToken: generateAuthToken(),
					role: 'judge_advisor',
					judgeAdvisorId: JUDGE_ADVISOR_SINGLETON_ID
				})
			};

			await updateJudgeGroups([{ id: GROUP_ONE, name: 'Panel A', assignedTeams: [teamOneId] }], jaCtx);
			expect((await getJudgeGroups(context.db))[0]!.name).toBe('Panel A');
		});
	});
});
