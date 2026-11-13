<script lang="ts">
	import type { HTMLInputAttributes } from 'svelte/elements';

	/** M3 outlined text field with a label above and supporting or error text below. */
	interface Props extends HTMLInputAttributes {
		label: string;
		value?: string | number | null;
		supportingText?: string;
		/** Shown in place of the supporting text, and marks the field invalid. */
		error?: string;
	}

	let { label, value = $bindable(), supportingText, error, id, class: className = '', type = 'text', ...rest }: Props = $props();

	const fallbackId = $props.id();
	const inputId = $derived(id ?? fallbackId);
	const message = $derived(error || supportingText);
</script>

<div class={['flex flex-col gap-1', className]}>
	<label for={inputId} class="text-body-small text-on-surface-variant" class:text-error={error}>{label}</label>
	<input
		id={inputId}
		{type}
		class="classic w-full"
		aria-invalid={error ? 'true' : undefined}
		aria-describedby={message ? `${inputId}-message` : undefined}
		bind:value
		{...rest}
	/>
	{#if message}
		<p id="{inputId}-message" class="px-4 text-body-small" class:text-error={error} class:text-on-surface-variant={!error}>
			{message}
		</p>
	{/if}
</div>
