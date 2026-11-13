<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import type { Incident } from '@robotools.app/protocol/src/ref';
	import { refApp } from '$lib/ref/ref-app.svelte';
	import { canModify, formatTime, incidentWhere } from '$lib/ref/incidents';
	import SeverityBadge from './SeverityBadge.svelte';
	import RuleCode from './RuleCode.svelte';

	interface Props {
		incident: Incident;
		/** Hide the team number, when the list is already one team's. */
		showTeam?: boolean;
		onEdit?: (incident: Incident) => void;
		onTeam?: (teamNumber: string) => void;
	}

	let { incident, showTeam = true, onEdit, onTeam }: Props = $props();

	const editable = $derived(canModify(incident, refApp.self));
</script>

<article class="flex flex-col gap-2 rounded-xl border border-outline-variant bg-surface-container-lowest p-3">
	<div class="flex flex-wrap items-center gap-2">
		<SeverityBadge severity={incident.severity} />
		{#if showTeam}
			{#if onTeam}
				<button
					type="button"
					class="text-title-medium text-primary underline-offset-2 hover:underline"
					onclick={() => onTeam(incident.teamNumber)}
				>
					{incident.teamNumber}
				</button>
			{:else}
				<span class="text-title-medium text-on-surface">{incident.teamNumber}</span>
			{/if}
		{/if}
		<span class="text-body-medium text-on-surface-variant">{incidentWhere(incident)}</span>
		{#each incident.ruleCodes as code (code)}
			<RuleCode {code} />
		{/each}
		{#if incident.private}
			<span class="rounded-md border border-outline px-1.5 text-label-medium text-on-surface-variant" title={m.ref_private_description()}>
				{m.ref_private_badge()}
			</span>
		{/if}
	</div>

	{#if incident.note}
		<p class="text-body-medium whitespace-pre-wrap text-on-surface">{incident.note}</p>
	{/if}

	<div class="flex items-center justify-between gap-2 text-body-small text-on-surface-variant">
		<span>
			{incident.authorName} · {formatTime(incident.createdAt)}{incident.updatedAt - incident.createdAt > 1000 ? ` · ${m.ref_edited()}` : ''}
		</span>
		{#if editable && onEdit}
			<button type="button" class="state-layer rounded-md px-2 py-1 text-label-large text-primary" onclick={() => onEdit(incident)}>
				{m.ref_edit()}
			</button>
		{/if}
	</div>
</article>
