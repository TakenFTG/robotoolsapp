<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import { resolve } from '$app/paths';
	import { onMount, tick } from 'svelte';
	import { replaceState } from '$app/navigation';
	import { app, AppUI, dialogs } from '$lib/index.svelte';
	import EventSetup from '$lib/components/event-setup/EventSetup.svelte';
	import Workspace from '$lib/components/workspace/Workspace.svelte';
	import RoleSelection from '$lib/components/role-selection/RoleSelection.svelte';
	import Loading from '$lib/components/loading/Loading.svelte';
	import Begin from '$lib/components/begin/Begin.svelte';
	import JoiningJudgesRoom from '$lib/components/joining-judges-room/JoiningJudgesRoom.svelte';
	import AlertDialog from '$lib/components/dialog/AlertDialog.svelte';
	import ConfirmationDialog from '$lib/components/dialog/ConfirmationDialog.svelte';
	import PromptDialog from '$lib/components/dialog/PromptDialog.svelte';
	import { parseAuthTokenFromUrl, parseEventGroupUrl, parseJudgesRoomUrl } from '$lib/utils.svelte';
	import Notice from '$lib/components/notice/Notice.svelte';
	import Leaving from '$lib/components/leaving/Leaving.svelte';
	import { NoStoredRoomsError } from '$lib/app.svelte';

	const currentUser = $derived(app.getCurrentUser());
	const currentUserJudge = $derived(app.getCurrentUserJudge());

	// Monitor user state changes
	$effect(() => {
		// Handle role deletion
		if (app.isJudgingReady() && currentUser && currentUser.role === 'judge' && !currentUserJudge) {
			app.unselectUser();
			if (app.isAccessControlEnabled()) {
				AppUI.appPhase = 'leaving';
				dialogs.showAlert({
					title: m.role_removed(),
					message: m.your_judge_access_was_revoked_ask_ja_for_a_new_link(),
					confirmText: 'OK',
					confirmButtonClass: 'primary'
				});
			} else {
				AppUI.appPhase = 'role_selection';
				dialogs.showAlert({
					title: m.role_removed(),
					message: m.your_judge_role_has_been_removed_please_select_a_new_role(),
					confirmText: 'OK',
					confirmButtonClass: 'primary'
				});
			}
		}
	});

	// $inspect(AppUI.appPhase);

	onMount(async () => {
		const roomIdFromUrl = parseJudgesRoomUrl(window.location.href);
		const authFromUrl = parseAuthTokenFromUrl(window.location.href);
		const groupIdFromUrl = parseEventGroupUrl(window.location.href);

		// An event group link names a competition rather than a division: it resolves to a
		// list of rooms, and opening the first of them is what "joining" means here.
		if (!roomIdFromUrl && groupIdFromUrl) {
			await handleEventGroupUrl();
			return;
		}
		// Join link: /app?roomId=…&auth=… (or via /join redirect)
		if (roomIdFromUrl) {
			const existingPermit = app.getPermit();
			if (existingPermit?.roomId !== roomIdFromUrl || existingPermit?.authToken !== authFromUrl) {
				await handleJudgesRoomUrl();
				return;
			}

			// Clear join params from the address bar (roomId / auth)
			// Use tick() to avoid "cannot call replaceState(...) before router is initialized"
			tick().then(() => {
				replaceState(resolve('/app'), {});
			});
		}

		// In other cases, check if we can rejoin a stored permit
		// The stored permit should be the loaded when the app is loaded
		const existingPermit = app.getPermit();
		if (existingPermit) {
			await useStoredPermit();
			return;
		}

		// If we have no permit, show the choose action page
		AppUI.appPhase = 'begin';
	});

	async function handleEventGroupUrl() {
		try {
			await app.joinEventGroupFromUrl(window.location.href);
			replaceState(resolve('/app'), {});

			const session = app.getGroupSession();
			if (!session) {
				AppUI.appPhase = 'begin';
				return;
			}

			await app.openEventGroup(session.groupId);
			AppUI.appPhase = 'joining_judges_room';
		} catch (error) {
			console.error('Error opening event group from URL:', error);
			AppUI.appPhase = 'begin';
			dialogs.showAlert({
				title: m.failed_to_join(),
				message: m.failed_to_join_judges_room({ error: error + '' }),
				confirmButtonClass: 'primary'
			});
		}
	}

	async function handleJudgesRoomUrl() {
		try {
			// No leave first: a device may hold several rooms now, and opening a link for
			// another division must add to them rather than evict what is already here.
			await app.joinJudgesRoomFromUrl(window.location.href);

			// Clear join params from the address bar (roomId / auth)
			replaceState(resolve('/app'), {});

			// Wait for sync to complete
			AppUI.appPhase = 'joining_judges_room';
		} catch (error) {
			console.error("Error joining Judges' Room from URL:", error);
			AppUI.appPhase = 'begin';
			dialogs.showAlert({
				title: m.failed_to_join(),
				message: m.failed_to_join_judges_room({ error: error + '' }),
				confirmButtonClass: 'primary'
			});
		}
	}

	async function useStoredPermit() {
		try {
			await app.joinJudgesRoomWithStoredPermit();

			AppUI.appPhase = 'joining_judges_room';
		} catch (error) {
			// Every stored room turned out to be gone. Nothing failed and there is nothing
			// to say — go to the start screen as if there had never been a permit.
			if (error instanceof NoStoredRoomsError) {
				AppUI.appPhase = 'begin';
				return;
			}
			// Permit in storage but couldn't be used, show choice
			// TODO: handle this case
			console.error('Error rejoining stored permit:', error);
			AppUI.appPhase = 'begin';
			dialogs.showAlert({
				title: m.failed_to_rejoin(),
				message: m.failed_to_rejoin_judges_room({ error: error + '' }),
				confirmButtonClass: 'primary'
			});
		}
	}

	let notices = $derived(app.getNotices());
	let currentDialog = $derived(dialogs.currentDialog);

	function dismissNotice(id: string) {
		app.clearNotice(id);
	}
</script>

<div class="min-h-screen">
	{#if AppUI.appPhase === 'loading'}
		<Loading />
	{:else if AppUI.appPhase === 'begin'}
		<Begin />
	{:else if AppUI.appPhase === 'joining_judges_room'}
		<JoiningJudgesRoom />
	{:else if AppUI.appPhase === 'event_setup'}
		<EventSetup />
	{:else if AppUI.appPhase === 'role_selection'}
		<RoleSelection />
	{:else if AppUI.appPhase === 'workspace'}
		<Workspace />
	{:else if AppUI.appPhase === 'leaving'}
		<Leaving />
	{/if}

	<!-- Notices -->
	{#if notices.length > 0}
		<div class="fixed right-4 bottom-4 z-50 flex flex-col items-end gap-2">
			{#each notices as notice (notice.id)}
				<Notice {notice} {dismissNotice} />
			{/each}
		</div>
	{/if}

	<!-- Dialog System -->
	{#if currentDialog}
		{#if currentDialog.type === 'alert'}
			<AlertDialog dialog={currentDialog} />
		{:else if currentDialog.type === 'confirmation'}
			<ConfirmationDialog dialog={currentDialog} />
		{:else if currentDialog.type === 'prompt'}
			<PromptDialog dialog={currentDialog} />
		{:else if currentDialog.type === 'custom'}
			{@const Component = currentDialog.component}

			<!-- <svelte:component this={currentDialog.component as any} {...currentDialog.props} /> -->
			<!-- https://svelte.dev/e/svelte_component_deprecated -->
			<Component {...currentDialog.props} />
		{/if}
	{/if}
</div>
