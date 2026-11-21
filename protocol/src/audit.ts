import z from 'zod';

/**
 * The activity log: who did what in a Judges' Room, and when.
 *
 * Written by the server alongside the change it describes, never by a client, so a device
 * cannot add, edit or remove entries. Readable by Judge Advisors only.
 *
 * Entries keep a copy of the names they mention (the judge, the team number) as they were
 * at the time. A judge removed later, or a team renumbered, still reads correctly here,
 * which is the whole point of a record.
 */

export const AuditActionSchema = z.enum([
	'notebook_rubric_submitted',
	'notebook_rubric_edited',
	'notebook_rubric_deleted',
	'interview_rubric_submitted',
	'interview_rubric_edited',
	'interview_rubric_deleted',
	'interview_notes_saved',
	'team_data_changed',
	'team_flagged',
	'team_unflagged',
	'award_ranking_changed',
	'final_nomination_added',
	'final_nomination_removed',
	'final_ranking_changed',
	'award_deliberation_started',
	'photo_uploaded',
	'photo_deleted',
	'judge_added',
	'judge_updated',
	'judge_removed',
	'lead_judge_changed',
	'judge_link_rotated',
	'judge_advisor_added',
	'judge_advisor_removed',
	'device_kicked',
	'judge_groups_changed',
	'event_setup_changed'
]);
export type AuditAction = z.infer<typeof AuditActionSchema>;

/** The team fields a change to team data is recorded for. */
export const AuditTeamFieldSchema = z.enum([
	'hasSeasonSummary',
	'notebookDevelopmentStatus',
	'notebookLink',
	'hasInnovateAwardSubmissionForm',
	'absent'
]);
export type AuditTeamField = z.infer<typeof AuditTeamFieldSchema>;

const AuditValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);

/**
 * What an entry says beyond its action. Every field is optional; which ones are present
 * depends on the action.
 */
export const AuditDetailsSchema = z.object({
	/** Rubric total. */
	score: z.number().nullable().optional(),
	/** The judge who wrote a rubric, when that is not the person who acted on it. */
	authorName: z.string().nullable().optional(),
	judgeGroupName: z.string().nullable().optional(),
	/** For team_data_changed. */
	field: AuditTeamFieldSchema.optional(),
	before: AuditValueSchema.optional(),
	after: AuditValueSchema.optional(),
	/** A screening reason, a judge's name, a device's name: whatever the action is about. */
	note: z.string().optional(),
	name: z.string().optional(),
	/** For final_ranking_changed: the order afterwards. */
	teamNumbers: z.array(z.string()).optional()
});
export type AuditDetails = z.infer<typeof AuditDetailsSchema>;

/**
 * Who acted.
 *
 * `verified` is true when the identity comes from the access link the device connected
 * with. With access control off the server cannot tell people apart, so a judge named here
 * is only the one the device said it was working as, and the device is the reliable part.
 */
export const AuditActorRoleSchema = z.enum(['judge_advisor', 'judge']);
export type AuditActorRole = z.infer<typeof AuditActorRoleSchema>;

export const AuditEntrySchema = z.object({
	id: z.number().int(),
	timestamp: z.number().int(),
	actorRole: AuditActorRoleSchema.nullable(),
	actorId: z.string().nullable(),
	actorName: z.string().nullable(),
	verified: z.boolean(),
	deviceId: z.string(),
	deviceName: z.string(),
	action: AuditActionSchema,
	teamId: z.string().nullable(),
	teamNumber: z.string().nullable(),
	awardName: z.string().nullable(),
	details: AuditDetailsSchema
});
export type AuditEntry = z.infer<typeof AuditEntrySchema>;

/** Sent to subscribers when an entry is written. `replacesId` is an entry it supersedes. */
export const AuditLogUpdateSchema = z.object({
	entry: AuditEntrySchema,
	replacesId: z.number().int().nullable()
});
export type AuditLogUpdate = z.infer<typeof AuditLogUpdateSchema>;

export const AUDIT_LOG_PAGE_MAX = 500;

export const AuditLogQuerySchema = z.object({
	/** Return entries older than this id. Omit for the newest. */
	beforeId: z.number().int().optional(),
	limit: z.number().int().min(1).max(AUDIT_LOG_PAGE_MAX).default(100),
	actorId: z.string().optional(),
	teamId: z.string().optional(),
	actions: z.array(AuditActionSchema).optional()
});
export type AuditLogQuery = z.input<typeof AuditLogQuerySchema>;

export const AuditLogPageSchema = z.object({
	entries: z.array(AuditEntrySchema),
	hasMore: z.boolean()
});
export type AuditLogPage = z.infer<typeof AuditLogPageSchema>;

/** Whether an entry passes the filters a query was made with. */
export function matchesAuditQuery(entry: AuditEntry, query: Pick<AuditLogQuery, 'actorId' | 'teamId' | 'actions'>): boolean {
	if (query.actorId && entry.actorId !== query.actorId) {
		return false;
	}
	if (query.teamId && entry.teamId !== query.teamId) {
		return false;
	}
	if (query.actions && query.actions.length > 0 && !query.actions.includes(entry.action)) {
		return false;
	}
	return true;
}
