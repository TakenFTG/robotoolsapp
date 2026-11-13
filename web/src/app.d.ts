// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		// interface Error {}
		// interface Locals {}
		// interface PageData {}
		interface PageState {
			/**
			 * Set on a history entry pushed when a tab other than Overview is opened.
			 *
			 * Every tab lives at the same URL, so without this the browser has no record that
			 * opening one was a step forward — and back leaves the event outright. On a phone
			 * reached from an emailed link, `/app` is the first entry in the tab, so "leaves"
			 * means the browser closes.
			 */
			workspaceTabOpen?: boolean;
			/**
			 * Set on the history entry the referee app pushes while anything is open on top of
			 * its home screen, so back closes that rather than leaving. See ref/back.svelte.ts.
			 */
			refNested?: boolean;
		}
		// interface Platform {}
	}
}

export {};
