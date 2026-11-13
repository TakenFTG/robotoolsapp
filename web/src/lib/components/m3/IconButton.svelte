<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLButtonAttributes } from 'svelte/elements';

	/** M3 icon button. `aria-label` is required: the icon is the only content. */
	interface Props extends HTMLButtonAttributes {
		'aria-label': string;
		variant?: 'standard' | 'filled' | 'tonal' | 'outlined';
		selected?: boolean;
		children: Snippet;
	}

	let { variant = 'standard', selected = false, children, class: className = '', type = 'button', ...rest }: Props = $props();

	const VARIANT_CLASS = {
		standard: 'text-on-surface-variant',
		filled: 'bg-primary text-on-primary',
		tonal: 'bg-secondary-container text-on-secondary-container',
		outlined: 'border border-outline text-on-surface-variant'
	} as const;
</script>

<button
	{type}
	aria-pressed={selected || undefined}
	class={[
		'state-layer inline-flex size-10 shrink-0 items-center justify-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-38',
		selected && variant === 'standard' ? 'text-primary' : VARIANT_CLASS[variant],
		className
	]}
	{...rest}
>
	{@render children()}
</button>
