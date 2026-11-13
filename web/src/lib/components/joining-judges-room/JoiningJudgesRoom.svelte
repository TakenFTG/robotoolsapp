<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import LinearProgress from '$lib/components/m3/LinearProgress.svelte';
	import { app, AppUI } from '$lib/index.svelte';

	// Watch for app data to become available and transition UI automatically
	$effect(() => {
		if (app.hasEssentialData()) {
			const currentUser = app.getCurrentUser();
			if (currentUser) {
				if (!app.isAccessControlEnabled()) {
					void app.selectUser(currentUser);
				}
				AppUI.appPhase = 'workspace';
			} else if (app.isAccessControlEnabled()) {
				// Access control requires a personal link; role picker is unavailable.
				AppUI.appPhase = 'begin';
			} else {
				AppUI.appPhase = 'role_selection';
			}
		}
	});
</script>

<svelte:head>
	<title>{m.joining()} | Judges' Room</title>
</svelte:head>

<div class="flex h-screen flex-1 flex-col items-center justify-center gap-6 bg-surface p-8 text-on-surface">
	<LinearProgress class="max-w-xs" label={m.joining()} />
	<p class="text-body-large text-on-surface-variant">{m.joining_judges_room_description()}</p>
</div>
