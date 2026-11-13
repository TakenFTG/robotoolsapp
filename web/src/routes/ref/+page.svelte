<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import { onMount, tick } from 'svelte';
	import { resolve } from '$app/paths';
	import { pushState, replaceState } from '$app/navigation';
	import { refBack } from '$lib/ref/back.svelte';
	import { SvelteURL } from 'svelte/reactivity';
	import { page } from '$app/state';
	import { dialogs } from '$lib/index.svelte';
	import { refApp } from '$lib/ref/ref-app.svelte';
	import AlertDialog from '$lib/components/dialog/AlertDialog.svelte';
	import ConfirmationDialog from '$lib/components/dialog/ConfirmationDialog.svelte';
	import PromptDialog from '$lib/components/dialog/PromptDialog.svelte';
	import LinearProgress from '$lib/components/m3/LinearProgress.svelte';
	import RefBegin from '$lib/components/ref/RefBegin.svelte';
	import RefSetup from '$lib/components/ref/RefSetup.svelte';
	import RefWorkspace from '$lib/components/ref/RefWorkspace.svelte';

	onMount(() => {
		const url = new SvelteURL(window.location.href);
		void refApp.start(url);
		// The link is a credential. Once it is saved on the device it has no business sitting
		// in the address bar, browser history or a screenshot.
		if (url.searchParams.has('auth')) {
			// After a tick: replaceState refuses to run before the router has started.
			void tick().then(() => replaceState(resolve('/ref'), page.state));
		}
	});

	let currentDialog = $derived(dialogs.currentDialog);

	// A confirmation on screen is closed by back like anything else, as a "no".
	$effect(() => {
		if (currentDialog) {
			return refBack.push(() => dialogs.closeDialog(false));
		}
	});

	// Setting up an event: back returns to the open event, or the start screen.
	$effect(() => {
		if (refApp.phase === 'setup') {
			return refBack.push(() => refApp.closeSetup());
		}
	});

	/**
	 * Keep one history entry in place while anything is open, and treat its going away as the
	 * back press. The same approach as the judging workspace (Workspace.svelte): popping our
	 * entry and never having pushed one look the same from page.state, so this flag tells
	 * them apart, and it is a plain local so writing it does not re-run the effect.
	 */
	let entryPushed = false;

	$effect(() => {
		const nested = refBack.depth > 0;
		const entryPresent = Boolean(page.state.refNested);

		if (nested && !entryPresent) {
			if (entryPushed) {
				// Our entry was just popped: this is the back press.
				entryPushed = false;
				refBack.closeTop();
			} else {
				entryPushed = true;
				pushState('', { refNested: true });
			}
		} else if (!nested && !entryPresent) {
			entryPushed = false;
		}
	});
</script>

<svelte:head>
	<title>{m.ref_product_name()}</title>
</svelte:head>

{#if refApp.phase === 'loading' || refApp.phase === 'joining'}
	<div class="flex h-screen flex-col items-center justify-center gap-6 bg-surface p-8">
		<LinearProgress class="max-w-xs" label={m.loading()} />
	</div>
{:else if refApp.phase === 'begin' || refApp.phase === 'signed_out'}
	<RefBegin />
{:else if refApp.phase === 'setup'}
	<RefSetup />
{:else if refApp.phase === 'workspace'}
	<RefWorkspace />
{/if}

{#if currentDialog}
	{#if currentDialog.type === 'alert'}
		<AlertDialog dialog={currentDialog} />
	{:else if currentDialog.type === 'confirmation'}
		<ConfirmationDialog dialog={currentDialog} />
	{:else if currentDialog.type === 'prompt'}
		<PromptDialog dialog={currentDialog} />
	{/if}
{/if}
