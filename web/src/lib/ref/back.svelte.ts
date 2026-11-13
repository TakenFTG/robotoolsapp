/**
 * What the back button closes in the referee app.
 *
 * Everything in the app lives at one URL, so the browser has no record that opening the log
 * form or switching tab was a step forward, and back left the app outright. On a phone opened
 * from an emailed link, that closes the browser tab — one stray edge swipe away.
 *
 * Anything that back should close registers here while it is open: a tab other than the home
 * one, a dialog, the rule picker. The page keeps one history entry in place while anything is
 * registered (see routes/ref/+page.svelte), and back closes the most recently opened thing.
 * With nothing registered there is no entry of ours, so back leaves as usual.
 *
 * Register from an effect, so closing it any other way unregisters it too:
 *
 *     $effect(() => { if (open) return refBack.push(() => (open = null)); });
 */
import { untrack } from 'svelte';

class BackStack {
	private handlers = $state<(() => void)[]>([]);

	get depth(): number {
		return this.handlers.length;
	}

	/** Returns the function that unregisters it. */
	push(close: () => void): () => void {
		// Untracked: called from effects, which must not come to depend on the list they add to,
		// or adding would re-run them forever.
		untrack(() => {
			this.handlers = [...this.handlers, close];
		});
		return () => {
			untrack(() => {
				this.handlers = this.handlers.filter((handler) => handler !== close);
			});
		};
	}

	/** Close the most recently opened thing. */
	closeTop(): void {
		untrack(() => {
			const top = this.handlers.at(-1);
			if (top) {
				this.handlers = this.handlers.slice(0, -1);
				top();
			}
		});
	}
}

export const refBack = new BackStack();
