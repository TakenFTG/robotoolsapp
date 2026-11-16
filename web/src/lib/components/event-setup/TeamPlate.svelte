<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import { isSubmittedNotebook } from '@robotools.app/protocol/src/team';
	import type { TeamInfoAndData } from '$lib/team.svelte';

	interface Props {
		team: TeamInfoAndData;
		showGrade?: boolean;
		/** Show NB / SS badges, so a Judge Advisor can spread notebooks across groups. */
		showNotebook?: boolean;
	}

	let { team, showGrade = true, showNotebook = false }: Props = $props();

	// A notebook counts as in once it has a digital link, or has been sorted as handed in.
	const hasNotebook = $derived(team.notebookLink.trim() !== '' || isSubmittedNotebook(team.notebookDevelopmentStatus));
</script>

<div class="team-info 0 min-h-19 cursor-move rounded bg-white p-3 shadow-sm transition-all hover:shadow-md">
	<div class="flex items-start">
		<div class="min-w-0 flex-1">
			<div class="flex items-center gap-1 text-sm font-medium">
				<span>{team.number}</span>
				{#if showNotebook && hasNotebook}
					<span class="text-xs font-medium text-green-700" title={m.notebook_badge_title()}>{m.notebook_badge()}</span>
				{/if}
				{#if showNotebook && team.hasSeasonSummary}
					<span class="text-xs font-medium text-blue-700" title={m.season_summary_badge_title()}>{m.season_summary_badge()}</span>
				{/if}
			</div>
			<div class="truncate text-xs text-gray-600">{team.name}</div>
			{#if showGrade}
				<div class="text-xs text-gray-500">{team.grade}</div>
			{/if}
		</div>
	</div>
</div>
