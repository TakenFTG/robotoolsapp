<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import type { Incident } from '@robotools.app/protocol/src/ref';
	import { refApp } from '$lib/ref/ref-app.svelte';
	import { worstSeverity } from '$lib/ref/incidents';
	import Dialog from '$lib/components/dialog/Dialog.svelte';
	import Button from '$lib/components/m3/Button.svelte';
	import IncidentCard from './IncidentCard.svelte';
	import SeverityBadge from './SeverityBadge.svelte';

	interface Props {
		teamNumber: string;
		onClose: () => void;
		onLog: (teamNumber: string) => void;
		onEdit: (incident: Incident) => void;
	}

	let { teamNumber, onClose, onLog, onEdit }: Props = $props();

	const team = $derived(refApp.teams.find((item) => item.number === teamNumber) ?? null);
	const history = $derived(refApp.incidents.filter((incident) => incident.teamNumber === teamNumber));
	const worst = $derived(worstSeverity(history));
</script>

<Dialog open={true} {onClose} innerContainerClass="max-w-lg">
	<div class="flex h-full flex-col gap-4 md:max-h-[80vh]">
		<div>
			<div class="flex items-center gap-2">
				<h2 id="dialog-title" class="text-headline-small text-on-surface">{teamNumber}</h2>
				{#if worst}
					<SeverityBadge severity={worst} />
				{/if}
			</div>
			{#if team}
				<p class="text-body-medium text-on-surface-variant">{team.name} · {team.school}</p>
			{/if}
		</div>

		<div class="flex flex-1 flex-col gap-2 overflow-y-auto">
			{#each history as incident (incident.id)}
				<IncidentCard {incident} showTeam={false} {onEdit} />
			{:else}
				<p class="py-6 text-center text-body-medium text-on-surface-variant">{m.ref_no_incidents_for_team()}</p>
			{/each}
		</div>

		<div class="flex justify-end gap-2">
			<Button variant="text" onclick={onClose}>{m.ref_close()}</Button>
			<Button onclick={() => onLog(teamNumber)}>{m.ref_log_for_team()}</Button>
		</div>
	</div>
</Dialog>
