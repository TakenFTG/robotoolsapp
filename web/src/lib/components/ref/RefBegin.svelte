<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import { resolve } from '$app/paths';
	import { refApp } from '$lib/ref/ref-app.svelte';
	import Button from '$lib/components/m3/Button.svelte';
	import TextField from '$lib/components/m3/TextField.svelte';
	import RefEventList from './RefEventList.svelte';

	let link = $state('');
	let error = $state('');
	let joining = $state(false);

	async function handleJoin() {
		error = '';
		joining = true;
		try {
			await refApp.joinWithLink(link);
		} catch (cause) {
			error = cause instanceof Error ? cause.message : String(cause);
		} finally {
			joining = false;
		}
	}
</script>

<div class="flex min-h-screen flex-col items-center justify-center bg-surface px-4 py-8">
	<div class="flex w-full max-w-lg flex-col gap-6">
		<div class="flex flex-col items-center gap-2 text-center">
			<h1 class="text-display-small text-on-surface">{m.ref_product_name()}</h1>
			<p class="text-body-large text-on-surface-variant">{m.ref_tagline()}</p>
		</div>

		{#if refApp.signedOutMessage}
			<div role="status" class="rounded-xl bg-error-container p-4 text-body-medium text-on-error-container">
				{refApp.signedOutMessage}
			</div>
		{/if}

		{#if refApp.savedEvents.length > 0}
			<div class="flex flex-col gap-4 rounded-2xl bg-surface-container-low p-4 shadow-elev-1 sm:p-6">
				<h2 class="text-headline-small text-on-surface">{m.ref_your_events()}</h2>
				<RefEventList events={refApp.savedEvents} onOpen={(roomId) => void refApp.switchTo(roomId)} />
			</div>
		{/if}

		<div class="flex flex-col gap-4 rounded-2xl bg-surface-container-low p-4 shadow-elev-1 sm:p-6">
			<h2 class="text-headline-small text-on-surface">{m.ref_have_a_link()}</h2>
			<p class="text-body-medium text-on-surface-variant">{m.ref_have_a_link_description()}</p>
			<form
				class="flex flex-col gap-4"
				onsubmit={(event) => {
					event.preventDefault();
					void handleJoin();
				}}
			>
				<TextField label={m.ref_link_label()} bind:value={link} {error} autocomplete="off" />
				<Button type="submit" disabled={joining || !link.trim()}>{m.ref_open()}</Button>
			</form>
		</div>

		<div class="flex flex-col items-center gap-2">
			<Button variant="text" onclick={() => refApp.openSetup()}>{m.ref_set_up_new_event()}</Button>
			<a class="text-body-medium text-on-surface-variant underline hover:text-on-surface" href={resolve('/')}>{m.ref_back_to_judging()}</a>
		</div>
	</div>
</div>
