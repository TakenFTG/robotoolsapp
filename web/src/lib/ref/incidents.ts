import { m } from '$lib/paraglide/messages.js';
import type { Incident, IncidentContext, IncidentSeverity, RefereeRole } from '@robotools.app/protocol/src/ref';

/** What the log form starts with when opened from a team or a match. */
export type IncidentPreset = {
	teamNumber?: string;
	context?: IncidentContext;
	matchId?: number | null;
	matchName?: string | null;
	/** From the Rules tab: start with this rule already chosen. */
	ruleCodes?: string[];
};

/**
 * How bad each severity is, for "worst so far" on a team. Positive sits lowest, so good news
 * never hides a problem. Inspection sits low: it is a robot problem, not conduct.
 */
const SEVERITY_RANK: Record<IncidentSeverity, number> = {
	positive: 0,
	note: 1,
	inspection: 2,
	warning: 3,
	minor: 4,
	major: 5,
	disabled: 6,
	dq: 7
};

export function severityLabel(severity: IncidentSeverity): string {
	switch (severity) {
		case 'positive':
			return m.ref_severity_positive();
		case 'note':
			return m.ref_severity_note();
		case 'warning':
			return m.ref_severity_warning();
		case 'minor':
			return m.ref_severity_minor();
		case 'major':
			return m.ref_severity_major();
		case 'disabled':
			return m.ref_severity_disabled();
		case 'dq':
			return m.ref_severity_dq();
		case 'inspection':
			return m.ref_severity_inspection();
	}
}

export function severityClass(severity: IncidentSeverity): string {
	switch (severity) {
		case 'positive':
			return 'bg-success-container text-on-success-container';
		case 'note':
			return 'bg-surface-container-highest text-on-surface-variant';
		case 'inspection':
			return 'bg-secondary-container text-on-secondary-container';
		case 'warning':
			return 'bg-warning-container text-on-warning-container';
		case 'minor':
			return 'bg-tertiary-container text-on-tertiary-container';
		case 'major':
			return 'bg-error-container text-on-error-container';
		case 'disabled':
			return 'bg-error text-on-error';
		case 'dq':
			return 'bg-inverse-surface text-inverse-on-surface';
	}
}

/** Compare by how bad: positive when `a` is worse than `b`. */
export function compareSeverity(a: IncidentSeverity, b: IncidentSeverity): number {
	return SEVERITY_RANK[a] - SEVERITY_RANK[b];
}

export function worstSeverity(incidents: readonly { severity: IncidentSeverity }[]): IncidentSeverity | null {
	let worst: IncidentSeverity | null = null;
	for (const incident of incidents) {
		if (worst === null || SEVERITY_RANK[incident.severity] > SEVERITY_RANK[worst]) {
			worst = incident.severity;
		}
	}
	return worst;
}

export function incidentsByTeam<T extends { teamNumber: string }>(incidents: readonly T[]): Map<string, T[]> {
	const byTeam = new Map<string, T[]>();
	for (const incident of incidents) {
		const list = byTeam.get(incident.teamNumber) ?? [];
		list.push(incident);
		byTeam.set(incident.teamNumber, list);
	}
	return byTeam;
}

export function canModify(incident: Incident, self: { refereeId: string; role: RefereeRole } | null): boolean {
	return !!self && (self.role === 'head_referee' || incident.authorRefereeId === self.refereeId);
}

/** "Q 12", "Skills · Driver" — where it happened, in the words used at the field. */
export function incidentWhere(incident: Pick<Incident, 'context' | 'skillsRunType' | 'matchName'>): string {
	if (incident.context === 'skills') {
		return incident.skillsRunType === 'programming' ? m.ref_skills_programming() : m.ref_skills_driver();
	}
	return incident.matchName ?? m.ref_match_unspecified();
}

export function formatTime(timestamp: number): string {
	return new Date(timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/** Rule codes as the game manual writes them. */
export function formatRule(code: string): string {
	return `<${code}>`;
}

function csvCell(value: string): string {
	return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Every incident as CSV, oldest first, for the Head Ref to keep after the event. */
export function incidentsToCsv(incidents: readonly Incident[]): string {
	const header = ['Time', 'Team', 'Where', 'Rules', 'Severity', 'Note', 'Private', 'Logged by'];
	const rows = [...incidents]
		.sort((a, b) => a.createdAt - b.createdAt)
		.map((incident) => [
			new Date(incident.createdAt).toISOString(),
			incident.teamNumber,
			incidentWhere(incident),
			incident.ruleCodes.map(formatRule).join(' '),
			severityLabel(incident.severity),
			incident.note,
			incident.private ? 'Yes' : 'No',
			incident.authorName
		]);
	return [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\n');
}
