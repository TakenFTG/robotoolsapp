<script lang="ts">
	/** M3 linear progress indicator. Leave `value` unset for an indeterminate bar. */
	interface Props {
		/** 0 to 1. */
		value?: number;
		label?: string;
		class?: string;
	}

	let { value, label, class: className = '' }: Props = $props();
</script>

<div
	role="progressbar"
	aria-label={label}
	aria-valuemin={0}
	aria-valuemax={100}
	aria-valuenow={value === undefined ? undefined : Math.round(value * 100)}
	class={['relative h-1 w-full overflow-hidden rounded-full bg-secondary-container', className]}
>
	{#if value === undefined}
		<div class="indeterminate absolute inset-y-0 rounded-full bg-primary"></div>
	{:else}
		<div
			class="h-full rounded-full bg-primary transition-[width] duration-300"
			style:width="{Math.min(1, Math.max(0, value)) * 100}%"
		></div>
	{/if}
</div>

<style>
	.indeterminate {
		animation: slide 1.6s cubic-bezier(0.4, 0, 0.2, 1) infinite;
	}

	@keyframes slide {
		from {
			left: -40%;
			width: 40%;
		}
		to {
			left: 100%;
			width: 40%;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.indeterminate {
			animation-duration: 4s;
		}
	}
</style>
