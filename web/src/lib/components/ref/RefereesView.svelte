<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import { JudgeEmailSchema } from '@robotools.app/protocol/src/email';
	import { RefereeNameSchema, type Referee, type RefEmailSendResult, type RefereeRole } from '@robotools.app/protocol/src/ref';
	import { refApp } from '$lib/ref/ref-app.svelte';
	import { incidentsToCsv } from '$lib/ref/incidents';
	import { dialogs } from '$lib/index.svelte';
	import { generateQrCodeDataUrl } from '$lib/qrcode';
	import { getRobotEventsClient, importFromRobotEvents } from '$lib/robotevents-source';
	import Dialog from '$lib/components/dialog/Dialog.svelte';
	import Button from '$lib/components/m3/Button.svelte';
	import TextField from '$lib/components/m3/TextField.svelte';
	import RefDeleteDialog from './RefDeleteDialog.svelte';
	import AccessPassesDialog from '$lib/components/access/AccessPassesDialog.svelte';
	import { refBack } from '$lib/ref/back.svelte';

	/** The add/edit form: closed, adding, or editing one ref. */
	let editor = $state<{ referee: Referee | null; name: string; email: string; role: RefereeRole } | null>(null);
	let editorError = $state('');
	let saving = $state(false);
	let qr = $state<{ name: string; link: string; dataUrl: string } | null>(null);
	let notice = $state('');
	let busy = $state(false);
	let linkCode = $state('');
	let linkError = $state('');
	let linking = $state(false);

	/** The last email send, shown until the next one or until dismissed. */
	let sendResults = $state<RefEmailSendResult[] | null>(null);

	const emailEnabled = $derived(refApp.emailCapability.enabled);

	$effect(() => {
		if (editor) {
			return refBack.push(() => (editor = null));
		}
	});
	$effect(() => {
		if (qr) {
			return refBack.push(() => (qr = null));
		}
	});
	const addressedCount = $derived(refApp.referees.filter((referee) => !!referee.email).length);
	/** Refs an attempt was made for: one with no address has not failed, it was skipped. */
	const attemptedResults = $derived(sendResults?.filter((result) => result.outcome !== 'no_address') ?? []);
	const sentCount = $derived(attemptedResults.filter((result) => result.outcome === 'sent').length);

	const nameError = $derived(
		editor && editor.name.trim() && !RefereeNameSchema.safeParse(editor.name.trim()).success ? m.ref_name_invalid() : ''
	);
	const emailError = $derived(
		editor && editor.email.trim() && !JudgeEmailSchema.safeParse(editor.email.trim()).success ? m.ref_email_invalid() : ''
	);

	function openAdd() {
		editorError = '';
		editor = { referee: null, name: '', email: '', role: 'referee' };
	}

	function openEdit(referee: Referee) {
		editorError = '';
		editor = { referee, name: referee.name, email: referee.email ?? '', role: referee.role };
	}

	async function saveEditor() {
		if (!editor || nameError || emailError || !editor.name.trim()) {
			return;
		}
		saving = true;
		editorError = '';
		const input = { name: editor.name.trim(), email: editor.email.trim() || null, role: editor.role };
		try {
			if (editor.referee) {
				await refApp.updateReferee(editor.referee.id, input);
				editor = null;
			} else {
				const added = await refApp.addReferee(input);
				editor = null;
				// Adding someone is pointless until they have their link, so offer it straight away.
				// Offer, not send: a typo in an address must be caught before a link goes out.
				if (added.email && emailEnabled) {
					await emailLinks([added.id], m.ref_email_link_confirm({ name: added.name, email: added.email }));
				} else {
					await showQr(added);
				}
			}
		} catch (error) {
			editorError = errorText(error);
		} finally {
			saving = false;
		}
	}

	function errorText(error: unknown): string {
		return error instanceof Error ? error.message : String(error);
	}

	async function run(action: () => Promise<void>) {
		notice = '';
		sendResults = null;
		busy = true;
		try {
			await action();
		} catch (error) {
			await dialogs.showAlert({ title: m.ref_something_went_wrong(), message: errorText(error) });
		} finally {
			busy = false;
		}
	}

	async function copyLink(referee: Referee) {
		await run(async () => {
			const link = await refApp.getRefereeLink(referee.id);
			await navigator.clipboard.writeText(link);
			notice = m.ref_link_copied({ name: referee.name });
		});
	}

	/** Referees' links for the printable passes, or null while the passes are closed. */
	let passes = $state<{ name: string; link: string }[] | null>(null);
	const printableReferees = $derived(refApp.referees.filter((referee) => referee.role === 'referee'));

	$effect(() => {
		if (passes) {
			return refBack.push(() => (passes = null));
		}
	});

	/**
	 * Printable passes for every referee, for events where emailed links don't get through.
	 * Head Referees are left out, like Judge Advisors on judge passes: their link manages
	 * the whole event.
	 */
	async function printPasses() {
		await run(async () => {
			const sorted = [...printableReferees].sort((a, b) => a.name.localeCompare(b.name));
			passes = await Promise.all(sorted.map(async (referee) => ({ name: referee.name, link: await refApp.getRefereeLink(referee.id) })));
		});
	}

	async function showQr(referee: Referee) {
		await run(async () => {
			const link = await refApp.getRefereeLink(referee.id);
			qr = { name: referee.name, link, dataUrl: await generateQrCodeDataUrl(link, { width: 280, margin: 1 }) };
		});
	}

	/**
	 * Email links, after the Head Ref confirms. Never automatic: each link signs its holder in,
	 * so a mistyped address has to be caught before anything leaves the server.
	 */
	async function emailLinks(refereeIds: string[] | null, message: string) {
		const confirmed = await dialogs.showConfirmation({
			title: refereeIds === null ? m.ref_email_all_links() : m.ref_email_link(),
			message,
			confirmText: refereeIds === null ? m.ref_email_all_links() : m.ref_email_link()
		});
		if (!confirmed) {
			return;
		}
		await run(async () => {
			sendResults = await refApp.sendRefereeLinks(refereeIds);
		});
	}

	function emailOne(referee: Referee) {
		if (referee.email) {
			void emailLinks([referee.id], m.ref_email_link_confirm({ name: referee.name, email: referee.email }));
		}
	}

	async function replaceLink(referee: Referee) {
		const confirmed = await dialogs.showConfirmation({
			title: m.ref_replace_link_title({ name: referee.name }),
			message: m.ref_replace_link_message(),
			confirmText: m.ref_replace_link()
		});
		if (!confirmed) {
			return;
		}
		await run(async () => {
			await refApp.rotateRefereeLink(referee.id);
			notice = m.ref_link_replaced({ name: referee.name });
		});
		// The old link is dead, so they need the new one: offer to send it.
		if (referee.email && emailEnabled && referee.id !== refApp.self?.refereeId) {
			await emailLinks([referee.id], m.ref_email_new_link_confirm({ name: referee.name, email: referee.email }));
		}
	}

	async function remove(referee: Referee) {
		const confirmed = await dialogs.showConfirmation({
			title: m.ref_remove_ref_title({ name: referee.name }),
			message: m.ref_remove_ref_message(),
			confirmText: m.ref_remove(),
			confirmButtonClass: 'danger'
		});
		if (!confirmed) {
			return;
		}
		await run(() => refApp.removeReferee(referee.id));
	}

	async function link() {
		linkError = '';
		notice = '';
		linking = true;
		try {
			const linked = await refApp.linkJudgesRooms(linkCode);
			linkCode = '';
			notice = m.ref_links_linked({ count: linked.length });
		} catch (error) {
			linkError = errorText(error);
		} finally {
			linking = false;
		}
	}

	async function unlinkDivision(judgesRoomId: string | null, label: string) {
		const confirmed = await dialogs.showConfirmation({
			title: judgesRoomId === null ? m.ref_links_unlink_all_title() : m.ref_links_unlink_title({ name: label }),
			message: m.ref_links_unlink_message(),
			confirmText: m.ref_links_unlink(),
			confirmButtonClass: 'danger'
		});
		if (confirmed) {
			await run(() => refApp.unlinkJudgesRoom(judgesRoomId));
		}
	}

	function exportCsv() {
		const csv = incidentsToCsv(refApp.incidents);
		const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
		const url = URL.createObjectURL(blob);
		const anchor = document.createElement('a');
		anchor.href = url;
		anchor.download = `${(refApp.event?.eventName ?? 'referee-notes').replace(/[^\w-]+/g, '-')}-referee-notes.csv`;
		anchor.click();
		URL.revokeObjectURL(url);
	}

	async function updateTeams() {
		const sku = refApp.event?.robotEventsSku;
		if (!sku) {
			return;
		}
		await run(async () => {
			const data = await importFromRobotEvents(getRobotEventsClient(), sku);
			const teams = data.teamInfos.map((team) => ({
				number: team.number,
				name: team.name.slice(0, 200),
				school: team.school.slice(0, 200)
			}));
			await refApp.replaceTeams(teams);
			notice = m.ref_teams_updated({ count: teams.length });
		});
	}

	/** The delete dialog, behind a typed "destroy", like destroying a Judges' Room. */
	let deleting = $state(false);

	$effect(() => {
		if (deleting) {
			return refBack.push(() => (deleting = false));
		}
	});
</script>

<div class="flex flex-col gap-6">
	{#if notice}
		<p role="status" class="rounded-lg bg-success-container p-3 text-body-medium text-on-success-container">{notice}</p>
	{/if}

	<section class="flex flex-col gap-3">
		<div class="flex items-center justify-between">
			<h2 class="text-title-large text-on-surface">{m.ref_referees_heading()}</h2>
			{#if refApp.isHeadReferee}
				<div class="flex flex-wrap justify-end gap-2">
					{#if emailEnabled}
						<Button
							variant="outlined"
							compact
							disabled={busy || addressedCount === 0}
							title={addressedCount === 0 ? m.ref_email_none_addressed() : undefined}
							onclick={() => emailLinks(null, m.ref_email_all_links_confirm())}
						>
							{m.ref_email_all_links()}
						</Button>
					{/if}
					<Button variant="outlined" compact disabled={busy || printableReferees.length === 0} onclick={printPasses}>
						{m.print_ref_passes()}
					</Button>
					<Button variant="tonal" compact onclick={openAdd}>{m.ref_add_ref()}</Button>
				</div>
			{/if}
		</div>

		{#if refApp.isHeadReferee && !emailEnabled}
			<p class="rounded-lg bg-surface-container p-3 text-body-medium text-on-surface-variant">{m.ref_email_not_configured()}</p>
		{/if}

		{#if sendResults && attemptedResults.length > 0}
			<div role="status" class="flex flex-col gap-2 rounded-lg bg-surface-container p-3">
				<div class="flex items-center justify-between gap-2">
					<p class="text-title-small text-on-surface">{m.ref_email_send_summary({ sent: sentCount, total: attemptedResults.length })}</p>
					<Button variant="text" compact onclick={() => (sendResults = null)}>{m.ref_dismiss()}</Button>
				</div>
				{#each attemptedResults.filter((result) => result.outcome === 'failed') as result (result.refereeId)}
					<p class="text-body-medium text-error">
						{result.name} ({result.email}): {m.ref_email_outcome_failed({ reason: result.error ?? '' })}
					</p>
				{/each}
				{#if refApp.emailCapability.fromAddress}
					<p class="text-body-small text-on-surface-variant">{m.ref_email_sent_from({ address: refApp.emailCapability.fromAddress })}</p>
				{/if}
			</div>
		{/if}

		<ul class="flex flex-col divide-y divide-outline-variant rounded-xl border border-outline-variant bg-surface-container-lowest">
			{#each refApp.referees as referee (referee.id)}
				<li class="flex flex-col gap-2 px-4 py-3">
					<div class="flex flex-wrap items-baseline gap-x-2">
						<span class="text-title-medium text-on-surface">{referee.name}</span>
						<span class="text-body-small text-on-surface-variant">
							{referee.role === 'head_referee' ? m.ref_role_head_referee() : m.ref_role_referee()}
							{#if referee.id === refApp.self?.refereeId}· {m.ref_you()}{/if}
						</span>
						{#if refApp.isHeadReferee && referee.email}
							<span class="text-body-small text-on-surface-variant">· {referee.email}</span>
						{/if}
					</div>
					{#if refApp.isHeadReferee}
						<div class="flex flex-wrap gap-1">
							<Button variant="outlined" compact disabled={busy} onclick={() => copyLink(referee)}>{m.ref_copy_link()}</Button>
							<Button variant="outlined" compact disabled={busy} onclick={() => showQr(referee)}>{m.ref_qr_code()}</Button>
							{#if referee.email && emailEnabled}
								<Button variant="outlined" compact disabled={busy} onclick={() => emailOne(referee)}>{m.ref_email_link()}</Button>
							{/if}
							<Button variant="text" compact disabled={busy} onclick={() => openEdit(referee)}>{m.ref_edit()}</Button>
							<Button variant="text" compact disabled={busy} onclick={() => replaceLink(referee)}>{m.ref_replace_link()}</Button>
							{#if referee.id !== refApp.self?.refereeId}
								<Button variant="text" compact disabled={busy} onclick={() => remove(referee)}>{m.ref_remove()}</Button>
							{/if}
						</div>
					{/if}
				</li>
			{/each}
		</ul>
	</section>

	{#if refApp.isHeadReferee}
		<section class="flex flex-col gap-3">
			<div class="flex items-center justify-between">
				<h2 class="text-title-large text-on-surface">{m.ref_links_heading()}</h2>
				{#if refApp.linkedDivisions.length > 1}
					<Button variant="text" compact disabled={busy} onclick={() => unlinkDivision(null, '')}>{m.ref_links_unlink_all()}</Button>
				{/if}
			</div>
			<p class="text-body-medium text-on-surface-variant">{m.ref_links_description()}</p>

			{#if refApp.linkedDivisions.length > 0}
				<ul class="flex flex-col divide-y divide-outline-variant rounded-xl border border-outline-variant bg-surface-container-lowest">
					{#each refApp.linkedDivisions as division (division.judgesRoomId)}
						<li class="flex items-center justify-between gap-2 px-4 py-3">
							<span class="text-title-medium text-on-surface">{division.label}</span>
							<Button variant="text" compact disabled={busy} onclick={() => unlinkDivision(division.judgesRoomId, division.label)}>
								{m.ref_links_unlink()}
							</Button>
						</li>
					{/each}
				</ul>
			{/if}

			<form
				class="flex items-end gap-2"
				onsubmit={(event) => {
					event.preventDefault();
					void link();
				}}
			>
				<TextField
					class="flex-1"
					label={m.ref_links_code_label()}
					placeholder="ABCD-EFGH"
					bind:value={linkCode}
					error={linkError}
					autocapitalize="characters"
					autocomplete="off"
				/>
				<Button type="submit" variant="tonal" disabled={linking || !linkCode.trim()}
					>{linking ? m.ref_links_linking() : m.ref_links_link()}</Button
				>
			</form>
		</section>

		<section class="flex flex-col gap-3">
			<h2 class="text-title-large text-on-surface">{m.ref_event_heading()}</h2>
			<div class="flex flex-col gap-3 rounded-xl border border-outline-variant bg-surface-container-lowest p-4">
				<div class="flex flex-wrap items-center justify-between gap-2">
					<p class="text-body-medium text-on-surface-variant">{m.ref_export_description({ count: refApp.incidents.length })}</p>
					<Button variant="outlined" compact disabled={refApp.incidents.length === 0} onclick={exportCsv}>{m.ref_export_csv()}</Button>
				</div>
				{#if refApp.event?.robotEventsSku}
					<div class="flex flex-wrap items-center justify-between gap-2">
						<p class="text-body-medium text-on-surface-variant">{m.ref_update_teams_description({ count: refApp.teams.length })}</p>
						<Button variant="outlined" compact disabled={busy} onclick={updateTeams}>{m.ref_update_teams()}</Button>
					</div>
				{/if}
				<div class="flex flex-wrap items-center justify-between gap-2">
					<p class="text-body-medium text-on-surface-variant">{m.ref_delete_event_description()}</p>
					<Button danger compact onclick={() => (deleting = true)}>{m.ref_delete_event()}</Button>
				</div>
			</div>
		</section>
	{/if}
</div>

{#if editor}
	<Dialog open={true} onClose={() => (editor = null)} innerContainerClass="max-w-md">
		<form
			class="flex flex-col gap-4"
			onsubmit={(event) => {
				event.preventDefault();
				void saveEditor();
			}}
		>
			<h2 id="dialog-title" class="text-headline-small text-on-surface">{editor.referee ? m.ref_edit_ref() : m.ref_add_ref()}</h2>
			<TextField label={m.ref_name()} bind:value={editor.name} error={nameError} maxlength={100} autocomplete="off" />
			<TextField
				label={m.ref_email_optional()}
				bind:value={editor.email}
				error={emailError}
				supportingText={m.ref_email_supporting()}
				inputmode="email"
				autocomplete="off"
			/>
			<label class="flex flex-col gap-1">
				<span class="text-body-small text-on-surface-variant">{m.ref_role()}</span>
				<select class="classic" bind:value={editor.role}>
					<option value="referee">{m.ref_role_referee()}</option>
					<option value="head_referee">{m.ref_role_head_referee()}</option>
				</select>
			</label>
			{#if editorError}
				<p role="alert" class="text-body-medium text-error">{editorError}</p>
			{/if}
			<div class="flex justify-end gap-2">
				<Button variant="text" onclick={() => (editor = null)}>{m.ref_cancel()}</Button>
				<Button type="submit" disabled={saving || !editor.name.trim() || !!nameError || !!emailError}>{m.ref_save()}</Button>
			</div>
		</form>
	</Dialog>
{/if}

{#if qr}
	<Dialog open={true} onClose={() => (qr = null)} innerContainerClass="max-w-sm">
		<div class="flex flex-col items-center gap-4">
			<h2 id="dialog-title" class="text-headline-small text-on-surface">{m.ref_link_for({ name: qr.name })}</h2>
			<!-- Kept light: a camera cannot read a QR code on a dark field. -->
			<div class="jr-force-light rounded-lg bg-white p-2">
				<img src={qr.dataUrl} alt={m.ref_qr_alt({ name: qr.name })} class="size-64" />
			</div>
			<p class="text-center text-body-small text-on-surface-variant">{m.ref_qr_description()}</p>
			<Button onclick={() => (qr = null)}>{m.ref_done()}</Button>
		</div>
	</Dialog>
{/if}

{#if passes}
	<AccessPassesDialog kind="referee" people={passes} onClose={() => (passes = null)} />
{/if}

{#if deleting}
	<RefDeleteDialog onExport={exportCsv} onClose={() => (deleting = false)} />
{/if}
