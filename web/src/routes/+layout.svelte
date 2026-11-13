<script lang="ts">
	import { page } from '$app/state';
	import { asset } from '$app/paths';
	import { locales, localizeHref } from '$lib/paraglide/runtime';
	import { onMount } from 'svelte';
	import { app } from '$lib/index.svelte';
	import { watchSystemTheme } from '$lib/theme.svelte';
	import '../app.css';

	let { children } = $props();

	// While the preference is System, follow the device if it changes mid-session — someone
	// whose phone switches to dark at sunset should not have to reload.
	onMount(() => watchSystemTheme(() => app.getPreferences().get('theme')));

	// The ref pages install as their own app, with their own name and icon, so a phone can
	// hold the judge app and the ref app side by side. Chrome tells them apart by the
	// manifest id, so each side must point at its own manifest.
	let isRef = $derived(page.url.pathname === '/ref' || page.url.pathname.startsWith('/ref/'));
</script>

<svelte:head>
	{#if isRef}
		<link rel="manifest" href={asset('/ref.webmanifest')} />
		<link rel="apple-touch-icon" sizes="180x180" href={asset('/ref-apple-touch-icon.png')} />
		<meta name="apple-mobile-web-app-title" content="Ref Notes" />
	{:else}
		<link rel="manifest" href={asset('/site.webmanifest')} />
		<link rel="apple-touch-icon" sizes="180x180" href={asset('/apple-touch-icon.png')} />
		<meta name="apple-mobile-web-app-title" content="Robo Tools" />
	{/if}
</svelte:head>

{@render children()}

<div style="display:none">
	{#each locales as locale (locale)}
		<!-- paraglide builds this from the current pathname; it is not a route id. -->
		<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
		<a href={localizeHref(page.url.pathname, { locale })}>
			{locale}
		</a>
	{/each}
</div>
