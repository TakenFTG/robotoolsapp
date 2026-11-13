<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import type { Incident } from '@robotools.app/protocol/src/ref';
	import { refApp } from '$lib/ref/ref-app.svelte';
	import type { IncidentPreset } from '$lib/ref/incidents';
	import IncidentDialog from './IncidentDialog.svelte';
	import TeamHistoryDialog from './TeamHistoryDialog.svelte';
	import MatchesView from './MatchesView.svelte';
	import FeedView from './FeedView.svelte';
	import TeamsView from './TeamsView.svelte';
	import RefereesView from './RefereesView.svelte';
	import RulesView from './RulesView.svelte';
	import RefEventsDialog from './RefEventsDialog.svelte';
	import { refBack } from '$lib/ref/back.svelte';

	type TabId = 'matches' | 'feed' | 'teams' | 'rules' | 'refs';

	let tab = $state<TabId>('matches');

	/** The log form: closed, or open on an incident (edit) or a preset (new). */
	let form: { incident: Incident | null; preset: IncidentPreset } | null = $state(null);
	let historyTeam = $state<string | null>(null);
	let eventsOpen = $state(false);

	const tabs = $derived([
		{ id: 'matches' as const, label: m.ref_tab_matches() },
		{ id: 'feed' as const, label: m.ref_tab_feed() },
		{ id: 'teams' as const, label: m.ref_tab_teams() },
		{ id: 'rules' as const, label: m.ref_tab_rules() },
		{ id: 'refs' as const, label: refApp.isHeadReferee ? m.ref_tab_manage() : m.ref_tab_refs() }
	]);

	const statusClass = $derived(
		refApp.connectionState === 'connected' ? 'bg-success' : refApp.connectionState === 'error' ? 'bg-error' : 'bg-warning'
	);
	const statusText = $derived(
		refApp.connectionState === 'connected'
			? m.ref_status_live()
			: refApp.connectionState === 'offline'
				? m.ref_status_offline()
				: m.ref_status_reconnecting()
	);

	// Back closes the log form or a team's history, and from any other tab returns to Matches.
	$effect(() => {
		if (tab !== 'matches') {
			return refBack.push(() => (tab = 'matches'));
		}
	});
	$effect(() => {
		if (historyTeam) {
			return refBack.push(() => (historyTeam = null));
		}
	});
	$effect(() => {
		if (form) {
			return refBack.push(() => (form = null));
		}
	});
	$effect(() => {
		if (eventsOpen) {
			return refBack.push(() => (eventsOpen = false));
		}
	});

	function logIncident(preset: IncidentPreset = {}) {
		historyTeam = null;
		form = { incident: null, preset };
	}

	function editIncident(incident: Incident) {
		historyTeam = null;
		form = { incident, preset: {} };
	}

	// The schedule is fetched once on arrival; the Matches tab refreshes it after that.
	$effect(() => {
		if (refApp.hasScheduleSource && !refApp.matches) {
			void refApp.refreshMatches().catch((error) => console.error('Failed to load matches:', error));
		}
	});
</script>

<div class="flex min-h-screen flex-col bg-surface">
	<header class="sticky top-0 z-10 border-b border-outline-variant bg-surface-container">
		<div class="mx-auto flex max-w-4xl items-center gap-3 px-4 py-3">
			<div class="min-w-0 flex-1">
				<h1 class="truncate text-title-large text-on-surface">{refApp.event?.eventName}</h1>
				<p class="flex items-center gap-2 truncate text-body-small text-on-surface-variant">
					<span class={['inline-block size-2 shrink-0 rounded-full', statusClass]} aria-hidden="true"></span>
					<span>{statusText}</span>
					<span aria-hidden="true">·</span>
					<span class="truncate">
						{refApp.self?.name} ({refApp.isHeadReferee ? m.ref_role_head_referee() : m.ref_role_referee()})
					</span>
				</p>
			</div>
			<button
				type="button"
				class="state-layer flex items-center gap-2 rounded-full px-3 py-2 text-label-large text-on-surface-variant"
				onclick={() => (eventsOpen = true)}
			>
				{m.ref_events()}
				{#if refApp.savedEvents.length > 1}
					<span
						class="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-secondary-container px-1.5 text-label-small text-on-secondary-container"
						aria-label={m.ref_events_saved_count({ count: refApp.savedEvents.length })}
					>
						{refApp.savedEvents.length}
					</span>
				{/if}
			</button>
		</div>
		<nav class="mx-auto flex max-w-4xl overflow-x-auto px-2" aria-label={m.ref_sections()}>
			{#each tabs as item (item.id)}
				<button
					type="button"
					class={[
						'state-layer h-12 flex-1 border-b-2 px-2.5 text-title-small whitespace-nowrap sm:px-4',
						tab === item.id ? 'border-primary text-primary' : 'border-transparent text-on-surface-variant'
					]}
					aria-current={tab === item.id ? 'page' : undefined}
					onclick={() => (tab = item.id)}
				>
					{item.label}
				</button>
			{/each}
		</nav>
	</header>

	<main class="mx-auto w-full max-w-4xl flex-1 px-4 pt-4 pb-28">
		{#if tab === 'matches'}
			<MatchesView onLog={logIncident} onTeam={(team) => (historyTeam = team)} />
		{:else if tab === 'feed'}
			<FeedView onEdit={editIncident} onTeam={(team) => (historyTeam = team)} />
		{:else if tab === 'teams'}
			<TeamsView onTeam={(team) => (historyTeam = team)} />
		{:else if tab === 'rules'}
			<RulesView onLog={(code) => logIncident({ ruleCodes: [code] })} />
		{:else}
			<RefereesView />
		{/if}
	</main>

	<button
		type="button"
		class="fixed right-4 bottom-6 z-20 flex h-14 items-center gap-2 rounded-2xl bg-primary-container px-5 text-label-large text-on-primary-container shadow-elev-3"
		onclick={() => logIncident()}
	>
		<span aria-hidden="true" class="text-headline-small leading-none">+</span>
		{m.ref_log_incident()}
	</button>
</div>

{#if historyTeam}
	<TeamHistoryDialog
		teamNumber={historyTeam}
		onClose={() => (historyTeam = null)}
		onLog={(teamNumber) => logIncident({ teamNumber })}
		onEdit={editIncident}
	/>
{/if}

{#if eventsOpen}
	<RefEventsDialog onClose={() => (eventsOpen = false)} />
{/if}

{#if form}
	<IncidentDialog incident={form.incident} preset={form.preset} onClose={() => (form = null)} />
{/if}
