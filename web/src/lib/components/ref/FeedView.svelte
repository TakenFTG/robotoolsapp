<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import { INCIDENT_SEVERITIES, normalizeRuleCode, type Incident, type IncidentSeverity } from '@robotools.app/protocol/src/ref';
	import { refApp } from '$lib/ref/ref-app.svelte';
	import { severityLabel } from '$lib/ref/incidents';
	import Chip from '$lib/components/m3/Chip.svelte';
	import IncidentCard from './IncidentCard.svelte';

	interface Props {
		onEdit: (incident: Incident) => void;
		onTeam: (teamNumber: string) => void;
	}

	let { onEdit, onTeam }: Props = $props();

	let search = $state('');
	let severities = $state<IncidentSeverity[]>([]);
	let where = $state<'all' | 'match' | 'skills'>('all');
	let mineOnly = $state(false);

	const filtered = $derived.by(() => {
		const query = search.trim().toLowerCase();
		const asRule = normalizeRuleCode(search);
		return refApp.incidents.filter((incident) => {
			if (severities.length > 0 && !severities.includes(incident.severity)) return false;
			if (where !== 'all' && incident.context !== where) return false;
			if (mineOnly && incident.authorRefereeId !== refApp.self?.refereeId) return false;
			if (!query) return true;
			return (
				incident.teamNumber.toLowerCase().includes(query) ||
				incident.ruleCodes.some((code) => code === asRule) ||
				incident.note.toLowerCase().includes(query) ||
				incident.authorName.toLowerCase().includes(query) ||
				(incident.matchName ?? '').toLowerCase().includes(query)
			);
		});
	});

	function toggleSeverity(severity: IncidentSeverity) {
		severities = severities.includes(severity) ? severities.filter((item) => item !== severity) : [...severities, severity];
	}
</script>

<div class="flex flex-col gap-4">
	<input
		class="classic"
		type="text"
		bind:value={search}
		placeholder={m.ref_feed_search()}
		aria-label={m.ref_feed_search()}
		autocomplete="off"
	/>

	<div class="flex flex-wrap gap-2">
		<Chip variant="filter" selected={where === 'match'} onclick={() => (where = where === 'match' ? 'all' : 'match')}>{m.ref_match()}</Chip>
		<Chip variant="filter" selected={where === 'skills'} onclick={() => (where = where === 'skills' ? 'all' : 'skills')}
			>{m.ref_skills()}</Chip
		>
		<Chip variant="filter" selected={mineOnly} onclick={() => (mineOnly = !mineOnly)}>{m.ref_mine()}</Chip>
		{#each INCIDENT_SEVERITIES as severity (severity)}
			<Chip variant="filter" selected={severities.includes(severity)} onclick={() => toggleSeverity(severity)}
				>{severityLabel(severity)}</Chip
			>
		{/each}
	</div>

	<p class="text-body-small text-on-surface-variant">{m.ref_showing_count({ shown: filtered.length, total: refApp.incidents.length })}</p>

	<div class="flex flex-col gap-2">
		{#each filtered as incident (incident.id)}
			<IncidentCard {incident} {onEdit} {onTeam} />
		{:else}
			<p class="py-10 text-center text-body-medium text-on-surface-variant">
				{refApp.incidents.length === 0 ? m.ref_feed_empty() : m.ref_feed_no_match()}
			</p>
		{/each}
	</div>
</div>
