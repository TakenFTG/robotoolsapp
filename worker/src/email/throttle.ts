import { ACCESS_LINK_EMAIL_COOLDOWN_MS, MAX_ACCESS_LINK_EMAIL_COOLDOWN_MS } from '@robotools.app/protocol/src/email';

/**
 * Pacing for emailing access links, shared by Judges' Rooms and ref rooms.
 *
 * Both send the same kind of message for the same reason, and both draw on the one mail
 * account the operator configured, so they keep to the same limits. Keyed by room id; the
 * two kinds of room have distinct ids, so they never share a window.
 */

/**
 * The earliest each room may send again, so a stuck or retrying client cannot burn a
 * daily quota in a loop.
 *
 * Proportional to how many messages went out rather than a flat delay. Fixing one
 * mistyped address and pressing Send again is the common case and should not mean
 * waiting; mailing a panel of thirty earns a correspondingly longer pause.
 *
 * In memory on purpose. This guards against a runaway client over a span of seconds, and
 * a restart clearing it is correct — an operator who has just restarted should not be
 * told to wait. Keyed by room, so it never grows beyond the rooms opened since boot.
 */
const nextSendAllowedAt = new Map<string, number>();

/**
 * Check the room's send window and, if it is open, claim it — in one synchronous step.
 *
 * Returns 0 when the caller may send, or the milliseconds left to wait. The two send
 * procedures run outside the room lock (runtime/lock-free.ts), so a check followed by an
 * await and then a record would let two calls landing together both pass. Claiming here
 * closes the window before anything can interleave; recordSend then sets its true length
 * once the caller knows how many messages it is sending.
 */
export function claimSendWindow(roomId: string): number {
	const allowedAt = nextSendAllowedAt.get(roomId);
	const waitMs = allowedAt === undefined ? 0 : Math.max(0, allowedAt - Date.now());
	if (waitMs === 0) {
		recordSend(roomId, 1);
	}
	return waitMs;
}

export function recordSend(roomId: string, messageCount: number): void {
	const cost = Math.min(messageCount * ACCESS_LINK_EMAIL_COOLDOWN_MS, MAX_ACCESS_LINK_EMAIL_COOLDOWN_MS);
	nextSendAllowedAt.set(roomId, Date.now() + cost);
}

/**
 * How many messages are in flight at once.
 *
 * The send procedures run outside the room lock (runtime/lock-free.ts), so this no longer
 * holds up anyone else in the room; it only sets how hard a send-all leans on the mail
 * provider. Four at a time sends a full panel in a few seconds and stays well inside the
 * per-second limits these providers publish.
 */
export const SEND_CONCURRENCY = 4;

/** Run `worker` over `items` with at most `limit` outstanding, preserving input order. */
export async function mapWithConcurrency<T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> {
	const results = new Array<R>(items.length);
	let next = 0;

	async function drain(): Promise<void> {
		while (next < items.length) {
			const index = next++;
			results[index] = await worker(items[index]!);
		}
	}

	await Promise.all(Array.from({ length: Math.min(limit, items.length) }, drain));
	return results;
}
