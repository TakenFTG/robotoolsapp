<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import { dialogs } from '$lib/index.svelte';
	import { refNotes } from '$lib/ref-notes.svelte';
	import Dialog from '$lib/components/dialog/Dialog.svelte';
	import Button from '$lib/components/m3/Button.svelte';
	import RefNoteCard from './RefNoteCard.svelte';
	import JudgeRefNoteDialog from './JudgeRefNoteDialog.svelte';

	interface Props {
		teamNumber: string;
	}

	let { teamNumber }: Props = $props();

	// Live: a note logged while this is open appears in it.
	const notes = $derived(refNotes.forTeam(teamNumber));

	function close() {
		dialogs.closeDialog();
	}
</script>

<Dialog open={true} onClose={close} innerContainerClass="max-w-lg">
	<div class="flex max-h-[80vh] flex-col gap-4">
		<h2 id="dialog-title" class="text-headline-small text-on-surface">{m.ref_notes_for_team({ team: teamNumber })}</h2>
		<div class="flex flex-col gap-2 overflow-y-auto">
			{#each notes as note (note.id)}
				<RefNoteCard {note} showTeam={false} onEdit={(item) => dialogs.showCustom(JudgeRefNoteDialog, { props: { note: item } })} />
			{:else}
				<p class="py-6 text-center text-body-medium text-on-surface-variant">{m.ref_notes_none_for_team()}</p>
			{/each}
		</div>
		<div class="flex justify-between gap-2">
			{#if refNotes.linked}
				<Button variant="outlined" onclick={() => dialogs.showCustom(JudgeRefNoteDialog, { props: { note: null, teamNumber } })}
					>{m.ref_notes_add()}</Button
				>
			{:else}
				<span></span>
			{/if}
			<Button variant="text" onclick={close}>{m.ref_link_close()}</Button>
		</div>
	</div>
</Dialog>
