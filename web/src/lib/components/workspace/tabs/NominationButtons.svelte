<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import { app } from '$lib/index.svelte';
	import { formatGradesShort, type Award } from '@robotools.app/protocol/src/award';
	import type { TeamInfoAndData } from '$lib/team.svelte';
	import { meetsAwardNotebookRequirement, requiresFullyDevelopedNotebook } from '$lib/award.svelte';

	interface Props {
		award: Award;
		team: TeamInfoAndData;
		judgeGroupId: string;
		ranking: number;
		isNominated: boolean;
		hasTeamInterview: boolean;
		bypassAwardRequirements: boolean;
		showExcellenceAwardWinners: boolean;
	}

	let { award, team, judgeGroupId, ranking, isNominated, hasTeamInterview, bypassAwardRequirements, showExcellenceAwardWinners }: Props =
		$props();

	const isMeetNotebookRequirement = $derived(meetsAwardNotebookRequirement(award, team.notebookDevelopmentStatus));
	const needsFullyDevelopedNotebook = $derived(requiresFullyDevelopedNotebook(award.name));
	const isMeetTeamInterviewRequirement = $derived(award.requireTeamInterview ? hasTeamInterview : true);
	const isMeetGradeRequirement = $derived(award.acceptedGrades.includes(team.grade));
	const isDisabled = $derived(
		bypassAwardRequirements ? false : !isMeetNotebookRequirement || !isMeetTeamInterviewRequirement || !isMeetGradeRequirement
	);

	async function removeNomination() {
		await app.wrpcClient.judging.removeFromFinalAwardNominations.mutation({ awardName: award.name, teamId: team.id });
	}

	async function addNomination() {
		await app.wrpcClient.judging.nominateFinalAward.mutation({ awardName: award.name, teamId: team.id, judgeGroupId });
	}

	async function onClick() {
		if (isNominated || showExcellenceAwardWinners) {
			await removeNomination();
		} else if (!isDisabled) {
			await addNomination();
		}
	}

	// Generate star display
	function getStars(count: number): string {
		return '★'.repeat(count);
	}

	/**
	 * Whether a full-cell message is covering this button.
	 *
	 * The messages below are absolutely positioned so that showing one cannot change the
	 * row's height, and they have no background — so they were drawn straight over the
	 * stars. Nothing revealed it until a team was both star-rated and ineligible, which is
	 * an ordinary mid-event state: a group rates a team before its interview has happened.
	 *
	 * The stars give way rather than the message. A team that cannot be nominated for this
	 * award needs to say why, and the rating is still visible in the award ranking tab.
	 *
	 * The nominated tick is deliberately not included. It is a single large glyph over faint
	 * grey stars, which reads as a tick against a rating rather than as two things fighting —
	 * and where it would collide with a message instead, it moves to the corner rather than
	 * suppressing anything. See the tick markup below.
	 */
	const hasMessageOverlay = $derived(showExcellenceAwardWinners || isDisabled);
</script>

<button
	class="group relative max-w-40 min-w-40 p-2 text-center select-none"
	class:cursor-default!={(isDisabled && !isNominated) || showExcellenceAwardWinners}
	onclick={onClick}
>
	<!--
		The element stays even when the stars do not: its min-height is what gives the button
		its size, and the messages below are absolutely positioned and contribute none. Empty
		it, and the cell keeps its height; remove it, and the row collapses.
	-->
	<div class="flex min-h-6 items-center justify-center text-lg text-gray-300">
		{#if !hasMessageOverlay}{getStars(ranking)}{/if}
	</div>
	{#if showExcellenceAwardWinners}
		<div class="absolute top-0 left-0 flex h-full w-full items-center justify-center text-lg text-gray-600">Excellence Award</div>
	{:else if isDisabled}
		<div class="absolute top-0 left-0 flex h-full w-full flex-col items-center justify-center text-xs text-gray-600">
			{#if !isMeetNotebookRequirement}
				{#if needsFullyDevelopedNotebook}
					<p>{m.fully_developed_required_btn()}</p>
				{:else}
					<p>{m.notebook_required_btn()}</p>
				{/if}
			{/if}
			{#if !isMeetTeamInterviewRequirement}
				<p>{m.team_interview_required_btn()}</p>
			{/if}
			{#if !isMeetGradeRequirement}
				<p>{m.grade_must_be_btn({ grades: formatGradesShort(award.acceptedGrades) })}</p>
			{/if}
		</div>
	{/if}
	<!--
		The tick is large and centred only when it is the only thing this cell has to say.

		A nominated team can also be ineligible — nominate with "bypass award requirements"
		on, then turn it off, or let a notebook status change underneath — and in the
		excellence view a winner is nominated by definition. In both cases the tick and the
		message were drawn over each other.

		Neither can simply win. That a team is nominated is the state of the deliberation;
		that it no longer qualifies is the thing needing attention, and hiding either would
		be hiding the anomaly rather than showing it. So the message keeps the middle of the
		cell and the tick shrinks into the corner, where it still reads as nominated.
	-->
	{#if isNominated}
		{#if hasMessageOverlay}
			<div class="absolute top-0 right-0 px-1 text-sm leading-none text-gray-600">✓</div>
		{:else}
			<div class="absolute top-0 left-0 flex h-full w-full items-center justify-center text-4xl text-gray-600 hover:text-black">✓</div>
		{/if}
	{/if}
</button>
