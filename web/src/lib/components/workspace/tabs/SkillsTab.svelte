<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import { app } from '$lib/index.svelte';
	import RefreshIcon from '$lib/icon/RefreshIcon.svelte';
	import type { SkillsEntry } from '@robotools.app/protocol/src/matches';
	import type { SkillsTab } from '$lib/tab.svelte';
	import { onMount } from 'svelte';

	/**
	 * Combined skills standings: each team's best driver run, best programming run and the
	 * total they are ranked on.
	 *
	 * Defaults to the whole field rather than to the judge's own teams, which is the
	 * opposite of the matches tab and deliberate. A judge opens the schedule to find out
	 * where they need to be; they open skills to find out how a team is doing, and a
	 * standing means nothing without the teams it is measured against. The filter is there
	 * for anyone who wants it, and their own teams are highlighted either way.
	 *
	 * The data comes from the room's cache, the same snapshot the matches tab reads, so
	 * this tab costs no extra RobotEvents traffic however many judges open it.
	 */
	interface Props {
		tab: SkillsTab;
	}

	// Declared but unread: every tab is handed its own instance, and the type is what keeps
	// this component and the SkillsTab class in step.
	let { tab }: Props = $props();
	void tab;

	let skills = $state<SkillsEntry[]>([]);
	let loading = $state(false);
	let errorMessage = $state<string | null>(null);
	let fetchedAt = $state<Date | null>(null);
	let available = $state(true);
	let loadedOnce = $state(false);
	let mineOnly = $state(false);

	const teams = $derived(app.getAllTeamInfoAndData());
	const judgeGroup = $derived(app.getCurrentUserJudgeGroup());

	/** The team numbers this judge is responsible for. A Judge Advisor has none. */
	const myTeamNumbers = $derived.by(() => {
		if (!judgeGroup) return null;
		const numbers = judgeGroup.assignedTeams.map((teamId) => teams[teamId]?.number).filter((number): number is string => !!number);
		return numbers.length > 0 ? new Set(numbers) : null;
	});

	const canFilterToMyTeams = $derived(!!myTeamNumbers);

	/**
	 * Whether the filter is actually being applied.
	 *
	 * Derived rather than read straight off the toggle so that losing the teams cannot
	 * leave someone looking at an empty table with no way back — the same trap the matches
	 * tab used to have, avoided here by construction.
	 */
	const filtered = $derived(mineOnly && canFilterToMyTeams);

	const visibleSkills = $derived.by(() => {
		if (!filtered || !myTeamNumbers) return skills;
		return skills.filter((entry) => myTeamNumbers.has(entry.teamNumber));
	});

	async function load(force: boolean) {
		if (loading) return;

		loading = true;
		try {
			const snapshot = await app.wrpcClient.matches.getSnapshot.query({ force });
			skills = snapshot.skills;
			available = snapshot.available;
			fetchedAt = snapshot.fetchedAt === null ? null : new Date(snapshot.fetchedAt);
			// A failed poll is reported alongside the last good standings, so both can be
			// true: here are the scores, and here is why they may have moved since.
			errorMessage = snapshot.error;
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : String(error);
		} finally {
			loading = false;
			loadedOnce = true;
		}
	}

	onMount(() => {
		void load(false);
	});

	function isMine(teamNumber: string): boolean {
		return !!myTeamNumbers?.has(teamNumber);
	}
</script>

<div class="flex h-full flex-col overflow-hidden p-4">
	<div class="mb-3 flex shrink-0 flex-wrap items-center justify-between gap-3">
		<div class="flex items-center gap-2">
			<button
				type="button"
				class="rounded-md px-3 py-1 text-sm font-medium"
				class:bg-primary={!filtered}
				class:text-on-primary={!filtered}
				class:bg-gray-100={filtered}
				class:text-gray-700={filtered}
				onclick={() => (mineOnly = false)}
			>
				{m.skills_view_all()}
			</button>
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
					{m.skills_view_mine()}
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
		<p class="text-sm text-gray-600">{m.skills_loading()}</p>
	{:else if errorMessage && skills.length === 0}
		<div class="rounded-md bg-red-50 p-3 text-sm text-red-800">{m.skills_failed({ reason: errorMessage })}</div>
	{:else}
		{#if errorMessage}
			<div class="mb-2 shrink-0 rounded-md bg-amber-50 p-2 text-xs text-amber-800">{m.skills_stale({ reason: errorMessage })}</div>
		{/if}

		{#if visibleSkills.length === 0}
			<p class="text-sm text-gray-600">{filtered ? m.skills_none_for_my_teams() : m.skills_none()}</p>
		{:else}
			<div class="min-h-0 flex-1 overflow-auto">
				<table class="w-full border-collapse text-sm">
					<thead class="sticky top-0 bg-white">
						<tr class="border-b border-gray-300 text-left">
							<th class="py-2 pr-3 font-semibold">{m.matches_column_rank()}</th>
							<th class="py-2 pr-3 font-semibold">{m.matches_column_team()}</th>
							<th class="py-2 pr-3 text-right font-semibold">{m.skills_column_total()}</th>
							<th class="py-2 pr-3 text-right font-semibold">{m.skills_column_driver()}</th>
							<th class="py-2 pr-3 text-right font-semibold">{m.skills_column_driver_attempts()}</th>
							<th class="py-2 pr-3 text-right font-semibold">{m.skills_column_programming()}</th>
							<th class="py-2 text-right font-semibold">{m.skills_column_programming_attempts()}</th>
						</tr>
					</thead>
					<tbody>
						{#each visibleSkills as entry (entry.teamNumber)}
							<tr class="border-b border-gray-100" class:bg-amber-50={isMine(entry.teamNumber)}>
								<td class="py-2 pr-3 font-medium whitespace-nowrap">{entry.rank}</td>
								<td class="py-2 pr-3 whitespace-nowrap" class:font-bold={isMine(entry.teamNumber)}>{entry.teamNumber}</td>
								<td class="py-2 pr-3 text-right font-semibold whitespace-nowrap">{entry.totalScore}</td>
								<td class="py-2 pr-3 text-right whitespace-nowrap">{entry.driverScore}</td>
								<!-- A team with no runs of a type shows a dash rather than a zero: not having
								     driven yet and having driven badly are different things to a judge. -->
								<td class="py-2 pr-3 text-right whitespace-nowrap text-gray-500">
									{entry.driverAttempts > 0 ? entry.driverAttempts : '—'}
								</td>
								<td class="py-2 pr-3 text-right whitespace-nowrap">{entry.programmingScore}</td>
								<td class="py-2 text-right whitespace-nowrap text-gray-500">
									{entry.programmingAttempts > 0 ? entry.programmingAttempts : '—'}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	{/if}
</div>
