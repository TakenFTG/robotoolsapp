<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import { app, AppUI, dialogs } from '$lib/index.svelte';
	import GearIcon from '$lib/icon/GearIcon.svelte';
	import LeaveDoorIcon from '$lib/icon/LeaveDoorIcon.svelte';
	import SettingsIcon from '$lib/icon/SettingsIcon.svelte';
	import ShareIcon from '$lib/icon/ShareIcon.svelte';
	import TrashBinIcon from '$lib/icon/TrashBinIcon.svelte';
	import UserIcon from '$lib/icon/UserIcon.svelte';
	import DestroyDialog from './DestroyDialog.svelte';
	import ShareDialog from './ShareDialog.svelte';
	import DevicesDialog from './DevicesDialog.svelte';
	import UsersDialog from './UsersDialog.svelte';
	import RoleSelectionDialog from './RoleSelectionDialog.svelte';
	import EventsDialog from './EventsDialog.svelte';
	import PreferencesDialog from './PreferencesDialog.svelte';
	import DevicesIcon from '$lib/icon/DevicesIcon.svelte';
	import UsersIcon from '$lib/icon/UsersIcon.svelte';
	import { onMount } from 'svelte';
	import ResultsReportDialog from './ResultsReportDialog.svelte';
	import RefLinkDialog from './RefLinkDialog.svelte';
	import DownloadIcon from '$lib/icon/DownloadIcon.svelte';
	import FlagIcon from '$lib/icon/FlagIcon.svelte';
	import HelpIcon from '$lib/icon/HelpIcon.svelte';
	import { resolve } from '$app/paths';

	let isOpen = $state(false);
	let menuRef: HTMLDivElement | null = $state(null);
	let buttonRef: HTMLButtonElement | null = $state(null);

	const currentUser = $derived(app.getCurrentUser());
	const isJudgeAdvisor = $derived(currentUser?.role === 'judge_advisor');
	const accessControlEnabled = $derived(app.isAccessControlEnabled());
	const roomDialogLabel = $derived(!accessControlEnabled ? m.share_judges_room() : isJudgeAdvisor ? m.users() : m.devices());

	function toggleMenu() {
		isOpen = !isOpen;
	}

	function closeMenu() {
		isOpen = false;
	}

	function handleRoomDialog() {
		closeMenu();
		const dialog = !accessControlEnabled ? ShareDialog : isJudgeAdvisor ? UsersDialog : DevicesDialog;
		dialogs.showCustom(dialog, {
			props: {},
			maxWidth: 'max-w-4xl'
		});
	}

	function handleSwitchRole() {
		closeMenu();
		// Defensive: the menu entry is not rendered while access control is on, because
		// app.selectUser() throws in that mode. Kept so the dialog can never be opened
		// into a state where every action silently fails.
		if (accessControlEnabled) {
			void dialogs.showAlert({
				title: m.permission_denied(),
				message: m.switching_roles_disabled_with_access_control(),
				confirmText: 'OK',
				confirmButtonClass: 'primary'
			});
			return;
		}
		dialogs.showCustom(RoleSelectionDialog, { props: {} });
	}

	/**
	 * One entry for both. Event groups used to have their own item, which made the menu
	 * seven long and drew a line between "which event am I in" and "which events are tied
	 * together" that only this application draws.
	 */
	function handleSwitchEvent() {
		closeMenu();
		dialogs.showCustom(EventsDialog, { props: {}, maxWidth: 'max-w-2xl' });
	}

	function handlePreferences() {
		closeMenu();
		dialogs.showCustom(PreferencesDialog, { props: {} });
	}

	async function handleLeaveJudgesRoom() {
		closeMenu();

		const confirmed = await dialogs.showConfirmation({
			title: m.leave_judges_room(),
			message: m.are_you_sure_you_want_to_leave_the_judges_room(),
			confirmText: m.leave_judges_room(),
			confirmButtonClass: 'danger'
		});

		if (confirmed) {
			// await app.leaveJudgesRoom();
			AppUI.appPhase = 'leaving';
		}
	}

	function handleRefLink() {
		closeMenu();
		void dialogs.showCustom(RefLinkDialog, { props: {} });
	}

	function handleExportResults() {
		isOpen = false;
		void dialogs.showCustom(ResultsReportDialog, { props: {}, maxWidth: 'max-w-3xl' });
	}

	async function handleDestroy() {
		closeMenu();

		if (!isJudgeAdvisor) {
			await dialogs.showAlert({
				title: m.permission_denied(),
				message: m.this_action_is_available_for_judge_advisors_only(),
				confirmText: 'OK',
				confirmButtonClass: 'primary'
			});
			return;
		}

		// Import the DestroyDialog dynamically
		await dialogs.showCustom(DestroyDialog, {
			props: {},
			maxWidth: 'max-w-2xl'
		});
	}

	async function handleChangeEventSetup() {
		closeMenu();

		if (!isJudgeAdvisor) {
			await dialogs.showAlert({
				title: m.permission_denied(),
				message: m.this_action_is_available_for_judge_advisors_only(),
				confirmText: 'OK',
				confirmButtonClass: 'primary'
			});
			return;
		}

		const confirmed = await dialogs.showConfirmation({
			title: m.change_event_setup(),
			message: m.are_you_sure_you_want_to_modify_the_event_setup_this_could_disrupt_ongoing_judging_activities(),
			confirmText: m.continue_btn(),
			confirmButtonClass: 'primary'
		});

		if (confirmed) {
			AppUI.appPhase = 'event_setup';
		}
	}

	// Close menu when clicking outside
	function handleClickOutside(event: MouseEvent) {
		if (menuRef && buttonRef && !menuRef.contains(event.target as Node) && !buttonRef.contains(event.target as Node)) {
			closeMenu();
		}
	}

	// Close menu on escape key
	function handleKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape' && isOpen) {
			closeMenu();
		}
	}

	onMount(() => {
		document.addEventListener('click', handleClickOutside);
		document.addEventListener('keydown', handleKeydown);

		return () => {
			document.removeEventListener('click', handleClickOutside);
			document.removeEventListener('keydown', handleKeydown);
		};
	});
</script>

<div class="relative">
	<!-- Menu Button -->
	<button
		bind:this={buttonRef}
		onclick={toggleMenu}
		class="secondary tiny inline-flex items-center gap-2"
		aria-label="Menu"
		aria-expanded={isOpen}
		aria-haspopup="true"
	>
		<!-- Hamburger Icon -->
		<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
			<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16" />
		</svg>
		<span class="sm:inline">{m.menu()}</span>
	</button>

	<!-- Context Menu -->
	{#if isOpen}
		<div
			bind:this={menuRef}
			class="absolute top-full right-0 z-50 mt-1 w-64 rounded-sm bg-surface-container py-2 shadow-elev-2"
			role="menu"
			aria-orientation="vertical"
			aria-labelledby="menu-button"
		>
			<button onclick={handleRoomDialog} class="menu-item" role="menuitem">
				<span class="mr-3">
					{#if !accessControlEnabled}
						<ShareIcon />
					{:else if isJudgeAdvisor}
						<UsersIcon size={16} />
					{:else}
						<DevicesIcon size={16} />
					{/if}
				</span>
				<span>{roomDialogLabel}</span>
			</button>

			<!-- Referee notes: Judge Advisors only, and only with access control on, since a
			     link hands this division's teams and schedule to another app. -->
			{#if isJudgeAdvisor && accessControlEnabled}
				<button onclick={handleRefLink} class="menu-item" role="menuitem">
					<span class="mr-3">
						<FlagIcon />
					</span>
					<span>{m.ref_link_menu()}</span>
				</button>
			{/if}

			<!-- Switch Role: open mode only. With access control on, identity comes from the
			     access link and app.selectUser() refuses to change it, so the entry is hidden
			     for everyone including the Judge Advisor. -->
			{#if !accessControlEnabled}
				<button onclick={handleSwitchRole} class="menu-item" role="menuitem">
					<span class="mr-3">
						<UserIcon />
					</span>
					<span>{m.switch_role()}</span>
				</button>
			{/if}

			<!-- Switch event: available to everyone, since a judge may also cover more than
			     one division. Always shown so a single-room user can add a second. Event
			     group administration is a tab inside it, offered only to a Judge Advisor with
			     access control on, which is who its own menu item used to appear for. -->
			<button onclick={handleSwitchEvent} class="menu-item" role="menuitem">
				<span class="mr-3">
					<UsersIcon size={16} />
				</span>
				<span>{m.switch_event()}</span>
			</button>

			<!-- Preferences -->
			<button onclick={handlePreferences} class="menu-item" role="menuitem">
				<span class="mr-3">
					<SettingsIcon />
				</span>
				<span>{m.preferences()}</span>
			</button>

			<!-- Help: opens in a new tab so nothing open in the room is lost. -->
			<a href={resolve('/help')} target="_blank" rel="noopener" onclick={closeMenu} class="menu-item" role="menuitem">
				<span class="mr-3">
					<HelpIcon />
				</span>
				<span>{m.menu_help()}</span>
			</a>

			<!-- Leave Judges' Room -->
			<button onclick={handleLeaveJudgesRoom} class="menu-item menu-danger" role="menuitem">
				<span class="mr-3">
					<LeaveDoorIcon />
				</span>
				<span>{m.leave_judges_room()}</span>
			</button>

			<!-- Divider -->
			<div class="my-2 border-t border-outline-variant"></div>

			<!-- Export results.
			     Sits immediately above Destroy on purpose: the two are a pair, and the record
			     is the thing that cannot be recovered afterwards. -->
			<button onclick={handleExportResults} disabled={!isJudgeAdvisor} class="menu-item" role="menuitem">
				<span class="mr-3">
					<DownloadIcon />
				</span>
				<span>{m.export_results()}</span>
			</button>

			<!-- Destroy -->
			<button
				onclick={handleDestroy}
				disabled={!isJudgeAdvisor}
				class="menu-item menu-danger"
				role="menuitem"
				title={isJudgeAdvisor ? '' : 'Available for Judge Advisors only'}
			>
				<span class="mr-3">
					<TrashBinIcon />
				</span>
				<span>{m.destroy_judging_data()}</span>
			</button>

			<!-- Change Event Setup -->
			<button
				onclick={handleChangeEventSetup}
				disabled={!isJudgeAdvisor}
				class="menu-item"
				role="menuitem"
				title={isJudgeAdvisor ? '' : 'Available for Judge Advisors only'}
			>
				<span class="mr-3">
					<GearIcon />
				</span>
				<span>{m.change_event_setup()}</span>
			</button>
		</div>
	{/if}
</div>

<style lang="postcss">
	@reference '../../../app.css';

	/* M3 menu item: 48px tall, state layer on hover, destructive entries in the error colour. */
	.menu-item {
		@apply state-layer flex h-12 w-full items-center px-3 text-left text-label-large text-on-surface;

		&.menu-danger {
			@apply text-error;
		}

		&:disabled {
			@apply cursor-not-allowed opacity-38;
		}
	}
</style>
