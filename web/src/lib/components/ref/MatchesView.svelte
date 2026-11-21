<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import type { MatchSummary } from '@robotools.app/protocol/src/matches';
	import { refApp } from '$lib/ref/ref-app.svelte';
	import { formatTime, incidentsByTeam, worstSeverity, type IncidentPreset } from '$lib/ref/incidents';
	import Button from '$lib/components/m3/Button.svelte';
	import Chip from '$lib/components/m3/Chip.svelte';
	import SeveritySummary from './SeveritySummary.svelte';
	import { currentMatchIndex } from '$lib/ref/current-match';

	interface Props {
		onLog: (preset: IncidentPreset) => void;
		onTeam: (teamNumber: string) => void;
	}

	let { onLog, onTeam }: Props = $props();

	let divisionId = $state<number | 'all'>('all');
	let field = $state<string>('all');
	let showPlayed = $state(false);
	let refreshing = $state(false);
	let refreshError = $state('');

	/**
	 * How many matches to draw. A big event has well over a thousand across its divisions, and
	 * drawing them all makes a phone crawl; refs want what is coming up next.
	 */
	const PAGE_SIZE = 40;
	/** Earlier matches kept above the current one, so a ref can see what just finished. */
	const LOOKBACK = 2;
	let start = $state(0);
	let limit = $state(PAGE_SIZE);

	const hasSchedule = $derived(refApp.hasScheduleSource);
	const multiDivision = $derived((refApp.matches?.divisions.length ?? 0) > 1);
	const byTeam = $derived(incidentsByTeam(refApp.incidents));

	type Row = MatchSummary & { divisionId: number; divisionName: string };

	const allMatches: Row[] = $derived(
		(refApp.matches?.divisions ?? []).flatMap((division) =>
			division.matches.map((match) => ({ ...match, divisionId: division.divisionId, divisionName: division.divisionName }))
		)
	);

	const fields = $derived([...new Set(allMatches.map((match) => match.field).filter((name): name is string => !!name))].sort());

	const inScope: Row[] = $derived(
		allMatches
			.filter((match) => divisionId === 'all' || match.divisionId === divisionId)
			.filter((match) => field === 'all' || match.field === field)
			.sort((a, b) => (a.scheduledAt ?? '').localeCompare(b.scheduledAt ?? '') || a.round - b.round || a.matchnum - b.matchnum)
	);
	const shown: Row[] = $derived(showPlayed ? inScope : inScope.filter((match) => !match.scored));

	/** The match on the field now (or next up), as an index into `shown`; see `currentMatchIndex`. */
	const current = $derived(
		currentMatchIndex(
			shown,
			inScope.some((match) => match.scored),
			Date.now()
		)
	);
	const currentKey = $derived(current >= 0 ? rowKey(shown[current]) : null);

	const visible = $derived(shown.slice(start, start + limit));

	function rowKey(match: Row) {
		return `${match.divisionId}-${match.id}`;
	}

	let anchoredFor = '';
	let listEl = $state<HTMLElement>();

	/**
	 * Open on the current match rather than the first of the day. Runs once per filter (and
	 * once when the schedule first arrives), so a background refresh or a ref scrolling back
	 * through earlier matches isn't yanked to the bottom.
	 */
	$effect(() => {
		const filterKey = `${divisionId}|${field}|${showPlayed}`;
		if (shown.length === 0 || anchoredFor === filterKey) return;
		anchoredFor = filterKey;
		// Once everything is over, open on the last page: the end of the day is what's relevant.
		const index = current >= 0 ? current : Math.max(0, shown.length - PAGE_SIZE + LOOKBACK);
		start = Math.max(0, index - LOOKBACK);
		limit = PAGE_SIZE;
		const key = start > 0 ? currentKey : null;
		requestAnimationFrame(() => {
			if (!key || !listEl) return;
			const card = listEl.querySelector<HTMLElement>(`[data-match="${CSS.escape(key)}"]`);
			card?.scrollIntoView({ block: 'start' });
		});
	});

	function showEarlier() {
		const earlier = Math.max(0, start - PAGE_SIZE);
		limit += start - earlier;
		start = earlier;
	}

	async function refresh() {
		refreshError = '';
		refreshing = true;
		try {
			await refApp.refreshMatches(true);
		} catch (error) {
			refreshError = error instanceof Error ? error.message : String(error);
		} finally {
			refreshing = false;
		}
	}
</script>

{#snippet teamChip(match: Row, teamNumber: string, alliance: 'red' | 'blue')}
	{@const history = byTeam.get(teamNumber) ?? []}
	{@const worst = worstSeverity(history)}
	<span class="inline-flex items-center gap-1">
		<button
			type="button"
			class={[
				'state-layer h-9 rounded-lg px-3 text-title-small',
				alliance === 'red' ? 'bg-error-container text-on-error-container' : 'bg-primary-container text-on-primary-container'
			]}
			aria-label={m.ref_log_team_in_match({ team: teamNumber, match: match.name })}
			onclick={() => onLog({ teamNumber, context: 'match', matchId: match.id, matchName: match.name })}
		>
			{teamNumber}
		</button>
		{#if worst}
			<button type="button" aria-label={m.ref_history_for({ team: teamNumber })} onclick={() => onTeam(teamNumber)}>
				<SeveritySummary items={history} />
			</button>
		{/if}
	</span>
{/snippet}

{#if !hasSchedule}
	<div class="rounded-xl bg-surface-container p-6 text-center text-body-medium text-on-surface-variant">{m.ref_no_schedule()}</div>
{:else}
	<div class="flex flex-col gap-4">
		<div class="flex flex-wrap items-end gap-2">
			{#if multiDivision}
				<label class="flex flex-col gap-1">
					<span class="text-body-small text-on-surface-variant">{m.ref_division()}</span>
					<select
						class="classic"
						value={String(divisionId)}
						onchange={(event) => (divisionId = event.currentTarget.value === 'all' ? 'all' : Number(event.currentTarget.value))}
					>
						<option value="all">{m.ref_all()}</option>
						{#each refApp.matches?.divisions ?? [] as division (division.divisionId)}
							<option value={String(division.divisionId)}>{division.divisionName}</option>
						{/each}
					</select>
				</label>
			{/if}
			{#if fields.length > 1}
				<label class="flex flex-col gap-1">
					<span class="text-body-small text-on-surface-variant">{m.ref_field()}</span>
					<select class="classic" bind:value={field}>
						<option value="all">{m.ref_all()}</option>
						{#each fields as name (name)}
							<option value={name}>{name}</option>
						{/each}
					</select>
				</label>
			{/if}
			<Chip variant="filter" selected={showPlayed} onclick={() => (showPlayed = !showPlayed)}>{m.ref_show_played()}</Chip>
			<div class="ml-auto flex items-center gap-2">
				{#if refApp.matches?.fetchedAt}
					<span class="text-body-small text-on-surface-variant">{m.ref_updated_at({ time: formatTime(refApp.matches.fetchedAt) })}</span>
				{/if}
				<Button variant="outlined" compact disabled={refreshing} onclick={refresh}
					>{refreshing ? m.ref_refreshing() : m.ref_refresh()}</Button
				>
			</div>
		</div>

		{#if refreshError || refApp.matches?.error}
			<p role="alert" class="rounded-lg bg-error-container p-3 text-body-medium text-on-error-container">
				{m.ref_schedule_error({ error: refreshError || refApp.matches?.error || '' })}
			</p>
		{/if}

		<p class="text-body-small text-on-surface-variant">{m.ref_matches_hint()}</p>

		<div class="flex flex-col gap-2" bind:this={listEl}>
			{#if start > 0}
				<Button variant="outlined" onclick={showEarlier}>
					{m.ref_show_earlier({ count: start })}
				</Button>
			{/if}
			{#each visible as match (rowKey(match))}
				{@const isCurrent = rowKey(match) === currentKey}
				<article
					data-match={rowKey(match)}
					aria-current={isCurrent ? 'true' : undefined}
					class={[
						'flex scroll-mt-36 flex-col gap-2 rounded-xl border p-3',
						isCurrent ? 'border-2 border-primary' : 'border-outline-variant',
						match.scored ? 'bg-surface-container-low' : 'bg-surface-container-lowest'
					]}
				>
					<div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
						<span class="text-title-medium text-on-surface">{match.name}</span>
						{#if isCurrent}
							<span class="rounded-full bg-primary px-2 py-0.5 text-label-small text-on-primary">{m.ref_match_now()}</span>
						{/if}
						{#if match.field}<span class="text-body-medium text-on-surface-variant">{match.field}</span>{/if}
						{#if match.scheduledAt}<span class="text-body-medium text-on-surface-variant">{formatTime(Date.parse(match.scheduledAt))}</span
							>{/if}
						{#if multiDivision}<span class="text-body-small text-on-surface-variant">{match.divisionName}</span>{/if}
						{#if match.scored}
							<span class="ml-auto text-body-medium text-on-surface-variant">{match.red.score} – {match.blue.score}</span>
						{/if}
					</div>
					<div class="flex flex-wrap items-center gap-2">
						{#each match.red.teamNumbers as teamNumber (teamNumber)}
							{@render teamChip(match, teamNumber, 'red')}
						{/each}
						<span class="px-1 text-body-small text-on-surface-variant">{m.ref_vs()}</span>
						{#each match.blue.teamNumbers as teamNumber (teamNumber)}
							{@render teamChip(match, teamNumber, 'blue')}
						{/each}
					</div>
				</article>
			{:else}
				<p class="py-10 text-center text-body-medium text-on-surface-variant">
					{refApp.matches === null ? m.loading() : allMatches.length === 0 ? m.ref_schedule_empty() : m.ref_all_played()}
				</p>
			{/each}
			{#if shown.length > start + visible.length}
				<Button variant="outlined" onclick={() => (limit += PAGE_SIZE)}>
					{m.ref_show_more({ shown: start + visible.length, total: shown.length })}
				</Button>
			{/if}
		</div>
	</div>
{/if}
