<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import { app, dialogs } from '$lib/index.svelte';
	import CopyIcon from '$lib/icon/CopyIcon.svelte';
	import DenialIcon from '$lib/icon/DenialIcon.svelte';
	import RotateIcon from '$lib/icon/RotateIcon.svelte';
	import UsersIcon from '$lib/icon/UsersIcon.svelte';
	import XmarkIcon from '$lib/icon/XmarkIcon.svelte';
	import Dialog from '$lib/components/dialog/Dialog.svelte';

	import AccessLinkDialog from '$lib/components/access/AccessLinkDialog.svelte';
	import AccessPassesDialog from '$lib/components/access/AccessPassesDialog.svelte';
	import { canUseClipboard, errorToString } from '$lib/utils.svelte';
	import { onDestroy, onMount } from 'svelte';
	import type { AccessLinks } from '@robotools.app/protocol/src/access';
	import { JudgeEmailSchema, type EmailSendResult } from '@robotools.app/protocol/src/email';
	import type { DeviceInfo } from '@robotools.app/protocol/src/client';

	const clipboardAvailable = canUseClipboard();

	type UserRow = {
		key: string;
		name: string;
		/**
		 * Null for a group advisor: their credential belongs to the event group, which never
		 * hands it to a member room. Nothing here can copy or rotate a link it does not have.
		 */
		authToken: string | null;
		kind: 'judge_advisor' | 'judge';
		/** Advisors only: whether this room administers them, or the event group does. */
		origin?: 'room' | 'group';
		judgeId?: string;
		judgeAdvisorId?: string;
		/** True for the row representing the advisor using this device. */
		isSelf?: boolean;
		/** Judges only: the saved address, or null. Advisors are handed their links in person. */
		email?: string | null;
	};

	let accessLinks = $state<AccessLinks | null>(null);
	let loadingLinks = $state(false);
	let copiedKey = $state<string | null>(null);

	/**
	 * Unsaved edits, keyed by judge id.
	 *
	 * Held apart from `accessLinks` so a background refresh cannot overwrite an address
	 * someone is halfway through typing. A key is present only while the field differs
	 * from what the server holds.
	 */
	let emailDrafts = $state<Record<string, string>>({});
	let savingEmailFor = $state<string | null>(null);
	let emailErrors = $state<Record<string, string>>({});
	let sendingKey = $state<string | null>(null);
	/** Outcome of the last send, shown until the next one. */
	let sendResults = $state<EmailSendResult[] | null>(null);
	let sendError = $state<string | null>(null);

	const emailEnabled = $derived(accessLinks?.emailCapability.enabled ?? false);
	const emailFrom = $derived(accessLinks?.emailCapability.fromAddress ?? null);
	const addressedJudgeCount = $derived(accessLinks?.judges.filter((judge) => !!judge.email).length ?? 0);

	const devices = $derived(app.getDevices());
	const connectionState = $derived(app.getConnectionState());
	const permit = $derived(app.getPermit());
	const isDisconnectedFromServer = $derived(connectionState !== 'connected');

	const userRows = $derived.by((): UserRow[] => {
		if (!accessLinks) return [];
		const currentAuth = app.getPermit()?.authToken;
		return [
			...accessLinks.judgeAdvisors.map((advisor) => ({
				key: advisor.judgeAdvisorId,
				name: advisor.name,
				authToken: advisor.authToken,
				kind: 'judge_advisor' as const,
				origin: advisor.origin,
				judgeAdvisorId: advisor.judgeAdvisorId,
				email: advisor.email,
				isSelf: !!currentAuth && currentAuth === advisor.authToken
			})),
			...accessLinks.judges.map((judge) => ({
				key: judge.judgeId,
				name: judge.name,
				authToken: judge.authToken,
				kind: 'judge' as const,
				judgeId: judge.judgeId,
				email: judge.email
			}))
		];
	});

	function devicesForUser(user: UserRow): DeviceInfo[] {
		return devices.filter((device) => {
			const auth = device.authenticated;
			if (!auth) return false;
			if (user.kind === 'judge_advisor') return auth.role === 'judge_advisor' && auth.judgeAdvisorId === user.judgeAdvisorId;
			return auth.role === 'judge' && auth.judgeId === user.judgeId;
		});
	}

	function onlineCount(user: UserRow): number {
		return devicesForUser(user).filter((device) => device.isOnline).length;
	}

	async function loadAccessLinks() {
		loadingLinks = true;
		try {
			accessLinks = await app.wrpcClient.access.listAccessLinks.query();
		} catch (error) {
			console.error('Failed to load access links:', error);
		} finally {
			loadingLinks = false;
		}
	}

	/**
	 * Show someone their link.
	 *
	 * Always available, unlike the copy shortcut: copying needs a secure context, and a
	 * self-hosted server on plain HTTP is not one — so without this there was no way at all
	 * to hand a judge their link on exactly those deployments.
	 */
	function showUserLink(user: UserRow) {
		if (!user.authToken) return;
		void dialogs.showCustom(AccessLinkDialog, {
			props: { name: user.name, link: app.getJudgesRoomUrl(user.authToken) },
			maxWidth: 'max-w-xl'
		});
	}

	/** Printable passes for every judge, for events where emailed links don't get through. */
	function printJudgePasses() {
		if (!accessLinks) return;
		const people = [...accessLinks.judges]
			.sort((a, b) => a.name.localeCompare(b.name))
			.map((judge) => ({ name: judge.name, link: app.getJudgesRoomUrl(judge.authToken) }));
		void dialogs.showCustom(AccessPassesDialog, { props: { kind: 'judge' as const, people }, maxWidth: 'max-w-3xl' });
	}

	async function copyUserLink(user: UserRow) {
		if (!user.authToken) return;
		try {
			await navigator.clipboard.writeText(app.getJudgesRoomUrl(user.authToken));
			copiedKey = user.key;
			setTimeout(() => {
				if (copiedKey === user.key) copiedKey = null;
			}, 2000);
		} catch (error) {
			console.error('Failed to copy URL:', error);
		}
	}

	async function rotateUserLink(user: UserRow) {
		const confirmed = await dialogs.showConfirmation({
			title: m.rotate_access_link(),
			message: user.kind === 'judge_advisor' ? m.rotate_judge_advisor_access_link_confirm() : m.rotate_access_link_confirm(),
			confirmText: m.rotate_access_link(),
			confirmButtonClass: 'danger'
		});
		if (!confirmed) return;

		if (user.kind === 'judge_advisor') {
			// The server only ever rotates the calling advisor's own link.
			const { authToken } = await app.wrpcClient.access.rotateJudgeAdvisorAuth.mutation();
			const accessLink = app.getJudgesRoomUrl(authToken);
			await loadAccessLinks();
			await dialogs.showCustom(AccessLinkDialog, {
				props: { link: accessLink, audience: 'self' as const, name: user.name },
				maxWidth: 'max-w-xl'
			});
			return;
		}

		if (!user.judgeId) return;
		await app.wrpcClient.access.rotateJudgeAuth.mutation({ judgeId: user.judgeId });
		await loadAccessLinks();
	}

	async function addJudgeAdvisor() {
		const name = await dialogs.showPrompt({
			title: m.add_judge_advisor(),
			message: m.judge_advisor_name_colon(),
			confirmText: m.add_judge_advisor()
		});
		const trimmed = typeof name === 'string' ? name.trim() : '';
		if (!trimmed) return;

		try {
			const { authToken } = await app.wrpcClient.access.addJudgeAdvisor.mutation({ name: trimmed });
			await loadAccessLinks();
			// Show the link straight away — it is the only way to reach the new advisor, and
			// in a room with no PIN it is the whole of their credential.
			await dialogs.showCustom(AccessLinkDialog, {
				props: { link: app.getJudgesRoomUrl(authToken), name: trimmed },
				maxWidth: 'max-w-xl'
			});
		} catch (error) {
			dialogs.showAlert({
				title: m.failed(),
				message: error instanceof Error ? error.message : 'Unknown error',
				confirmButtonClass: 'primary'
			});
		}
	}

	async function removeJudgeAdvisor(user: UserRow) {
		if (!user.judgeAdvisorId) return;
		const confirmed = await dialogs.showConfirmation({
			title: m.remove(),
			message: m.remove_judge_advisor_confirmation({ name: user.name }),
			confirmButtonClass: 'danger'
		});
		if (!confirmed) return;

		try {
			await app.wrpcClient.access.removeJudgeAdvisor.mutation({ judgeAdvisorId: user.judgeAdvisorId });
			await loadAccessLinks();
		} catch (error) {
			dialogs.showAlert({
				title: m.failed(),
				message: error instanceof Error ? error.message : 'Unknown error',
				confirmButtonClass: 'primary'
			});
		}
	}

	async function renameJudgeAdvisor(user: UserRow) {
		if (!user.judgeAdvisorId) return;
		const name = await dialogs.showPrompt({
			title: m.judge_advisor_name_colon(),
			message: m.judge_advisor_name_colon(),
			defaultValue: user.name
		});
		const trimmed = typeof name === 'string' ? name.trim() : '';
		if (!trimmed || trimmed === user.name) return;

		try {
			await app.wrpcClient.access.renameJudgeAdvisor.mutation({ judgeAdvisorId: user.judgeAdvisorId, name: trimmed });
			await loadAccessLinks();
		} catch (error) {
			dialogs.showAlert({
				title: m.failed(),
				message: error instanceof Error ? error.message : 'Unknown error',
				confirmButtonClass: 'primary'
			});
		}
	}

	// ========================================================================
	// Emailing access links
	// ========================================================================

	/** What is currently in the field: the unsaved draft if there is one, else the saved value. */
	function currentEmail(user: UserRow): string {
		return emailDrafts[user.key] ?? user.email ?? '';
	}

	function isEmailDirty(user: UserRow): boolean {
		const draft = emailDrafts[user.key];
		return draft !== undefined && draft.trim() !== (user.email ?? '');
	}

	function onEmailInput(user: UserRow, value: string) {
		emailDrafts = { ...emailDrafts, [user.key]: value };
		if (emailErrors[user.key]) {
			const { [user.key]: _removed, ...rest } = emailErrors;
			emailErrors = rest;
		}
	}

	/**
	 * Save an address, or clear it when the field is emptied.
	 *
	 * Validated here as well as on the server so a typo is caught while the person who made
	 * it is still looking at the field, rather than as a failed send some minutes later.
	 */
	async function saveJudgeEmail(user: UserRow) {
		if (!user.judgeId) return;

		const raw = (emailDrafts[user.key] ?? '').trim();
		const email = raw === '' ? null : raw;

		if (email !== null && !JudgeEmailSchema.safeParse(email).success) {
			emailErrors = { ...emailErrors, [user.key]: m.judge_email_invalid() };
			return;
		}

		savingEmailFor = user.key;
		try {
			const saved = await app.wrpcClient.access.setJudgeEmail.mutation({ judgeId: user.judgeId, email });
			// Reflect the server's normalised value, then drop the draft so the row reads
			// from the authoritative copy again.
			if (accessLinks) {
				accessLinks = {
					...accessLinks,
					judges: accessLinks.judges.map((judge) => (judge.judgeId === user.judgeId ? { ...judge, email: saved.email } : judge))
				};
			}
			const { [user.key]: _saved, ...rest } = emailDrafts;
			emailDrafts = rest;
		} catch (error) {
			emailErrors = { ...emailErrors, [user.key]: errorToString(error) };
		} finally {
			savingEmailFor = null;
		}
	}

	async function sendAccessLinkEmails(judgeIds: string[] | null, confirmMessage: string, key: string) {
		const confirmed = await dialogs.showConfirmation({
			title: judgeIds === null ? m.email_all_access_links() : m.email_access_link(),
			message: confirmMessage,
			confirmText: judgeIds === null ? m.email_all_access_links() : m.email_access_link(),
			confirmButtonClass: 'primary'
		});
		if (!confirmed) return;

		sendingKey = key;
		sendError = null;
		try {
			const { results } = await app.wrpcClient.access.sendAccessLinkEmails.mutation({ judgeIds });
			sendResults = results;
		} catch (error) {
			sendResults = null;
			sendError = errorToString(error);
		} finally {
			sendingKey = null;
		}
	}

	/**
	 * Save an advisor's address.
	 *
	 * Separate from the judge path because a group advisor's address lives at the group,
	 * which is also the only place it can be changed — the room holds neither their token
	 * nor their address.
	 */
	async function saveAdvisorEmail(user: UserRow) {
		if (!user.judgeAdvisorId) return;

		const raw = (emailDrafts[user.key] ?? '').trim();
		const email = raw === '' ? null : raw;

		if (email !== null && !JudgeEmailSchema.safeParse(email).success) {
			emailErrors = { ...emailErrors, [user.key]: m.judge_email_invalid() };
			return;
		}

		savingEmailFor = user.key;
		try {
			const saved = await app.wrpcClient.access.setJudgeAdvisorEmail.mutation({
				judgeAdvisorId: user.judgeAdvisorId,
				email
			});
			if (accessLinks) {
				accessLinks = {
					...accessLinks,
					judgeAdvisors: accessLinks.judgeAdvisors.map((advisor) =>
						advisor.judgeAdvisorId === user.judgeAdvisorId ? { ...advisor, email: saved.email } : advisor
					)
				};
			}
			const { [user.key]: _saved, ...rest } = emailDrafts;
			emailDrafts = rest;
		} catch (error) {
			emailErrors = { ...emailErrors, [user.key]: errorToString(error) };
		} finally {
			savingEmailFor = null;
		}
	}

	/**
	 * Send an advisor their access link — yours, or another advisor's.
	 *
	 * Sending someone else's is deliberate. It reads like handing out the room's most
	 * powerful credential on their behalf, but every advisor's link is already offered on
	 * their own row through "Show access link" and "Copy access link", so nothing here is
	 * newly exposed. What it does fix is a second advisor added after setup having no way
	 * to be sent their link, when the first advisor was sent theirs automatically.
	 */
	async function emailAdvisorLink(user: UserRow) {
		const email = user.email;
		if (!email) return;

		const confirmed = await dialogs.showConfirmation({
			title: user.isSelf ? m.email_my_access_link() : m.email_access_link(),
			message: user.isSelf ? m.email_own_link_confirm({ email }) : m.email_access_link_confirm({ name: user.name, email }),
			confirmText: user.isSelf ? m.email_my_access_link() : m.email_access_link(),
			confirmButtonClass: 'primary'
		});
		if (!confirmed) return;

		sendingKey = user.key;
		sendError = null;
		try {
			// Null asks the server for the caller's own link, which is what a Judge Advisor
			// resending to themselves wants and avoids trusting the client with the id.
			const { results } = await app.wrpcClient.access.sendAdvisorAccessLinkEmail.mutation({
				judgeAdvisorId: user.isSelf ? null : (user.judgeAdvisorId ?? null)
			});
			sendResults = results;
		} catch (error) {
			sendResults = null;
			sendError = errorToString(error);
		} finally {
			sendingKey = null;
		}
	}

	function emailOneJudge(user: UserRow) {
		const email = user.email;
		if (!user.judgeId || !email) return;
		void sendAccessLinkEmails([user.judgeId], m.email_access_link_confirm({ name: user.name, email }), user.key);
	}

	function emailAllJudges() {
		void sendAccessLinkEmails(null, m.email_all_access_links_confirm(), 'all');
	}

	const sentCount = $derived(sendResults?.filter((result) => result.outcome === 'sent').length ?? 0);

	/**
	 * Only report on judges an attempt was actually made for. A room where half the panel
	 * has no address would otherwise read as half-failed, which it is not.
	 */
	const attemptedResults = $derived(sendResults?.filter((result) => result.outcome !== 'no_address') ?? []);

	/**
	 * Only room advisors can be removed from here, so the "keep at least one" guard in this
	 * dialog counts them. The server applies the real rule, which also counts the group's.
	 */
	const removableAdvisorCount = $derived(userRows.filter((row) => row.kind === 'judge_advisor' && row.origin !== 'group').length);

	async function handleKickDevice(targetDeviceId: string) {
		try {
			await app.kickDevice(targetDeviceId);
		} catch (error) {
			console.error('Failed to kick device:', error);
		}
	}

	function getConnectionDuration(connectedAt: number): string {
		const now = Date.now();
		const duration = now - connectedAt;
		const minutes = Math.floor(duration / (1000 * 60));
		const hours = Math.floor(minutes / 60);

		if (hours > 0) {
			return `${hours}h ${minutes % 60}m`;
		}
		return `${minutes}m`;
	}

	function handleClose() {
		dialogs.closeDialog();
	}

	// An effect rather than onMount so it runs again after a reconnect, when the server
	// has dropped this subscription.
	$effect(() => {
		void app.getReconnectionCount();
		app.wrpcClient.device.subscribeDeviceList.mutation().then((list) => {
			app.handleDeviceListUpdate(list);
		});
	});

	onMount(() => {
		void loadAccessLinks();
	});

	onDestroy(() => {
		app.wrpcClient.device.unsubscribeDeviceList.mutation();
	});
</script>

<Dialog open={true} onClose={handleClose} innerContainerClass="max-w-2xl p-4!">
	<div class="flex max-h-[80vh] flex-col overflow-hidden p-2">
		<div class="mb-4 flex shrink-0 items-center justify-between">
			<h3 id="dialog-title" class="flex items-center gap-2 text-lg font-medium text-gray-900">
				{m.users()}
			</h3>
			<button onclick={handleClose} class="rounded-full p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600" aria-label="Close dialog">
				<XmarkIcon size={18} />
			</button>
		</div>

		<div class="mb-4 flex shrink-0 items-start justify-between gap-3">
			<p class="text-xs text-gray-600">{m.users_dialog_description()}</p>
			<div class="flex shrink-0 items-center gap-2">
				{#if emailEnabled}
					<button
						type="button"
						class="lightweight tiny shrink-0"
						onclick={emailAllJudges}
						disabled={isDisconnectedFromServer || addressedJudgeCount === 0 || sendingKey !== null}
						title={addressedJudgeCount === 0 ? m.email_send_none_addressed() : undefined}
					>
						{sendingKey === 'all' ? '…' : m.email_all_access_links()}
					</button>
				{/if}
				<button
					type="button"
					class="lightweight tiny shrink-0"
					onclick={printJudgePasses}
					disabled={!accessLinks || accessLinks.judges.length === 0}
				>
					{m.print_judge_passes()}
				</button>
				<button type="button" class="primary tiny shrink-0" onclick={addJudgeAdvisor} disabled={isDisconnectedFromServer}>
					{m.add_judge_advisor()}
				</button>
			</div>
		</div>

		{#if !emailEnabled}
			<p class="mb-4 shrink-0 text-xs text-gray-500">{m.email_not_configured()}</p>
		{/if}

		<!-- The outcome of the last send, itemised. A send-all that half worked has to say
		     which half, or the Judge Advisor has no way to know who to chase. -->
		{#if sendError}
			<div class="mb-4 shrink-0 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
				{m.email_send_failed({ reason: sendError })}
			</div>
		{:else if sendResults}
			<div class="mb-4 shrink-0 rounded-lg bg-slate-50 px-3 py-2">
				<p class="text-sm font-medium text-gray-800">
					{m.email_send_summary({ sent: sentCount, total: attemptedResults.length })}
				</p>
				{#if attemptedResults.some((result) => result.outcome === 'failed')}
					<ul class="mt-1 space-y-0.5">
						{#each attemptedResults.filter((result) => result.outcome === 'failed') as result (result.judgeId)}
							<li class="text-xs text-red-700">{result.name} — {result.error ?? m.email_outcome_failed()}</li>
						{/each}
					</ul>
				{/if}
				{#if emailFrom}
					<p class="mt-1 text-xs text-gray-500">{m.email_sent_from({ address: emailFrom })}</p>
				{/if}
			</div>
		{/if}

		{#if isDisconnectedFromServer}
			<div class="mb-4 rounded-lg bg-red-50 p-4">
				<div class="flex items-center space-x-2 text-red-800">
					<DenialIcon />
					<div>
						<h5 class="font-medium">{m.connection_error()}</h5>
						<p class="text-sm">{m.you_are_disconnected_from_the_server()}</p>
					</div>
				</div>
			</div>
		{/if}

		{#if loadingLinks}
			<p class="text-sm text-gray-500">…</p>
		{:else if accessLinks}
			<div class="min-h-0 flex-1 space-y-3 overflow-auto pr-1">
				{#each userRows as user (user.key)}
					{@const userDevices = devicesForUser(user)}
					{@const online = onlineCount(user)}
					<div class="rounded-lg border border-gray-200">
						<div class="flex items-center gap-3 px-3 py-2.5">
							<div class="min-w-0 flex-1">
								<div class="flex flex-wrap items-center gap-2">
									<div class="truncate text-sm font-medium text-gray-900">{user.name}</div>
									{#if user.kind === 'judge_advisor'}
										<span class="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">{m.judge_advisor()}</span>
									{/if}
									<!-- Both are Judge Advisors here with the same powers. The badge says where
									     they are administered, which is where they can be removed. -->
									{#if user.origin === 'group'}
										<span class="rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700">{m.via_event_group()}</span>
									{/if}
									{#if user.isSelf}
										<span class="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">{m.you()}</span>
									{/if}
									{#if online > 0}
										<span class="inline-flex items-center gap-1 rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700">
											<span class="h-1.5 w-1.5 rounded-full bg-green-500"></span>
											{m.online_device_count({ count: online })}
										</span>
									{:else}
										<span class="text-xs text-gray-400">{m.no_devices_online()}</span>
									{/if}
								</div>
							</div>
							<div class="flex shrink-0 items-center gap-1">
								{#if user.authToken}
									<button
										type="button"
										onclick={() => showUserLink(user)}
										class="rounded-md px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
									>
										{m.show_access_link()}
									</button>
								{/if}
								{#if clipboardAvailable && user.authToken}
									<button
										type="button"
										onclick={() => copyUserLink(user)}
										class="rounded-md p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-800"
										title={copiedKey === user.key ? m.copied() : m.copy_access_link()}
										aria-label={m.copy_access_link()}
									>
										<CopyIcon size={14} class={copiedKey === user.key ? 'text-green-600' : ''} />
									</button>
								{/if}
								{#if user.kind === 'judge_advisor' && user.origin !== 'group'}
									<button
										type="button"
										onclick={() => renameJudgeAdvisor(user)}
										class="rounded-md px-2 py-1 text-xs text-gray-500 hover:bg-gray-100 hover:text-gray-800"
										disabled={isDisconnectedFromServer}
									>
										{m.rename()}
									</button>
									{#if !user.isSelf && removableAdvisorCount > 1}
										<button
											type="button"
											onclick={() => removeJudgeAdvisor(user)}
											class="rounded-md px-2 py-1 text-xs text-red-600 hover:bg-red-50"
											disabled={isDisconnectedFromServer}
										>
											{m.remove()}
										</button>
									{/if}
								{/if}
								<!-- Rotating a Judge Advisor link only ever affects your own, so it is
								     offered on your row and on judges' rows, not on other advisors'. -->
								<button
									type="button"
									onclick={() => rotateUserLink(user)}
									class="rounded-md p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-800 disabled:opacity-30"
									disabled={user.kind === 'judge_advisor' && (!user.isSelf || user.origin === 'group')}
									title={m.rotate_access_link()}
									aria-label={m.rotate_access_link()}
								>
									<RotateIcon size={14} />
								</button>
							</div>
						</div>

						<!-- Judges only. A Judge Advisor's link is handed over in person or through
						     the event group, and mailing one would put the room's most powerful
						     credential in an inbox. -->
						<!-- Every advisor this room administers, not just your own row. A group
						     advisor is excluded because their address lives at the group.
						     This used to be your row only, on the reasoning that another advisor's
						     address was not yours to set. It does not hold: "Show access link" and
						     "Copy access link" sit on every advisor's row above, so their credential
						     is already yours to take anywhere. The restriction protected nothing and
						     stopped a second advisor being sent their link the way the first was. -->
						{#if user.kind === 'judge_advisor' && user.origin !== 'group'}
							<div class="border-t border-gray-100 px-3 py-2">
								<div class="flex flex-wrap items-center gap-2">
									<label class="sr-only" for={`advisor-email-${user.key}`}>{m.judge_advisor_email_label()}</label>
									<input
										id={`advisor-email-${user.key}`}
										type="email"
										class="classic min-w-0 flex-1 text-sm"
										placeholder={m.judge_email_placeholder()}
										value={currentEmail(user)}
										oninput={(event) => onEmailInput(user, event.currentTarget.value)}
										disabled={isDisconnectedFromServer}
									/>
									{#if isEmailDirty(user)}
										<button
											type="button"
											class="primary tiny shrink-0"
											onclick={() => saveAdvisorEmail(user)}
											disabled={isDisconnectedFromServer || savingEmailFor === user.key}
										>
											{savingEmailFor === user.key ? '…' : m.save_judge_email()}
										</button>
									{:else if user.email && emailEnabled}
										<button
											type="button"
											class="lightweight tiny shrink-0"
											onclick={() => emailAdvisorLink(user)}
											disabled={isDisconnectedFromServer || sendingKey !== null}
										>
											{sendingKey === user.key ? '…' : user.isSelf ? m.email_my_access_link() : m.email_access_link()}
										</button>
									{/if}
								</div>
								{#if emailErrors[user.key]}
									<p class="mt-1 text-xs text-red-600">{emailErrors[user.key]}</p>
								{/if}
							</div>
						{/if}

						{#if user.kind === 'judge'}
							<div class="border-t border-gray-100 px-3 py-2">
								<div class="flex flex-wrap items-center gap-2">
									<label class="sr-only" for={`judge-email-${user.key}`}>{m.judge_email()}</label>
									<input
										id={`judge-email-${user.key}`}
										type="email"
										class="classic min-w-0 flex-1 text-sm"
										placeholder={m.judge_email_placeholder()}
										value={currentEmail(user)}
										oninput={(event) => onEmailInput(user, event.currentTarget.value)}
										disabled={isDisconnectedFromServer}
									/>
									{#if isEmailDirty(user)}
										<button
											type="button"
											class="primary tiny shrink-0"
											onclick={() => saveJudgeEmail(user)}
											disabled={isDisconnectedFromServer || savingEmailFor === user.key}
										>
											{savingEmailFor === user.key ? '…' : m.save_judge_email()}
										</button>
									{:else if user.email && emailEnabled}
										<button
											type="button"
											class="lightweight tiny shrink-0"
											onclick={() => emailOneJudge(user)}
											disabled={isDisconnectedFromServer || sendingKey !== null}
										>
											{sendingKey === user.key ? '…' : m.email_access_link()}
										</button>
									{/if}
								</div>
								{#if emailErrors[user.key]}
									<p class="mt-1 text-xs text-red-600">{emailErrors[user.key]}</p>
								{/if}
							</div>
						{/if}

						{#if userDevices.length > 0}
							<ul class="border-t border-gray-100 bg-gray-50/80 px-3 py-2">
								{#each userDevices as device (device.deviceId)}
									<li class="flex items-center justify-between gap-2 py-1.5">
										<div class="flex min-w-0 items-center gap-2">
											{#if device.isOnline}
												<span class="h-2 w-2 shrink-0 rounded-full bg-green-500"></span>
											{:else}
												<span class="h-2 w-2 shrink-0 rounded-full bg-gray-300"></span>
											{/if}
											<div class="min-w-0">
												<div class="truncate text-sm text-gray-800">
													{device.deviceName}
													{#if permit?.deviceId === device.deviceId}
														<span class="text-xs text-blue-600">({m.you()})</span>
													{/if}
												</div>
												<div class="text-xs text-gray-500">
													{m.joined_ago({ duration: getConnectionDuration(device.connectedAt) })}
												</div>
											</div>
										</div>
										{#if permit?.deviceId !== device.deviceId}
											<button
												type="button"
												onclick={() => handleKickDevice(device.deviceId)}
												class="rounded-full p-1.5 text-gray-400 hover:bg-red-100 hover:text-red-600"
												title={m.kick_device()}
												aria-label={m.kick_device()}
											>
												<XmarkIcon size={12} />
											</button>
										{/if}
									</li>
								{/each}
							</ul>
						{/if}
					</div>
				{/each}
			</div>
		{/if}
	</div>
</Dialog>
