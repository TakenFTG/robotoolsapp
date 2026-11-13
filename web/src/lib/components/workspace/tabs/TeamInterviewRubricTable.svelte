<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import { sanitizeHTMLMessage } from '$lib/i18n';
	import {
		TEAM_INTERVIEW_RUBRIC_MAX_SCORE,
		formatRubricScore,
		sumRubricScores,
		teamInterviewEvidenceLevels,
		teamInterviewRubricSections
	} from '@robotools.app/protocol/src/rubric';
	import { getRubricCriterionTitle, getRubricSectionHeading, getRubricText } from '$lib/rubric-messages';
	import InterviewScoringButtons from './InterviewScoringButtons.svelte';

	interface Props {
		rubricScores: number[];
		notes: string;
		isSubmitted: boolean;
		showValidationErrors: boolean;
	}

	let { rubricScores = $bindable(), notes = $bindable(), isSubmitted, showValidationErrors }: Props = $props();

	/**
	 * Where each section's criteria start in the flat score array.
	 *
	 * Scores are stored flat because that is what the submission schema is: one number per
	 * criterion, in rubric order. The sections are presentation.
	 */
	const sectionScoreOffsets = teamInterviewRubricSections.map((_, sectionIndex) =>
		teamInterviewRubricSections.slice(0, sectionIndex).reduce((sum, section) => sum + section.criteria.length, 0)
	);

	const totalScore = $derived.by(() => {
		if (rubricScores.some((score) => score === -1)) {
			return 'N/A';
		}
		return formatRubricScore(sumRubricScores(rubricScores));
	});

	/** The label a submitted score should read as, e.g. "Heard, with Specifics". */
	function scoredLevelDescription(score: number): string {
		const level = teamInterviewEvidenceLevels.find((candidate) => candidate.points === score);
		return level ? getRubricText(level.descriptionKey) : '';
	}
</script>

<!--
	The stacked view, for anything narrower than a laptop. Matches the notebook rubric.

	The table below has no horizontal scroll, which made it look like it coped on a phone.
	It does not: the scoring column is a fixed 176px, so on an iPhone the criteria column is
	left with 135 to 190 pixels to hold a criterion title *and* its bulleted listen-fors —
	lines like "questions land with the student who can answer — no one has to explain
	everything" rendered a couple of words at a time.

	So below `lg` the columns give way and each criterion becomes a card, exactly as the
	notebook rubric does. The three evidence levels were already buttons; here they are
	full-width ones carrying both the heading and what it means, which is the shape the
	notebook cards use.
-->
<div class="rubric-stacked">
	{#each teamInterviewRubricSections as section, sectionIndex (section.categoryKey)}
		<h3 class="mt-4 border-b-2 border-gray-300 pb-1 text-sm font-bold first:mt-0">
			{getRubricSectionHeading(section.categoryKey, section.sectionMaxPoints)}
		</h3>

		<div class="mt-2 rounded-lg bg-gray-50 p-3">
			<p class="text-sm font-semibold">{m.rubric_ti_sample_questions_title()}</p>
			<ul class="mt-1 ml-5 list-disc text-sm">
				{#each section.sampleQuestionKeys as questionKey (questionKey)}
					<li>{getRubricText(questionKey)}</li>
				{/each}
			</ul>
		</div>

		{#each section.criteria as row, rowIndex (row.messageKeyPrefix)}
			{@const scoreIndex = sectionScoreOffsets[sectionIndex] + rowIndex}
			{@const unscored = showValidationErrors && rubricScores[scoreIndex] === -1}
			<div class="mt-3 rounded-lg border p-3" class:border-gray-300={!unscored} class:border-red-400={unscored} class:bg-red-50={unscored}>
				<p class="text-sm font-bold">{getRubricCriterionTitle(row.messageKeyPrefix)}</p>

				{#if row.listenForKeys}
					<p class="mt-1 text-xs font-semibold">{m.rubric_ti_listen_for_label()}</p>
					<ul class="ml-5 list-disc text-xs">
						{#each row.listenForKeys as listenForKey (listenForKey)}
							<li>{getRubricText(listenForKey)}</li>
						{/each}
					</ul>
				{/if}

				<div class="mt-3 flex flex-col gap-2">
					{#each teamInterviewEvidenceLevels as level (level.points)}
						{@const selected = rubricScores[scoreIndex] === level.points}
						<button
							type="button"
							disabled={isSubmitted}
							aria-pressed={selected}
							onclick={() => (rubricScores[scoreIndex] = level.points)}
							class="rounded-md border p-2 text-left text-sm disabled:cursor-default"
							class:border-primary={selected}
							class:bg-primary={selected}
							class:text-on-primary={selected}
							class:border-gray-300={!selected}
							class:hover:bg-gray-100={!selected && !isSubmitted}
						>
							<span class="block text-xs font-bold">{getRubricText(level.headerKey)}</span>
							<span class="mt-0.5 block leading-snug">{getRubricText(level.descriptionKey)}</span>
						</button>
					{/each}
				</div>
			</div>
		{/each}
	{/each}

	<div class="mt-4">
		<p class="text-sm font-bold">{m.rubric_ti_additional_notes()}</p>
		<textarea class="mt-2 block h-24 min-h-24 w-full rounded-md border border-gray-300 p-2" bind:value={notes} readonly={isSubmitted}
		></textarea>
	</div>

	<div class="mt-4 flex items-center justify-between rounded-lg bg-gray-100 p-3">
		<span class="text-sm font-bold">
			{@html sanitizeHTMLMessage(m.rubric_total_score)}
			<span class="block text-[10px] font-normal text-gray-600">
				{m.rubric_ti_total_out_of({ points: TEAM_INTERVIEW_RUBRIC_MAX_SCORE })}
			</span>
		</span>
		<span class="text-lg font-bold tabular-nums">{totalScore}</span>
	</div>
</div>

<!--
	No horizontal scroll here, unlike the notebook rubric.

	v2.0 has one column of criteria and one of scoring: the three evidence columns on the
	printed sheet are tick boxes, and their headings say the same thing for every criterion,
	so reproducing them as columns would be three identical columns of text to scroll past.
	They are stated once per section instead, and carried on the buttons where the judge is
	actually choosing between them.

	The `lg` breakpoint that hides this on a phone lives in rubric.css, not here — the
	element's display is set unlayered, which outranks Tailwind's layered utilities.
-->
<rubric-table class="interview-rubric">
	<rubric-body>
		{#each teamInterviewRubricSections as section, sectionIndex (section.categoryKey)}
			<row class="section-title-row">
				<div class="grow border-r-3 border-l-3 p-2 text-left text-sm font-bold">
					{getRubricSectionHeading(section.categoryKey, section.sectionMaxPoints)}
				</div>
			</row>

			<row class="sample-questions-row">
				<div class="grow border-r-3 border-l-3 p-2">
					<p class="text-sm font-semibold">{m.rubric_ti_sample_questions_title()}</p>
					<ul class="mt-1 ml-5 list-disc text-sm">
						{#each section.sampleQuestionKeys as questionKey (questionKey)}
							<li>{getRubricText(questionKey)}</li>
						{/each}
					</ul>
				</div>
			</row>

			<row class="section-header-row">
				<criteria class="min-w-0 grow basis-0 items-start! text-left!">
					<p class="text-sm font-bold">{m.rubric_ti_criteria_header()}</p>
					<p class="mt-1 text-xs font-normal">{m.rubric_ti_listen_fors_note()}</p>
				</criteria>
				<scoring class="flex-col! items-stretch! text-left!">
					<p class="px-1 text-xs font-bold">{m.rubric_points()}</p>
					{#each teamInterviewEvidenceLevels as level (level.points)}
						<p class="px-1 text-[11px] leading-tight">{getRubricText(level.headerKey)}</p>
					{/each}
				</scoring>
			</row>

			{#each section.criteria as row, rowIndex (row.messageKeyPrefix)}
				{@const scoreIndex = sectionScoreOffsets[sectionIndex] + rowIndex}
				<row class="criteria-row">
					<criteria class="min-w-0 grow basis-0 items-start! text-left!">
						<p class="text-sm font-bold">{getRubricCriterionTitle(row.messageKeyPrefix)}</p>
						{#if row.listenForKeys}
							<p class="mt-1 text-xs font-semibold">{m.rubric_ti_listen_for_label()}</p>
							<ul class="ml-5 list-disc text-xs">
								{#each row.listenForKeys as listenForKey (listenForKey)}
									<li>{getRubricText(listenForKey)}</li>
								{/each}
							</ul>
						{/if}
					</criteria>
					<scoring class="flex-col! items-stretch! justify-center! text-left!">
						{#if isSubmitted}
							<p class="px-1 text-lg font-semibold tabular-nums">{formatRubricScore(rubricScores[scoreIndex])}</p>
							<p class="px-1 text-[11px] leading-tight text-gray-600">{scoredLevelDescription(rubricScores[scoreIndex])}</p>
						{:else}
							<InterviewScoringButtons bind:variable={rubricScores[scoreIndex]} showError={showValidationErrors} />
						{/if}
					</scoring>
				</row>
			{/each}
		{/each}

		<row class="footer-row border-t-3! bg-gray-100">
			<div class="p-2">
				<p class="text-sm font-bold">{m.rubric_ti_additional_notes()}</p>
				<textarea class="mt-2 block h-20 min-h-20 w-full border border-gray-300 p-1" bind:value={notes} readonly={isSubmitted}></textarea>
			</div>
			<scoring class="flex-col! gap-2">
				<p>{@html sanitizeHTMLMessage(m.rubric_total_score)}</p>
				<p id="total-score" class="text-lg tabular-nums">{totalScore}</p>
				<p class="text-[10px] text-gray-600">{m.rubric_ti_total_out_of({ points: TEAM_INTERVIEW_RUBRIC_MAX_SCORE })}</p>
			</scoring>
		</row>
	</rubric-body>
</rubric-table>
