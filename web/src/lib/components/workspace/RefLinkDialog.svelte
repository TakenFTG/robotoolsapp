<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import { app, dialogs } from '$lib/index.svelte';
	import { RefereeNameSchema, formatRefLinkCode, type RefLinkCodeResult, type RefLinkStatus } from '@robotools.app/protocol/src/ref';
	import { JudgeEmailSchema } from '@robotools.app/protocol/src/email';
	import TextField from '$lib/components/m3/TextField.svelte';
	import { refNotes } from '$lib/ref-notes.svelte';
	import Dialog from '$lib/components/dialog/Dialog.svelte';
	import Button from '$lib/components/m3/Button.svelte';
	import { errorToString } from '$lib/utils.svelte';

	/**
	 * Linking this division to the Head Referee's notes.
	 *
	 * The refs get this division's team list and match schedule, and nothing else from
	 * judging. The dialog says so, because a Judge Advisor should know exactly what a code
	 * hands over before making one.
	 */

	let status = $state<RefLinkStatus | null>(null);
	let code = $state<RefLinkCodeResult | null>(null);
	let error = $state('');
	let busy = $state(false);

	/** Which divisions a new link covers. Only a group's own advisors get the choice. */
	let scope = $state<'room' | 'group'>('room');
	let headName = $state('');
	let headEmail = $state('');
	let sentTo = $state<string | null>(null);

	const nameError = $derived(headName.trim() && !RefereeNameSchema.safeParse(headName.trim()).success ? m.ref_name_invalid() : '');
	const emailError = $derived(headEmail.trim() && !JudgeEmailSchema.safeParse(headEmail.trim()).success ? m.ref_email_invalid() : '');
	const canCreate = $derived(!!headName.trim() && !!headEmail.trim() && !nameError && !emailError && !busy);

	/**
	 * Set up referee notes linked from the start. The Head Ref's link is emailed to them and
	 * never shown here: like a judge's link, it belongs to the person it signs in.
	 */
	async function create() {
		error = '';
		busy = true;
		try {
			const result = await app.wrpcClient.refLink.createRefRoom.mutation({
				scope,
				headReferee: { name: headName.trim(), email: headEmail.trim() }
			});
			sentTo = result.sentTo;
			headName = '';
			headEmail = '';
			await load();
		} catch (cause) {
			error = errorToString(cause);
		} finally {
			busy = false;
		}
	}

	async function load() {
		error = '';
		try {
			status = await app.wrpcClient.refLink.getStatus.query();
			// The link may have changed under us; the notes follow it.
			refNotes.signal();
		} catch (cause) {
			error = errorToString(cause);
		}
	}

	$effect(() => {
		void load();
	});

	async function makeCode(codeScope: 'room' | 'group') {
		error = '';
		busy = true;
		try {
			code = await app.wrpcClient.refLink.createCode.mutation({ scope: codeScope });
		} catch (cause) {
			error = errorToString(cause);
		} finally {
			busy = false;
		}
	}

	/**
	 * Asked inside this dialog rather than with a confirmation dialog: the dialog stack shows
	 * one dialog at a time, so a confirmation would close this one and reopen a fresh copy
	 * that reads the status before the unlink has landed.
	 */
	let confirmingUnlink = $state(false);

	async function unlink() {
		busy = true;
		try {
			await app.wrpcClient.refLink.unlink.mutation();
			confirmingUnlink = false;
			await load();
		} catch (cause) {
			error = errorToString(cause);
		} finally {
			busy = false;
		}
	}

	async function done() {
		code = null;
		await load();
	}

	function close() {
		dialogs.closeDialog();
	}

	const expiresAt = $derived(code ? new Date(code.expiresAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '');
</script>

<Dialog open={true} onClose={close} innerContainerClass="max-w-md">
	<div class="flex flex-col gap-4">
		<h2 id="dialog-title" class="text-headline-small text-on-surface">{m.ref_link_title()}</h2>
		<p class="text-body-medium text-on-surface-variant">{m.ref_link_description()}</p>

		{#if code}
			<div class="flex flex-col items-center gap-2 rounded-xl bg-surface-container p-4">
				<p class="text-body-medium text-on-surface-variant">
					{code.scope === 'group' && status?.group
						? m.ref_link_code_for_group({ name: status.group.name, count: status.group.divisionCount })
						: m.ref_link_code_for_room()}
				</p>
				<p class="font-mono text-display-small tracking-widest text-on-surface select-all">{formatRefLinkCode(code.code)}</p>
				<p class="text-body-small text-on-surface-variant">{m.ref_link_code_expires({ time: expiresAt })}</p>
			</div>
			<p class="text-body-medium text-on-surface-variant">{m.ref_link_code_instructions()}</p>
			<div class="flex justify-end">
				<Button onclick={done}>{m.ref_link_done()}</Button>
			</div>
		{:else if status === null && !error}
			<p class="text-body-medium text-on-surface-variant">{m.loading()}</p>
		{:else if status?.linkedTo?.refsUsingApp}
			<div class="rounded-xl bg-success-container p-4 text-body-medium text-on-success-container">
				{m.ref_link_linked_to({ name: status.linkedTo.eventName })}
				{#if sentTo}
					<p class="mt-2">{m.ref_link_created_sent({ email: sentTo })}</p>
				{/if}
			</div>
			{#if confirmingUnlink}
				<p class="text-body-medium text-on-surface">{m.ref_link_unlink_message()}</p>
				<div class="flex justify-end gap-2">
					<Button variant="text" disabled={busy} onclick={() => (confirmingUnlink = false)}>{m.ref_link_cancel()}</Button>
					<Button danger disabled={busy} onclick={unlink}>{m.ref_link_unlink()}</Button>
				</div>
			{:else}
				<div class="flex justify-between gap-2">
					<Button variant="text" onclick={() => (confirmingUnlink = true)}>{m.ref_link_unlink()}</Button>
					<Button variant="text" onclick={close}>{m.ref_link_close()}</Button>
				</div>
			{/if}
		{:else if status}
			{#if status.linkedTo}
				<!-- This division's own notes, with no refs in them: the refs can still be brought in. -->
				<div class="rounded-xl bg-secondary-container p-4 text-body-medium text-on-secondary-container">
					{m.ref_link_kept_by_advisors()}
				</div>
			{/if}
			{#if status.group}
				<div class="flex flex-wrap gap-2" role="radiogroup" aria-label={m.ref_link_scope()}>
					<Button
						variant={scope === 'room' ? 'tonal' : 'outlined'}
						compact
						role="radio"
						aria-checked={scope === 'room'}
						onclick={() => (scope = 'room')}
					>
						{m.ref_link_scope_room()}
					</Button>
					<Button
						variant={scope === 'group' ? 'tonal' : 'outlined'}
						compact
						role="radio"
						aria-checked={scope === 'group'}
						onclick={() => (scope = 'group')}
					>
						{m.ref_link_scope_group({ name: status.group.name, count: status.group.divisionCount })}
					</Button>
				</div>
			{/if}

			<section class="flex flex-col gap-3 rounded-xl border border-outline-variant p-4">
				<h3 class="text-title-medium text-on-surface">{m.ref_link_create_heading()}</h3>
				{#if status.emailEnabled}
					<p class="text-body-medium text-on-surface-variant">{m.ref_link_create_description()}</p>
					<form
						class="flex flex-col gap-3"
						onsubmit={(event) => {
							event.preventDefault();
							void create();
						}}
					>
						<TextField label={m.ref_link_head_name()} bind:value={headName} error={nameError} maxlength={100} autocomplete="off" />
						<TextField label={m.ref_link_head_email()} bind:value={headEmail} error={emailError} inputmode="email" autocomplete="off" />
						<Button type="submit" disabled={!canCreate}>{busy ? m.ref_link_creating() : m.ref_link_create()}</Button>
					</form>
				{:else}
					<p class="text-body-medium text-on-surface-variant">{m.ref_link_create_needs_email()}</p>
				{/if}
			</section>

			<section class="flex flex-col gap-3 rounded-xl border border-outline-variant p-4">
				<h3 class="text-title-medium text-on-surface">{m.ref_link_code_heading()}</h3>
				<p class="text-body-medium text-on-surface-variant">{m.ref_link_code_description()}</p>
				<Button variant="outlined" disabled={busy} onclick={() => makeCode(scope)}>{m.ref_link_make_code()}</Button>
			</section>

			<div class="flex justify-end">
				<Button variant="text" onclick={close}>{m.ref_link_close()}</Button>
			</div>
		{/if}

		{#if error}
			<p role="alert" class="text-body-medium text-error">{error}</p>
		{/if}
	</div>
</Dialog>
