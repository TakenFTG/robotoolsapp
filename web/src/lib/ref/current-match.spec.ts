import { describe, expect, it } from 'vitest';
import { currentMatchIndex, LATE_GRACE_MS } from './current-match';

const at = (minutes: number) => new Date(Date.UTC(2026, 10, 21, 9, minutes)).toISOString();
const now = Date.parse(at(30));

describe('currentMatchIndex', () => {
	it('picks the match after the last scored one', () => {
		const rows = [0, 5, 10, 15].map((minute, index) => ({ scored: index < 2, scheduledAt: at(minute) }));
		expect(currentMatchIndex(rows, true, now)).toBe(2);
	});

	it('trusts results over the clock when the field runs behind', () => {
		const rows = [0, 5, 10, 15].map((minute, index) => ({ scored: index < 1, scheduledAt: at(minute) }));
		expect(currentMatchIndex(rows, true, now)).toBe(1);
	});

	it('picks the first match when played ones are hidden and results are syncing', () => {
		const rows = [20, 25].map((minute) => ({ scored: false, scheduledAt: at(minute) }));
		expect(currentMatchIndex(rows, true, now)).toBe(0);
	});

	it('falls back to the clock, with grace for a late field, when nothing is scored', () => {
		const rows = [0, 10, 16, 20, 40].map((minute) => ({ scored: false, scheduledAt: at(minute) }));
		// 09:16 is 14 minutes ago, inside the grace window; 09:10 is 20 minutes ago.
		expect(LATE_GRACE_MS).toBe(15 * 60_000);
		expect(currentMatchIndex(rows, false, now)).toBe(2);
	});

	it('treats an unscheduled match as still to come', () => {
		const rows = [
			{ scored: false, scheduledAt: at(0) },
			{ scored: false, scheduledAt: null }
		];
		expect(currentMatchIndex(rows, false, now)).toBe(1);
	});

	it('returns -1 when every match is over', () => {
		expect(currentMatchIndex([{ scored: true, scheduledAt: at(0) }], true, now)).toBe(-1);
		expect(currentMatchIndex([{ scored: false, scheduledAt: at(0) }], false, now)).toBe(-1);
		expect(currentMatchIndex([], false, now)).toBe(-1);
	});
});
