<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import Dialog from '$lib/components/dialog/Dialog.svelte';
	import XmarkIcon from '$lib/icon/XmarkIcon.svelte';
	import { app, dialogs } from '$lib/index.svelte';
	import EventSwitcherPanel from './EventSwitcherPanel.svelte';
	import EventGroupPanel from './EventGroupPanel.svelte';

	/**
	 * Switching events and administering an event group, behind one menu entry.
	 *
	 * They were two items in a menu of seven, and the distinction between them is one this
	 * application's own vocabulary makes rather than one a Judge Advisor arrives with: both
	 * are about which competitions this device can reach. The menu is read on a phone, in a
	 * hall, by someone who is looking for something else, so the fewer entries the better.
	 *
	 * The tab is only offered to a Judge Advisor with access control on, which is exactly
	 * who the menu item used to appear for. A judge holds a room link and never sees the
	 * group, so for them this dialog has no tabs at all and looks as the switcher always did.
	 */
	const isJudgeAdvisor = $derived(app.getCurrentUser()?.role === 'judge_advisor');
	const canSeeGroupTab = $derived(isJudgeAdvisor && app.isAccessControlEnabled());

	type PanelTab = 'switch' | 'group';
	let activeTab = $state<PanelTab>('switch');

	/**
	 * Whether the group tab has ever been opened.
	 *
	 * The group panel asks the server for the group on mount, and a judge switching
	 * divisions never needs that, so it is not mounted until the tab is first chosen. After
	 * that it stays mounted and is merely hidden, because unmounting would throw away what
	 * it loaded and make every glance at the other tab cost another round trip.
	 */
	let groupTabOpened = $state(false);

	function showTab(tab: PanelTab) {
		activeTab = tab;
		if (tab === 'group') groupTabOpened = true;
	}

	function handleClose() {
		dialogs.closeDialog();
	}
</script>

<!--
	Width follows content. The group panel's division and advisor lists need the room; the
	switcher on its own is a short list of names and looks stranded in a wide dialog, which
	is what a judge sees every time.
-->
<Dialog open={true} onClose={handleClose} innerContainerClass={canSeeGroupTab ? 'max-w-2xl p-4!' : 'max-w-lg p-4!'}>
	<div class="p-2">
		<div class="mb-4 flex items-center justify-between">
			<h3 class="text-lg font-medium text-gray-900">{m.switch_event()}</h3>
			<button onclick={handleClose} class="rounded-full p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600" aria-label="Close dialog">
				<XmarkIcon size={18} />
			</button>
		</div>

		{#if canSeeGroupTab}
			<div class="mb-4 flex gap-1 border-b border-gray-200" role="tablist">
				<button
					class="tab-button"
					class:tab-active={activeTab === 'switch'}
					role="tab"
					aria-selected={activeTab === 'switch'}
					onclick={() => showTab('switch')}
				>
					{m.switch_event()}
				</button>
				<button
					class="tab-button"
					class:tab-active={activeTab === 'group'}
					role="tab"
					aria-selected={activeTab === 'group'}
					onclick={() => showTab('group')}
				>
					{m.event_group()}
				</button>
			</div>
		{/if}

		<div class:hidden={activeTab !== 'switch'}>
			<EventSwitcherPanel />
		</div>
		{#if canSeeGroupTab && groupTabOpened}
			<div class:hidden={activeTab !== 'group'}>
				<EventGroupPanel />
			</div>
		{/if}
	</div>
</Dialog>

<style lang="postcss">
	@reference '../../../app.css';

	.tab-button {
		@apply -mb-px border-b-2 border-transparent px-3 py-2 text-sm font-medium text-gray-500;

		&:hover {
			@apply text-gray-700;
		}
	}

	.tab-active {
		@apply border-blue-600 text-blue-700;
	}
</style>
