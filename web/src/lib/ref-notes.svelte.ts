import type { JudgeRefNote } from '@robotools.app/protocol/src/ref';

/**
 * Ref notes about this division's teams, as its Judge Advisors see them.
 *
 * Loaded by the workspace for Judge Advisors only, and loaded again whenever the server says
 * they changed (a bare signal, onRefNotesChanged) or the connection comes back. Notes marked
 * refs only never arrive here: the ref room drops them before answering.
 */
class RefNotesStore {
	/** False until loaded, and while this division is not linked to referee notes. */
	linked = $state(false);
	/**
	 * False while nobody can open the linked notes in the referee app: the refs aren't using
	 * it, so the Judge Advisors write down what the refs tell them.
	 */
	refsUsingApp = $state(false);
	/** Newest first. */
	notes: JudgeRefNote[] = $state([]);
	/** Bumped by the server's signal; the workspace reloads when it changes. */
	version = $state(0);

	signal(): void {
		this.version++;
	}

	set(result: { linked: boolean; refsUsingApp: boolean; notes: JudgeRefNote[] }): void {
		this.linked = result.linked;
		this.refsUsingApp = result.refsUsingApp;
		this.notes = result.notes;
	}

	clear(): void {
		this.linked = false;
		this.refsUsingApp = false;
		this.notes = [];
	}

	forTeam(teamNumber: string): JudgeRefNote[] {
		return this.notes.filter((note) => note.teamNumber === teamNumber);
	}
}

export const refNotes = new RefNotesStore();
