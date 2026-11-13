import type { DatabaseOrTransaction, Transaction } from './server-router';
import { getHandle } from './runtime/storage';

/**
 * Run a function inside a real SQLite transaction.
 *
 * better-sqlite3 is synchronous and its own `transaction()` refuses async callbacks: it
 * would commit the moment the callback returned its still-pending promise, which is
 * silently no transaction at all. So the statements are issued directly.
 *
 * This is only safe because every entry point into a room already holds that room's mutex
 * (see runtime/mutex.ts), so nothing else can interleave between BEGIN and COMMIT. If
 * that serialization is ever removed, this becomes wrong — the two belong together.
 *
 * Nested calls are flattened rather than refused: several routes compose helpers that
 * each open a transaction, and SQLite has no nested BEGIN. The outermost one owns the
 * commit, which matches how the code already behaved.
 */
export function transaction<T>(tx: DatabaseOrTransaction, fn: (tx: Transaction) => Promise<T>): Promise<T> {
	const handle = getHandle(tx as object);

	// A nested call, or a database opened outside the runtime (tests): just run the body.
	if (!handle || handle.sqlite.inTransaction) {
		return Promise.resolve(fn(tx as Transaction));
	}

	const { sqlite } = handle;
	sqlite.exec('BEGIN');

	return (async () => {
		try {
			const result = await fn(tx as Transaction);
			sqlite.exec('COMMIT');
			return result;
		} catch (error) {
			// Rolling back can itself throw if the connection is already unwound; the
			// original error is the one worth surfacing.
			try {
				if (sqlite.inTransaction) {
					sqlite.exec('ROLLBACK');
				}
			} catch (rollbackError) {
				console.error('Failed to roll back transaction:', rollbackError);
			}
			throw error;
		}
	})();
}
