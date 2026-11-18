<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import Dialog from '$lib/components/dialog/Dialog.svelte';
	import { app, dialogs } from '$lib/index.svelte';
	import { errorToString } from '$lib/utils.svelte';
	import { TEAM_SCREENING_NOTE_MAX_LENGTH } from '@robotools.app/protocol/src/team';

	interface Props {
		teamId: string;
		teamNumber: string;
	}

	let { teamId, teamNumber }: Props = $props();

	const screening = $derived(app.getTeamScreening(teamId));

	let draft = $state<string | null>(null);
	let saving = $state(false);
	let error = $state<string | null>(null);

	const note = $derived(draft ?? screening?.note ?? '');
	const isOffline = $derived(app.getConnectionState() !== 'connected');

	async function run(action: () => Promise<unknown>) {
		saving = true;
		error = null;
		try {
			await action();
			dialogs.closeDialog();
		} catch (failure) {
			error = errorToString(failure);
		} finally {
			saving = false;
		}
	}

	const save = () => run(() => app.wrpcClient.team.flagTeamForScreening.mutation({ teamId, note }));
	const clear = () => run(() => app.wrpcClient.team.clearTeamScreening.mutation({ teamId }));
</script>

<Dialog open={true} onClose={() => dialogs.closeDialog()} innerContainerClass="max-w-md p-4!">
	<div class="space-y-4 p-2">
		<div>
			<h3 id="dialog-title" class="text-lg font-medium text-gray-900">{m.team_screening_title({ team: teamNumber })}</h3>
			<p class="mt-1 text-sm text-gray-600">{m.team_screening_description()}</p>
		</div>

		<div>
			<label for="team-screening-note" class="mb-1 block text-sm font-medium text-gray-700">{m.team_screening_reason()}</label>
			<textarea
				id="team-screening-note"
				class="classic w-full"
				rows="3"
				maxlength={TEAM_SCREENING_NOTE_MAX_LENGTH}
				placeholder={m.team_screening_reason_placeholder()}
				value={note}
				oninput={(event) => (draft = event.currentTarget.value)}></textarea>
		</div>

		{#if error}
			<p class="text-sm text-red-600">{error}</p>
		{/if}

		<div class="flex flex-wrap justify-end gap-2">
			{#if screening}
				<button type="button" class="danger mr-auto" onclick={clear} disabled={saving || isOffline}>{m.team_screening_clear()}</button>
			{/if}
			<button type="button" class="secondary" onclick={() => dialogs.closeDialog()}>{m.cancel()}</button>
			<button type="button" class="primary" onclick={save} disabled={saving || isOffline}>
				{screening ? m.team_screening_update() : m.team_screening_flag()}
			</button>
		</div>
	</div>
</Dialog>
