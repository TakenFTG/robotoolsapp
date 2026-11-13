<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import LinearProgress from '$lib/components/m3/LinearProgress.svelte';
	import { app, AppUI, dialogs, tabs } from '$lib/index.svelte';
	import { onMount } from 'svelte';

	// This app phase is important to trigger unmounting before calling leaveJudgesRoom
	// However, the unsubscribe request might not be sent successfully, it does not matter much

	onMount(async () => {
		// Leaving one event falls back to another room on this device if there is one, so a
		// Judge Advisor running four divisions does not get dumped at the start screen.
		let switchedTo: string | null = null;
		try {
			switchedTo = await app.leaveCurrentEvent();
		} catch (error) {
			console.error('Failed to switch to a remaining event:', error);
		}
		AppUI.appPhase = switchedTo ? 'joining_judges_room' : 'begin';

		try {
			dialogs.closeAllDialogs();
		} catch (error) {
			console.error('Failed to close all dialogs:', error);
		}

		try {
			tabs.closeAllTabs();
		} catch (error) {
			console.error('Failed to close all tabs:', error);
		}
	});
</script>

<div class="flex h-screen flex-1 flex-col items-center justify-center gap-6 bg-surface p-8 text-on-surface">
	<LinearProgress class="max-w-xs" label={m.leaving_judges_room_description()} />
	<p class="text-body-large text-on-surface-variant">{m.leaving_judges_room_description()}</p>
</div>
