/**
 * Which match in the ref app's schedule is on the field now, so the list can open there
 * instead of at the first match of the day.
 */

/**
 * With no results synced at all, a match counts as current until this long after its
 * scheduled time. Fields run late, and a match that should have started ten minutes ago is
 * often the one on the field now.
 */
export const LATE_GRACE_MS = 15 * 60_000;

interface ScheduledMatch {
	scored: boolean;
	scheduledAt: string | null;
}

/**
 * The index in `rows` (sorted by schedule) of the match on the field now, or -1 once every
 * match is over.
 *
 * Results are the best signal: everything up to the last scored match has happened. When the
 * event has no results at all — they aren't syncing, or the day has only just started — the
 * clock stands in.
 *
 * @param resultsSyncing whether any match in scope is scored, including ones `rows` hides.
 */
export function currentMatchIndex(rows: readonly ScheduledMatch[], resultsSyncing: boolean, now: number): number {
	if (resultsSyncing) {
		let lastScored = -1;
		rows.forEach((row, index) => {
			if (row.scored) lastScored = index;
		});
		return lastScored + 1 < rows.length ? lastScored + 1 : -1;
	}
	return rows.findIndex((row) => !row.scheduledAt || Date.parse(row.scheduledAt) + LATE_GRACE_MS >= now);
}
