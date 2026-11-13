import { describe, it, expect, afterEach } from 'vitest';
import { serverRouter } from '../server-router';
import { createRecordingEmailContext, createTestServerContext, seedTestDatabase } from '../test-utils';
import { Authentication } from '../access/authentication';
import { generateAuthToken, resolveClientAuthentication, upsertJudgeAdvisorAuthToken } from '../access/tokens';
import { upsertJudge } from './judge';
import { uuidv4 } from '@robotools.app/protocol/src/utils';

/**
 * Send-all runs outside the room lock (runtime/lock-free.ts), so two calls can now be in
 * flight at once. The send throttle has to hold on its own.
 */
describe('access link email throttle', () => {
	let cleanup: (() => void) | null = null;

	afterEach(() => {
		cleanup?.();
		cleanup = null;
	});

	async function setUp() {
		const email = createRecordingEmailContext();
		// The throttle is keyed by room, and module-level: a fresh id keeps tests apart.
		const context = createTestServerContext({ email, roomId: uuidv4() });
		cleanup = context.cleanup;
		await seedTestDatabase(context);
		for (let i = 0; i < 3; i++) {
			await upsertJudge(context.db, { id: uuidv4(), name: `Judge ${i}`, groupId: 'group-1', email: `judge${i}@example.com` });
		}
		// Send-all needs an access-controlled Judge Advisor who has entered their PIN.
		const token = generateAuthToken();
		await upsertJudgeAdvisorAuthToken(context.db, token);
		const resolved = await resolveClientAuthentication(context.db, token);
		if (resolved?.role !== 'judge_advisor') throw new Error('expected a Judge Advisor');
		return { email, ctx: { ...context, auth: Authentication.withFixture(resolved) } };
	}

	const sendAll = (ctx: Awaited<ReturnType<typeof setUp>>['ctx']) =>
		serverRouter.access.sendAccessLinkEmails._def._resolver!({ input: { judgeIds: null }, ctx, session: {} as never });

	it('lets only one of two simultaneous send-alls through', async () => {
		const { email, ctx } = await setUp();

		const [first, second] = await Promise.allSettled([sendAll(ctx), sendAll(ctx)]);
		const outcomes = [first.status, second.status].sort();

		expect(outcomes).toEqual(['fulfilled', 'rejected']);
		const rejected = [first, second].find((result) => result.status === 'rejected') as PromiseRejectedResult;
		expect(String(rejected.reason)).toContain('Sending too quickly');
		expect(email.sent).toHaveLength(3);
	});
});
