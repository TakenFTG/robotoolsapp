import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { JUDGE_ADVISOR_SINGLETON_ID } from '@robotools.app/protocol/src/access';
import { serverRouter } from '../server-router';
import type { ServerContext } from '../server-router';
import type { Session } from '@robotools.app/wrpc/server/session';
import type { AnyRouter } from '@robotools.app/wrpc/server/router';
import { createTestServerContext, seedTestDatabase } from '../test-utils';
import { Authentication } from '../access/authentication';
import { generateAuthToken, getJudgeAdvisors, resolveClientAuthentication, upsertJudgeAdvisorAuthToken } from '../access/tokens';
import { metadata } from '../db/schema';
import { uuidv4 } from '@robotools.app/protocol/src/utils';

describe('multiple judge advisors', () => {
	let context: ServerContext & { cleanup: () => void };
	let session: Session<AnyRouter>;

	function makeSession(): Session<AnyRouter> {
		return {
			getClient: () => ({ onClientAuthenticationChange: { mutation: async () => undefined } }) as never,
			broadcast: () => ({ onDeviceListUpdate: { mutation: async () => [] } }) as never,
			getServer: () => {
				throw new Error('getServer() cannot be called from server-side session');
			},
			roomId: 'test-room',
			currentClient: { clientId: 'client-1', deviceId: uuidv4(), deviceName: 'Test Device' }
		};
	}

	/** A Judge Advisor context for a given advisor id. */
	function advisorCtx(judgeAdvisorId: string): ServerContext {
		return {
			...context,
			auth: Authentication.withFixture({
				isAccessControlled: true,
				authToken: generateAuthToken(),
				role: 'judge_advisor',
				judgeAdvisorId
			})
		};
	}

	const call = (
		name: 'addJudgeAdvisor' | 'removeJudgeAdvisor' | 'renameJudgeAdvisor' | 'listAccessLinks',
		input: unknown,
		ctx: ServerContext
	) => serverRouter.access[name]._def._resolver!({ input, session, ctx } as never);

	beforeEach(async () => {
		context = createTestServerContext();
		await seedTestDatabase(context);
		session = makeSession();
		await context.db.update(metadata).set({ accessControlEnabled: true });
	});

	afterEach(async () => {
		await new Promise((resolve) => setTimeout(resolve, 10));
		context.cleanup();
	});

	it('adds an advisor with their own link', async () => {
		const added = (await call('addJudgeAdvisor', { name: 'Sam Rivera' }, advisorCtx(JUDGE_ADVISOR_SINGLETON_ID))) as {
			judgeAdvisorId: string;
			authToken: string;
		};

		const advisors = await getJudgeAdvisors(context.db);
		expect(advisors).toHaveLength(2);

		const sam = advisors.find((advisor) => advisor.id === added.judgeAdvisorId);
		expect(sam?.name).toBe('Sam Rivera');
		expect(sam?.authToken).toBe(added.authToken);
		// Distinct credentials — adding a colleague must not share your own link.
		expect(sam?.authToken).not.toBe(advisors.find((a) => a.id === JUDGE_ADVISOR_SINGLETON_ID)?.authToken);
	});

	it('resolves each advisor token to its own identity', async () => {
		const added = (await call('addJudgeAdvisor', { name: 'Sam Rivera' }, advisorCtx(JUDGE_ADVISOR_SINGLETON_ID))) as {
			judgeAdvisorId: string;
			authToken: string;
		};

		const resolved = await resolveClientAuthentication(context.db, added.authToken);
		expect(resolved).toMatchObject({ role: 'judge_advisor', judgeAdvisorId: added.judgeAdvisorId });
	});

	it('rotating a token leaves the other advisors alone', async () => {
		const bobId = uuidv4();
		const bobToken = generateAuthToken();
		await upsertJudgeAdvisorAuthToken(context.db, bobToken, bobId, 'Bob');

		await upsertJudgeAdvisorAuthToken(context.db, generateAuthToken(), JUDGE_ADVISOR_SINGLETON_ID);

		const advisors = await getJudgeAdvisors(context.db);
		expect(advisors.find((a) => a.id === bobId)?.authToken).toBe(bobToken);
	});

	it('renames an advisor', async () => {
		const bobId = uuidv4();
		await upsertJudgeAdvisorAuthToken(context.db, generateAuthToken(), bobId, 'Bob');

		await call('renameJudgeAdvisor', { judgeAdvisorId: bobId, name: 'Roberta' }, advisorCtx(JUDGE_ADVISOR_SINGLETON_ID));

		expect((await getJudgeAdvisors(context.db)).find((a) => a.id === bobId)?.name).toBe('Roberta');
	});

	it('removes another advisor', async () => {
		const bobId = uuidv4();
		await upsertJudgeAdvisorAuthToken(context.db, generateAuthToken(), bobId, 'Bob');

		await call('removeJudgeAdvisor', { judgeAdvisorId: bobId }, advisorCtx(JUDGE_ADVISOR_SINGLETON_ID));

		expect(await getJudgeAdvisors(context.db)).toHaveLength(1);
	});

	it('refuses to remove yourself', async () => {
		const bobId = uuidv4();
		await upsertJudgeAdvisorAuthToken(context.db, generateAuthToken(), bobId, 'Bob');

		await expect(
			call('removeJudgeAdvisor', { judgeAdvisorId: JUDGE_ADVISOR_SINGLETON_ID }, advisorCtx(JUDGE_ADVISOR_SINGLETON_ID))
		).rejects.toThrow(/cannot remove yourself/);
	});

	it('refuses to remove the last advisor', async () => {
		// Only the original advisor exists; removing them would strand the room.
		await expect(call('removeJudgeAdvisor', { judgeAdvisorId: uuidv4() }, advisorCtx(JUDGE_ADVISOR_SINGLETON_ID))).rejects.toThrow(
			/at least one Judge Advisor/
		);
	});

	it('refuses management from a judge', async () => {
		const judgeCtx: ServerContext = {
			...context,
			auth: Authentication.withFixture({
				isAccessControlled: true,
				authToken: generateAuthToken(),
				role: 'judge',
				judgeId: uuidv4()
			})
		};

		await expect(call('addJudgeAdvisor', { name: 'Sam' }, judgeCtx)).rejects.toThrow(/Only the Judge Advisor/);
	});

	it('lists every advisor', async () => {
		const bobId = uuidv4();
		await upsertJudgeAdvisorAuthToken(context.db, generateAuthToken(), bobId, 'Bob');

		const links = (await call('listAccessLinks', undefined, advisorCtx(JUDGE_ADVISOR_SINGLETON_ID))) as {
			judgeAdvisors: { judgeAdvisorId: string; name: string }[];
		};

		expect(links.judgeAdvisors.map((a) => a.judgeAdvisorId).sort()).toEqual([JUDGE_ADVISOR_SINGLETON_ID, bobId].sort());
	});
});
