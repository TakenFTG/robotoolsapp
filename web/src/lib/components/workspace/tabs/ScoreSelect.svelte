<script lang="ts">
	/**
	 * The keyboard route through a rubric: Tab moves between these, and a number key scores
	 * the focused criterion.
	 *
	 * The number key is handled here rather than left to the browser's type-to-select,
	 * which differs by platform and can open the list instead of choosing an option.
	 */
	let {
		variable = $bindable(),
		points,
		label,
		showError,
		class: className = ''
	}: {
		variable: number;
		/** The scores this criterion offers, in the order to list them. */
		points: number[];
		label: string;
		showError: boolean;
		class?: string;
	} = $props();

	const hasError = $derived(showError && variable === -1);

	function onKeydown(event: KeyboardEvent) {
		if (event.ctrlKey || event.metaKey || event.altKey || !/^\d$/.test(event.key)) {
			return;
		}
		// Swallow numbers this criterion does not offer too, so type-to-select cannot act on them.
		event.preventDefault();
		const score = Number(event.key);
		if (points.includes(score)) {
			variable = score;
		}
	}
</script>

<select
	bind:value={variable}
	onkeydown={onKeydown}
	aria-label={label}
	aria-invalid={hasError}
	class="classic text-center font-semibold tabular-nums {className}"
>
	<option value={-1} disabled hidden>—</option>
	{#each points as score (score)}
		<option value={score}>{score}</option>
	{/each}
</select>
