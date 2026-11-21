import { and, desc, eq, gt, inArray, lt, type SQL } from 'drizzle-orm';
import {
	AuditDetailsSchema,
	AuditEntrySchema,
	type AuditAction,
	type AuditActorRole,
	type AuditDetails,
	type AuditEntry,
	type AuditLogPage,
	type AuditLogQuery,
	type AuditLogUpdate
} from '@robotools.app/protocol/src/audit';
import { auditLog, judgeAdvisors, judgeGroups, judges, offlineDevices, teams } from '../db/schema';
import type { DatabaseOrTransaction } from '../server-router';
import type { Authentication } from '../access/authentication';
import { broadcastTopic, type ClientSource } from '../routes/subscriptions';

/** The subscription topic Judge Advisors' Activity views listen on. */
export const AUDIT_LOG_TOPIC = 'auditLog';

/** How long repeats of the same change by the same person fold into one entry. */
export const AUDIT_COALESCE_MS = 60_000;

export type AuditActor = {
	role: AuditActorRole | null;
	id: string | null;
	name: string | null;
	verified: boolean;
};

export type AuditDevice = { deviceId: string; deviceName: string };

/** The parts of a WRPC session the log reads. Tests and HTTP callers can supply their own. */
export type AuditSession = { currentClient?: { deviceId: string; deviceName: string } };

export type AuditWrite = {
	action: AuditAction;
	teamId?: string | null;
	awardName?: string | null;
	details?: AuditDetails;
	/**
	 * Merge with this person's last entry carrying the same key, if it is recent. The
	 * earlier entry's `before` is kept, so a run of changes reads as first value → last.
	 */
	coalesceKey?: string;
};

export async function getJudgeName(db: DatabaseOrTransaction, judgeId: string): Promise<string | null> {
	const [row] = await db.select({ name: judges.name }).from(judges).where(eq(judges.id, judgeId)).limit(1);
	return row?.name ?? null;
}

export async function getJudgeGroupName(db: DatabaseOrTransaction, judgeGroupId: string | null): Promise<string | null> {
	if (!judgeGroupId) {
		return null;
	}
	const [row] = await db.select({ name: judgeGroups.name }).from(judgeGroups).where(eq(judgeGroups.id, judgeGroupId)).limit(1);
	return row?.name ?? null;
}

/**
 * Who is making this request.
 *
 * The connection's access link when there is one. Without access control the server has
 * only the device's word, so `claimedJudgeId` (the judge a rubric says it is from) is used
 * and marked unverified.
 */
export async function resolveAuditActor(
	db: DatabaseOrTransaction,
	auth: Authentication,
	claimedJudgeId: string | null = null
): Promise<AuditActor> {
	const judgeId = auth.getJudgeId();
	if (judgeId) {
		return { role: 'judge', id: judgeId, name: await getJudgeName(db, judgeId), verified: true };
	}

	const judgeAdvisorId = auth.getJudgeAdvisorId();
	if (judgeAdvisorId) {
		// A group's advisors are administered at the group, so the room has no row for them.
		const [row] = await db.select({ name: judgeAdvisors.name }).from(judgeAdvisors).where(eq(judgeAdvisors.id, judgeAdvisorId)).limit(1);
		return { role: 'judge_advisor', id: judgeAdvisorId, name: row?.name ?? null, verified: true };
	}

	if (claimedJudgeId) {
		return { role: 'judge', id: claimedJudgeId, name: await getJudgeName(db, claimedJudgeId), verified: false };
	}

	return { role: null, id: null, name: null, verified: false };
}

export function sessionDevice(session: AuditSession): AuditDevice {
	return {
		deviceId: session.currentClient?.deviceId ?? '',
		deviceName: session.currentClient?.deviceName ?? ''
	};
}

/** A device's last known name, for callers that only have its id. */
export async function getDeviceName(db: DatabaseOrTransaction, deviceId: string): Promise<string> {
	const [row] = await db
		.select({ deviceName: offlineDevices.deviceName })
		.from(offlineDevices)
		.where(eq(offlineDevices.deviceId, deviceId))
		.limit(1);
	return row?.deviceName ?? '';
}

type AuditRow = typeof auditLog.$inferSelect;

function toEntry(row: AuditRow): AuditEntry {
	const details = AuditDetailsSchema.safeParse(row.details);
	return AuditEntrySchema.parse({
		id: row.id,
		timestamp: row.timestamp,
		actorRole: row.actorRole,
		actorId: row.actorId,
		actorName: row.actorName,
		verified: row.verified,
		deviceId: row.deviceId,
		deviceName: row.deviceName,
		action: row.action,
		teamId: row.teamId,
		teamNumber: row.teamNumber,
		awardName: row.awardName,
		details: details.success ? details.data : {}
	});
}

/**
 * Write one entry with an actor and device already in hand.
 *
 * Call inside the same transaction as the change it describes, so the log can neither
 * claim something that rolled back nor miss something that committed. Returns what to
 * announce once that transaction has committed.
 */
export async function writeAudit(
	db: DatabaseOrTransaction,
	actor: AuditActor,
	device: AuditDevice,
	write: AuditWrite,
	now: number = Date.now()
): Promise<AuditLogUpdate> {
	let teamNumber: string | null = null;
	if (write.teamId) {
		const [team] = await db.select({ number: teams.number }).from(teams).where(eq(teams.id, write.teamId)).limit(1);
		teamNumber = team?.number ?? null;
	}

	let details: AuditDetails = write.details ?? {};
	let replacesId: number | null = null;

	if (write.coalesceKey) {
		// Match on the person when known, else the device, so two judges ranking the same
		// team never merge into one entry.
		const who = actor.id ? eq(auditLog.actorId, actor.id) : eq(auditLog.deviceId, device.deviceId);
		const [previous] = await db
			.select()
			.from(auditLog)
			.where(
				and(
					eq(auditLog.coalesceKey, write.coalesceKey),
					eq(auditLog.action, write.action),
					who,
					gt(auditLog.timestamp, now - AUDIT_COALESCE_MS)
				)
			)
			.orderBy(desc(auditLog.id))
			.limit(1);

		if (previous) {
			const previousDetails = AuditDetailsSchema.safeParse(previous.details);
			if (previousDetails.success && 'before' in previousDetails.data) {
				details = { ...details, before: previousDetails.data.before };
			}
			// Replaced rather than updated so the log stays in id order, which is what paging
			// relies on.
			await db.delete(auditLog).where(eq(auditLog.id, previous.id));
			replacesId = previous.id;
		}
	}

	const [row] = await db
		.insert(auditLog)
		.values({
			timestamp: now,
			actorRole: actor.role,
			actorId: actor.id,
			actorName: actor.name,
			verified: actor.verified,
			deviceId: device.deviceId,
			deviceName: device.deviceName,
			action: write.action,
			teamId: write.teamId ?? null,
			teamNumber,
			awardName: write.awardName ?? null,
			details,
			coalesceKey: write.coalesceKey ?? null
		})
		.returning();

	return { entry: toEntry(row!), replacesId };
}

/** Write one entry for a request: resolve who is asking, then record. */
export async function recordAudit(
	db: DatabaseOrTransaction,
	auth: Authentication,
	session: AuditSession,
	write: AuditWrite,
	claimedJudgeId: string | null = null
): Promise<AuditLogUpdate> {
	const actor = await resolveAuditActor(db, auth, claimedJudgeId);
	return writeAudit(db, actor, sessionDevice(session), write);
}

/**
 * Tell open Activity views about new entries. Not awaited by callers: the change has
 * already committed, and a slow socket must not hold up the reply.
 */
export function announceAudit(db: DatabaseOrTransaction, source: ClientSource, updates: readonly AuditLogUpdate[]): void {
	if (updates.length === 0) {
		return;
	}
	void broadcastTopic(db, AUDIT_LOG_TOPIC, source, async (client) => {
		for (const update of updates) {
			await client.onAuditLogUpdate.mutation(update);
		}
	}).catch((error: unknown) => {
		console.error('Failed to announce activity log entries:', error);
	});
}

/** A page of the log, newest first. */
export async function getAuditLog(db: DatabaseOrTransaction, query: AuditLogQuery): Promise<AuditLogPage> {
	const limit = query.limit ?? 100;
	const conditions: SQL[] = [];
	if (query.beforeId !== undefined) {
		conditions.push(lt(auditLog.id, query.beforeId));
	}
	if (query.actorId) {
		conditions.push(eq(auditLog.actorId, query.actorId));
	}
	if (query.teamId) {
		conditions.push(eq(auditLog.teamId, query.teamId));
	}
	if (query.actions && query.actions.length > 0) {
		conditions.push(inArray(auditLog.action, query.actions));
	}

	const rows = await db
		.select()
		.from(auditLog)
		.where(conditions.length > 0 ? and(...conditions) : undefined)
		.orderBy(desc(auditLog.id))
		.limit(limit + 1);

	return {
		entries: rows.slice(0, limit).map(toEntry),
		hasMore: rows.length > limit
	};
}
