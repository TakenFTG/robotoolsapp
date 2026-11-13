import { describe, it, expect } from 'vitest';
import type { MatchSummary } from '@robotools.app/protocol/src/matches';
import { freeTime, matchTime, projectMatchTimes, type FreeTimeOptions } from './free-time';

const MIN = 60 * 1000;
const utcDay = (time: number) => new Date(time).toISOString().slice(0, 10);

/** hh:mm UTC on 2026-10-31 (or another day), as an ISO string. */
function at(hhmm: string, day = '2026-10-31'): string {
	return `${day}T${hhmm}:00.000Z`;
}
/** The same, in milliseconds. */
function ms(hhmm: string, day?: string): number {
	return new Date(at(hhmm, day)).getTime();
}

let nextId = 1;
function match(name: string, time: string, red: string[], blue: string[], extra: Partial<MatchSummary> = {}): MatchSummary {
	const id = nextId++;
	return {
		id,
		name,
		round: 2,
		matchnum: id,
		field: 'Field 1',
		scheduledAt: time,
		startedAt: null,
		scored: false,
		red: { score: 0, teamNumbers: red },
		blue: { score: 0, teamNumbers: blue },
		...extra
	};
}

/**
 * Other teams playing every five minutes from `from` to `to`, so the hall is never idle and
 * nothing in a test reads as a schedule break unless it means to.
 */
function filler(from: string, to: string, day?: string): MatchSummary[] {
	const result: MatchSummary[] = [];
	for (let time = ms(from, day); time <= ms(to, day); time += 5 * MIN) {
		result.push(match(`F ${result.length + 1}`, new Date(time).toISOString(), ['F1'], ['F2']));
	}
	return result;
}

const opts = (now = ms('00:00')): FreeTimeOptions => ({ now, dayKey: utcDay });
const teamOf = (matches: MatchSummary[], team: string, now?: number) => freeTime(matches, [team], opts(now)).teams.get(team);

describe('matchTime', () => {
	it('prefers the actual start over the schedule', () => {
		expect(matchTime(match('Q 1', at('09:00'), [], [], { startedAt: at('09:20') }))).toBe(ms('09:20'));
	});

	it('is null for a match with no time', () => {
		expect(matchTime(match('Q 1', '', [], [], { scheduledAt: null }))).toBeNull();
	});
});

describe('free windows', () => {
	// The hall runs 09:00–12:00, so the day spans 08:50–12:05.
	const day = () => filler('09:00', '12:00');
	const schedule = () => [
		...day(),
		match('Q 1', at('09:00'), ['1A'], ['2A']),
		match('Q 2', at('09:25'), ['1A'], ['3A']),
		match('Q 3', at('11:00'), ['1A'], ['3A']),
		match('Q 4', at('12:00'), ['1A'], ['2A'])
	];

	it('measures from the end of one match to the start of the next', () => {
		// 09:05–09:15 between Q 1 and Q 2 is too short to count.
		expect(teamOf(schedule(), '1A')).toEqual({
			status: 'window',
			window: { start: ms('09:30'), end: ms('10:50'), from: { kind: 'match', name: 'Q 2' }, until: { kind: 'match', name: 'Q 3' } }
		});
	});

	it('counts the time before a team’s first match, from when the division starts', () => {
		const matches = [...day(), match('Q 1', at('11:00'), ['3A'], ['2A']), match('Q 2', at('11:30'), ['3A'], ['1A'])];
		expect(teamOf(matches, '3A')).toEqual({
			status: 'window',
			window: { start: ms('08:50'), end: ms('10:50'), from: { kind: 'day' }, until: { kind: 'match', name: 'Q 1' } }
		});
	});

	it('counts the time after a team’s last match, up to when the division stops', () => {
		const matches = [...day(), match('Q 1', at('09:00'), ['1A'], ['2A']), match('Q 2', at('09:20'), ['1A'], ['2A'])];
		expect(teamOf(matches, '1A')).toEqual({
			status: 'window',
			window: { start: ms('09:25'), end: ms('12:05'), from: { kind: 'match', name: 'Q 2' }, until: { kind: 'day' } }
		});
	});

	it('never counts overnight as a gap', () => {
		const matches = [
			...day(),
			...filler('09:00', '12:00', '2026-11-01'),
			match('Q 1', at('09:00'), ['1A'], ['2A']),
			match('Q 50', at('11:00', '2026-11-01'), ['1A'], ['2A'])
		];
		const result = teamOf(matches, '1A');
		// The rest of day one, 09:05–12:05 — not 09:05 until 10:50 the next morning.
		expect(result?.status === 'window' && result.window).toMatchObject({ start: ms('09:05'), end: ms('12:05'), until: { kind: 'day' } });
	});

	it('hides time that has already passed and starts a current window at now', () => {
		const result = teamOf(schedule(), '1A', ms('10:00'));
		expect(result?.status === 'window' && result.window).toMatchObject({ start: ms('10:00'), until: { kind: 'match', name: 'Q 3' } });
	});

	it('reports a team with nothing left today as none left', () => {
		expect(teamOf(schedule(), '1A', ms('12:10'))).toEqual({ status: 'none_left' });
	});

	it('reports a team that is not in the schedule as having no matches', () => {
		expect(teamOf(schedule(), '99Z')).toEqual({ status: 'no_matches' });
	});

	it('ignores matches without a time', () => {
		expect(teamOf([match('Q 1', '', ['1A'], ['2A'], { scheduledAt: null })], '1A')).toEqual({ status: 'no_matches' });
	});

	it('merges back-to-back matches whose busy blocks overlap', () => {
		const matches = [
			...day(),
			match('Q 1', at('09:00'), ['1A'], ['2A']),
			match('Q 2', at('09:05'), ['1A'], ['3A']),
			match('Q 3', at('09:10'), ['1A'], ['4A'])
		];
		const result = teamOf(matches, '1A');
		expect(result?.status === 'window' && result.window).toMatchObject({ start: ms('09:15'), from: { kind: 'match', name: 'Q 3' } });
	});

	it('shows the first window long enough, not the longest', () => {
		const matches = [
			...day(),
			match('Q 1', at('09:00'), ['1A'], ['2A']),
			match('Q 2', at('09:40'), ['1A'], ['2A']),
			match('Q 3', at('12:00'), ['1A'], ['2A'])
		];
		// 09:05–09:30 comes before the much longer 09:45–11:50.
		expect(teamOf(matches, '1A')).toMatchObject({ status: 'window', window: { start: ms('09:05'), end: ms('09:30') } });
	});

	it('takes the minimum length the judge picks', () => {
		const matches = [
			...day(),
			match('Q 1', at('09:00'), ['1A'], ['2A']),
			match('Q 2', at('09:40'), ['1A'], ['2A']),
			match('Q 3', at('12:00'), ['1A'], ['2A'])
		];
		const result = freeTime(matches, ['1A'], { ...opts(), minLengthMs: 30 * MIN }).teams.get('1A');
		expect(result).toMatchObject({ status: 'window', window: { start: ms('09:45'), end: ms('11:50') } });
	});

	it('counts a window under way only if enough of it is left', () => {
		const matches = [
			...day(),
			match('Q 1', at('09:00'), ['1A'], ['2A']),
			match('Q 2', at('09:40'), ['1A'], ['2A']),
			match('Q 3', at('12:00'), ['1A'], ['2A'])
		];
		// At 09:20 only 10 minutes of 09:05–09:30 are left.
		expect(teamOf(matches, '1A', ms('09:20'))).toMatchObject({ status: 'window', window: { start: ms('09:45') } });
	});
});

describe('schedule breaks', () => {
	// Matches stop after 11:55 and resume at 13:00: a break from 12:00 to 12:50.
	const lunchDay = () => [...filler('09:00', '11:55'), ...filler('13:00', '15:00')];

	it('finds a break where every match stops', () => {
		expect(freeTime(lunchDay(), [], opts()).breaks).toEqual([{ start: ms('12:00'), end: ms('12:50') }]);
	});

	it('does not find a break in a schedule that keeps running', () => {
		expect(freeTime(filler('09:00', '15:00'), [], opts()).breaks).toEqual([]);
	});

	it('leaves break time out of a team’s windows', () => {
		const matches = [...lunchDay(), match('Q 1', at('09:00'), ['1A'], ['2A']), match('Q 2', at('14:00'), ['1A'], ['2A'])];
		// 09:05–13:50 would be the longest window, but 12:00–12:50 is lunch for everyone.
		expect(teamOf(matches, '1A')).toEqual({
			status: 'window',
			window: { start: ms('09:05'), end: ms('12:00'), from: { kind: 'match', name: 'Q 1' }, until: { kind: 'break' } }
		});
	});

	it('does not count the break as a team’s own window', () => {
		// 1A plays every 15 minutes either side of lunch, so lunch is its only gap.
		const own: MatchSummary[] = [];
		for (const [from, to] of [
			['09:00', '11:45'],
			['13:00', '15:00']
		]) {
			for (let time = ms(from); time <= ms(to); time += 15 * MIN) {
				own.push(match(`Q ${own.length + 1}`, new Date(time).toISOString(), ['1A'], ['2A']));
			}
		}
		// All that is left outside lunch is 11:50–12:00, too short to count.
		expect(teamOf([...lunchDay(), ...own], '1A')).toEqual({ status: 'none_left' });
	});

	it('reports a break that is under way as starting now', () => {
		expect(freeTime(lunchDay(), [], opts(ms('12:20'))).breaks).toEqual([{ start: ms('12:20'), end: ms('12:50') }]);
	});

	it('drops breaks that are over', () => {
		expect(freeTime(lunchDay(), [], opts(ms('13:00'))).breaks).toEqual([]);
	});
});

describe('running late', () => {
	const times = (matches: MatchSummary[]) => projectMatchTimes(matches, { dayKey: utcDay });

	it('moves matches still to come by how late the last match started', () => {
		const q1 = match('Q 1', at('09:00'), ['1A'], ['2A'], { startedAt: at('09:20') });
		const q2 = match('Q 2', at('09:30'), ['1A'], ['2A']);
		const result = times([q1, q2]);
		expect(result.times.get(q1.id)).toBe(ms('09:20'));
		expect(result.times.get(q2.id)).toBe(ms('09:50'));
		expect(result.delayMs).toBe(20 * MIN);
	});

	it('takes the delay from the most recently started match', () => {
		const q1 = match('Q 1', at('09:00'), [], [], { startedAt: at('09:30') });
		const q2 = match('Q 2', at('09:10'), [], [], { startedAt: at('09:35') });
		const q3 = match('Q 3', at('09:20'), [], []);
		expect(times([q1, q2, q3]).times.get(q3.id)).toBe(ms('09:45'));
	});

	it('lets a schedule break absorb the delay', () => {
		const q1 = match('Q 1', at('09:00'), [], [], { startedAt: at('09:40') });
		const q2 = match('Q 2', at('09:30'), [], []);
		// 25 minutes of free time between Q 2 and Q 3 takes 25 off a 40 minute delay.
		const q3 = match('Q 3', at('10:10'), [], []);
		const q4 = match('Q 4', at('10:15'), [], []);
		const result = times([q1, q2, q3, q4]);
		expect(result.times.get(q2.id)).toBe(ms('10:10'));
		expect(result.times.get(q3.id)).toBe(ms('10:25'));
		expect(result.times.get(q4.id)).toBe(ms('10:30'));
	});

	it('restarts on schedule after a break when the hall was running early', () => {
		const q1 = match('Q 1', at('09:00'), [], [], { startedAt: at('08:55') });
		const q2 = match('Q 2', at('09:05'), [], []);
		const q3 = match('Q 3', at('11:00'), [], []);
		const result = times([q1, q2, q3]);
		expect(result.times.get(q2.id)).toBe(ms('09:00'));
		expect(result.times.get(q3.id)).toBe(ms('11:00'));
		expect(result.delayMs).toBe(-5 * MIN);
	});

	it('does not carry a delay into the next day', () => {
		const q1 = match('Q 1', at('16:00'), [], [], { startedAt: at('16:30') });
		const q2 = match('Q 2', at('09:00', '2026-11-01'), [], []);
		const result = times([q1, q2]);
		expect(result.times.get(q2.id)).toBe(ms('09:00', '2026-11-01'));
		expect(result.delayMs).toBe(0);
	});

	it('moves a team’s free window to match', () => {
		const matches = filler('09:00', '12:00');
		matches[0].startedAt = at('09:20');
		matches.push(match('Q 1', at('09:00'), ['1A'], ['2A']), match('Q 2', at('10:00'), ['1A'], ['2A']));
		const result = freeTime(matches, ['1A'], opts());
		// Q 1 now ends 09:25 and Q 2 queues from 10:10, rather than 09:05 and 09:50.
		expect(result.teams.get('1A')).toMatchObject({ status: 'window', window: { start: ms('09:25'), end: ms('10:10') } });
		expect(result.delayMs).toBe(20 * MIN);
	});
});
