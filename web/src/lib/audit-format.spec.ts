import { describe, expect, it } from 'vitest';
import type { AuditEntry } from '@robotools.app/protocol/src/audit';
import { AuditActionSchema } from '@robotools.app/protocol/src/audit';
import { AUDIT_ACTION_GROUPS, auditEntriesToCsv, describeAuditEntry } from './audit-format';

function entry(overrides: Partial<AuditEntry> = {}): AuditEntry {
	return {
		id: 1,
		timestamp: Date.UTC(2026, 10, 21, 9, 30),
		actorRole: 'judge',
		actorId: 'judge-1',
		actorName: 'Ada Judge',
		verified: true,
		deviceId: 'device-1',
		deviceName: 'Tablet 3',
		action: 'team_data_changed',
		teamId: 'team-1',
		teamNumber: '1234A',
		awardName: null,
		details: { field: 'hasSeasonSummary', before: false, after: true },
		...overrides
	};
}

describe('describeAuditEntry', () => {
	it('says Season Summary was ticked or unticked', () => {
		expect(describeAuditEntry(entry())).toBe('Ticked Season Summary for 1234A');
		expect(describeAuditEntry(entry({ details: { field: 'hasSeasonSummary', before: true, after: false } }))).toBe(
			'Unticked Season Summary for 1234A'
		);
	});

	it('shows an unset rank as none', () => {
		expect(
			describeAuditEntry(entry({ action: 'award_ranking_changed', awardName: 'Design Award', details: { before: 0, after: 3 } }))
		).toBe('Changed the Design Award ranking for 1234A from none to 3');
	});
});

describe('AUDIT_ACTION_GROUPS', () => {
	it('puts every action in exactly one filter group', () => {
		const grouped = Object.values(AUDIT_ACTION_GROUPS).flat();
		expect([...grouped].sort()).toEqual([...AuditActionSchema.options].sort());
	});
});

describe('auditEntriesToCsv', () => {
	it('writes oldest first', () => {
		const csv = auditEntriesToCsv([entry({ id: 2, teamNumber: '2B' }), entry({ id: 1, teamNumber: '1A' })]);
		const lines = csv.split('\n');
		expect(lines[1]).toContain('1A');
		expect(lines[2]).toContain('2B');
	});

	it('stops a typed name being read as a spreadsheet formula', () => {
		const csv = auditEntriesToCsv([entry({ actorName: '=HYPERLINK("x")' })]);
		expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
	});
});
