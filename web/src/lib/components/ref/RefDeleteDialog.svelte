<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import { refApp } from '$lib/ref/ref-app.svelte';
	import Dialog from '$lib/components/dialog/Dialog.svelte';
	import Button from '$lib/components/m3/Button.svelte';

	/**
	 * Deleting an event's referee notes, behind the same guard the Judges' Room uses for
	 * destroying judging data: type "destroy" first.
	 *
	 * A confirmation button alone is one stray tap on a phone at the field, and this cannot be
	 * undone. The export is offered here, where the decision is made, because it is the only
	 * record that can be kept.
	 */
	interface Props {
		onExport: () => void;
		onClose: () => void;
	}

	let { onExport, onClose }: Props = $props();

	let typed = $state('');
	let deleting = $state(false);

	const confirmed = $derived(typed.trim().toLowerCase() === 'destroy');

	async function remove() {
		if (!confirmed) {
			return;
		}
		deleting = true;
		await refApp.destroyRoom();
		deleting = false;
		onClose();
	}
</script>

<Dialog open={true} {onClose} innerContainerClass="max-w-md">
	<form
		class="flex flex-col gap-4"
		onsubmit={(event) => {
			event.preventDefault();
			void remove();
		}}
	>
		<h2 id="dialog-title" class="text-headline-small text-on-surface">{m.ref_delete_event_title()}</h2>

		<div role="alert" class="rounded-xl bg-error-container p-4 text-body-medium text-on-error-container">
			{m.ref_delete_event_message()}
		</div>

		<div class="flex flex-col gap-2 rounded-xl border border-outline-variant p-4">
			<p class="text-body-medium text-on-surface-variant">{m.ref_delete_export_prompt({ count: refApp.incidents.length })}</p>
			<Button variant="outlined" compact class="self-start" disabled={refApp.incidents.length === 0} onclick={onExport}>
				{m.ref_export_csv()}
			</Button>
		</div>

		<label class="flex flex-col gap-1">
			<span class="text-body-medium text-on-surface">{m.ref_delete_type_destroy()}</span>
			<input
				class="classic"
				type="text"
				bind:value={typed}
				placeholder="destroy"
				autocomplete="off"
				autocapitalize="none"
				spellcheck="false"
			/>
		</label>

		<div class="flex justify-end gap-2">
			<Button variant="text" disabled={deleting} onclick={onClose}>{m.ref_cancel()}</Button>
			<Button type="submit" danger disabled={!confirmed || deleting}>{m.ref_delete_event()}</Button>
		</div>
	</form>
</Dialog>
