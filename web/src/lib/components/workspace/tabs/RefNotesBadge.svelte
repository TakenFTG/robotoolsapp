<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import { dialogs } from '$lib/index.svelte';
	import { refNotes } from '$lib/ref-notes.svelte';
	import SeveritySummary from '$lib/components/ref/SeveritySummary.svelte';
	import RefNotesTeamDialog from './RefNotesTeamDialog.svelte';

	/**
	 * A team's ref notes at a glance, beside its number: the worst severity and how many.
	 *
	 * Shows nothing when there is nothing to show, which is also what a judge sees — the
	 * store is only ever filled for Judge Advisors.
	 */
	interface Props {
		teamNumber: string;
	}

	let { teamNumber }: Props = $props();

	const notes = $derived(refNotes.forTeam(teamNumber));
</script>

{#if notes.length > 0}
	<button
		type="button"
		class="inline-flex items-center"
		aria-label={m.ref_notes_for_team({ team: teamNumber })}
		onclick={(event) => {
			event.stopPropagation();
			void dialogs.showCustom(RefNotesTeamDialog, { props: { teamNumber } });
		}}
	>
		<SeveritySummary items={notes} size="small" />
	</button>
{/if}
