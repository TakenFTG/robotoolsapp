<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import TrashBinIcon from '$lib/icon/TrashBinIcon.svelte';
	import type { Judge } from '@robotools.app/protocol/src/judging';
	import { JudgeEmailSchema } from '@robotools.app/protocol/src/email';

	interface Props {
		judge: Judge;
		onRemoveJudge: (judgeId: string) => void;
		/** Omitted where addresses are not collected, which hides the field entirely. */
		onSetJudgeEmail?: (judgeId: string, email: string | null) => void;
	}

	let { judge, onRemoveJudge, onSetJudgeEmail }: Props = $props();

	/**
	 * The field edits local setup state, so it commits on blur rather than behind a Save
	 * button. Nothing has been sent to the server yet at this point in setup — the whole
	 * event is written in one go at the end — so there is no round trip to guard.
	 */
	let draft = $state(judge.email ?? '');
	let invalid = $state(false);

	function commit() {
		const value = draft.trim();
		if (value === '') {
			invalid = false;
			onSetJudgeEmail?.(judge.id, null);
			return;
		}
		if (!JudgeEmailSchema.safeParse(value).success) {
			invalid = true;
			return;
		}
		invalid = false;
		onSetJudgeEmail?.(judge.id, value.toLowerCase());
	}
</script>

<div class="rounded border border-gray-200 bg-gray-50 px-3 py-2">
	<div class="flex items-center justify-between gap-2">
		<span class="min-w-0 truncate text-sm font-medium text-gray-900">{judge.name}</span>
		<button
			onclick={() => onRemoveJudge(judge.id)}
			class="shrink-0 rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600"
			title={m.remove_judge()}
		>
			<TrashBinIcon class="h-3 w-3" />
		</button>
	</div>

	{#if onSetJudgeEmail}
		<input
			type="email"
			bind:value={draft}
			onblur={commit}
			placeholder={m.judge_email_placeholder()}
			aria-label={m.judge_email()}
			class="mt-1.5 w-full rounded border border-gray-300 bg-white px-2 py-1 text-xs focus:border-blue-500 focus:ring-blue-500"
			class:border-red-400={invalid}
		/>
		{#if invalid}
			<p class="mt-1 text-xs text-red-600">{m.judge_email_invalid()}</p>
		{/if}
	{/if}
</div>
