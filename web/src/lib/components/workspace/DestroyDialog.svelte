<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import { app, AppUI, dialogs, tabs } from '$lib/index.svelte';
	import Dialog from '$lib/components/dialog/Dialog.svelte';
	import ResultsReportDialog from './ResultsReportDialog.svelte';

	let destroyConfirmText = $state('');
	let isDestroying = $state(false);

	const canDestroy = $derived(true);
	const isDestroyConfirmValid = $derived(destroyConfirmText.trim().toLowerCase() === 'destroy');

	async function handleDestroy() {
		if (!canDestroy || !isDestroyConfirmValid) return;

		isDestroying = true;
		try {
			// Usually rejects: the server closes the socket as part of destroying the room.
			// Either way the room is gone and the permit has been forgotten.
			await app.destroyJudgesRoomData();
		} catch (error) {
			console.debug('Destroy finished with a closed socket, as expected:', error);
		}

		// Deliberately after the try/finally rather than inside it.
		//
		// This ran in a `finally` block with a `return` in it, which is a quiet trap: a
		// return inside finally discards whatever the try block was doing, including an
		// exception on its way out. Nothing throws past the catch above today, so it never
		// bit — but the room has already been destroyed by this point, and swallowing an
		// error here would hide it at the worst moment.
		isDestroying = false;
		dialogs.closeAllDialogs();
		tabs.closeAllTabs();

		// Land somewhere real rather than on a workspace for a room that no longer exists:
		// another event on this device if there is one, otherwise the start screen.
		const remaining = app.getPermits()[0];
		if (remaining) {
			try {
				await app.switchToEvent(remaining.roomId);
				AppUI.appPhase = 'joining_judges_room';
				return;
			} catch (error) {
				console.error('Failed to switch to a remaining event after destroy:', error);
			}
		}
		AppUI.appPhase = 'begin';
	}

	/**
	 * Show the report without losing this dialog.
	 *
	 * Stacked rather than replacing: someone who exports should come straight back to the
	 * decision they were making, not have to find their way here again.
	 */
	function openExport() {
		void dialogs.showCustom(ResultsReportDialog, { props: {}, maxWidth: 'max-w-3xl' });
	}

	function handleCancel() {
		dialogs.closeDialog(false);
	}
</script>

<Dialog open={true} onClose={handleCancel}>
	<div class="space-y-6">
		<div>
			<h3 id="dialog-title" class="text-lg font-semibold text-gray-900">{m.destroy_judging_data()}</h3>
			<p class="mt-2 text-sm text-gray-600">
				{m.destroy_judging_data_description()}
			</p>
		</div>

		<!-- Warning Message -->
		<div class="rounded-md bg-red-50 p-4">
			<div class="flex">
				<div class="shrink-0">
					<svg class="h-5 w-5 text-red-400" fill="currentColor" viewBox="0 0 20 20">
						<path
							fill-rule="evenodd"
							d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
							clip-rule="evenodd"
						/>
					</svg>
				</div>
				<div class="ml-3">
					<h3 class="text-sm font-medium text-red-800">{m.warning()}</h3>
					<div class="mt-2 text-sm text-red-700">
						<p>
							{m.destroy_judging_data_description_warning()}
						</p>
					</div>
				</div>
			</div>
		</div>

		<!-- The export offered where it is needed, not buried in a menu.
		     Destroying is irreversible and this is the only record that can be kept, so the
		     prompt belongs on the screen where the decision is being made. -->
		<div class="rounded-md border border-gray-200 bg-gray-50 p-4">
			<p class="text-sm text-gray-700">{m.destroy_export_prompt()}</p>
			<button type="button" class="lightweight tiny mt-2" onclick={openExport}>{m.export_results()}</button>
		</div>

		<!-- Data Destruction Section -->
		<div class="space-y-3">
			<p class="text-sm text-gray-600">{m.destroy_judging_data_confirmation()}</p>

			<div>
				<label for="destroyConfirm" class="block text-sm font-medium text-gray-700">{m.confirmation()}</label>
				<input
					id="destroyConfirm"
					type="text"
					bind:value={destroyConfirmText}
					disabled={!canDestroy}
					placeholder={m.destroy_judging_data_confirmation_placeholder()}
					class="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-red-500 focus:ring-1 focus:ring-red-500 focus:outline-none disabled:bg-gray-50 disabled:opacity-50"
				/>
			</div>
		</div>

		<!-- Action Buttons -->
		<div class="flex justify-end space-x-3">
			<button
				onclick={handleCancel}
				class="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
			>
				{m.cancel()}
			</button>
			<button
				onclick={handleDestroy}
				disabled={!canDestroy || !isDestroyConfirmValid || isDestroying}
				class="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
			>
				{#if isDestroying}
					{m.destroying()}
				{:else}
					{m.destroy_all_data()}
				{/if}
			</button>
		</div>
	</div>
</Dialog>
