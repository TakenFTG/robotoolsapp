<script lang="ts">
	import CloseIcon from '$lib/icon/CloseIcon.svelte';
	import type { Tab } from '$lib/tab.svelte';

	interface Props {
		tab: Tab;
		isActive: boolean;
		onClose: () => void;
		isDragging?: boolean;
	}

	let { tab, isActive, onClose, isDragging = false }: Props = $props();
</script>

<!-- M3 secondary tab: label in the content colour, a 2px primary indicator under the active one. -->
<div
	class="group state-layer relative flex h-10 flex-1 items-center gap-1 px-3 text-title-small transition-colors select-none"
	class:text-primary={isActive}
	class:text-on-surface-variant={!isActive}
>
	<span class="flex-1 truncate text-left">{tab.title}</span>
	{#if !tab.isPinned}
		<button
			onmousedown={(e) => {
				e.stopPropagation();
			}}
			ontouchstart={(e) => {
				e.stopPropagation();
			}}
			onclick={(e) => {
				e.stopPropagation();
				onClose();
			}}
			class="relative z-10 -mr-1 inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-full text-on-surface-variant hover:bg-on-surface/12"
			tabindex="0"
			aria-label="Close tab"
		>
			<CloseIcon size={12} />
		</button>
	{/if}
	{#if isActive}
		<div class="absolute inset-x-0 bottom-0 h-0.5 rounded-t-full bg-primary"></div>
	{/if}
</div>
