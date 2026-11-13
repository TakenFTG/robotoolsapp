import { describe, it, expect } from 'vitest';
import type { Incident } from '@robotools.app/protocol/src/ref';
import { canModify, incidentsToCsv, worstSeverity } from './incidents';
import { parseRefLink } from './ref-app.svelte';

function incident(overrides: Partial<Incident>): Incident {
	return {
		id: crypto.randomUUID(),
		context: 'match',
		teamNumber: '1234A',
		matchId: 1,
		matchName: 'Q 1',
		skillsRunType: null,
		ruleCodes: [],
		severity: 'note',
		note: '',
		private: false,
		authorRefereeId: 'ref-1',
		authorName: 'Ray',
		createdAt: 1,
		updatedAt: 1,
		...overrides
	};
}

describe('ref incidents', () => {
	it('ranks a positive note below everything else', () => {
		expect(worstSeverity([incident({ severity: 'positive' }), incident({ severity: 'note' })])).toBe('note');
		expect(worstSeverity([incident({ severity: 'positive' })])).toBe('positive');
	});

	it('ranks a DQ above a disablement above a major, and an inspection below a warning', () => {
		expect(worstSeverity([incident({ severity: 'major' }), incident({ severity: 'dq' }), incident({ severity: 'disabled' })])).toBe('dq');
		expect(worstSeverity([incident({ severity: 'inspection' }), incident({ severity: 'warning' })])).toBe('warning');
		expect(worstSeverity([])).toBeNull();
	});

	it('lets the author or any Head Ref change an incident', () => {
		const item = incident({ authorRefereeId: 'ref-1' });
		expect(canModify(item, { refereeId: 'ref-1', role: 'referee' })).toBe(true);
		expect(canModify(item, { refereeId: 'ref-2', role: 'referee' })).toBe(false);
		expect(canModify(item, { refereeId: 'ref-2', role: 'head_referee' })).toBe(true);
		expect(canModify(item, null)).toBe(false);
	});

	it('quotes commas, quotes and newlines in the CSV, oldest first', () => {
		const csv = incidentsToCsv([
			incident({ createdAt: 2000, note: 'Second' }),
			incident({ createdAt: 1000, note: 'Said "no", then\nleft', ruleCodes: ['SG6', 'G1'] })
		]);
		const lines = csv.split('\n');
		expect(lines[0]).toBe('Time,Team,Where,Rules,Severity,Note,Private,Logged by');
		expect(csv).toContain('"Said ""no"", then\nleft"');
		expect(csv).toContain('<SG6> <G1>');
		expect(csv.indexOf('Said')).toBeLessThan(csv.indexOf('Second'));
	});
});

describe('parseRefLink', () => {
	const roomId = '6f1c2a4e-9b7d-4c3e-8a2f-1d5e6b7c8a9f';

	it('reads a full link and a bare query string', () => {
		expect(parseRefLink(`https://judging.example.com/ref?roomId=${roomId}&auth=abcDEF123456`)).toEqual({
			roomId,
			authToken: 'abcDEF123456'
		});
		expect(parseRefLink(`?roomId=${roomId}&auth=abcDEF123456`)).toEqual({ roomId, authToken: 'abcDEF123456' });
	});

	it('rejects anything that is not a well-formed ref link', () => {
		expect(parseRefLink('hello')).toBeNull();
		expect(parseRefLink(`https://x/ref?roomId=${roomId}`)).toBeNull();
		expect(parseRefLink('https://x/ref?roomId=not-a-uuid&auth=abcDEF123456')).toBeNull();
		expect(parseRefLink(`https://x/ref?roomId=${roomId}&auth=short`)).toBeNull();
	});
});
