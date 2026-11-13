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
import {
	engineeringNotebookRubrics,
	judgeGroupsReviewedTeams,
	judgeGroupsSubmissionsCache,
	judges,
	teamInterviewRubrics
} from '../db/schema';
import { uuidv4 } from '@robotools.app/protocol/src/utils';
import { generateNotebookRubricScores, generateTeamInterviewRubricScores } from '@robotools.app/protocol/src/rubric';

const GROUP_ONE = 'group-1';

/**
 * Deleting a submitted rubric.
 *
 * The permission boundary is the point of most of this. A rubric is the record of a
 * judge's assessment, deleting it is not recoverable, and the write path's own check —
 * "is this yours" — gives the wrong answer for an advisor, who authored none of them.
 */
describe('rubric deletion', () => {
	let context: ServerContext & { cleanup: () => void };
	let session: Session<AnyRouter>;

	const judgeId = uuidv4();
	const teamOneId = sampleTeamInfoAndData[0]!.id;
	const teamTwoId = sampleTeamInfoAndData[1]!.id;

	function makeSession(): Session<AnyRouter> {
		return {
			getClient: () => ({}) as never,
			broadcast: () => ({}) as never,
			getServer: () => {
				throw new Error('getServer() cannot be called from server-side session');
			},
			roomId: 'test-room',
			currentClient: { clientId: 'client-1', deviceId: uuidv4(), deviceName: 'Test Device' }
		};
	}

	/** An advisor with a verified PIN — what the delete requires. */
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

	/** A judge, bound to the judge who authored the rubrics below. */
	function judgeContext(): ServerContext {
		return {
			...context,
			auth: Authentication.withFixture({
				isAccessControlled: true,
				authToken: generateAuthToken(),
				role: 'judge',
				judgeId
			})
		};
	}

	const completeNotebook = (submission: unknown, ctx: ServerContext = context) =>
		serverRouter.judging.completeEngineeringNotebookRubric._def._resolver!({
			input: { judgeGroupId: GROUP_ONE, submission },
			session,
			ctx
		} as never);

	const completeInterview = (submission: unknown, ctx: ServerContext = context) =>
		serverRouter.judging.completeTeamInterviewRubric._def._resolver!({
			input: { judgeGroupId: GROUP_ONE, submission },
			session,
			ctx
		} as never);

	const deleteNotebook = (id: string, ctx: ServerContext) =>
		serverRouter.judging.deleteEngineeringNotebookRubric._def._resolver!({ input: { id }, session, ctx } as never);

	const deleteInterview = (id: string, ctx: ServerContext) =>
		serverRouter.judging.deleteTeamInterviewRubric._def._resolver!({ input: { id }, session, ctx } as never);

	function notebookSubmission(teamId: string) {
		return {
			id: uuidv4(),
			teamId,
			judgeId,
			rubric: generateNotebookRubricScores(),
			notes: 'notes',
			innovateAwardNotes: '',
			timestamp: Date.now()
		};
	}

	function interviewSubmission(teamId: string) {
		return {
			id: uuidv4(),
			teamId,
			judgeId,
			rubric: generateTeamInterviewRubricScores(),
			notes: 'notes',
			timestamp: Date.now()
		};
	}

	async function reviewedTeams(): Promise<string[]> {
		const rows = await context.db.select().from(judgeGroupsReviewedTeams).where(eq(judgeGroupsReviewedTeams.judgeGroupId, GROUP_ONE));
		return rows.map((row) => row.teamId);
	}

	beforeEach(async () => {
		context = createTestServerContext();
		await seedTestDatabase(context);
		await context.db.insert(judges).values({ id: judgeId, name: 'Judge One', groupId: GROUP_ONE, authToken: generateAuthToken() });
		session = makeSession();
	});

	afterEach(async () => {
		// The delete broadcasts without awaiting, as the write path does.
		await new Promise((resolve) => setTimeout(resolve, 10));
		context.cleanup();
	});

	it('refuses a judge, including the one who wrote it', async () => {
		const submission = notebookSubmission(teamOneId);
		await completeNotebook(submission, judgeContext());

		await expect(deleteNotebook(submission.id, judgeContext())).rejects.toThrow(/Judge Advisor/);

		// And it is still there, which is the part that matters.
		const rows = await context.db.select().from(engineeringNotebookRubrics).where(eq(engineeringNotebookRubrics.id, submission.id));
		expect(rows).toHaveLength(1);
	});

	it('deletes a notebook rubric and its cache row', async () => {
		const submission = notebookSubmission(teamOneId);
		await completeNotebook(submission, judgeContext());

		expect(await context.db.select().from(judgeGroupsSubmissionsCache)).toHaveLength(1);

		await deleteNotebook(submission.id, advisorContext());

		expect(await context.db.select().from(engineeringNotebookRubrics)).toHaveLength(0);
		// Worth asserting rather than assuming. The schema's onDelete cascade would do this
		// in production, where foreign_keys is ON, but not here — the test database does not
		// set that pragma, so a delete that leaned on the cascade would pass in front of
		// judges and fail nowhere.
		expect(await context.db.select().from(judgeGroupsSubmissionsCache)).toHaveLength(0);
	});

	it('deletes an interview rubric too', async () => {
		const submission = interviewSubmission(teamOneId);
		await completeInterview(submission, judgeContext());

		await deleteInterview(submission.id, advisorContext());

		expect(await context.db.select().from(teamInterviewRubrics)).toHaveLength(0);
		expect(await context.db.select().from(judgeGroupsSubmissionsCache)).toHaveLength(0);
	});

	it('clears the reviewed mark when nothing is left for the team', async () => {
		const submission = notebookSubmission(teamOneId);
		await completeNotebook(submission, judgeContext());
		expect(await reviewedTeams()).toEqual([teamOneId]);

		await deleteNotebook(submission.id, advisorContext());

		// Otherwise a team with no rubric still counts as done in the progress figures.
		expect(await reviewedTeams()).toEqual([]);
	});

	it('keeps the reviewed mark while another submission remains', async () => {
		const notebook = notebookSubmission(teamOneId);
		const interview = interviewSubmission(teamOneId);
		await completeNotebook(notebook, judgeContext());
		await completeInterview(interview, judgeContext());

		await deleteNotebook(notebook.id, advisorContext());

		// The interview is still there, so the group has still looked at this team.
		expect(await reviewedTeams()).toEqual([teamOneId]);

		await deleteInterview(interview.id, advisorContext());
		expect(await reviewedTeams()).toEqual([]);
	});

	it('leaves other teams alone', async () => {
		const one = notebookSubmission(teamOneId);
		const two = notebookSubmission(teamTwoId);
		await completeNotebook(one, judgeContext());
		await completeNotebook(two, judgeContext());

		await deleteNotebook(one.id, advisorContext());

		expect(await reviewedTeams()).toEqual([teamTwoId]);
		const remaining = await context.db.select().from(engineeringNotebookRubrics);
		expect(remaining.map((row) => row.id)).toEqual([two.id]);
	});

	it('is silent about an id that matches nothing', async () => {
		// Two advisors clearing the same duplicate is not a failure, and the end state is
		// what both of them wanted.
		await expect(deleteNotebook(uuidv4(), advisorContext())).resolves.toBeUndefined();
	});
});
