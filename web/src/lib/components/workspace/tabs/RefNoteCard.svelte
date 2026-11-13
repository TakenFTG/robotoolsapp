<script lang="ts">
	import type { JudgeRefNote } from '@robotools.app/protocol/src/ref';
	import { formatTime, incidentWhere } from '$lib/ref/incidents';
	import { app } from '$lib/index.svelte';
	import SeverityBadge from '$lib/components/ref/SeverityBadge.svelte';
	import RuleCode from '$lib/components/ref/RuleCode.svelte';
	import Button from '$lib/components/m3/Button.svelte';
	import { m } from '$lib/paraglide/messages.js';

	interface Props {
		note: JudgeRefNote;
		/** Hide the team, when the list is already one team's. */
		showTeam?: boolean;
		teamName?: string | null;
		onTeam?: (teamNumber: string) => void;
		/** Offered on notes this division's Judge Advisors wrote. */
		onEdit?: (note: JudgeRefNote) => void;
	}

	let { note, showTeam = true, teamName = null, onTeam, onEdit }: Props = $props();
</script>

<article class="flex flex-col gap-2 rounded-xl border border-outline-variant bg-surface-container-lowest p-3">
	<div class="flex flex-wrap items-center gap-2">
		<SeverityBadge severity={note.severity} />
		{#if showTeam}
			{#if onTeam}
				<button
					type="button"
					class="text-title-medium text-primary underline-offset-2 hover:underline"
					onclick={() => onTeam(note.teamNumber)}
				>
					{note.teamNumber}
				</button>
			{:else}
				<span class="text-title-medium text-on-surface">{note.teamNumber}</span>
			{/if}
			{#if teamName}
				<span class="text-body-medium text-on-surface-variant">{teamName}</span>
			{/if}
		{/if}
		<span class="text-body-medium text-on-surface-variant">{incidentWhere(note)}</span>
		{#each note.ruleCodes as code (code)}
			<RuleCode {code} program={app.getEssentialData()?.program} />
		{/each}
	</div>
	{#if note.note}
		<p class="text-body-medium whitespace-pre-wrap text-on-surface">{note.note}</p>
	{/if}
	<div class="flex items-center justify-between gap-2">
		<p class="text-body-small text-on-surface-variant">{note.authorName} · {formatTime(note.createdAt)}</p>
		{#if note.editable && onEdit}
			<Button variant="text" compact onclick={() => onEdit(note)}>{m.ref_notes_edit()}</Button>
		{/if}
	</div>
</article>
