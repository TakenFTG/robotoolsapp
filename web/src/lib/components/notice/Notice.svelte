<script lang="ts">
	import type { Notice } from '$lib/app.svelte';

	interface Props {
		notice: Notice;
		dismissNotice: (id: string) => void;
	}

	let { notice, dismissNotice }: Props = $props();
	const isError = $derived(notice.type === 'error');
</script>

<div
	role={isError ? 'alert' : 'status'}
	class="flex max-w-9/10 min-w-xs items-center justify-between gap-2 rounded-sm bg-inverse-surface py-2 pr-2 pl-4 text-inverse-on-surface shadow-elev-3"
>
	<div class="flex items-center">
		{#if isError}
			<svg class="mr-3 h-5 w-5 shrink-0 text-error-container" fill="none" stroke="currentColor" viewBox="0 0 24 24">
				<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
			</svg>
		{:else}
			<svg class="mr-3 h-5 w-5 shrink-0 text-success-container" fill="none" stroke="currentColor" viewBox="0 0 24 24">
				<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path>
			</svg>
		{/if}
		<span class="py-2 text-body-medium">{notice.message}</span>
	</div>
	<button
		onclick={() => dismissNotice(notice.id)}
		class="state-layer inline-flex size-10 shrink-0 items-center justify-center rounded-full"
		aria-label="Dismiss notice"
	>
		<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
			<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
		</svg>
	</button>
</div>
