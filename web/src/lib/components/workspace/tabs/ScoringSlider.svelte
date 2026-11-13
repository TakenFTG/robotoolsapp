<script lang="ts">
	import { formatRubricScore } from '@robotools.app/protocol/src/rubric';

	let {
		variable = $bindable(),
		max,
		/**
		 * The lowest score the rubric offers. Not always zero: the notebook rubric's columns
		 * run 4 down to 1, so a zero would be a judgement it cannot express.
		 */
		min = 0,
		/**
		 * Whole points by default. Both rubrics score against discrete GRSF proficiency
		 * columns, so a tenth of a point describes a judgement neither rubric offers, and
		 * two judges separated by 3.3 against 3.4 are comparing noise. Overridable for a
		 * rubric that genuinely scores in fractions.
		 */
		step = 1,
		showError
	}: {
		variable: number;
		max: number;
		min?: number;
		step?: number;
		showError: boolean;
	} = $props();

	const sliderValue = $derived(variable === -1 ? min : variable);
	const displayValue = $derived(variable === -1 ? '—' : formatRubricScore(variable));
	const hasError = $derived(showError && variable === -1);

	function onInput(event: Event) {
		const target = event.target as HTMLInputElement;
		// Snap to the step the slider is actually offering. The range input already emits
		// values on the step, but rounding here means the stored number cannot drift into a
		// precision the rubric does not use.
		const raw = parseFloat(target.value);
		const snapped = step >= 1 ? Math.round(raw) : Math.round(raw * 10) / 10;
		variable = Math.min(max, Math.max(min, snapped));
	}
</script>

<div class="flex w-full flex-col items-center gap-1 px-1">
	<span class="text-base font-semibold tabular-nums" class:text-red-600={hasError}>{displayValue}</span>
	<input
		type="range"
		class="w-full accent-slate-700"
		{min}
		{max}
		{step}
		value={sliderValue}
		disabled={false}
		oninput={onInput}
		aria-label="Points"
	/>
	<span class="text-[10px] text-gray-500 tabular-nums">{formatRubricScore(min)}–{formatRubricScore(max)}</span>
</div>
