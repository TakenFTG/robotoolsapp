<script lang="ts">
	import type { AlertDialog } from '$lib/dialog.svelte';
	import { dialogs } from '$lib/index.svelte';
	import Dialog from './Dialog.svelte';

	interface Props {
		dialog: AlertDialog;
	}

	let { dialog }: Props = $props();

	function handleConfirm() {
		dialogs.closeDialog(true);
	}
</script>

<Dialog open={true} onClose={handleConfirm} innerContainerClass="max-w-md">
	<h3 id="dialog-title" class="mb-4 text-headline-small text-on-surface">{dialog.title}</h3>
	<p id="dialog-message" class="mb-6 text-body-medium text-on-surface-variant">{dialog.message}</p>
	<div class="flex justify-end gap-2">
		<button onclick={handleConfirm} class={dialog.confirmButtonClass || 'primary'}>
			{dialog.confirmText || 'OK'}
		</button>
	</div>
</Dialog>
