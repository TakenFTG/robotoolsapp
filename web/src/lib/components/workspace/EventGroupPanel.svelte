<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import AccessLinkDialog from '$lib/components/access/AccessLinkDialog.svelte';
	import { app, dialogs } from '$lib/index.svelte';
	import { buildEventGroupJoinUrl, type GroupAdvisor, type GroupDivision } from '@robotools.app/protocol/src/group';
	import { errorToString, parseAuthTokenFromUrl, parseEventGroupUrl } from '$lib/utils.svelte';
	import { onMount } from 'svelte';
	import { JudgeEmailSchema } from '@robotools.app/protocol/src/email';

	type Membership = {
		groupId: string;
		name: string;
		divisions: GroupDivision[];
		advisors: GroupAdvisor[];
	};

	let membership = $state<Membership | null>(null);
	let loading = $state(true);
	let busy = $state(false);
	let errorMessage = $state('');

	const activeRoomId = $derived(app.getActiveRoomId());

	/**
	 * Administering a group needs the group's own link, not this room's.
	 *
	 * A Judge Advisor of one division can see the group they belong to, and can leave it,
	 * but cannot add advisors to it or remove sibling divisions — that authority lives with
	 * whoever holds a group credential, which is the only thing the group will listen to.
	 */
	const groupPermit = $derived(membership ? app.getGroupPermit(membership.groupId) : null);
	const canAdminister = $derived(!!groupPermit);

	async function load() {
		loading = true;
		try {
			membership = await app.wrpcClient.group.getGroup.query();
			if (membership) {
				// The room can describe its group without a group credential, so this is the
				// one place the division list is available even when the group itself is
				// unreachable. Hand it to the switcher rather than keeping it to ourselves.
				app.cacheGroupDivisions(membership.groupId, membership.divisions);
			}
		} catch (error) {
			errorMessage = errorToString(error);
		} finally {
			loading = false;
		}
	}

	async function run(action: () => Promise<unknown>) {
		if (busy) return;
		busy = true;
		errorMessage = '';
		try {
			await action();
		} catch (error) {
			errorMessage = errorToString(error);
		} finally {
			busy = false;
		}
	}

	function createGroup() {
		return run(async () => {
			const name = await dialogs.showPrompt({
				title: m.create_event_group(),
				message: m.event_group_name_colon(),
				confirmText: m.create_event_group()
			});
			const groupName = typeof name === 'string' ? name.trim() : '';
			if (!groupName) return;

			const label = await dialogs.showPrompt({
				title: m.division_label(),
				message: m.division_label_colon(),
				defaultValue: app.getEventName() ?? ''
			});
			const divisionLabel = typeof label === 'string' ? label.trim() : '';
			if (!divisionLabel) return;

			// No third prompt for a name: the Judge Advisor creating the group becomes its
			// first group advisor, under the name they already go by in this division.
			const { groupId, authToken } = await app.wrpcClient.group.createGroup.mutation({
				name: groupName,
				divisionLabel
			});

			await app.adoptEventGroup(groupId, authToken);
			await load();

			// No PIN is asked for, for the same reason a room no longer asks: the link is the
			// credential. A group link is a bigger thing to hold than a room's, which is why
			// this outlasted the room prompt, but a second secret written on the whiteboard
			// beside the first protects nothing. Rotate the link instead if it goes astray.
			// Groups that already have a PIN keep it and are still challenged for it; nothing
			// here removes a stored verifier.
			//
			// So this link is shown once, and it is what opens every division added from here on.
			await dialogs.showCustom(AccessLinkDialog, {
				props: { link: buildEventGroupJoinUrl(window.location.origin, groupId, authToken), audience: 'self' as const },
				maxWidth: 'max-w-xl'
			});
		});
	}

	function attachToGroup() {
		return run(async () => {
			const link = await dialogs.showPrompt({
				title: m.join_event_group(),
				message: m.paste_event_group_link(),
				inputType: 'url'
			});
			const url = typeof link === 'string' ? link.trim() : '';
			if (!url) return;

			const groupId = parseEventGroupUrl(url);
			const groupAuthToken = parseAuthTokenFromUrl(url);
			if (!groupId || !groupAuthToken) {
				throw new Error(m.invalid_event_group_link());
			}

			const label = await dialogs.showPrompt({
				title: m.division_label(),
				message: m.division_label_colon(),
				defaultValue: app.getEventName() ?? ''
			});
			const divisionLabel = typeof label === 'string' ? label.trim() : '';
			if (!divisionLabel) return;

			await app.wrpcClient.group.attachToGroup.mutation({ groupId, groupAuthToken, divisionLabel });
			await app.adoptEventGroup(groupId, groupAuthToken);
			await load();
		});
	}

	function detachFromGroup() {
		return run(async () => {
			const confirmed = await dialogs.showConfirmation({
				title: m.leave_event_group(),
				message: m.leave_event_group_confirmation(),
				confirmText: m.leave_event_group(),
				confirmButtonClass: 'danger'
			});
			if (!confirmed) return;

			await app.wrpcClient.group.detachFromGroup.mutation();
			membership = null;
			await load();
		});
	}

	function addGroupAdvisor() {
		return run(async () => {
			if (!membership) return;
			const name = await dialogs.showPrompt({
				title: m.add_judge_advisor(),
				message: m.judge_advisor_name_colon(),
				confirmText: m.add_judge_advisor()
			});
			const trimmed = typeof name === 'string' ? name.trim() : '';
			if (!trimmed) return;

			// Asked separately rather than parsed out of the name, because the prompt is a
			// plain text box and "Ada <ada@example.com>" is a name a person could plausibly
			// type. Skipping it just means the link is relayed by hand, as before.
			const emailAnswer = await dialogs.showPrompt({
				title: m.add_judge_advisor(),
				message: m.judge_advisor_email_prompt(),
				confirmText: m.add_judge_advisor()
			});
			const emailInput = typeof emailAnswer === 'string' ? emailAnswer.trim().toLowerCase() : '';
			if (emailInput && !JudgeEmailSchema.safeParse(emailInput).success) {
				await dialogs.showAlert({ title: m.add_judge_advisor(), message: m.judge_email_invalid() });
				return;
			}

			const response = await app.runGroupAction(membership.groupId, {
				kind: 'add_advisor',
				name: trimmed,
				email: emailInput || null
			});
			await load();

			if (response.issuedAuthToken) {
				await dialogs.showCustom(AccessLinkDialog, {
					props: {
						link: buildEventGroupJoinUrl(window.location.origin, membership.groupId, response.issuedAuthToken),
						name: trimmed
					},
					maxWidth: 'max-w-xl'
				});
			}
		});
	}

	function removeGroupAdvisor(advisor: GroupAdvisor) {
		return run(async () => {
			if (!membership) return;
			const confirmed = await dialogs.showConfirmation({
				title: m.remove(),
				message: m.remove_group_advisor_confirmation({ name: advisor.name }),
				confirmButtonClass: 'danger'
			});
			if (!confirmed) return;

			await app.runGroupAction(membership.groupId, { kind: 'remove_advisor', groupAdvisorId: advisor.groupAdvisorId });
			await load();
		});
	}

	function renameDivision(division: GroupDivision) {
		return run(async () => {
			if (!membership) return;
			const label = await dialogs.showPrompt({
				title: m.division_label(),
				message: m.division_label_colon(),
				defaultValue: division.label
			});
			const trimmed = typeof label === 'string' ? label.trim() : '';
			if (!trimmed || trimmed === division.label) return;

			await app.runGroupAction(membership.groupId, { kind: 'rename_division', roomId: division.roomId, label: trimmed });
			await load();
		});
	}

	function removeDivision(division: GroupDivision) {
		return run(async () => {
			if (!membership) return;
			const confirmed = await dialogs.showConfirmation({
				title: m.remove(),
				message: m.remove_division_confirmation({ name: division.label }),
				confirmButtonClass: 'danger'
			});
			if (!confirmed) return;

			await app.runGroupAction(membership.groupId, { kind: 'remove_room', roomId: division.roomId });
			await load();
		});
	}

	onMount(load);
</script>

<div class="flex max-h-[60vh] flex-col overflow-hidden">
	<p class="mb-4 shrink-0 text-sm text-gray-600">{m.event_group_description()}</p>

	{#if errorMessage}
		<p class="mb-3 shrink-0 text-sm text-red-600" role="alert">{errorMessage}</p>
	{/if}

	{#if loading}
		<p class="text-sm text-gray-500">…</p>
	{:else if !membership}
		<div class="space-y-3">
			<p class="text-sm text-gray-700">{m.event_group_not_joined()}</p>
			<div class="flex flex-wrap gap-2">
				<button class="primary tiny" onclick={createGroup} disabled={busy}>{m.create_event_group()}</button>
				<button class="lightweight tiny" onclick={attachToGroup} disabled={busy}>{m.join_event_group()}</button>
			</div>
		</div>
	{:else}
		<div class="min-h-0 flex-1 space-y-5 overflow-auto pr-1">
			<div>
				<h4 class="text-sm font-medium text-gray-900">{membership.name}</h4>
				{#if !canAdminister}
					<p class="mt-1 text-xs text-gray-500">{m.event_group_read_only()}</p>
				{/if}
			</div>

			<div>
				<div class="mb-2 flex items-center justify-between">
					<h5 class="text-sm font-medium text-gray-900">{m.divisions()}</h5>
				</div>
				<ul class="divide-y divide-gray-100 rounded border border-gray-200">
					{#each membership.divisions as division (division.roomId)}
						<li class="flex items-center gap-3 px-3 py-2.5">
							<div class="min-w-0 flex-1">
								<div class="flex flex-wrap items-center gap-2">
									<span class="truncate text-sm font-medium text-gray-900">{division.label}</span>
									{#if division.roomId === activeRoomId}
										<span class="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">{m.current()}</span>
									{/if}
								</div>
								<div class="truncate text-xs text-gray-500">{division.roomId.slice(0, 8)}</div>
							</div>
							{#if canAdminister}
								<div class="flex shrink-0 items-center gap-1">
									<button
										class="rounded-md px-2 py-1 text-xs text-gray-500 hover:bg-gray-100"
										onclick={() => renameDivision(division)}
										disabled={busy}
									>
										{m.rename()}
									</button>
									<button
										class="rounded-md px-2 py-1 text-xs text-red-600 hover:bg-red-50"
										onclick={() => removeDivision(division)}
										disabled={busy}
									>
										{m.remove()}
									</button>
								</div>
							{/if}
						</li>
					{/each}
				</ul>
			</div>

			<div>
				<div class="mb-2 flex items-center justify-between">
					<h5 class="text-sm font-medium text-gray-900">{m.judge_advisors()}</h5>
					{#if canAdminister}
						<button class="primary tiny" onclick={addGroupAdvisor} disabled={busy}>{m.add_judge_advisor()}</button>
					{/if}
				</div>
				<ul class="divide-y divide-gray-100 rounded border border-gray-200">
					{#each membership.advisors as advisor (advisor.groupAdvisorId)}
						<li class="flex items-center gap-3 px-3 py-2.5">
							<div class="min-w-0 flex-1">
								<!--
									No "PIN not set" badge. Nobody is given a PIN any more, so it would be amber
									beside every name for a state that is now the ordinary one, and an advisor who
									does still hold a PIN from before is simply asked for it when they join.
								-->
								<div class="flex flex-wrap items-center gap-2">
									<span class="truncate text-sm font-medium text-gray-900">{advisor.name}</span>
								</div>
							</div>
							{#if canAdminister && membership.advisors.length > 1}
								<button
									class="shrink-0 rounded-md px-2 py-1 text-xs text-red-600 hover:bg-red-50"
									onclick={() => removeGroupAdvisor(advisor)}
									disabled={busy}
								>
									{m.remove()}
								</button>
							{/if}
						</li>
					{/each}
				</ul>
			</div>

			<div class="flex flex-wrap gap-2 border-t border-gray-100 pt-3">
				<button class="lightweight tiny text-red-600" onclick={detachFromGroup} disabled={busy}>{m.leave_event_group()}</button>
			</div>
		</div>
	{/if}
</div>
