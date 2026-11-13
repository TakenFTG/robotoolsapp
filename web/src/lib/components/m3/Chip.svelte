<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLButtonAttributes } from 'svelte/elements';
	import CheckIcon from '$lib/icon/CheckIcon.svelte';

	/**
	 * M3 chip. `assist` triggers an action; `filter` toggles, and shows a tick and a tonal
	 * fill while selected.
	 */
	interface Props extends HTMLButtonAttributes {
		variant?: 'assist' | 'filter';
		selected?: boolean;
		icon?: Snippet;
		children?: Snippet;
	}

	let { variant = 'assist', selected = false, icon, children, class: className = '', type = 'button', ...rest }: Props = $props();

	const isSelected = $derived(variant === 'filter' && selected);
</script>

<button
	{type}
	aria-pressed={variant === 'filter' ? selected : undefined}
	class={[
		'state-layer inline-flex h-8 items-center gap-2 rounded-md px-4 text-label-large transition-colors disabled:cursor-not-allowed disabled:opacity-38',
		isSelected ? 'bg-secondary-container pl-2 text-on-secondary-container' : 'border border-outline-variant text-on-surface-variant',
		className
	]}
	{...rest}
>
	{#if isSelected}
		<CheckIcon size={18} />
	{:else}
		{@render icon?.()}
	{/if}
	{@render children?.()}
</button>
