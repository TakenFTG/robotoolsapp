<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLButtonAttributes } from 'svelte/elements';

	/**
	 * M3 common button. Built on the shared button classes in app.css, so a `<Button>` and a
	 * `<button class="primary">` always look the same.
	 */
	interface Props extends HTMLButtonAttributes {
		variant?: 'filled' | 'tonal' | 'outlined' | 'text' | 'elevated';
		/** Destructive action: filled in the error colour. */
		danger?: boolean;
		compact?: boolean;
		icon?: Snippet;
		children?: Snippet;
	}

	let {
		variant = 'filled',
		danger = false,
		compact = false,
		icon,
		children,
		class: className = '',
		type = 'button',
		...rest
	}: Props = $props();

	const VARIANT_CLASS = {
		filled: 'primary',
		tonal: 'secondary',
		outlined: 'lightweight',
		text: 'cancel',
		elevated: 'elevated'
	} as const;
</script>

<button
	{type}
	class={['inline-flex items-center justify-center gap-2', danger ? 'danger' : VARIANT_CLASS[variant], compact && 'tiny', className]}
	{...rest}
>
	{@render icon?.()}
	{@render children?.()}
</button>
