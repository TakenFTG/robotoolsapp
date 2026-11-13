<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import { app } from '$lib/index.svelte';
	import RefreshIcon from '$lib/icon/RefreshIcon.svelte';
	import type { MatchSummary, TeamRanking } from '@robotools.app/protocol/src/matches';
	import type { MatchesTab } from '$lib/tab.svelte';
	import { onMount } from 'svelte';

	/**
	 * The match schedule, results and division standings, so a judge does not have to leave
	 * to find them.
	 *
	 * Three views of one fetch. "My teams" is the one that earns its place: a judge cares
	 * when the teams they are interviewing are on a field, and scanning a whole event
	 * schedule for six team numbers is exactly the jumping around this is meant to replace.
	 * "All matches" and "Rankings" are there for a Judge Advisor watching the room as a
	 * whole — and rankings matter to judging directly, because several awards ask about a
	 * team's performance on the field.
	 *
	 * The data comes from the room, not from RobotEvents. The server polls once every five
	 * minutes on behalf of everyone in the room and this reads the result, so opening the
	 * tab costs one local request however many judges do it at once — and the shared
	 * RobotEvents token never travels to a judge's device. Refresh asks the room again,
	 * which re-reads its cache unless it is old enough to be worth another fetch.
	 */
	interface Props {
		tab: MatchesTab;
	}

	// Declared but unread: every tab is handed its own instance, and the type is what keeps
	// this component and the MatchesTab class in step.
	let { tab }: Props = $props();
	void tab;

	type View = 'mine' | 'all' | 'rankings';

	let matches = $state<MatchSummary[]>([]);
	let rankings = $state<TeamRanking[]>([]);
	let loading = $state(false);
	let errorMessage = $state<string | null>(null);
	let fetchedAt = $state<Date | null>(null);
	let available = $state(true);
	let loadedOnce = $state(false);
	let chosenView = $state<View | null>(null);

	const teams = $derived(app.getAllTeamInfoAndData());
	const judgeGroup = $derived(app.getCurrentUserJudgeGroup());

	/**
	 * The team numbers this judge is responsible for.
	 *
	 * A Judge Advisor has no judge group, so "my teams" would be empty for them — they get
	 * the whole event instead, which is what they are looking at anyway.
	 */
	const myTeamNumbers = $derived.by(() => {
		if (!judgeGroup) return null;
		const numbers = judgeGroup.assignedTeams.map((teamId) => teams[teamId]?.number).filter((number): number is string => !!number);
		return numbers.length > 0 ? new Set(numbers) : null;
	});

	const canFilterToMyTeams = $derived(!!myTeamNumbers);

	/**
	 * The view actually being shown.
	 *
	 * Kept separate from the button the person last pressed so that "My teams" can never
	 * strand them. It used to be the default view *and* disabled for anyone without
	 * assigned teams — a Judge Advisor would open on it, switch to all matches, and find no
	 * way back, because the button they needed had been dead the whole time. Now the view
	 * falls back on its own and the button only exists when it does something.
	 */
	const view = $derived.by<View>(() => {
		if (chosenView === null) return canFilterToMyTeams ? 'mine' : 'all';
		if (chosenView === 'mine' && !canFilterToMyTeams) return 'all';
		return chosenView;
	});

	const visibleMatches = $derived.by(() => {
		if (view !== 'mine' || !myTeamNumbers) return matches;
		return matches.filter(
			(match) =>
				match.red.teamNumbers.some((number) => myTeamNumbers.has(number)) ||
				match.blue.teamNumbers.some((number) => myTeamNumbers.has(number))
		);
	});

	/**
	 * Which ranking columns to show, decided by the data rather than by the program.
	 *
	 * V5RC and VURC rank on WP/AP/SP; VIQRC has no alliances to win against and ranks on
	 * average points. Reading that off the standings themselves avoids plumbing the program
	 * through, and an event with nothing scored yet shows either set as zeros regardless.
	 */
	const ranksOnWinPoints = $derived(rankings.some((entry) => entry.wp > 0 || entry.ap > 0 || entry.sp > 0));

	async function load(force: boolean) {
		if (loading) return;

		loading = true;
		try {
			const snapshot = await app.wrpcClient.matches.getSnapshot.query({ force });
			matches = snapshot.matches;
			rankings = snapshot.rankings;
			available = snapshot.available;
			fetchedAt = snapshot.fetchedAt === null ? null : new Date(snapshot.fetchedAt);
			// The server reports a failed fetch alongside the last good schedule, so both can
			// be true: here is the schedule, and here is why it may be out of date.
			errorMessage = snapshot.error;
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : String(error);
		} finally {
			loading = false;
			loadedOnce = true;
		}
	}

	// Read on open. The tab is opened from the Start menu and reused if it is already open,
	// so this runs when a judge asks for it rather than on every load, and switching back to
	// an open tab costs nothing.
	onMount(() => {
		void load(false);
	});

	function isMine(teamNumber: string): boolean {
		return !!myTeamNumbers?.has(teamNumber);
	}

	/**
	 * Whether this match has been played.
	 *
	 * `scored` is the flag Tournament Manager publishes and is the right answer when it is
	 * set, but it lags — which is why there was a fallback at all. That fallback used to be
	 * "either alliance scored something", and it had an obvious hole once stated out loud: a
	 * real 0–0 result is indistinguishable from a match that has not happened. Those exist,
	 * and the tab called them unplayed.
	 *
	 * `startedAt` is the direct signal. A match that has been run has a start time; one
	 * still to come does not. It answers the question the column is actually asking, where
	 * the score was only ever circumstantial evidence.
	 *
	 * The score check stays as a third arm. It is redundant whenever `startedAt` is
	 * populated, costs nothing, and this disjunction can only ever turn "not played" into a
	 * shown result — never the reverse — which is the safe direction for this bug.
	 *
	 * Trade-off worth knowing: a match currently on the field has started and is not yet
	 * scored, so it now shows 0 – 0 rather than "not played" for the couple of minutes it is
	 * running. Nothing in the feed distinguishes "in progress" from "finished but the flag
	 * has not caught up", so that ambiguity is inherent rather than chosen.
	 */
	function hasResult(match: MatchSummary): boolean {
		return match.scored || match.startedAt !== null || match.red.score > 0 || match.blue.score > 0;
	}

	function formatTime(value: string | null): string {
		if (!value) return '';
		const date = new Date(value);
		return Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
	}

	function formatPoints(value: number): string {
		return Number.isInteger(value) ? String(value) : value.toFixed(1);
	}
</script>

<div class="flex h-full flex-col overflow-hidden p-4">
	<div class="mb-3 flex shrink-0 flex-wrap items-center justify-between gap-3">
		<div class="flex items-center gap-2">
			{#if canFilterToMyTeams}
				<button
					type="button"
					class="rounded-md px-3 py-1 text-sm font-medium"
					class:bg-primary={view === 'mine'}
					class:text-on-primary={view === 'mine'}
					class:bg-gray-100={view !== 'mine'}
					class:text-gray-700={view !== 'mine'}
					onclick={() => (chosenView = 'mine')}
				>
					{m.matches_view_mine()}
				</button>
			{/if}
			<button
				type="button"
				class="rounded-md px-3 py-1 text-sm font-medium"
				class:bg-primary={view === 'all'}
				class:text-on-primary={view === 'all'}
				class:bg-gray-100={view !== 'all'}
				class:text-gray-700={view !== 'all'}
				onclick={() => (chosenView = 'all')}
			>
				{m.matches_view_all()}
			</button>
			<button
				type="button"
				class="rounded-md px-3 py-1 text-sm font-medium"
				class:bg-primary={view === 'rankings'}
				class:text-on-primary={view === 'rankings'}
				class:bg-gray-100={view !== 'rankings'}
				class:text-gray-700={view !== 'rankings'}
				onclick={() => (chosenView = 'rankings')}
			>
				{m.matches_view_rankings()}
			</button>
		</div>

		<div class="flex items-center gap-3">
			{#if fetchedAt}
				<span class="text-xs text-gray-500">{m.matches_updated({ time: fetchedAt.toLocaleTimeString() })}</span>
			{/if}
			<button type="button" class="lightweight tiny flex items-center gap-2" onclick={() => load(true)} disabled={loading}>
				<RefreshIcon />
				{loading ? m.matches_refreshing() : m.matches_refresh()}
			</button>
		</div>
	</div>

	{#if !available}
		<!-- Nothing to show, and nothing the judge can do about it: the schedule comes from
		     RobotEvents, and this event was set up without being linked to one. -->
		<p class="text-sm text-gray-600">{m.matches_not_linked()}</p>
	{:else if !loadedOnce}
		<p class="text-sm text-gray-600">{m.matches_loading()}</p>
	{:else if errorMessage && matches.length === 0 && rankings.length === 0}
		<div class="rounded-md bg-red-50 p-3 text-sm text-red-800">{m.matches_failed({ reason: errorMessage })}</div>
	{:else}
		{#if errorMessage}
			<div class="mb-2 shrink-0 rounded-md bg-amber-50 p-2 text-xs text-amber-800">{m.matches_stale({ reason: errorMessage })}</div>
		{/if}

		{#if view === 'rankings'}
			{#if rankings.length === 0}
				<p class="text-sm text-gray-600">{m.matches_rankings_none()}</p>
			{:else}
				<div class="min-h-0 flex-1 overflow-auto">
					<table class="w-full border-collapse text-sm">
						<thead class="sticky top-0 bg-white">
							<tr class="border-b border-gray-300 text-left">
								<th class="py-2 pr-3 font-semibold">{m.matches_column_rank()}</th>
								<th class="py-2 pr-3 font-semibold">{m.matches_column_team()}</th>
								<th class="py-2 pr-3 font-semibold">{m.matches_column_record()}</th>
								{#if ranksOnWinPoints}
									<th class="py-2 pr-3 text-right font-semibold">{m.matches_column_wp()}</th>
									<th class="py-2 pr-3 text-right font-semibold">{m.matches_column_ap()}</th>
									<th class="py-2 pr-3 text-right font-semibold">{m.matches_column_sp()}</th>
								{:else}
									<th class="py-2 pr-3 text-right font-semibold">{m.matches_column_average()}</th>
									<th class="py-2 pr-3 text-right font-semibold">{m.matches_column_high()}</th>
								{/if}
							</tr>
						</thead>
						<tbody>
							{#each rankings as entry (entry.teamNumber)}
								<tr class="border-b border-gray-100" class:bg-amber-50={isMine(entry.teamNumber)}>
									<td class="py-2 pr-3 font-medium whitespace-nowrap">{entry.rank}</td>
									<td class="py-2 pr-3 whitespace-nowrap" class:font-bold={isMine(entry.teamNumber)}>{entry.teamNumber}</td>
									<td class="py-2 pr-3 whitespace-nowrap text-gray-600">{entry.wins}-{entry.losses}-{entry.ties}</td>
									{#if ranksOnWinPoints}
										<td class="py-2 pr-3 text-right whitespace-nowrap">{formatPoints(entry.wp)}</td>
										<td class="py-2 pr-3 text-right whitespace-nowrap text-gray-600">{formatPoints(entry.ap)}</td>
										<td class="py-2 pr-3 text-right whitespace-nowrap text-gray-600">{formatPoints(entry.sp)}</td>
									{:else}
										<td class="py-2 pr-3 text-right whitespace-nowrap">{formatPoints(entry.averagePoints)}</td>
										<td class="py-2 pr-3 text-right whitespace-nowrap text-gray-600">{formatPoints(entry.highScore)}</td>
									{/if}
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}
		{:else if visibleMatches.length === 0}
			<p class="text-sm text-gray-600">{view === 'mine' ? m.matches_none_for_my_teams() : m.matches_none()}</p>
		{:else}
			<div class="min-h-0 flex-1 overflow-auto">
				<table class="w-full border-collapse text-sm">
					<thead class="sticky top-0 bg-white">
						<tr class="border-b border-gray-300 text-left">
							<th class="py-2 pr-3 font-semibold">{m.matches_column_match()}</th>
							<th class="py-2 pr-3 font-semibold">{m.matches_column_time()}</th>
							<th class="py-2 pr-3 font-semibold">{m.matches_column_field()}</th>
							<th class="py-2 pr-3 font-semibold">{m.matches_column_red()}</th>
							<th class="py-2 pr-3 font-semibold">{m.matches_column_blue()}</th>
							<th class="py-2 text-right font-semibold">{m.matches_column_score()}</th>
						</tr>
					</thead>
					<tbody>
						{#each visibleMatches as match (match.id)}
							<tr class="border-b border-gray-100 align-top">
								<td class="py-2 pr-3 font-medium whitespace-nowrap">{match.name}</td>
								<td class="py-2 pr-3 whitespace-nowrap text-gray-600">{formatTime(match.startedAt ?? match.scheduledAt)}</td>
								<td class="py-2 pr-3 whitespace-nowrap text-gray-600">{match.field ?? ''}</td>
								<td class="py-2 pr-3">
									<div class="flex flex-wrap items-baseline gap-x-2">
										{#each match.red.teamNumbers as number (number)}
											<span class:font-bold={isMine(number)} class:text-red-700={isMine(number)}>{number}</span>
										{/each}
									</div>
								</td>
								<td class="py-2 pr-3">
									<div class="flex flex-wrap items-baseline gap-x-2">
										{#each match.blue.teamNumbers as number (number)}
											<span class:font-bold={isMine(number)} class:text-blue-700={isMine(number)}>{number}</span>
										{/each}
									</div>
								</td>
								<td class="py-2 text-right whitespace-nowrap">
									{#if hasResult(match)}
										<!-- The winning side is bolded rather than labelled: it reads at a glance,
										     and it stays correct for a tie, where neither is. -->
										<span
											class="text-red-700"
											class:font-bold={match.red.score > match.blue.score}
											class:text-gray-500={match.red.score < match.blue.score}>{match.red.score}</span
										>
										<span class="mx-1 text-gray-400">–</span>
										<span
											class="text-blue-700"
											class:font-bold={match.blue.score > match.red.score}
											class:text-gray-500={match.blue.score < match.red.score}>{match.blue.score}</span
										>
									{:else}
										<span class="text-gray-400">{m.matches_not_played()}</span>
									{/if}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	{/if}
</div>
