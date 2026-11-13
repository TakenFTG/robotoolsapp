<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';

	/** M3 card: a container for one subject. */
	interface Props extends HTMLAttributes<HTMLDivElement> {
		variant?: 'elevated' | 'filled' | 'outlined';
		children?: Snippet;
	}

	let { variant = 'outlined', children, class: className = '', ...rest }: Props = $props();

	const VARIANT_CLASS = {
		elevated: 'bg-surface-container-low shadow-elev-1',
		filled: 'bg-surface-container-highest',
		outlined: 'border border-outline-variant bg-surface-container-lowest'
	} as const;
</script>

<div class={['rounded-lg text-on-surface', VARIANT_CLASS[variant], className]} {...rest}>
	{@render children?.()}
</div>
