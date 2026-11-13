/**
 * A promise queue, one per room.
 *
 * This exists to replace something we used to get for free. A Durable Object processes
 * one request at a time, and the room code was written against that guarantee — several
 * places do read-then-write sequences, and one of them (toggling access control, which
 * kicks every other client before writing the flag) is a security property rather than a
 * convenience.
 *
 * Node is single-threaded, but `await` is an interleaving point: two overlapping requests
 * to the same room *will* see each other's half-finished work without this. So every
 * entry point into a room — WebSocket message, socket close, HTTP media, admin RPC —
 * runs through `Mutex.run`, and the room behaves as it did before.
 *
 * Deliberately not reentrant: nothing inside a critical section should be re-entering it,
 * and making that a deadlock rather than a silent double-entry is the safer failure.
 */
export class Mutex {
	private tail: Promise<unknown> = Promise.resolve();

	run<T>(fn: () => Promise<T> | T): Promise<T> {
		// Chain onto the tail, and make the new tail immune to this task's failure so one
		// rejected operation does not poison every later one.
		const result = this.tail.then(fn, fn);
		this.tail = result.then(
			() => undefined,
			() => undefined
		);
		return result;
	}
}
