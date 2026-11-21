import { JUDGE_ADVISOR_SINGLETON_ID } from '@robotools.app/protocol/src/access';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { serverRouter } from '../server-router';
import type { ServerContext } from '../server-router';
import type { Session } from '@robotools.app/wrpc/server/session';
import type { AnyRouter } from '@robotools.app/wrpc/server/router';
import { createTestServerContext, seedTestDatabase, sampleTeamInfoAndData } from '../test-utils';
import { Authentication } from '../access/authentication';
import { generateAuthToken } from '../access/tokens';
import { auditLog, judges, metadata } from '../db/schema';
import { uuidv4 } from '@robotools.app/protocol/src/utils';
import { generateNotebookRubricScores, sumRubricScores } from '@robotools.app/protocol/src/rubric';
import type { AuditLogPage } from '@robotools.app/protocol/src/audit';
import type { TeamData } from '@robotools.app/protocol/src/team';
import { AUDIT_COALESCE_MS, getAuditLog, resolveAuditActor, sessionDevice, writeAudit } from '../audit/log';

const GROUP_ONE = 'group-1';

/**
 * The activity log.
 *
 * What matters is that the server, not the client, says who did it; that each entry
 * describes what actually changed; and that only Judge Advisors can read it.
 */
describe('activity log', () => {
	let context: ServerContext & { cleanup: () => void };
	let session: Session<AnyRouter>;

	const judgeId = uuidv4();
	const otherJudgeId = uuidv4();
	const team = sampleTeamInfoAndData[0]!;

	function makeSession(deviceName = 'Judge Tablet'): Session<AnyRouter> {
		return {
			getClient: () => ({}) as never,
			broadcast: () => new Proxy({}, { get: () => ({ mutation: async () => undefined }) }) as never,
			getServer: () => {
				throw new Error('getServer() cannot be called from server-side session');
			},
			roomId: 'test-room',
			currentClient: { clientId: 'client-1', deviceId: 'device-1', deviceName }
		};
	}

	function advisorContext(): ServerContext {
		return {
			...context,
			auth: Authentication.withFixture({
				isAccessControlled: true,
				authToken: generateAuthToken(),
				role: 'judge_advisor',
				judgeAdvisorId: JUDGE_ADVISOR_SINGLETON_ID
			})
		};
	}

	function judgeContext(id = judgeId): ServerContext {
		return {
			...context,
			auth: Authentication.withFixture({ isAccessControlled: true, authToken: generateAuthToken(), role: 'judge', judgeId: id })
		};
	}

	const resolve = <T>(procedure: { _def: { _resolver?: (opts: never) => unknown } }, input: unknown, ctx: ServerContext) =>
		procedure._def._resolver!({ input, session, ctx } as never) as Promise<T>;

	const completeNotebook = (submission: unknown, ctx: ServerContext) =>
		resolve(serverRouter.judging.completeEngineeringNotebookRubric, { judgeGroupId: GROUP_ONE, submission }, ctx);

	const updateTeamData = (input: TeamData, ctx: ServerContext) => resolve(serverRouter.team.updateTeamData, input, ctx);

	const readLog = (ctx: ServerContext, input: object = {}) =>
		resolve<AuditLogPage>(serverRouter.audit.getAuditLog, { limit: 100, ...input }, ctx);

	function notebookSubmission(teamId = team.id, author = judgeId) {
		return {
			id: uuidv4(),
			teamId,
			judgeId: author,
			rubric: generateNotebookRubricScores(),
			notes: '',
			innovateAwardNotes: '',
			timestamp: Date.now()
		};
	}

	function teamData(overrides: Partial<TeamData> = {}): TeamData {
		return {
			id: team.id,
			notebookLink: team.notebookLink,
			hasInnovateAwardSubmissionForm: team.hasInnovateAwardSubmissionForm,
			notebookDevelopmentStatus: team.notebookDevelopmentStatus,
			hasSeasonSummary: team.hasSeasonSummary,
			absent: team.absent,
			...overrides
		};
	}

	beforeEach(async () => {
		context = createTestServerContext();
		await seedTestDatabase(context);
		await context.db.insert(judges).values([
			{ id: judgeId, name: 'Ada Judge', groupId: GROUP_ONE, authToken: generateAuthToken() },
			{ id: otherJudgeId, name: 'Grace Judge', groupId: GROUP_ONE, authToken: generateAuthToken() }
		]);
		await context.db.update(metadata).set({ accessControlEnabled: true });
		session = makeSession();
	});

	afterEach(async () => {
		await new Promise((r) => setTimeout(r, 10));
		context.cleanup();
	});

	it('records a rubric submission with the judge, team, score and device', async () => {
		const submission = notebookSubmission();
		await completeNotebook(submission, judgeContext());

		const { entries } = await readLog(advisorContext());
		expect(entries).toHaveLength(1);
		expect(entries[0]).toMatchObject({
			action: 'notebook_rubric_submitted',
			actorRole: 'judge',
			actorId: judgeId,
			actorName: 'Ada Judge',
			verified: true,
			deviceName: 'Judge Tablet',
			teamId: team.id,
			teamNumber: team.number,
			details: { score: sumRubricScores(submission.rubric), judgeGroupName: 'Group 1', authorName: null }
		});
	});

	it('records a second save of the same rubric as an edit', async () => {
		const submission = notebookSubmission();
		await completeNotebook(submission, judgeContext());
		await completeNotebook({ ...submission, notes: 'changed' }, judgeContext());

		const { entries } = await readLog(advisorContext());
		expect(entries.map((entry) => entry.action)).toEqual(['notebook_rubric_edited', 'notebook_rubric_submitted']);
	});

	it('names the author when a Judge Advisor saves a judge’s rubric', async () => {
		await completeNotebook(notebookSubmission(), advisorContext());

		const [entry] = (await readLog(advisorContext())).entries;
		expect(entry).toMatchObject({ actorRole: 'judge_advisor', actorName: 'Judge Advisor', details: { authorName: 'Ada Judge' } });
	});

	it('records a rubric deletion with whose rubric it was', async () => {
		const submission = notebookSubmission();
		await completeNotebook(submission, judgeContext());
		await resolve(serverRouter.judging.deleteEngineeringNotebookRubric, { id: submission.id }, advisorContext());

		const [entry] = (await readLog(advisorContext())).entries;
		expect(entry).toMatchObject({ action: 'notebook_rubric_deleted', actorRole: 'judge_advisor', details: { authorName: 'Ada Judge' } });
	});

	it('records ticking Season Summary as that, not as a generic team edit', async () => {
		await updateTeamData(teamData({ hasSeasonSummary: true }), judgeContext());

		const [entry] = (await readLog(advisorContext())).entries;
		expect(entry).toMatchObject({
			action: 'team_data_changed',
			teamId: team.id,
			details: { field: 'hasSeasonSummary', before: false, after: true }
		});
	});

	it('records nothing for a save that changed nothing', async () => {
		await updateTeamData(teamData(), judgeContext());

		expect((await readLog(advisorContext())).entries).toHaveLength(0);
	});

	it('records each field a bulk update changed', async () => {
		const second = sampleTeamInfoAndData[1]!;
		await resolve(
			serverRouter.team.updateAllTeamData,
			[
				teamData({ notebookDevelopmentStatus: 'fully_developed', absent: true }),
				{ ...teamData(), id: second.id, notebookLink: second.notebookLink, hasSeasonSummary: !second.hasSeasonSummary }
			],
			advisorContext()
		);

		const fields = (await readLog(advisorContext())).entries.map((entry) => `${entry.teamNumber}:${entry.details.field}`).sort();
		expect(fields).toContain(`${team.number}:notebookDevelopmentStatus`);
		expect(fields).toContain(`${team.number}:absent`);
		expect(fields).toContain(`${second.number}:hasSeasonSummary`);
	});

	it('folds a burst of ranking changes into one entry that keeps the first value', async () => {
		const ranking = (value: number) =>
			resolve(
				serverRouter.judging.updateAwardRanking,
				{ judgeGroupId: GROUP_ONE, teamId: team.id, awardName: 'Design Award', ranking: value },
				judgeContext()
			);
		await ranking(1);
		await ranking(3);
		await ranking(4);

		const { entries } = await readLog(advisorContext());
		expect(entries).toHaveLength(1);
		expect(entries[0]).toMatchObject({ action: 'award_ranking_changed', awardName: 'Design Award', details: { before: 0, after: 4 } });
	});

	it('keeps two judges’ rankings of the same team apart', async () => {
		const ranking = (value: number, ctx: ServerContext) =>
			resolve(
				serverRouter.judging.updateAwardRanking,
				{ judgeGroupId: GROUP_ONE, teamId: team.id, awardName: 'Design Award', ranking: value },
				ctx
			);
		await ranking(2, judgeContext(judgeId));
		await ranking(5, judgeContext(otherJudgeId));

		expect((await readLog(advisorContext())).entries.map((entry) => entry.actorName).sort()).toEqual(['Ada Judge', 'Grace Judge']);
	});

	it('does not fold changes further apart than the window', async () => {
		const actor = await resolveAuditActor(context.db, judgeContext().auth);
		const device = sessionDevice(session);
		const write = { action: 'award_ranking_changed' as const, teamId: team.id, details: { before: 0, after: 1 }, coalesceKey: 'k' };
		await writeAudit(context.db, actor, device, write, 1_000_000);
		await writeAudit(context.db, actor, device, write, 1_000_000 + AUDIT_COALESCE_MS + 1);

		expect((await getAuditLog(context.db, {})).entries).toHaveLength(2);
	});

	it('records final nominations being added, removed and reordered', async () => {
		const [a, b] = sampleTeamInfoAndData;
		const nominate = (teamId: string) =>
			resolve(serverRouter.judging.nominateFinalAward, { awardName: 'Design Award', teamId, judgeGroupId: null }, advisorContext());
		await nominate(a!.id);
		await nominate(b!.id);
		await resolve(
			serverRouter.judging.updateFinalRankings,
			{
				awardName: 'Design Award',
				nominations: [
					{ teamId: b!.id, judgeGroupId: null },
					{ teamId: a!.id, judgeGroupId: null }
				]
			},
			advisorContext()
		);
		await resolve(serverRouter.judging.removeFromFinalAwardNominations, { awardName: 'Design Award', teamId: a!.id }, advisorContext());

		const { entries } = await readLog(advisorContext());
		expect(entries.map((entry) => entry.action)).toEqual([
			'final_nomination_removed',
			'final_ranking_changed',
			'final_nomination_added',
			'final_nomination_added'
		]);
		expect(entries[1]!.details.teamNumbers).toEqual([b!.number, a!.number]);
	});

	it('keeps an entry readable after the judge in it is removed', async () => {
		await completeNotebook(notebookSubmission(), judgeContext());
		await context.db.delete(judges).where(eq(judges.id, judgeId));

		const entries = (await readLog(advisorContext())).entries;
		expect(entries.find((entry) => entry.action === 'notebook_rubric_submitted')).toMatchObject({ actorName: 'Ada Judge' });
	});

	it('marks the judge as unverified when access control is off', async () => {
		await context.db.update(metadata).set({ accessControlEnabled: false });
		await completeNotebook(notebookSubmission(), { ...context, auth: Authentication.unauthenticated() });

		const [entry] = (await readLog({ ...context, auth: Authentication.unauthenticated() })).entries;
		expect(entry).toMatchObject({ actorRole: 'judge', actorName: 'Ada Judge', verified: false, deviceName: 'Judge Tablet' });
	});

	it('refuses a judge reading the log while access control is on', async () => {
		await expect(readLog(judgeContext())).rejects.toThrow(/Judge Advisor/);
		await expect(resolve(serverRouter.audit.subscribeAuditLog, undefined, judgeContext())).rejects.toThrow(/Judge Advisor/);
	});

	it('filters by person, team and action, and pages from newest to oldest', async () => {
		const second = sampleTeamInfoAndData[1]!;
		await completeNotebook(notebookSubmission(team.id, judgeId), judgeContext(judgeId));
		await completeNotebook(notebookSubmission(second.id, otherJudgeId), judgeContext(otherJudgeId));
		await updateTeamData(teamData({ absent: true }), judgeContext(judgeId));

		expect((await readLog(advisorContext(), { actorId: otherJudgeId })).entries.map((e) => e.teamId)).toEqual([second.id]);
		expect((await readLog(advisorContext(), { teamId: team.id })).entries).toHaveLength(2);
		expect((await readLog(advisorContext(), { actions: ['team_data_changed'] })).entries).toHaveLength(1);

		const first = await readLog(advisorContext(), { limit: 2 });
		expect(first.hasMore).toBe(true);
		const rest = await readLog(advisorContext(), { limit: 2, beforeId: first.entries.at(-1)!.id });
		expect(rest.hasMore).toBe(false);
		expect([...first.entries, ...rest.entries].map((e) => e.id)).toEqual(
			(await context.db.select({ id: auditLog.id }).from(auditLog)).map((row) => row.id).sort((x, y) => y - x)
		);
	});
});
