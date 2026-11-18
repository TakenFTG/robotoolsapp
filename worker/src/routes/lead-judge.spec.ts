import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { serverRouter } from '../server-router';
import type { ServerContext } from '../server-router';
import type { Session } from '@robotools.app/wrpc/server/session';
import type { AnyRouter } from '@robotools.app/wrpc/server/router';
import { createTestServerContext, seedTestDatabase, sampleTeamInfoAndData } from '../test-utils';
import { Authentication } from '../access/authentication';
import { generateAuthToken, JUDGE_ADVISOR_SINGLETON_ID } from '../access/tokens';
import { getJudges, upsertJudge } from './judge';
import { getTeamScreenings } from './team';
import { judgeGroups, judges, metadata } from '../db/schema';
import { uuidv4 } from '@robotools.app/protocol/src/utils';

describe('Lead Judge and team screening', () => {
	let context: ServerContext & { cleanup: () => void };
	let session: Session<AnyRouter>;

	const groupId = uuidv4();
	const leadId = uuidv4();
	const judgeId = uuidv4();
	const teamId = sampleTeamInfoAndData[0]!.id;

	const makeSession = (): Session<AnyRouter> =>
		({
			broadcast: () => ({
				onAllJudgesUpdate: { mutation: async () => [] },
				onTeamScreeningUpdate: { mutation: async () => [] }
			}),
			roomId: 'test-room',
			currentClient: { clientId: 'client-1', deviceId: uuidv4(), deviceName: 'Test Device' }
		}) as never;

	const asJudge = (id: string): ServerContext => ({
		...context,
		auth: Authentication.withFixture({ isAccessControlled: true, authToken: generateAuthToken(), role: 'judge', judgeId: id })
	});
	const asAdvisor = (): ServerContext => ({
		...context,
		auth: Authentication.withFixture({
			isAccessControlled: true,
			authToken: generateAuthToken(),
			role: 'judge_advisor',
			judgeAdvisorId: JUDGE_ADVISOR_SINGLETON_ID
		})
	});

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const call = (procedure: any, input: unknown, ctx: ServerContext) => procedure._def._resolver({ input, session, ctx });

	const addJudge = (ctx: ServerContext) => call(serverRouter.judge.addJudge, { name: 'New Judge', groupId, email: null }, ctx);
	const setLead = (id: string, isLeadJudge: boolean, ctx: ServerContext) =>
		call(serverRouter.access.setLeadJudge, { judgeId: id, isLeadJudge }, ctx);

	beforeEach(async () => {
		context = createTestServerContext();
		await seedTestDatabase(context);
		await context.db.update(metadata).set({ accessControlEnabled: true } as never);
		await context.db.insert(judgeGroups).values({ id: groupId, name: 'Group' });
		await upsertJudge(context.db, { id: leadId, name: 'Lead', groupId });
		await upsertJudge(context.db, { id: judgeId, name: 'Judge', groupId });
		await context.db.update(judges).set({ isLeadJudge: true }).where(eq(judges.id, leadId));
		session = makeSession();
	});

	afterEach(async () => {
		await new Promise((resolve) => setTimeout(resolve, 10));
		context.cleanup();
	});

	it('lets a Lead Judge add a judge and returns their link token', async () => {
		const added = await addJudge(asJudge(leadId));

		expect(added.authToken).toHaveLength(12);
		expect((await getJudges(context.db)).map((judge) => judge.name)).toContain('New Judge');
	});

	it('refuses an ordinary judge', async () => {
		await expect(addJudge(asJudge(judgeId))).rejects.toThrow('Lead Judge');
		await expect(call(serverRouter.access.listJudgeAccessLinks, undefined, asJudge(judgeId))).rejects.toThrow('Lead Judge');
	});

	it('stops working as soon as the role is taken away', async () => {
		const lead = asJudge(leadId);
		await setLead(leadId, false, asAdvisor());

		await expect(addJudge(lead)).rejects.toThrow('Lead Judge');
	});

	it('gives a Lead Judge no Judge Advisor links', async () => {
		const links = await call(serverRouter.access.listJudgeAccessLinks, undefined, asJudge(leadId));

		expect(links).not.toHaveProperty('judgeAdvisors');
		expect(links.judges).toHaveLength(2);
	});

	it('keeps Judge Advisor powers from a Lead Judge', async () => {
		const lead = asJudge(leadId);

		await expect(setLead(judgeId, true, lead)).rejects.toThrow();
		await expect(call(serverRouter.access.listAccessLinks, undefined, lead)).rejects.toThrow();
		await expect(call(serverRouter.access.rotateJudgeAuth, { judgeId }, lead)).rejects.toThrow();
		await expect(call(serverRouter.judge.updateJudge, { id: judgeId, name: 'Renamed', groupId }, lead)).rejects.toThrow();
		await expect(call(serverRouter.judge.updateAllJudges, [], lead)).rejects.toThrow();
	});

	it('does not change the role when a judge list is written back', async () => {
		await call(serverRouter.judge.updateJudge, { id: judgeId, name: 'Judge', groupId, isLeadJudge: true }, asAdvisor());
		await call(serverRouter.judge.updateJudge, { id: leadId, name: 'Lead', groupId, isLeadJudge: false }, asAdvisor());

		const roster = await getJudges(context.db);
		expect(roster.find((judge) => judge.id === judgeId)?.isLeadJudge).toBe(false);
		expect(roster.find((judge) => judge.id === leadId)?.isLeadJudge).toBe(true);
	});

	it('lets any judge flag a team, change the reason and clear it', async () => {
		const judge = asJudge(judgeId);

		await call(serverRouter.team.flagTeamForScreening, { teamId, note: '  Second interview  ' }, judge);
		await call(serverRouter.team.flagTeamForScreening, { teamId, note: 'Discuss programming' }, judge);
		expect(await getTeamScreenings(context.db)).toMatchObject([{ teamId, note: 'Discuss programming' }]);

		await call(serverRouter.team.clearTeamScreening, { teamId }, judge);
		expect(await getTeamScreenings(context.db)).toEqual([]);
	});

	it('refuses to flag a team that is not in the room', async () => {
		await expect(call(serverRouter.team.flagTeamForScreening, { teamId: uuidv4(), note: '' }, asJudge(judgeId))).rejects.toThrow(
			'Team not found'
		);
	});
});
