<script lang="ts">
	import { teamInterviewEvidenceLevels } from '@robotools.app/protocol/src/rubric';
	import { getRubricText } from '$lib/rubric-messages';

	/**
	 * Scoring for one interview criterion.
	 *
	 * Buttons rather than the notebook rubric's slider, because v2.0 asks a judge to pick
	 * one of three named descriptions of what they heard. At that granularity the name is
	 * the useful thing and the number is incidental — a three-stop slider would hide the
	 * wording behind a position, which is exactly backwards for a rubric whose whole
	 * method is "score what you heard".
	 */
	let {
		variable = $bindable(),
		showError
	}: {
		variable: number;
		showError: boolean;
	} = $props();

	const hasError = $derived(showError && variable === -1);
</script>

<div class="flex w-full flex-col gap-1 p-1" class:rounded={hasError} class:bg-red-50={hasError}>
	{#each teamInterviewEvidenceLevels as level (level.points)}
		<button
			type="button"
			class="flex items-center justify-between gap-1 rounded border px-1.5 py-1 text-left text-[11px] leading-tight"
			class:border-primary={variable === level.points}
			class:bg-primary={variable === level.points}
			class:text-on-primary={variable === level.points}
			class:border-gray-300={variable !== level.points}
			class:text-gray-700={variable !== level.points}
			class:hover:bg-gray-100={variable !== level.points}
			class:border-red-400={hasError}
			aria-pressed={variable === level.points}
			onclick={() => (variable = level.points)}
		>
			<span>{getRubricText(level.descriptionKey)}</span>
			<span class="font-semibold tabular-nums">{level.points}</span>
		</button>
	{/each}
</div>
