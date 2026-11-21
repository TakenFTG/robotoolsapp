import { m } from '$lib/paraglide/messages.js';
import type { AuditAction, AuditEntry } from '@robotools.app/protocol/src/audit';
import type { NotebookDevelopmentStatus } from '@robotools.app/protocol/src/team';

/** How the Activity view groups actions for its Type filter. */
export const AUDIT_ACTION_GROUPS = {
	rubrics: [
		'notebook_rubric_submitted',
		'notebook_rubric_edited',
		'notebook_rubric_deleted',
		'interview_rubric_submitted',
		'interview_rubric_edited',
		'interview_rubric_deleted',
		'interview_notes_saved'
	],
	teams: ['team_data_changed', 'team_flagged', 'team_unflagged', 'photo_uploaded', 'photo_deleted'],
	awards: ['award_ranking_changed', 'final_nomination_added', 'final_nomination_removed', 'final_ranking_changed'],
	people: [
		'judge_added',
		'judge_updated',
		'judge_removed',
		'lead_judge_changed',
		'judge_link_rotated',
		'judge_advisor_added',
		'judge_advisor_removed',
		'device_kicked'
	],
	event: ['award_deliberation_started', 'judge_groups_changed', 'event_setup_changed']
} as const satisfies Record<string, readonly AuditAction[]>;

export type AuditActionGroup = keyof typeof AUDIT_ACTION_GROUPS;

export function auditActionGroupLabel(group: AuditActionGroup): string {
	switch (group) {
		case 'rubrics':
			return m.activity_type_rubrics();
		case 'teams':
			return m.activity_type_teams();
		case 'awards':
			return m.activity_type_awards();
		case 'people':
			return m.activity_type_people();
		case 'event':
			return m.activity_type_event();
	}
}

function notebookStatusLabel(status: unknown): string {
	switch (status as NotebookDevelopmentStatus) {
		case 'fully_developed':
			return m.fully_developed_notebook_status();
		case 'developing':
			return m.developing_notebook_status();
		case 'not_submitted':
			return m.not_submitted_notebook_status();
		default:
			return m.undetermined_notebook_status();
	}
}

function rankLabel(rank: unknown): string {
	return typeof rank === 'number' && rank > 0 ? String(rank) : m.activity_rank_none();
}

/** Who acted, as one line. */
export function auditActorLabel(entry: AuditEntry): string {
	if (entry.actorName) {
		return entry.actorName;
	}
	if (entry.actorRole === 'judge_advisor') {
		return m.activity_judge_advisor();
	}
	// With access control off a Judge Advisor's device is anonymous; its name is the only
	// thing the server knows, so say that rather than "Unknown".
	return entry.deviceName || m.activity_unknown_person();
}

/** What happened, as a sentence. */
export function describeAuditEntry(entry: AuditEntry): string {
	const team = entry.teamNumber ?? m.activity_unknown_team();
	const award = entry.awardName ?? '';
	const d = entry.details;
	const name = d.name ?? '';

	switch (entry.action) {
		case 'notebook_rubric_submitted':
			return m.activity_notebook_rubric_submitted({ team });
		case 'notebook_rubric_edited':
			return m.activity_notebook_rubric_edited({ team });
		case 'notebook_rubric_deleted':
			return m.activity_notebook_rubric_deleted({ team });
		case 'interview_rubric_submitted':
			return m.activity_interview_rubric_submitted({ team });
		case 'interview_rubric_edited':
			return m.activity_interview_rubric_edited({ team });
		case 'interview_rubric_deleted':
			return m.activity_interview_rubric_deleted({ team });
		case 'interview_notes_saved':
			return m.activity_interview_notes_saved({ team });
		case 'team_data_changed':
			switch (d.field) {
				case 'hasSeasonSummary':
					return d.after ? m.activity_season_summary_on({ team }) : m.activity_season_summary_off({ team });
				case 'notebookDevelopmentStatus':
					return m.activity_notebook_status_changed({
						team,
						before: notebookStatusLabel(d.before),
						after: notebookStatusLabel(d.after)
					});
				case 'notebookLink':
					return m.activity_notebook_link_changed({ team });
				case 'hasInnovateAwardSubmissionForm':
					return d.after ? m.activity_innovate_form_on({ team }) : m.activity_innovate_form_off({ team });
				case 'absent':
					return d.after ? m.activity_absent_on({ team }) : m.activity_absent_off({ team });
				default:
					return team;
			}
		case 'team_flagged':
			return m.activity_team_flagged({ team });
		case 'team_unflagged':
			return m.activity_team_unflagged({ team });
		case 'award_ranking_changed':
			return m.activity_award_ranking_changed({ team, award, before: rankLabel(d.before), after: rankLabel(d.after) });
		case 'final_nomination_added':
			return m.activity_final_nomination_added({ team, award });
		case 'final_nomination_removed':
			return m.activity_final_nomination_removed({ team, award });
		case 'final_ranking_changed':
			return m.activity_final_ranking_changed({ award });
		case 'award_deliberation_started':
			return m.activity_award_deliberation_started();
		case 'photo_uploaded':
			return m.activity_photo_uploaded({ team });
		case 'photo_deleted':
			return m.activity_photo_deleted({ team });
		case 'judge_added':
			return m.activity_judge_added({ name });
		case 'judge_updated':
			return typeof d.before === 'string' && typeof d.after === 'string'
				? m.activity_judge_renamed({ before: d.before, after: d.after })
				: m.activity_judge_updated({ name });
		case 'judge_removed':
			return m.activity_judge_removed({ name });
		case 'lead_judge_changed':
			return d.after ? m.activity_lead_judge_on({ name }) : m.activity_lead_judge_off({ name });
		case 'judge_link_rotated':
			return m.activity_judge_link_rotated({ name });
		case 'judge_advisor_added':
			return m.activity_judge_advisor_added({ name });
		case 'judge_advisor_removed':
			return m.activity_judge_advisor_removed({ name });
		case 'device_kicked':
			return m.activity_device_kicked({ name });
		case 'judge_groups_changed':
			return m.activity_judge_groups_changed();
		case 'event_setup_changed':
			if (d.before !== undefined && d.after !== undefined && d.before !== d.after) {
				return d.after ? m.activity_access_control_on() : m.activity_access_control_off();
			}
			return m.activity_event_setup_changed();
	}
}

/** The smaller print under the sentence: score, author, group, a flag's reason, a new order. */
export function auditEntryExtras(entry: AuditEntry): string[] {
	const d = entry.details;
	const extras: string[] = [];
	if (typeof d.score === 'number') {
		extras.push(m.activity_score({ score: d.score }));
	}
	if (d.authorName) {
		extras.push(m.activity_written_by({ author: d.authorName }));
	}
	if (d.judgeGroupName) {
		extras.push(d.judgeGroupName);
	}
	if (d.note) {
		extras.push(d.note);
	}
	if (d.teamNumbers && d.teamNumbers.length > 0) {
		extras.push(d.teamNumbers.join(' › '));
	}
	if (entry.action === 'team_data_changed' && d.field === 'notebookLink' && typeof d.after === 'string' && d.after) {
		extras.push(d.after);
	}
	return extras;
}

/**
 * A cell that is safe to open in a spreadsheet.
 *
 * Names and notes are typed by people in the room, and a spreadsheet treats a cell that
 * starts with `=`, `+`, `-` or `@` as a formula. Prefixing those with an apostrophe keeps
 * an exported record a record.
 */
function csvCell(value: string): string {
	const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
	return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** The log as CSV, oldest first, for keeping after the event. */
export function auditEntriesToCsv(entries: readonly AuditEntry[]): string {
	const header = ['Time', 'Who', 'Role', 'Verified', 'Device', 'Action', 'Team', 'Award', 'Description', 'Details'];
	const rows = [...entries]
		.sort((a, b) => a.id - b.id)
		.map((entry) => [
			new Date(entry.timestamp).toISOString(),
			auditActorLabel(entry),
			entry.actorRole ?? '',
			entry.verified ? 'Yes' : 'No',
			entry.deviceName,
			entry.action,
			entry.teamNumber ?? '',
			entry.awardName ?? '',
			describeAuditEntry(entry),
			auditEntryExtras(entry).join('; ')
		]);
	return [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\n');
}
