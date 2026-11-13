import {
	AuthTokenSchema,
	JUDGE_ADVISOR_SINGLETON_ID,
	generateAuthToken,
	type AuthToken,
	type ClientAuthentication
} from '@robotools.app/protocol/src/access';
import { eq } from 'drizzle-orm';
import { WRPCError } from '@robotools.app/wrpc/server/types';
import { judgeAdvisors, judges } from '../db/schema';
import type { DatabaseOrTransaction } from '../server-router';
import type { Authentication } from './authentication';

export { generateAuthToken, JUDGE_ADVISOR_SINGLETON_ID };

export type JudgeAdvisorRecord = {
	id: string;
	name: string;
	authToken: string;
	email: string | null;
};

export async function getJudgeAdvisors(db: DatabaseOrTransaction): Promise<JudgeAdvisorRecord[]> {
	const rows = await db
		.select({
			id: judgeAdvisors.id,
			name: judgeAdvisors.name,
			authToken: judgeAdvisors.authToken,
			email: judgeAdvisors.email
		})
		.from(judgeAdvisors);

	return rows;
}

export async function countJudgeAdvisors(db: DatabaseOrTransaction): Promise<number> {
	return (await db.select({ id: judgeAdvisors.id }).from(judgeAdvisors)).length;
}

/** The access token of a specific Judge Advisor. */
export async function getJudgeAdvisorAuthToken(
	db: DatabaseOrTransaction,
	judgeAdvisorId = JUDGE_ADVISOR_SINGLETON_ID
): Promise<string | null> {
	const [row] = await db
		.select({ authToken: judgeAdvisors.authToken })
		.from(judgeAdvisors)
		.where(eq(judgeAdvisors.id, judgeAdvisorId))
		.limit(1);
	return row?.authToken ?? null;
}

/**
 * Create or update one Judge Advisor's access token.
 * Defaults to the room's original advisor so existing callers keep their meaning.
 */
export async function upsertJudgeAdvisorAuthToken(
	db: DatabaseOrTransaction,
	authToken: AuthToken,
	judgeAdvisorId = JUDGE_ADVISOR_SINGLETON_ID,
	name = 'Judge Advisor',
	email: string | null = null
): Promise<void> {
	await db
		.insert(judgeAdvisors)
		.values({ id: judgeAdvisorId, name, authToken, email })
		.onConflictDoUpdate({
			target: [judgeAdvisors.id],
			// Deliberately does not touch name or email: rotating a token must not rename
			// the advisor or drop the address their next link would be sent to.
			set: { authToken }
		});
}

/** Record, change or clear where an advisor's link is emailed. Returns false if unknown. */
export async function setJudgeAdvisorEmail(db: DatabaseOrTransaction, judgeAdvisorId: string, email: string | null): Promise<boolean> {
	const updated = await db.update(judgeAdvisors).set({ email }).where(eq(judgeAdvisors.id, judgeAdvisorId)).returning();
	return updated.length > 0;
}

export async function resolveClientAuthentication(
	db: DatabaseOrTransaction,
	auth: string
): Promise<Extract<ClientAuthentication, { isAccessControlled: true }> | null> {
	const parsed = AuthTokenSchema.safeParse(auth);
	if (!parsed.success) {
		return null;
	}

	const [advisor] = await db.select({ id: judgeAdvisors.id }).from(judgeAdvisors).where(eq(judgeAdvisors.authToken, parsed.data)).limit(1);

	if (advisor) {
		return { isAccessControlled: true, authToken: parsed.data, role: 'judge_advisor', judgeAdvisorId: advisor.id };
	}

	const [judge] = await db.select({ id: judges.id }).from(judges).where(eq(judges.authToken, parsed.data)).limit(1);
	if (judge) {
		return { isAccessControlled: true, authToken: parsed.data, role: 'judge', judgeId: judge.id };
	}

	return null;
}

export function assertAuthenticatedJudgeAdvisor(auth: Authentication): void {
	if (!auth.isAuthenticatedJudgeAdvisor()) {
		throw new WRPCError('CRITICAL: Only the Judge Advisor with access control enabled can perform this action');
	}
}

/**
 * Bound judges must match payload judgeId (null only allowed for JA / uncontrolled).
 * Does not require authentication when AC is on — that is guaranteed by authorizeConnect
 * plus kicking all other clients when AC is toggled (see essential.updateEssentialData).
 * Rubric row authorship is also enforced at write time via ON CONFLICT … setWhere + RETURNING.
 */
export function assertAuthorship(auth: Authentication, submissionJudgeId: string | null): void {
	const judgeId = auth.getJudgeId();
	if (auth.isAuthenticatedJudge() && judgeId && submissionJudgeId !== judgeId) {
		throw new WRPCError('CRITICAL: The authenticated identity does not match the submission judge');
	}
}
