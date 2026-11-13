<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import LinearProgress from '$lib/components/m3/LinearProgress.svelte';
</script>

<svelte:head>
	<title>{m.loading()} | Judges' Room</title>
</svelte:head>

<div class="flex h-screen flex-1 flex-col items-center justify-center gap-6 bg-surface p-8 text-on-surface">
	<LinearProgress class="max-w-xs" label={m.loading()} />
	<p class="text-body-large text-on-surface-variant">{m.loading_description()}</p>
</div>
