<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import type { ConfirmationDialog } from '$lib/dialog.svelte';
	import { dialogs } from '$lib/index.svelte';
	import Dialog from '$lib/components/dialog/Dialog.svelte';

	interface Props {
		dialog: ConfirmationDialog;
	}

	let { dialog }: Props = $props();

	function handleConfirm() {
		dialogs.closeDialog(true);
	}

	function handleCancel() {
		dialogs.closeDialog(false);
	}
</script>

<Dialog open={true} onClose={handleCancel} innerContainerClass="max-w-md">
	<!-- Title -->
	<h3 id="dialog-title" class="mb-4 text-headline-small text-on-surface">{dialog.title}</h3>

	<!-- Message -->
	<p id="dialog-message" class="mb-6 text-body-medium text-on-surface-variant">{dialog.message}</p>

	<!-- Buttons -->
	<div class="flex justify-end gap-2">
		<button onclick={handleCancel} class={dialog.cancelButtonClass || 'cancel'}>
			{dialog.cancelText || m.cancel()}
		</button>
		<button onclick={handleConfirm} class={dialog.confirmButtonClass || 'primary'} onkeydown={(e) => e.key === 'Enter' && handleConfirm()}>
			{dialog.confirmText || m.confirm()}
		</button>
	</div>
</Dialog>
