<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import { app, dialogs } from '$lib/index.svelte';
	import CloseIcon from '$lib/icon/CloseIcon.svelte';
	import Dialog from '$lib/components/dialog/Dialog.svelte';
	import { THEME_PREFERENCES, type ThemePreference } from '$lib/theme.svelte';
	import { onMount } from 'svelte';

	const preferences = app.getPreferences();
	let theme = $state<ThemePreference>(preferences.get('theme'));

	const themeLabels: Record<ThemePreference, string> = {
		system: m.theme_system(),
		light: m.theme_light(),
		dark: m.theme_dark()
	};

	function chooseTheme(next: ThemePreference) {
		theme = next;
		// Applied immediately by the preferences store, so the dialog you are looking at
		// changes as you choose — which is the only way to judge whether you want it.
		preferences.set('theme', next);
	}

	function handleClose() {
		dialogs.closeDialog();
	}

	/**
	 * What the server reports it is running.
	 *
	 * Asked for on open rather than held in app state: it is wanted roughly never, and when
	 * it is wanted it must be current rather than whatever was true when the page loaded —
	 * the server may well have been redeployed since.
	 *
	 * A failure here is shown as unknown rather than raised. Somebody opening Preferences
	 * to change the theme should not be handed an error about a version string.
	 */
	let serverVersion = $state<string | null>(null);

	onMount(() => {
		app.wrpcClient.meta.getServerInfo
			.query()
			.then((info) => {
				serverVersion = info.version;
			})
			.catch(() => {
				serverVersion = null;
			});
	});
</script>

<Dialog open={true} onClose={handleClose} innerContainerClass="max-w-lg">
	<div class="space-y-6">
		<!-- Title -->
		<div class="flex flex-col">
			<div class="flex items-center justify-between">
				<h3 id="dialog-title" class="text-lg font-semibold text-gray-900">{m.preferences()}</h3>
				<button
					onclick={handleClose}
					class="rounded-full p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
					aria-label="Close dialog"
				>
					<CloseIcon size={24} />
				</button>
			</div>
		</div>

		<div class="space-y-6">
			<!-- Appearance -->
			<div class="space-y-2">
				<span class="block text-sm font-medium text-gray-700">{m.appearance()}</span>
				<div class="flex gap-2" role="radiogroup" aria-label={m.appearance()}>
					{#each THEME_PREFERENCES as option (option)}
						<button
							type="button"
							role="radio"
							aria-checked={theme === option}
							onclick={() => chooseTheme(option)}
							class="flex-1 rounded-md border px-3 py-2 text-sm transition-colors"
							class:border-primary={theme === option}
							class:bg-primary={theme === option}
							class:text-on-primary={theme === option}
							class:border-gray-300={theme !== option}
							class:text-gray-700={theme !== option}
							class:hover:bg-gray-100={theme !== option}
						>
							{themeLabels[option]}
						</button>
					{/each}
				</div>
				<p class="text-xs text-gray-600">{m.theme_description()}</p>
			</div>
		</div>

		<!-- About -->
		<div class="border-t border-gray-200 pt-4">
			<dl class="space-y-1 text-xs text-gray-600">
				<div class="flex justify-between gap-4">
					<dt>{m.version_server()}</dt>
					<dd class="font-mono">{serverVersion ?? m.version_unknown()}</dd>
				</div>
			</dl>
		</div>

		<!-- Close Button -->
		<div class="flex justify-end">
			<button onclick={handleClose} class="primary">{m.close_dialog_text()}</button>
		</div>
	</div>
</Dialog>
