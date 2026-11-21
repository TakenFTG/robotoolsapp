import type { AuditLogUpdate } from '@robotools.app/protocol/src/audit';

type Listener = (update: AuditLogUpdate) => void;

/**
 * Hands live activity log entries to whichever Activity view is open.
 *
 * Nothing is kept here: the view loads its own page when it opens and only needs what
 * arrives while it is showing.
 */
export const auditLogFeed = {
	listeners: new Set<Listener>(),

	subscribe(listener: Listener): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	},

	emit(update: AuditLogUpdate): void {
		for (const listener of this.listeners) {
			listener(update);
		}
	}
};
