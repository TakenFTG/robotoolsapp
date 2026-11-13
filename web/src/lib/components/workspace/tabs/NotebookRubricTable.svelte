<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import { sanitizeHTMLMessage } from '$lib/i18n';
	import { formatRubricScore, notebookRubricSections, sumRubricScores, type RubricRowConfig } from '@robotools.app/protocol/src/rubric';
	import {
		getRubricCriterionTitle,
		getRubricProficiencyHeader,
		getRubricProficiencyText,
		getRubricSectionHeading,
		type ProficiencyLevel
	} from '$lib/rubric-messages';
	import { scrollSync } from '$lib/scroll-sync.svelte';
	import ScoringSlider from './ScoringSlider.svelte';

	interface Props {
		rubricScores: number[];
		notes: string;
		innovateAwardNotes: string;
		isSubmitted: boolean;
		showValidationErrors: boolean;
	}

	let {
		rubricScores = $bindable(),
		notes = $bindable(),
		innovateAwardNotes = $bindable(),
		isSubmitted,
		showValidationErrors
	}: Props = $props();

	const { registerScrollContainer, scrollLeft, scrollRight } = scrollSync();

	const proficiencyLevels: ProficiencyLevel[] = ['exemplary', 'proficient', 'developing', 'beginning'];

	const sectionScoreOffsets = notebookRubricSections.map((_, sectionIndex) =>
		notebookRubricSections.slice(0, sectionIndex).reduce((sum, section) => sum + section.criteria.length, 0)
	);

	const totalScore = $derived.by(() => {
		if (rubricScores.some((score) => score === -1)) {
			return 'N/A';
		}
		return formatRubricScore(sumRubricScores(rubricScores));
	});

	/**
	 * The score each proficiency column is worth, highest first.
	 *
	 * Derived from the row rather than written out, so it cannot drift from the config the
	 * table is built off. v2.0 runs 4/3/2/1 — one step per column from maxPoints down to
	 * minPoints — which is what `proficiencyHeaderScale: '4_3_2_1'` is asserting.
	 */
	function levelPoints(row: RubricRowConfig): number[] {
		const points: number[] = [];
		for (let value = row.maxPoints; value >= (row.minPoints ?? 0); value--) {
			points.push(value);
		}
		return points;
	}
</script>

<!--
	The stacked view, for anything narrower than a laptop.

	The table below puts 640px of proficiency text inside a horizontally scrolling column
	between two fixed ones. On a phone that leaves a window of roughly 80–130px — a tenth to
	a fifth of the text — to be scrolled through with buttons, sixteen criteria in a row.
	iPad portrait fares better at about three quarters and is still cut off.

	So below `lg` there is no table at all. Each criterion becomes a card and the four
	proficiency levels become full-width rows you tap to score, which also retires the
	four-stop slider — the hardest possible control to hit accurately on a phone. It is the
	same shape the v2.0 interview rubric already uses, for the same reason: the judge is
	choosing between descriptions, so the descriptions should be the thing they touch.

	Two renderings of one config rather than one rendering that reflows. The table has a
	structure — fixed columns either side of a scroller — that does not become this by
	changing flex direction, and pretending otherwise would produce something that is neither.
-->
<div class="rubric-stacked">
	{#each notebookRubricSections as section, sectionIndex (section.categoryKey)}
		<h3 class="mt-4 border-b-2 border-gray-300 pb-1 text-sm font-bold first:mt-0">
			{getRubricSectionHeading(section.categoryKey, section.sectionMaxPoints)}
		</h3>

		{#each section.criteria as row, rowIndex (row.messageKeyPrefix)}
			{@const scoreIndex = sectionScoreOffsets[sectionIndex] + rowIndex}
			{@const unscored = showValidationErrors && rubricScores[scoreIndex] === -1}
			<div class="mt-3 rounded-lg border p-3" class:border-gray-300={!unscored} class:border-red-400={unscored} class:bg-red-50={unscored}>
				<p class="text-sm font-bold">{getRubricCriterionTitle(row.messageKeyPrefix)}</p>

				<div class="mt-2 flex flex-col gap-2">
					{#each levelPoints(row) as points, levelIndex (points)}
						{@const level = proficiencyLevels[levelIndex]}
						{@const selected = rubricScores[scoreIndex] === points}
						<button
							type="button"
							disabled={isSubmitted}
							aria-pressed={selected}
							onclick={() => (rubricScores[scoreIndex] = points)}
							class="rounded-md border p-2 text-left text-sm disabled:cursor-default"
							class:border-primary={selected}
							class:bg-primary={selected}
							class:text-on-primary={selected}
							class:border-gray-300={!selected}
							class:hover:bg-gray-100={!selected && !isSubmitted}
						>
							<span class="block text-xs font-bold">
								{getRubricProficiencyHeader(section.proficiencyHeaderScale, level)}
							</span>
							<span class="mt-0.5 block leading-snug">{getRubricProficiencyText(row.messageKeyPrefix, level)}</span>
						</button>
					{/each}
				</div>
			</div>
		{/each}
	{/each}

	<div class="mt-4">
		<p class="text-sm font-bold">{m.rubric_notes()}</p>
		<textarea class="mt-2 block h-24 min-h-24 w-full rounded-md border border-gray-300 p-2" bind:value={notes} readonly={isSubmitted}
		></textarea>
	</div>

	<div class="mt-4">
		<p class="text-sm font-bold">{m.rubric_nb_innovate_award_notes()}</p>
		<textarea
			class="mt-2 block h-24 min-h-24 w-full rounded-md border border-gray-300 p-2"
			bind:value={innovateAwardNotes}
			readonly={isSubmitted}></textarea>
	</div>

	<div class="mt-4 flex items-center justify-between rounded-lg bg-gray-100 p-3">
		<span class="text-sm font-bold">{@html sanitizeHTMLMessage(m.rubric_total_score)}</span>
		<span class="text-lg font-bold tabular-nums">{totalScore}</span>
	</div>
</div>

<!--
	Kept for the table only, which now appears at `lg` and above. At that width the scroll
	window is wider than the content, so these are for the rare tight fit rather than the
	normal case — and the touch devices they were added for no longer see the table at all.
-->
<div class="mb-2 hidden flex-row justify-end gap-2 text-sm lg:flex">
	<button class="lightweight tiny" onclick={scrollLeft}>{m.scroll_left()}</button>
	<button class="lightweight tiny" onclick={scrollRight}>{m.scroll_right()}</button>
</div>

<!--
	No `hidden lg:flex` here: it does not work on this element. rubric.css sets the display
	unlayered, which outranks Tailwind's layered utilities, so the breakpoint lives there
	instead — see the note beside it.
-->
<rubric-table class="notebook-rubric">
	<rubric-body>
		{#each notebookRubricSections as section, sectionIndex (section.categoryKey)}
			<row class="section-title-row">
				<div class="grow border-r-3 border-l-3 p-2 text-left text-sm font-bold">
					{getRubricSectionHeading(section.categoryKey, section.sectionMaxPoints)}
				</div>
			</row>
			<row class="section-header-row">
				<criteria class="max-w-42 min-w-42 bg-gray-400 font-bold">{m.rubric_criteria()}</criteria>
				<scroll-container use:registerScrollContainer>
					<content class="min-w-160 bg-gray-200">
						{#each proficiencyLevels as level (level)}
							<div class="text-center font-bold">
								{getRubricProficiencyHeader(section.proficiencyHeaderScale, level)}
							</div>
						{/each}
					</content>
				</scroll-container>
				<scoring class="bg-gray-200 font-bold">{m.rubric_points()}</scoring>
			</row>
			{#each section.criteria as row, rowIndex (row.messageKeyPrefix)}
				{@const scoreIndex = sectionScoreOffsets[sectionIndex] + rowIndex}
				<row class="criteria-row">
					<criteria class="max-w-42 min-w-42 font-bold">
						<p class="text-sm">{getRubricCriterionTitle(row.messageKeyPrefix)}</p>
					</criteria>
					<scroll-container use:registerScrollContainer>
						<content class="min-w-160">
							{#each proficiencyLevels as level (level)}
								<div>{getRubricProficiencyText(row.messageKeyPrefix, level)}</div>
							{/each}
						</content>
					</scroll-container>
					<scoring>
						{#if isSubmitted}
							<p class="text-lg tabular-nums">{formatRubricScore(rubricScores[scoreIndex])}</p>
						{:else}
							<ScoringSlider
								bind:variable={rubricScores[scoreIndex]}
								max={row.maxPoints}
								min={row.minPoints ?? 0}
								showError={showValidationErrors}
							/>
						{/if}
					</scoring>
				</row>
			{/each}
		{/each}
		<row class="footer-row border-t-3! bg-gray-100">
			<div class="p-2">
				<p class="text-sm font-bold">{m.rubric_notes()}</p>
				<textarea class="mt-2 block h-20 min-h-20 w-full border border-gray-300 p-1" bind:value={notes} readonly={isSubmitted}></textarea>
			</div>
			<scoring></scoring>
		</row>
		<row class="footer-row">
			<div class="p-2">
				<p class="text-sm font-bold">{m.rubric_nb_innovate_award_notes()}</p>
				<textarea class="mt-2 block h-20 min-h-20 w-full border border-gray-300 p-1" bind:value={innovateAwardNotes} readonly={isSubmitted}
				></textarea>
			</div>
			<scoring class="flex-col! gap-2">
				<p>{@html sanitizeHTMLMessage(m.rubric_total_score)}</p>
				<p class="text-lg tabular-nums">{totalScore}</p>
			</scoring>
		</row>
	</rubric-body>
</rubric-table>
