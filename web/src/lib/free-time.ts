import type { MatchSummary } from '@robotools.app/protocol/src/matches';

/**
 * Each team's next free window between its matches that is long enough for an interview.
 *
 * The next one rather than the longest: the longest is often late in the day, after the
 * judges need to be done. So the answer is the first window, from now, of at least the
 * length the judge asked for.
 *
 * RobotEvents gives a match one time — when it is scheduled, or when it started — and no
 * end. A team is not free right up to that moment and straight after it, though: it has
 * to queue first and walk back afterwards. So each match is treated as taking the team
 * away for a block around its time, and what is left over is the free time.
 *
 * Free time is only counted inside the hours the division is actually running matches on
 * that day. Before a team's first match and after its last are real windows, but the end
 * of day one and the start of day two are not one long gap — the team has gone home.
 *
 * Two things keep the answer close to what is really happening in the hall:
 *
 * - Events run late. Matches that have not started are moved by however late the most
 *   recent match started, so a break is not shown twenty minutes before it really comes.
 *   A schedule break (lunch, say) is where events catch up, so the delay is reduced by the
 *   length of each break it passes, and runs out at the end of the day.
 *
 * - When every match stops, every team is free at once. That is a schedule break, not a
 *   good time to see one particular team, and judges are usually on a break too. Breaks are reported on their own and left out of each team's windows.
 */

/** Time before a match a team is busy queuing. */
export const MATCH_BUSY_BEFORE_MS = 10 * 60 * 1000;
/** Time after a match before a team is back in the pits. */
export const MATCH_BUSY_AFTER_MS = 5 * 60 * 1000;
/** Breaks shorter than this are not worth listing. */
export const MIN_WINDOW_MS = 60 * 1000;
/** The shortest window worth showing a team for, unless the judge picks another. */
export const DEFAULT_MIN_LENGTH_MS = 15 * 60 * 1000;
/** Free time with no team busy at all, at least this long, is a schedule break. */
export const BREAK_MIN_MS = 20 * 60 * 1000;

export interface FreeTimeOptions {
	now: number;
	busyBeforeMs?: number;
	busyAfterMs?: number;
	/** Groups times into days. Defaults to the browser's local calendar day. */
	dayKey?: (time: number) => string;
	/** The shortest window that counts. Defaults to DEFAULT_MIN_LENGTH_MS. */
	minLengthMs?: number;
}

/** What opens or closes a window: one of the team's matches, the day's first or last match, or a schedule break. */
export type WindowEdge = { kind: 'match'; name: string } | { kind: 'day' } | { kind: 'break' };

export interface FreeWindow {
	start: number;
	end: number;
	from: WindowEdge;
	until: WindowEdge;
}

export interface ScheduleBreak {
	start: number;
	end: number;
}

export type TeamFreeTime =
	| { status: 'window'; window: FreeWindow }
	/** The team has timed matches, but no window of the minimum length is left after now. */
	| { status: 'none_left' }
	/** The team has no match with a time in the schedule. */
	| { status: 'no_matches' };

export interface FreeTimeResult {
	teams: Map<string, TeamFreeTime>;
	/** Schedule breaks not yet over, the current one starting at now. */
	breaks: ScheduleBreak[];
	/**
	 * How far the next match still to come has been moved: positive when the event is
	 * running late, negative when it is running early, zero when nothing was moved.
	 */
	delayMs: number;
}

function parseTime(value: string | null): number | null {
	if (!value) return null;
	const time = new Date(value).getTime();
	return Number.isNaN(time) ? null : time;
}

/** When a match happens, as far as the feed says: when it started if it has, otherwise when it is scheduled. */
export function matchTime(match: MatchSummary): number | null {
	return parseTime(match.startedAt) ?? parseTime(match.scheduledAt);
}

function localDayKey(time: number): string {
	const date = new Date(time);
	return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

/**
 * Each match's best-guess time, by match id.
 *
 * A match that has started keeps its start time. One still to come on the same day as the
 * most recently started match is moved by how late (or early) that match started. Each
 * schedule break the delay passes takes its length off a late delay, and wipes out an early
 * one: the hall waits for the scheduled restart rather than starting early.
 */
export function projectMatchTimes(matches: readonly MatchSummary[], options: Omit<FreeTimeOptions, 'now'>) {
	const before = options.busyBeforeMs ?? MATCH_BUSY_BEFORE_MS;
	const after = options.busyAfterMs ?? MATCH_BUSY_AFTER_MS;
	const dayKey = options.dayKey ?? localDayKey;

	const times = new Map<number, number>();
	let reference: { started: number; scheduled: number } | null = null;
	const pending: { id: number; scheduled: number }[] = [];

	for (const match of matches) {
		const started = parseTime(match.startedAt);
		const scheduled = parseTime(match.scheduledAt);
		if (started !== null) {
			times.set(match.id, started);
			if (scheduled !== null && (!reference || started > reference.started)) {
				reference = { started, scheduled };
			}
		} else if (scheduled !== null) {
			pending.push({ id: match.id, scheduled });
		}
	}

	pending.sort((a, b) => a.scheduled - b.scheduled);
	const referenceDay = reference ? dayKey(reference.scheduled) : null;
	let remaining = reference ? reference.started - reference.scheduled : 0;
	let previous = reference?.scheduled ?? 0;
	let firstShift: number | null = null;

	for (const { id, scheduled } of pending) {
		if (!reference || dayKey(scheduled) !== referenceDay) {
			times.set(id, scheduled);
			continue;
		}
		if (scheduled >= reference.scheduled) {
			const freeBetween = scheduled - previous - before - after;
			if (freeBetween >= BREAK_MIN_MS) {
				remaining = remaining > 0 ? Math.max(0, remaining - freeBetween) : 0;
			}
			previous = scheduled;
		}
		times.set(id, scheduled + remaining);
		firstShift ??= remaining;
	}

	return { times, delayMs: firstShift ?? 0 };
}

interface Block {
	start: number;
	end: number;
	name: string;
}

export function freeTime(matches: readonly MatchSummary[], teamNumbers: Iterable<string>, options: FreeTimeOptions): FreeTimeResult {
	const before = options.busyBeforeMs ?? MATCH_BUSY_BEFORE_MS;
	const after = options.busyAfterMs ?? MATCH_BUSY_AFTER_MS;
	const dayKey = options.dayKey ?? localDayKey;
	const minLength = options.minLengthMs ?? DEFAULT_MIN_LENGTH_MS;
	const { times, delayMs } = projectMatchTimes(matches, options);

	// Each team's busy blocks by day, and every match time by day for the day spans and breaks.
	const timesByDay = new Map<string, number[]>();
	const blocksByTeam = new Map<string, Map<string, Block[]>>();

	for (const match of matches) {
		const time = times.get(match.id);
		if (time === undefined) continue;
		const block: Block = { start: time - before, end: time + after, name: match.name };
		const day = dayKey(time);

		let dayTimes = timesByDay.get(day);
		if (!dayTimes) timesByDay.set(day, (dayTimes = []));
		dayTimes.push(time);

		for (const teamNumber of new Set([...match.red.teamNumbers, ...match.blue.teamNumbers])) {
			let byDay = blocksByTeam.get(teamNumber);
			if (!byDay) blocksByTeam.set(teamNumber, (byDay = new Map()));
			let blocks = byDay.get(day);
			if (!blocks) byDay.set(day, (blocks = []));
			blocks.push(block);
		}
	}

	// Every block is the same length, so the gap in the union of all of them between two
	// consecutive match times is simply the space between their blocks.
	const daySpans = new Map<string, { start: number; end: number }>();
	const breaksByDay = new Map<string, ScheduleBreak[]>();
	for (const [day, dayTimes] of timesByDay) {
		dayTimes.sort((a, b) => a - b);
		daySpans.set(day, { start: dayTimes[0] - before, end: dayTimes[dayTimes.length - 1] + after });
		const breaks: ScheduleBreak[] = [];
		for (let i = 1; i < dayTimes.length; i++) {
			const start = dayTimes[i - 1] + after;
			const end = dayTimes[i] - before;
			if (end - start >= BREAK_MIN_MS) breaks.push({ start, end });
		}
		breaksByDay.set(day, breaks);
	}

	const teams = new Map<string, TeamFreeTime>();
	for (const teamNumber of teamNumbers) {
		const byDay = blocksByTeam.get(teamNumber);
		if (!byDay) {
			teams.set(teamNumber, { status: 'no_matches' });
			continue;
		}

		// The earliest window, from now, that is long enough. A window already under way
		// counts if enough of it is left.
		let best: FreeWindow | null = null;
		const consider = (window: FreeWindow) => {
			const start = Math.max(window.start, options.now);
			if (window.end - start < minLength) return;
			if (!best || start < best.start) best = { ...window, start };
		};

		for (const [day, blocks] of byDay) {
			const span = daySpans.get(day)!;
			const breaks = breaksByDay.get(day)!;
			blocks.sort((a, b) => a.start - b.start);

			// A gap in the team's own schedule, with any schedule breaks cut out of it.
			const considerGap = (gap: FreeWindow) => {
				let cursor = gap.start;
				let from = gap.from;
				for (const scheduleBreak of breaks) {
					if (scheduleBreak.end <= cursor || scheduleBreak.start >= gap.end) continue;
					if (scheduleBreak.start > cursor) {
						consider({ start: cursor, end: scheduleBreak.start, from, until: { kind: 'break' } });
					}
					cursor = Math.max(cursor, scheduleBreak.end);
					from = { kind: 'break' };
				}
				if (gap.end > cursor) consider({ start: cursor, end: gap.end, from, until: gap.until });
			};

			let cursor = span.start;
			let previous: WindowEdge = { kind: 'day' };
			for (const block of blocks) {
				if (block.start > cursor) {
					considerGap({ start: cursor, end: block.start, from: previous, until: { kind: 'match', name: block.name } });
				}
				// Overlapping blocks (back-to-back matches) merge rather than leaving a negative gap.
				if (block.end >= cursor) {
					cursor = block.end;
					previous = { kind: 'match', name: block.name };
				}
			}
			if (span.end > cursor) {
				considerGap({ start: cursor, end: span.end, from: previous, until: { kind: 'day' } });
			}
		}

		teams.set(teamNumber, best ? { status: 'window', window: best } : { status: 'none_left' });
	}

	const breaks = [...breaksByDay.values()]
		.flat()
		.filter((scheduleBreak) => scheduleBreak.end - Math.max(scheduleBreak.start, options.now) >= MIN_WINDOW_MS)
		.map((scheduleBreak) => ({ start: Math.max(scheduleBreak.start, options.now), end: scheduleBreak.end }))
		.sort((a, b) => a.start - b.start);

	return { teams, breaks, delayMs };
}
