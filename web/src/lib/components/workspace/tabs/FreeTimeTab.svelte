<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import { app } from '$lib/index.svelte';
	import RefreshIcon from '$lib/icon/RefreshIcon.svelte';
	import type { MatchSummary } from '@robotools.app/protocol/src/matches';
	import type { FreeTimeTab } from '$lib/tab.svelte';
	import {
		DEFAULT_MIN_LENGTH_MS,
		freeTime,
		matchTime,
		MATCH_BUSY_AFTER_MS,
		MATCH_BUSY_BEFORE_MS,
		type TeamFreeTime,
		type WindowEdge
	} from '$lib/free-time';
	import { onMount } from 'svelte';

	/**
	 * Each team's next few free windows between its matches that are long enough for an
	 * interview, one card per team, so judges can pick a time when the team is not queuing
	 * or on a field. The next ones rather than the longest, because the longest is often
	 * too late in the day; more than one, so a judge who cannot make the first still has
	 * somewhere to go.
	 *
	 * Who is listed follows how the event judges. With assigned judging a judge opens on
	 * their own group's teams, because those are the interviews they have to fit in; they
	 * can still look at everyone. With walk-in judging any judge can see any team, and a
	 * Judge Advisor has no group, so both see every team.
	 *
	 * The schedule is the room's cached snapshot, the same one the matches tab reads. It is
	 * read again every minute while the tab is open, so start times of matches as they are
	 * played — and with them how late the event is running — come through without anyone
	 * pressing Refresh. The server only goes to RobotEvents every five minutes regardless.
	 */
	interface Props {
		tab: FreeTimeTab;
	}

	let { tab }: Props = $props();
	void tab;

	type SortKey = 'start' | 'team';

	/** How many upcoming windows each team's card shows. */
	const WINDOWS_PER_TEAM = 3;

	let matches = $state<MatchSummary[]>([]);
	let loading = $state(false);
	let errorMessage = $state<string | null>(null);
	let fetchedAt = $state<Date | null>(null);
	let available = $state(true);
	let loadedOnce = $state(false);
	let mineOnly = $state(true);
	let sortKey = $state<SortKey>('start');

	const MIN_LENGTH_CHOICES = [10, 15, 20, 30];
	const MIN_LENGTH_STORAGE_KEY = 'freeTime.minLengthMinutes';
	// Remembered per device: a judge who prefers 20 minute interviews should not have to
	// pick it every time they open the tab.
	let minLengthMinutes = $state(readMinLength());

	function readMinLength(): number {
		try {
			const stored = Number(localStorage.getItem(MIN_LENGTH_STORAGE_KEY));
			if (MIN_LENGTH_CHOICES.includes(stored)) return stored;
		} catch {
			// Storage can be unavailable (private windows, blocked site data); use the default.
		}
		return DEFAULT_MIN_LENGTH_MS / 60000;
	}

	function setMinLength(minutes: number) {
		minLengthMinutes = minutes;
		try {
			localStorage.setItem(MIN_LENGTH_STORAGE_KEY, String(minutes));
		} catch {
			// Not remembered, which is fine.
		}
	}
	// Ticks every minute, so a window that has started or ended moves along with the clock.
	let now = $state(Date.now());

	const teams = $derived(app.getAllTeamInfoAndData());
	const judgeGroup = $derived(app.getCurrentUserJudgeGroup());
	const judgingMethod = $derived(app.getEssentialData()?.judgingMethod ?? 'walk_in');

	const myTeamNumbers = $derived.by(() => {
		if (judgingMethod !== 'assigned' || !judgeGroup) return null;
		const numbers = judgeGroup.assignedTeams.map((teamId) => teams[teamId]?.number).filter((number): number is string => !!number);
		return numbers.length > 0 ? new Set(numbers) : null;
	});

	const canFilterToMyTeams = $derived(!!myTeamNumbers);
	const filtered = $derived(mineOnly && canFilterToMyTeams);

	const teamNumbers = $derived.by(() => {
		const all = Object.values(teams).map((team) => team.number);
		return filtered && myTeamNumbers ? all.filter((number) => myTeamNumbers.has(number)) : all;
	});

	const hasTimedMatches = $derived(matches.some((match) => matchTime(match) !== null));

	/** Whether the schedule covers more than one day, so times need the day beside them. */
	const multiDay = $derived.by(() => {
		const days = matches.map(matchTime).flatMap((time) => (time === null ? [] : [new Date(time).toDateString()]));
		return days.some((day) => day !== days[0]);
	});

	const result = $derived(freeTime(matches, teamNumbers, { now, minLengthMs: minLengthMinutes * 60000, maxWindows: WINDOWS_PER_TEAM }));

	const teamNameByNumber = $derived(new Map(Object.values(teams).map((team) => [team.number, team.name])));
	const delayMinutes = $derived(Math.round(result.delayMs / 60000));

	const cards = $derived.by(() => {
		const list = teamNumbers.map((teamNumber) => ({ teamNumber, freeTime: result.teams.get(teamNumber) as TeamFreeTime }));
		const byTeam = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });

		return list.sort((a, b) => {
			if (sortKey === 'team') return byTeam(a.teamNumber, b.teamNumber);
			// Soonest first; teams with no window left sit at the end.
			const as = a.freeTime.status === 'window' ? a.freeTime.windows[0].start : Infinity;
			const bs = b.freeTime.status === 'window' ? b.freeTime.windows[0].start : Infinity;
			return (as === bs ? 0 : as < bs ? -1 : 1) || byTeam(a.teamNumber, b.teamNumber);
		});
	});

	/** `background` is the once-a-minute reread: it leaves the Refresh button alone. */
	async function load(force: boolean, background = false) {
		if (loading) return;
		loading = !background;
		try {
			const snapshot = await app.wrpcClient.matches.getSnapshot.query({ force });
			matches = snapshot.matches;
			available = snapshot.available;
			fetchedAt = snapshot.fetchedAt === null ? null : new Date(snapshot.fetchedAt);
			errorMessage = snapshot.error;
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : String(error);
		} finally {
			loading = false;
			loadedOnce = true;
			now = Date.now();
		}
	}

	onMount(() => {
		void load(false);
		const timer = setInterval(() => {
			now = Date.now();
			void load(false, true);
		}, 60 * 1000);
		return () => clearInterval(timer);
	});

	function formatTime(time: number): string {
		const date = new Date(time);
		const clock = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
		return multiDay ? `${date.toLocaleDateString([], { weekday: 'short' })} ${clock}` : clock;
	}

	function formatLength(ms: number): string {
		const total = Math.floor(ms / 60000);
		const hours = Math.floor(total / 60);
		const minutes = total % 60;
		return hours > 0 ? m.free_time_length_hours({ hours, minutes }) : m.free_time_length_minutes({ minutes });
	}

	function edgeLabel(edge: WindowEdge, isStart: boolean): string {
		if (edge.kind === 'match') return edge.name;
		if (edge.kind === 'break') return m.free_time_edge_break();
		return isStart ? m.free_time_day_start() : m.free_time_day_end();
	}

	function isMine(teamNumber: string): boolean {
		return !!myTeamNumbers?.has(teamNumber);
	}
</script>

<div class="flex h-full flex-col overflow-hidden p-4">
	<div class="mb-3 flex shrink-0 flex-wrap items-center justify-between gap-3">
		<div class="flex flex-wrap items-center gap-2">
			<label class="flex items-center gap-2 text-sm text-gray-700">
				{m.free_time_min_length_label()}
				<select
					class="rounded-md border border-gray-300 px-2 py-1 text-sm"
					value={minLengthMinutes}
					onchange={(event) => setMinLength(Number(event.currentTarget.value))}
				>
					{#each MIN_LENGTH_CHOICES as minutes (minutes)}
						<option value={minutes}>{m.free_time_length_minutes({ minutes })}</option>
					{/each}
				</select>
			</label>
			<label class="flex items-center gap-2 text-sm text-gray-700">
				{m.free_time_sort_label()}
				<select class="rounded-md border border-gray-300 px-2 py-1 text-sm" bind:value={sortKey}>
					<option value="start">{m.free_time_sort_soonest()}</option>
					<option value="team">{m.free_time_sort_team()}</option>
				</select>
			</label>
			{#if canFilterToMyTeams}
				<button
					type="button"
					class="rounded-md px-3 py-1 text-sm font-medium"
					class:bg-primary={filtered}
					class:text-on-primary={filtered}
					class:bg-gray-100={!filtered}
					class:text-gray-700={!filtered}
					onclick={() => (mineOnly = true)}
				>
					{m.free_time_view_mine()}
				</button>
				<button
					type="button"
					class="rounded-md px-3 py-1 text-sm font-medium"
					class:bg-primary={!filtered}
					class:text-on-primary={!filtered}
					class:bg-gray-100={filtered}
					class:text-gray-700={filtered}
					onclick={() => (mineOnly = false)}
				>
					{m.free_time_view_all()}
				</button>
			{/if}
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
		<p class="text-sm text-gray-600">{m.matches_not_linked()}</p>
	{:else if !loadedOnce}
		<p class="text-sm text-gray-600">{m.free_time_loading()}</p>
	{:else if errorMessage && matches.length === 0}
		<div class="rounded-md bg-red-50 p-3 text-sm text-red-800">{m.matches_failed({ reason: errorMessage })}</div>
	{:else if !hasTimedMatches}
		<p class="text-sm text-gray-600">{m.free_time_no_schedule()}</p>
	{:else}
		{#if errorMessage}
			<div class="mb-2 shrink-0 rounded-md bg-amber-50 p-2 text-xs text-amber-800">{m.matches_stale({ reason: errorMessage })}</div>
		{/if}
		<p class="mb-2 shrink-0 text-xs text-gray-500">
			{m.free_time_assumption({ before: MATCH_BUSY_BEFORE_MS / 60000, after: MATCH_BUSY_AFTER_MS / 60000 })}
		</p>
		{#if delayMinutes !== 0}
			<p class="mb-2 shrink-0 rounded-md bg-amber-50 p-2 text-xs text-amber-800">
				{delayMinutes > 0 ? m.free_time_running_late({ minutes: delayMinutes }) : m.free_time_running_early({ minutes: -delayMinutes })}
			</p>
		{/if}
		{#each result.breaks as scheduleBreak (scheduleBreak.start)}
			<p class="mb-2 shrink-0 rounded-md bg-blue-50 p-2 text-xs text-blue-800">
				{m.free_time_break({
					from: scheduleBreak.start <= now ? m.free_time_now() : formatTime(scheduleBreak.start),
					until: formatTime(scheduleBreak.end),
					length: formatLength(scheduleBreak.end - scheduleBreak.start)
				})}
			</p>
		{/each}

		{#if cards.length === 0}
			<p class="text-sm text-gray-600">{m.free_time_none_for_my_teams()}</p>
		{:else}
			<div class="min-h-0 flex-1 overflow-auto">
				<ul class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
					{#each cards as card (card.teamNumber)}
						<!-- In the all-teams view, the judge's own teams stand out. -->
						<li
							class="flex flex-col rounded-lg border bg-white p-3 shadow-sm"
							class:border-amber-400={!filtered && isMine(card.teamNumber)}
							class:border-gray-200={filtered || !isMine(card.teamNumber)}
						>
							<div class="mb-2 flex items-baseline gap-2">
								<span class="font-semibold text-gray-900">{card.teamNumber}</span>
								<span class="truncate text-xs text-gray-500">{teamNameByNumber.get(card.teamNumber) ?? ''}</span>
							</div>
							{#if card.freeTime.status === 'window'}
								<ol class="space-y-1.5">
									{#each card.freeTime.windows as window (window.start)}
										<li class="rounded-md bg-gray-50 px-2 py-1.5">
											<div class="flex items-baseline justify-between gap-2">
												<span class="text-sm font-medium whitespace-nowrap text-gray-900">
													{window.start <= now ? m.free_time_now() : formatTime(window.start)} – {formatTime(window.end)}
												</span>
												<span class="text-xs font-semibold whitespace-nowrap text-gray-700">{formatLength(window.end - window.start)}</span>
											</div>
											<div class="truncate text-xs text-gray-500">
												{edgeLabel(window.from, true)} – {edgeLabel(window.until, false)}
											</div>
										</li>
									{/each}
								</ol>
							{:else}
								<p class="text-sm text-gray-400">
									{card.freeTime.status === 'none_left' ? m.free_time_none_left({ minutes: minLengthMinutes }) : m.free_time_no_matches()}
								</p>
							{/if}
						</li>
					{/each}
				</ul>
			</div>
		{/if}
	{/if}
</div>
