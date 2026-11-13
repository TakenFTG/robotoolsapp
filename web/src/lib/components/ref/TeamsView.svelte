<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import { refApp } from '$lib/ref/ref-app.svelte';
	import { incidentsByTeam, worstSeverity } from '$lib/ref/incidents';
	import Chip from '$lib/components/m3/Chip.svelte';
	import SeveritySummary from './SeveritySummary.svelte';

	interface Props {
		onTeam: (teamNumber: string) => void;
	}

	let { onTeam }: Props = $props();

	let search = $state('');
	let withIncidentsOnly = $state(false);

	const byTeam = $derived(incidentsByTeam(refApp.incidents));

	/** The team list, plus any team logged against that is not on it, so nothing is hidden. */
	const rows = $derived.by(() => {
		const known = new Map(refApp.teams.map((team) => [team.number, team]));
		const numbers = new Set([...known.keys(), ...byTeam.keys()]);
		const query = search.trim().toLowerCase();
		return [...numbers]
			.map((number) => ({ number, team: known.get(number) ?? null, incidents: byTeam.get(number) ?? [] }))
			.filter((row) => !withIncidentsOnly || row.incidents.length > 0)
			.filter(
				(row) =>
					!query ||
					row.number.toLowerCase().includes(query) ||
					(row.team?.name.toLowerCase().includes(query) ?? false) ||
					(row.team?.school.toLowerCase().includes(query) ?? false)
			)
			.sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true }));
	});
</script>

<div class="flex flex-col gap-4">
	<input
		class="classic"
		type="text"
		bind:value={search}
		placeholder={m.ref_teams_search()}
		aria-label={m.ref_teams_search()}
		autocomplete="off"
	/>
	<div class="flex gap-2">
		<Chip variant="filter" selected={withIncidentsOnly} onclick={() => (withIncidentsOnly = !withIncidentsOnly)}
			>{m.ref_with_incidents_only()}</Chip
		>
	</div>

	<ul class="flex flex-col divide-y divide-outline-variant rounded-xl border border-outline-variant bg-surface-container-lowest">
		{#each rows as row (row.number)}
			{@const worst = worstSeverity(row.incidents)}
			<li>
				<button type="button" class="state-layer flex w-full items-center gap-3 px-4 py-3 text-left" onclick={() => onTeam(row.number)}>
					<span class="w-20 shrink-0 text-title-medium text-on-surface">{row.number}</span>
					<span class="min-w-0 flex-1 truncate text-body-medium text-on-surface-variant">{row.team?.name ?? m.ref_team_not_on_list()}</span>
					{#if worst}
						<SeveritySummary items={row.incidents} />
					{/if}
				</button>
			</li>
		{:else}
			<li class="px-4 py-10 text-center text-body-medium text-on-surface-variant">{m.ref_teams_empty()}</li>
		{/each}
	</ul>
</div>
