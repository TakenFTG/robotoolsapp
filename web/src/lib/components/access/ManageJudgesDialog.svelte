<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import Dialog from '$lib/components/dialog/Dialog.svelte';
	import AccessLinkDialog from './AccessLinkDialog.svelte';
	import { addAndInviteJudge } from './invite-judge';
	import { app, dialogs } from '$lib/index.svelte';
	import { errorToString } from '$lib/utils.svelte';
	import { trimBlanks } from '$lib/text';
	import XmarkIcon from '$lib/icon/XmarkIcon.svelte';
	import { JudgeEmailSchema } from '@robotools.app/protocol/src/email';
	import type { AccessLinkJudge, JudgeAccessLinks } from '@robotools.app/protocol/src/access';
	import { onMount } from 'svelte';

	/** The Lead Judge's roster: add judges and hand out their links, and nothing more. */
	let links = $state<JudgeAccessLinks | null>(null);
	let drafts = $state<Record<string, string>>({});
	let busyJudgeId = $state<string | null>(null);
	let messages = $state<Record<string, { text: string; isError: boolean }>>({});

	const judges = $derived([...(links?.judges ?? [])].sort((a, b) => a.name.localeCompare(b.name)));
	const isOffline = $derived(app.getConnectionState() !== 'connected');

	async function load() {
		try {
			links = await app.wrpcClient.access.listJudgeAccessLinks.query();
		} catch (error) {
			await dialogs.showAlert({ title: m.failed(), message: errorToString(error), confirmButtonClass: 'primary' });
			dialogs.closeDialog();
		}
	}

	async function addJudge() {
		if (await addAndInviteJudge()) await load();
	}

	function showLink(judge: AccessLinkJudge) {
		void dialogs.showCustom(AccessLinkDialog, {
			props: { name: judge.name, link: app.getJudgesRoomUrl(judge.authToken) },
			maxWidth: 'max-w-xl'
		});
	}

	function isDirty(judge: AccessLinkJudge): boolean {
		const draft = drafts[judge.judgeId];
		return draft !== undefined && trimBlanks(draft) !== (judge.email ?? '');
	}

	async function saveEmail(judge: AccessLinkJudge) {
		const address = trimBlanks(drafts[judge.judgeId] ?? '');
		if (address !== '' && !JudgeEmailSchema.safeParse(address).success) {
			messages[judge.judgeId] = { text: m.judge_email_invalid(), isError: true };
			return;
		}

		busyJudgeId = judge.judgeId;
		try {
			await app.wrpcClient.access.setJudgeEmail.mutation({ judgeId: judge.judgeId, email: address || null });
			delete drafts[judge.judgeId];
			delete messages[judge.judgeId];
			await load();
		} catch (error) {
			messages[judge.judgeId] = { text: errorToString(error), isError: true };
		} finally {
			busyJudgeId = null;
		}
	}

	async function sendEmail(judge: AccessLinkJudge) {
		const email = judge.email;
		if (!email) return;

		const confirmed = await dialogs.showConfirmation({
			title: m.email_access_link(),
			message: m.email_access_link_confirm({ name: judge.name, email }),
			confirmText: m.email_access_link(),
			confirmButtonClass: 'primary'
		});
		if (!confirmed) return;

		busyJudgeId = judge.judgeId;
		try {
			const { results } = await app.wrpcClient.access.sendAccessLinkEmails.mutation({ judgeIds: [judge.judgeId] });
			const result = results[0];
			messages[judge.judgeId] =
				result?.outcome === 'sent'
					? { text: m.email_access_link_sent({ email }), isError: false }
					: { text: result?.error ?? m.email_outcome_failed(), isError: true };
		} catch (error) {
			messages[judge.judgeId] = { text: errorToString(error), isError: true };
		} finally {
			busyJudgeId = null;
		}
	}

	onMount(() => {
		void load();
	});
</script>

<Dialog open={true} onClose={() => dialogs.closeDialog()} innerContainerClass="max-w-2xl p-4!">
	<div class="flex max-h-[80vh] flex-col overflow-hidden p-2">
		<div class="mb-2 flex shrink-0 items-center justify-between gap-3">
			<h3 id="dialog-title" class="text-lg font-medium text-gray-900">{m.manage_judges()}</h3>
			<button
				onclick={() => dialogs.closeDialog()}
				class="rounded-full p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
				aria-label={m.close_dialog_text()}
			>
				<XmarkIcon size={18} />
			</button>
		</div>

		<div class="mb-4 flex shrink-0 items-start justify-between gap-3">
			<p class="text-xs text-gray-600">{m.manage_judges_description()}</p>
			<button type="button" class="primary tiny shrink-0" onclick={addJudge} disabled={isOffline}>{m.add_judge()}</button>
		</div>

		{#if !links}
			<p class="text-sm text-gray-500">…</p>
		{:else}
			<div class="min-h-0 flex-1 space-y-3 overflow-auto pr-1">
				{#each judges as judge (judge.judgeId)}
					<div class="rounded-lg border border-gray-200 px-3 py-2.5">
						<div class="flex items-center justify-between gap-2">
							<div class="flex min-w-0 items-center gap-2">
								<span class="truncate text-sm font-medium text-gray-900">{judge.name}</span>
								{#if judge.isLeadJudge}
									<span class="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">{m.lead_judge()}</span>
								{/if}
							</div>
							<button
								type="button"
								class="shrink-0 rounded-md px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
								onclick={() => showLink(judge)}
							>
								{m.show_access_link()}
							</button>
						</div>
						<div class="mt-2 flex flex-wrap items-center gap-2">
							<label class="sr-only" for={`manage-judge-email-${judge.judgeId}`}>{m.judge_email()}</label>
							<input
								id={`manage-judge-email-${judge.judgeId}`}
								type="email"
								class="classic min-w-0 flex-1 text-sm"
								placeholder={m.judge_email_placeholder()}
								value={drafts[judge.judgeId] ?? judge.email ?? ''}
								oninput={(event) => (drafts[judge.judgeId] = event.currentTarget.value)}
								disabled={isOffline}
							/>
							{#if isDirty(judge)}
								<button
									type="button"
									class="primary tiny shrink-0"
									onclick={() => saveEmail(judge)}
									disabled={isOffline || busyJudgeId !== null}
								>
									{busyJudgeId === judge.judgeId ? '…' : m.save_judge_email()}
								</button>
							{:else if judge.email && links.emailCapability.enabled}
								<button
									type="button"
									class="lightweight tiny shrink-0"
									onclick={() => sendEmail(judge)}
									disabled={isOffline || busyJudgeId !== null}
								>
									{busyJudgeId === judge.judgeId ? '…' : m.email_access_link()}
								</button>
							{/if}
						</div>
						{#if messages[judge.judgeId]}
							<p
								class="mt-1 text-xs"
								class:text-red-600={messages[judge.judgeId].isError}
								class:text-green-700={!messages[judge.judgeId].isError}
							>
								{messages[judge.judgeId].text}
							</p>
						{/if}
					</div>
				{/each}
			</div>
		{/if}
	</div>
</Dialog>
