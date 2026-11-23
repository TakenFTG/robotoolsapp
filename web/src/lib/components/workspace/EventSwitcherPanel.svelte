<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import { app, AppUI, dialogs } from '$lib/index.svelte';
	import type { Permit } from '$lib/app.svelte';
	import { parseEventGroupUrl } from '$lib/utils.svelte';
	import { onMount } from 'svelte';
	import EditIcon from '$lib/icon/EditIcon.svelte';

	const permits = $derived(app.getPermits());
	const activeRoomId = $derived(app.getActiveRoomId());
	const isJudgeAdvisor = $derived(app.getCurrentUser()?.role === 'judge_advisor');

	/**
	 * Divisions that came from an event group are shown under it, and rooms held on their
	 * own links are shown separately. Merged rather than replaced: a Judge Advisor may hold
	 * both kinds of credential, and neither list is the whole picture on its own.
	 *
	 * The divisions come from the group, not from the permits this device happens to hold.
	 * A division added from a colleague's device has no permit here until it is first
	 * opened, and it must still be listed — being able to reach the other divisions is the
	 * entire point of holding a group link.
	 */
	const groupSections = $derived.by(() => {
		return app.getGroupPermits().map((groupPermit) => ({
			groupId: groupPermit.groupId,
			name: groupPermit.groupName ?? m.event_group(),
			divisions: app.getGroupDivisions(groupPermit.groupId).map((division) => ({
				roomId: division.roomId,
				// The room's own name once it has been opened, since that is what the Judge
				// Advisor sees inside it; the group's label until then.
				label: permits.find((permit) => permit.roomId === division.roomId)?.eventName ?? division.label,
				// The group's label is the room's nickname, and the group is the fresher copy:
				// a division renamed from another device reaches this one's permit only once
				// the room is opened here again.
				groupLabel: division.label
			}))
		}));
	});

	/** Room ids already accounted for above, so nothing is listed twice. */
	const groupedRoomIds = $derived(new Set(groupSections.flatMap((section) => section.divisions.map((division) => division.roomId))));

	const standaloneRooms = $derived(permits.filter((permit) => !groupedRoomIds.has(permit.roomId)));

	let busy = $state(false);
	let errorMessage = $state('');

	async function run(action: () => Promise<unknown>) {
		if (busy) return;
		busy = true;
		errorMessage = '';
		try {
			await action();
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : 'Unknown error';
		} finally {
			busy = false;
		}
	}

	function switchTo(roomId: string) {
		if (roomId === activeRoomId) {
			dialogs.closeDialog();
			return;
		}
		return run(async () => {
			await app.switchToEvent(roomId);
			AppUI.appPhase = 'joining_judges_room';
			dialogs.closeDialog();
		});
	}

	/**
	 * Drop a group link from this device.
	 *
	 * Local housekeeping, not administration: an empty or finished group otherwise sits in
	 * the switcher permanently, and there was no way to clear it. The group itself and its
	 * divisions are untouched — the link opens them again.
	 */
	function forgetGroup(groupId: string, name: string) {
		return run(async () => {
			const confirmed = await dialogs.showConfirmation({
				title: m.forget_event_group(),
				message: m.forget_event_group_confirmation({ name }),
				confirmText: m.remove(),
				confirmButtonClass: 'danger'
			});
			if (!confirmed) return;

			app.forgetGroup(groupId);
		});
	}

	/** A group division may have no permit on this device yet; switching makes one. */
	function switchToDivision(groupId: string, roomId: string) {
		if (roomId === activeRoomId) {
			dialogs.closeDialog();
			return;
		}
		return run(async () => {
			await app.switchToGroupDivision(groupId, roomId);
			AppUI.appPhase = 'joining_judges_room';
			dialogs.closeDialog();
		});
	}

	function startNewEvent(copySetup: boolean) {
		// Read the template before detaching — detaching clears the current event's data.
		const template = copySetup ? app.getSetupTemplateFromCurrentEvent() : null;
		app.beginAdditionalEvent(template);
		AppUI.appPhase = 'event_setup';
		dialogs.closeDialog();
	}

	/**
	 * One prompt for both kinds of link. A Judge Advisor handed a link should not have to
	 * know whether it addresses a division or a whole competition before pasting it.
	 */
	async function joinByLink() {
		const url = await dialogs.showPrompt({
			title: m.join_existing_event(),
			message: m.paste_judges_room_or_group_link(),
			inputType: 'url'
		});
		if (typeof url !== 'string' || !url.trim()) return;

		const link = url.trim();

		await run(async () => {
			if (parseEventGroupUrl(link)) {
				await app.joinEventGroupFromUrl(link);
				const session = app.getGroupSession();
				if (session) {
					await app.openEventGroup(session.groupId);
				}
			} else {
				await app.joinJudgesRoomFromUrl(link);
			}
			AppUI.appPhase = 'joining_judges_room';
			dialogs.closeDialog();
		});
	}

	function labelFor(permit: Permit): string {
		return permit.eventName ?? m.judges_room();
	}

	/**
	 * Give the open room a short name every judge sees here. In an event group it is also the
	 * division's label, so group advisors see it too. Clearing the box goes back to
	 * the event's own name. Only for the room this device is connected to, since that is the
	 * room it can tell; every other screen keeps the official name.
	 */
	async function rename(fullName: string) {
		const nickname = await dialogs.showPrompt({
			title: m.event_nickname_title(),
			message: m.event_nickname_message({ name: fullName }),
			defaultValue: activeRoomId ? (app.getEventNickname(activeRoomId) ?? '') : '',
			placeholder: m.event_nickname_placeholder(),
			confirmText: m.event_nickname_save()
		});
		if (nickname === null) return;
		await run(async () => {
			await app.setEventNickname(nickname);
			// In a group this also renamed the division; show the group's new label.
			await app.refreshEventGroups();
		});
	}

	// Divisions are added and removed at the group, often from someone else's device, so
	// ask before showing the list rather than trusting whatever was cached last time.
	onMount(() => {
		void app.refreshEventGroups();
	});
</script>

<!--
	One row per room. A nickname, when the Judge Advisor has set one, leads, and the full name moves
	underneath (where the room id otherwise sits) so the official name is still there to
	check against.
-->
{#snippet room(roomId: string, fullName: string, open: () => unknown, groupLabel: string | null = null)}
	{@const nickname = groupLabel ? (groupLabel !== fullName ? groupLabel : null) : app.getEventNickname(roomId)}
	<li class="flex items-center">
		<button
			class="flex min-w-0 flex-1 items-center justify-between gap-3 py-2.5 pr-3 pl-3 text-left hover:bg-gray-50 disabled:opacity-60"
			onclick={open}
			disabled={busy}
			title={fullName}
		>
			<span class="min-w-0">
				<span class="block truncate text-sm font-medium text-gray-900">{nickname ?? fullName}</span>
				<span class="block truncate text-xs text-gray-500">{nickname ? fullName : roomId.slice(0, 8)}</span>
			</span>
			{#if roomId === activeRoomId}
				<span class="shrink-0 rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">{m.current()}</span>
			{/if}
		</button>
		{#if isJudgeAdvisor && roomId === activeRoomId}
			<button
				class="mx-1 shrink-0 rounded-md p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-60"
				onclick={() => rename(fullName)}
				disabled={busy}
				aria-label={m.event_nickname_title()}
				title={m.event_nickname_title()}
			>
				<EditIcon size={14} />
			</button>
		{/if}
	</li>
{/snippet}

<div class="space-y-4">
	<p class="text-sm text-gray-600">{m.switch_event_description()}</p>

	{#each groupSections as section (section.groupId)}
		<div>
			<div class="mb-1 flex items-center gap-2">
				<h4 class="min-w-0 truncate text-sm font-medium text-gray-900">{section.name}</h4>
				<span class="shrink-0 rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700">{m.event_group()}</span>
				<button
					class="ml-auto shrink-0 rounded-md px-2 py-1 text-xs text-gray-500 hover:bg-red-50 hover:text-red-600"
					onclick={() => forgetGroup(section.groupId, section.name)}
					disabled={busy}
				>
					{m.remove()}
				</button>
			</div>
			{#if section.divisions.length === 0}
				<p class="text-xs text-gray-500">{m.event_group_no_divisions()}</p>
			{:else}
				<ul class="divide-y divide-gray-100 rounded border border-gray-200">
					{#each section.divisions as division (division.roomId)}
						{@render room(division.roomId, division.label, () => switchToDivision(section.groupId, division.roomId), division.groupLabel)}
					{/each}
				</ul>
			{/if}
		</div>
	{/each}

	{#if standaloneRooms.length > 0}
		<div>
			{#if groupSections.length > 0}
				<h4 class="mb-1 text-sm font-medium text-gray-900">{m.other_rooms()}</h4>
			{/if}
			<ul class="divide-y divide-gray-100 rounded border border-gray-200">
				{#each standaloneRooms as permit (permit.roomId)}
					{@render room(permit.roomId, labelFor(permit), () => switchTo(permit.roomId))}
				{/each}
			</ul>
		</div>
	{/if}

	{#if errorMessage}
		<p class="text-sm text-red-600" role="alert">{errorMessage}</p>
	{/if}

	<div class="flex flex-wrap gap-2">
		<button class="lightweight tiny" onclick={joinByLink} disabled={busy}>{m.join_existing_event()}</button>
		{#if isJudgeAdvisor}
			<button class="lightweight tiny" onclick={() => startNewEvent(false)} disabled={busy}>{m.new_event()}</button>
			<button class="primary tiny" onclick={() => startNewEvent(true)} disabled={busy}>{m.new_event_copy_setup()}</button>
		{/if}
	</div>

	{#if isJudgeAdvisor}
		<p class="text-xs text-gray-500">{m.new_event_copy_setup_description()}</p>
	{/if}
</div>
