<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import { app, dialogs } from '$lib/index.svelte';
	import { refNotes } from '$lib/ref-notes.svelte';
	import { INCIDENT_SEVERITIES, normalizeRuleCode, type IncidentSeverity, type JudgeRefNote } from '@robotools.app/protocol/src/ref';
	import { compareSeverity, incidentsByTeam, severityLabel, worstSeverity } from '$lib/ref/incidents';
	import type { RefNotesTab } from '$lib/tab.svelte';
	import Chip from '$lib/components/m3/Chip.svelte';
	import SeveritySummary from '$lib/components/ref/SeveritySummary.svelte';
	import RefNoteCard from './RefNoteCard.svelte';
	import RefNotesTeamDialog from './RefNotesTeamDialog.svelte';
	import RefLinkDialog from '../RefLinkDialog.svelte';
	import JudgeRefNoteDialog from './JudgeRefNoteDialog.svelte';
	import Button from '$lib/components/m3/Button.svelte';
	import { errorToString } from '$lib/utils.svelte';

	/**
	 * What the referees logged about this division's teams, for its Judge Advisors.
	 *
	 * Live, newest first. Notes the refs marked refs only never reach this device. Useful when
	 * weighing conduct for an award; the refs' notes are a record of what happened on the
	 * field, not a ruling on it.
	 */
	interface Props {
		tab: RefNotesTab;
	}

	let { tab }: Props = $props();
	void tab;

	type View = 'notes' | 'teams';

	let view = $state<View>('notes');
	let search = $state('');
	let severities = $state<IncidentSeverity[]>([]);

	const teamNames = $derived(Object.fromEntries(app.getAllTeams().map((team) => [team.number, team.name])));

	const filtered = $derived.by(() => {
		const query = search.trim().toLowerCase();
		const asRule = normalizeRuleCode(search);
		return refNotes.notes.filter((note) => {
			if (severities.length > 0 && !severities.includes(note.severity)) return false;
			if (!query) return true;
			return (
				note.teamNumber.toLowerCase().includes(query) ||
				(teamNames[note.teamNumber] ?? '').toLowerCase().includes(query) ||
				note.ruleCodes.includes(asRule) ||
				note.note.toLowerCase().includes(query)
			);
		});
	});

	/** One row per team with notes, worst first, so the teams worth a closer look come first. */
	const teamRows = $derived(
		[...incidentsByTeam(filtered).entries()]
			.map(([teamNumber, notes]) => ({ teamNumber, notes, worst: worstSeverity(notes)! }))
			.sort((a, b) => compareSeverity(b.worst, a.worst) || b.notes.length - a.notes.length)
	);

	function toggleSeverity(severity: IncidentSeverity) {
		severities = severities.includes(severity) ? severities.filter((item) => item !== severity) : [...severities, severity];
	}

	function openTeam(teamNumber: string) {
		void dialogs.showCustom(RefNotesTeamDialog, { props: { teamNumber } });
	}

	function openNote(note: JudgeRefNote | null) {
		void dialogs.showCustom(JudgeRefNoteDialog, { props: { note } });
	}

	let starting = $state(false);
	let startError = $state('');

	/** For a division made before referee notes came with every new event, or one that unlinked. */
	async function start() {
		starting = true;
		startError = '';
		try {
			await app.wrpcClient.refLink.start.mutation();
			refNotes.signal();
		} catch (cause) {
			startError = errorToString(cause);
		} finally {
			starting = false;
		}
	}
</script>

<div class="flex flex-col gap-4 p-4">
	<div class="flex flex-wrap items-start justify-between gap-3">
		<div>
			<h2 class="text-headline-small text-on-surface">{m.ref_notes_tab_title()}</h2>
			<p class="text-body-medium text-on-surface-variant">{m.ref_notes_tab_description()}</p>
		</div>
		{#if refNotes.linked}
			<Button onclick={() => openNote(null)}>{m.ref_notes_add()}</Button>
		{/if}
	</div>

	{#if !refNotes.linked}
		<div class="flex flex-col gap-3 rounded-xl bg-surface-container p-4">
			<p class="text-body-medium text-on-surface-variant">{m.ref_notes_not_linked()}</p>
			<div class="flex flex-wrap gap-2">
				<Button disabled={starting} onclick={start}>{starting ? m.ref_link_creating() : m.ref_notes_start()}</Button>
				<Button variant="outlined" onclick={() => dialogs.showCustom(RefLinkDialog, { props: {} })}>{m.ref_notes_link_existing()}</Button>
			</div>
			{#if startError}
				<p role="alert" class="text-body-medium text-error">{startError}</p>
			{/if}
		</div>
	{:else}
		{#if !refNotes.refsUsingApp}
			<div class="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-secondary-container p-4 text-on-secondary-container">
				<p class="min-w-60 flex-1 text-body-medium">{m.ref_notes_refs_not_using_app()}</p>
				<Button variant="text" onclick={() => dialogs.showCustom(RefLinkDialog, { props: {} })}>{m.ref_notes_invite_refs()}</Button>
			</div>
		{/if}
		<div class="flex flex-wrap items-center gap-2">
			<input
				class="classic min-w-60 flex-1"
				type="text"
				bind:value={search}
				placeholder={m.ref_notes_search()}
				aria-label={m.ref_notes_search()}
			/>
			<Chip variant="filter" selected={view === 'notes'} onclick={() => (view = 'notes')}>{m.ref_notes_view_notes()}</Chip>
			<Chip variant="filter" selected={view === 'teams'} onclick={() => (view = 'teams')}>{m.ref_notes_view_teams()}</Chip>
		</div>
		<div class="flex flex-wrap gap-2">
			{#each INCIDENT_SEVERITIES as severity (severity)}
				<Chip variant="filter" selected={severities.includes(severity)} onclick={() => toggleSeverity(severity)}
					>{severityLabel(severity)}</Chip
				>
			{/each}
		</div>

		{#if view === 'notes'}
			<div class="flex flex-col gap-2">
				{#each filtered as note (note.id)}
					<RefNoteCard {note} teamName={teamNames[note.teamNumber] ?? null} onTeam={openTeam} onEdit={openNote} />
				{:else}
					<p class="py-10 text-center text-body-medium text-on-surface-variant">
						{refNotes.notes.length === 0 ? m.ref_notes_empty() : m.ref_notes_no_match()}
					</p>
				{/each}
			</div>
		{:else}
			<ul class="flex flex-col divide-y divide-outline-variant rounded-xl border border-outline-variant bg-surface-container-lowest">
				{#each teamRows as row (row.teamNumber)}
					<li>
						<button
							type="button"
							class="state-layer flex w-full items-center gap-3 px-4 py-3 text-left"
							onclick={() => openTeam(row.teamNumber)}
						>
							<span class="w-20 shrink-0 text-title-medium text-on-surface">{row.teamNumber}</span>
							<span class="min-w-0 flex-1 truncate text-body-medium text-on-surface-variant">{teamNames[row.teamNumber] ?? ''}</span>
							<SeveritySummary items={row.notes} />
						</button>
					</li>
				{:else}
					<li class="px-4 py-10 text-center text-body-medium text-on-surface-variant">{m.ref_notes_empty()}</li>
				{/each}
			</ul>
		{/if}
	{/if}
</div>
