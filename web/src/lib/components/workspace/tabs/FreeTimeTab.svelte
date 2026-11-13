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
	 * Each team's next free window between its matches that is long enough for an
	 * interview, so judges can pick a time when the team is not queuing or on a field. The
	 * next one rather than the longest, because the longest is often too late in the day.
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

	type SortKey = 'team' | 'start' | 'end' | 'length';

	let matches = $state<MatchSummary[]>([]);
	let loading = $state(false);
	let errorMessage = $state<string | null>(null);
	let fetchedAt = $state<Date | null>(null);
	let available = $state(true);
	let loadedOnce = $state(false);
	let mineOnly = $state(true);
	let sortKey = $state<SortKey>('start');
	let sortAscending = $state(true);

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

	const result = $derived(freeTime(matches, teamNumbers, { now, minLengthMs: minLengthMinutes * 60000 }));
	const delayMinutes = $derived(Math.round(result.delayMs / 60000));

	const rows = $derived.by(() => {
		const list = teamNumbers.map((teamNumber) => ({ teamNumber, freeTime: result.teams.get(teamNumber) as TeamFreeTime }));
		const direction = sortAscending ? 1 : -1;
		const byTeam = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });

		return list.sort((a, b) => {
			// Teams with no window always sit at the bottom, whichever way the column runs.
			const aw = a.freeTime.status === 'window' ? a.freeTime.window : null;
			const bw = b.freeTime.status === 'window' ? b.freeTime.window : null;
			if (sortKey === 'team') return direction * byTeam(a.teamNumber, b.teamNumber);
			if (!aw || !bw) return (aw ? -1 : bw ? 1 : 0) || byTeam(a.teamNumber, b.teamNumber);
			const value = (w: typeof aw) => (sortKey === 'start' ? w.start : sortKey === 'end' ? w.end : w.end - w.start);
			return direction * (value(aw) - value(bw)) || byTeam(a.teamNumber, b.teamNumber);
		});
	});

	function sortBy(key: SortKey) {
		if (sortKey === key) {
			sortAscending = !sortAscending;
		} else {
			sortKey = key;
			// Longest first is the useful default for length; soonest first for everything else.
			sortAscending = key !== 'length';
		}
	}

	function ariaSort(key: SortKey): 'ascending' | 'descending' | 'none' {
		if (sortKey !== key) return 'none';
		return sortAscending ? 'ascending' : 'descending';
	}

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

{#snippet header(key: SortKey, label: string, alignRight = false)}
	<th class="py-2 pr-3 font-semibold" class:text-right={alignRight} aria-sort={ariaSort(key)}>
		<button type="button" class="inline-flex items-center gap-1 hover:text-gray-900" onclick={() => sortBy(key)}>
			{label}
			<span class="w-3 text-xs text-gray-400" aria-hidden="true">{sortKey === key ? (sortAscending ? '▲' : '▼') : ''}</span>
		</button>
	</th>
{/snippet}

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

		{#if rows.length === 0}
			<p class="text-sm text-gray-600">{m.free_time_none_for_my_teams()}</p>
		{:else}
			<div class="min-h-0 flex-1 overflow-auto">
				<table class="w-full border-collapse text-sm">
					<thead class="sticky top-0 bg-white">
						<tr class="border-b border-gray-300 text-left">
							{@render header('team', m.matches_column_team())}
							{@render header('start', m.free_time_column_from())}
							{@render header('end', m.free_time_column_until())}
							{@render header('length', m.free_time_column_length(), true)}
							<th class="py-2 font-semibold">{m.free_time_column_between()}</th>
						</tr>
					</thead>
					<tbody>
						{#each rows as row (row.teamNumber)}
							<tr class="border-b border-gray-100" class:bg-amber-50={!filtered && isMine(row.teamNumber)}>
								<td class="py-2 pr-3 font-medium whitespace-nowrap">{row.teamNumber}</td>
								{#if row.freeTime.status === 'window'}
									{@const window = row.freeTime.window}
									<td class="py-2 pr-3 whitespace-nowrap">{window.start <= now ? m.free_time_now() : formatTime(window.start)}</td>
									<td class="py-2 pr-3 whitespace-nowrap">{formatTime(window.end)}</td>
									<td class="py-2 pr-3 text-right font-semibold whitespace-nowrap">{formatLength(window.end - window.start)}</td>
									<td class="py-2 whitespace-nowrap text-gray-600">
										{edgeLabel(window.from, true)} – {edgeLabel(window.until, false)}
									</td>
								{:else}
									<td class="py-2 text-gray-400" colspan="4">
										{row.freeTime.status === 'none_left' ? m.free_time_none_left({ minutes: minLengthMinutes }) : m.free_time_no_matches()}
									</td>
								{/if}
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	{/if}
</div>
