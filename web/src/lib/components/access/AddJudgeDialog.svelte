<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import Dialog from '$lib/components/dialog/Dialog.svelte';
	import { app, dialogs } from '$lib/index.svelte';
	import { errorToString } from '$lib/utils.svelte';
	import { trimBlanks } from '$lib/text';
	import { JudgeEmailSchema } from '@robotools.app/protocol/src/email';

	interface Props {
		/** The group to start on, when adding from a particular group. */
		groupId?: string;
	}

	let { groupId }: Props = $props();

	const groups = $derived(app.getAllJudgeGroups());

	let name = $state('');
	let email = $state('');
	let chosenGroupId = $state<string | null>(null);
	let saving = $state(false);
	let error = $state<string | null>(null);

	const selectedGroupId = $derived(chosenGroupId ?? groupId ?? groups[0]?.id ?? '');
	const canSubmit = $derived(trimBlanks(name) !== '' && selectedGroupId !== '' && !saving);

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		if (!canSubmit) return;

		const address = trimBlanks(email);
		if (address !== '' && !JudgeEmailSchema.safeParse(address).success) {
			error = m.judge_email_invalid();
			return;
		}

		saving = true;
		error = null;
		try {
			dialogs.closeDialog(await app.addJudge(trimBlanks(name), selectedGroupId, address || null));
		} catch (failure) {
			error = errorToString(failure);
		} finally {
			saving = false;
		}
	}
</script>

<Dialog open={true} onClose={() => dialogs.closeDialog()} innerContainerClass="max-w-md p-4!">
	<form class="space-y-4 p-2" onsubmit={submit}>
		<h3 id="dialog-title" class="text-lg font-medium text-gray-900">{m.add_judge()}</h3>

		<div>
			<label for="new-judge-name" class="mb-1 block text-sm font-medium text-gray-700">{m.judge_name_colon()}</label>
			<input id="new-judge-name" class="classic w-full" maxlength="100" bind:value={name} />
		</div>

		<div>
			<label for="new-judge-group" class="mb-1 block text-sm font-medium text-gray-700">{m.judge_group_name_colon()}</label>
			<select
				id="new-judge-group"
				class="classic w-full"
				value={selectedGroupId}
				onchange={(event) => (chosenGroupId = event.currentTarget.value)}
			>
				{#each groups as group (group.id)}
					<option value={group.id}>{group.name}</option>
				{/each}
			</select>
		</div>

		<div>
			<label for="new-judge-email" class="mb-1 block text-sm font-medium text-gray-700">{m.judge_email_optional()}</label>
			<input id="new-judge-email" type="email" class="classic w-full" placeholder={m.judge_email_placeholder()} bind:value={email} />
		</div>

		{#if error}
			<p class="text-sm text-red-600">{error}</p>
		{/if}

		<div class="flex justify-end gap-2">
			<button type="button" class="secondary" onclick={() => dialogs.closeDialog()}>{m.cancel()}</button>
			<button type="submit" class="primary" disabled={!canSubmit}>{saving ? '…' : m.add_judge()}</button>
		</div>
	</form>
</Dialog>
