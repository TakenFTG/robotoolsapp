/**
 * Requests that run without the room's mutex, by procedure path and the one request type
 * each is allowed as.
 *
 * Each of these can wait seconds on something outside the server. Under the lock, that
 * wait stalled every rubric save, nomination and attendance tap in the room.
 *
 *   matches.getSnapshot            may fetch from RobotEvents when the cache is stale —
 *                                  with fifty judges on the Matches tab, a freeze on
 *                                  every Refresh, and an open-ended one if it hung.
 *   access.sendAccessLinkEmails    "Send all" — fifty judges is ten to twenty seconds of
 *   access.sendAdvisorAccessLinkEmail  SMTP, during check-in, when the room is busiest.
 *
 *   refLink.createRefRoom         creating linked referee notes: waits on other rooms and
 *                                  on emailing the Head Ref their link.
 *   refLink.start                 creating this division's own referee notes: waits on a
 *                                  new ref room, and on RobotEvents for the event name.
 *   refLink.saveNote              a Judge Advisor's or judge's note for the refs, and
 *   refLink.submitNote            removing one: each waits on the linked ref room's lock,
 *   refLink.removeNote            which a Judges' Room must never hold its own lock while
 *                                  waiting for. All three only read here.
 *
 * They are safe outside the lock because none writes room state directly. createRefRoom's
 * one write to this room, recording the link, is made by the hub under this room's lock —
 * which is exactly why the request itself must not be holding it. The match query reads
 * the metadata row and the in-memory cache, and the fetch it may start is coalesced and
 * assigns the cache in one step (Room.refreshMatches). The email sends read judges,
 * advisors and metadata, and their send throttle is reserved synchronously before the
 * first await (checkSendAllowance/recordSend in routes/access.ts), so two at once cannot
 * both slip past it.
 *
 * Anything added here must meet the same bar: no database writes, and no in-memory state
 * that another handler could see half-changed across an await.
 */
const LOCK_FREE_REQUESTS = new Map<string, 'query' | 'mutation'>([
	['matches.getSnapshot', 'query'],
	['access.sendAccessLinkEmails', 'mutation'],
	['access.sendAdvisorAccessLinkEmail', 'mutation'],
	['refLink.createRefRoom', 'mutation'],
	['refLink.start', 'mutation'],
	['refLink.saveNote', 'mutation'],
	['refLink.submitNote', 'mutation'],
	['refLink.removeNote', 'mutation']
]);

/**
 * Frames that must not queue behind the room's mutex.
 *
 * Parsed with a deliberately forgiving check: anything unrecognised, or not valid JSON at
 * all, falls through to the locked path so the real handler can reject it properly. The
 * cost of being wrong in that direction is a queued frame; the cost of being wrong in the
 * other is running a request without the lock that every request assumes it holds.
 */
export function isLockFreeFrame(message: string): boolean {
	return isLockFreeFrameFor(LOCK_FREE_REQUESTS, message);
}

/**
 * The same check against another room type's own list of lock-free requests.
 *
 * Ref rooms have different procedures, so they bring their own list; the rules for what may
 * go on it are the ones above.
 */
export function isLockFreeFrameFor(requests: ReadonlyMap<string, 'query' | 'mutation'>, message: string): boolean {
	try {
		const parsed: unknown = JSON.parse(message);
		if (typeof parsed !== 'object' || parsed === null) {
			return false;
		}
		const { kind, type, path } = parsed as { kind?: unknown; type?: unknown; path?: unknown };
		if (kind === 'response' || kind === 'ping' || kind === 'pong') {
			return true;
		}
		// Matched on type as well as path, so a request claiming a different type than the
		// procedure has still takes the lock.
		return kind === 'request' && typeof path === 'string' && type === requests.get(path);
	} catch {
		return false;
	}
}
