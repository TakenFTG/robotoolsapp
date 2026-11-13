<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import { pushState } from '$app/navigation';
	import { page } from '$app/state';
	import { app, subscriptions, tabs, dialogs } from '$lib/index.svelte';
	import Header from './Header.svelte';
	import TabBar from './TabBar.svelte';
	import type { AwardRankingsFullUpdate, SubmissionCache } from '@robotools.app/protocol/src/rubric';
	import type { TeamPhoto } from '@robotools.app/protocol/src/media';
	import type { Tab } from '$lib/tab.svelte';
	import { refNotes } from '$lib/ref-notes.svelte';

	// Get tab state
	const allTabs = $derived(tabs.allTabs);
	const activeTabId = $derived(tabs.activeTab);
	const activeTab = $derived(activeTabId ? tabs.getTab(activeTabId) : null);
	const isJudgingReady = $derived(app.isJudgingReady());
	const currentJudgeGroupId = $derived(app.getCurrentUserJudgeGroup()?.id ?? null);
	const isViewingAwardNominationTab = $derived(activeTab?.type === 'award_nomination');
	const isViewingOverviewTab = $derived(activeTab?.type === 'overview');

	const isOnOverviewTab = $derived(!activeTabId || activeTabId === tabs.overviewTab.id);

	/**
	 * Back goes to Overview before it leaves the room.
	 *
	 * Every tab lives at the same URL, so opening one left no trace in history and back
	 * simply left the event. On a phone that is one stray edge swipe away, and where `/app`
	 * is the first entry in the browser tab it closed the browser outright.
	 *
	 * Two earlier attempts hooked navigation callbacks, and both were dead code. SvelteKit
	 * treats popping a `pushState` entry as a *shallow* update: client.js sets `page.state`
	 * and returns before it reaches `navigate()`, so neither beforeNavigate nor afterNavigate
	 * ever runs on this path — cancelling was never going to work, and neither was switching
	 * the tab from a handler. The gesture animation played, nothing else happened, and the
	 * tab was still there afterwards.
	 *
	 * So the whole thing is driven by `page.state`, which is the one signal that path does
	 * update. Opening a tab pushes an entry; the entry going away is the back press.
	 *
	 * One entry, not one per tab. Back was asked to reach Overview, not to walk backwards
	 * through every tab visited, so a second and third tab reuse the entry already pushed.
	 * And Overview never pushes one, so back from Overview finds nothing of ours, leaves the
	 * room, and is a real navigation rather than a shallow one.
	 */

	/**
	 * Whether the entry we push for an open tab is currently on the history stack.
	 *
	 * Not derived from anything, because it cannot be: popping our entry and never having
	 * pushed one look identical from `page.state` alone — both are "a tab is open and the
	 * flag is absent". This is the one bit that tells them apart, so it is a plain local
	 * rather than reactive state, and writing it must not re-run the effect below.
	 */
	let tabEntryPushed = false;

	$effect(() => {
		const tabIsOpen = !isOnOverviewTab;
		const entryPresent = Boolean(page.state.workspaceTabOpen);

		if (tabIsOpen && !entryPresent) {
			if (tabEntryPushed) {
				// Our entry has just been popped — this is the back press.
				tabEntryPushed = false;
				tabs.switchToTab(tabs.overviewTab.id);
			} else {
				// A tab was opened and has no entry standing for it yet.
				tabEntryPushed = true;
				pushState('', { workspaceTabOpen: true });
			}
		} else if (!tabIsOpen && !entryPresent) {
			// Neither a tab nor an entry outstanding, so nothing is owed either way. This is
			// also what clears the flag after Overview is reached by tapping its tab rather
			// than by going back.
			tabEntryPushed = false;
		}
	});

	/*
	 * One rough edge, left deliberately. Returning to Overview by tapping the tab rather than
	 * pressing back leaves the pushed entry in place, so the next back consumes it, clears
	 * the flag above and appears to do nothing; a second press leaves. Removing it would mean
	 * calling history.back() ourselves to swallow an entry, which is a worse thing to get
	 * wrong on a phone than one dead press.
	 */

	const overviewTabSubscriptionScope = $derived(tabs.overviewTab.subscriptionScope);
	let subscriptionScope = $state<'all_judge_groups' | 'current_judge_group'>('current_judge_group');
	let targetJudgeGroupIds = $state<string[]>([]);

	$effect(() => {
		if (isViewingOverviewTab) {
			subscriptionScope = overviewTabSubscriptionScope;
		} else if (isViewingAwardNominationTab) {
			subscriptionScope = 'all_judge_groups';
		} else {
			subscriptionScope = 'current_judge_group';
		}
	});

	$effect(() => {
		if (!currentJudgeGroupId || subscriptionScope === 'all_judge_groups') {
			targetJudgeGroupIds = app.getAllJudgeGroups().map((group) => group.id);
		} else {
			targetJudgeGroupIds = [currentJudgeGroupId];
		}
	});

	// Tab handlers
	function switchTab(tabId: string) {
		tabs.switchToTab(tabId);
	}

	async function closeTab(tabId: string) {
		console.log('closeTab', tabId);

		const tab = tabs.getTab(tabId);

		// Check if tab has unsaved data
		if (tab && tab.isDataUnsaved()) {
			const confirmed = await dialogs.showConfirmation({
				title: m.unsaved_changes(),
				message: m.you_have_unsaved_changes(),
				confirmText: m.close_anyway(),
				cancelText: m.keep_editing(),
				confirmButtonClass: 'danger',
				cancelButtonClass: 'primary'
			});

			if (!confirmed) {
				return; // User cancelled, don't close the tab
			}
		}

		tabs.closeTab(tabId);
	}

	function reorderTabs(newOrder: Tab[]) {
		tabs.reorderTabs(newOrder);
	}

	// Warn user before closing browser tab if there are unsaved changes
	$effect(() => {
		const handleBeforeUnload = (e: BeforeUnloadEvent) => {
			const hasUnsavedData = allTabs.some((tab) => tab.isDataUnsaved());
			if (hasUnsavedData) {
				// Modern browsers require both preventDefault and returnValue
				e.preventDefault();
				e.returnValue = ''; // Chrome requires returnValue to be set
				return ''; // Some browsers use the return value
			}
		};

		window.addEventListener('beforeunload', handleBeforeUnload);

		return () => {
			window.removeEventListener('beforeunload', handleBeforeUnload);
		};
	});

	const isJudgeAdvisor = $derived(app.getCurrentUser()?.role === 'judge_advisor');

	// Ref notes, for Judge Advisors only. Reloaded when the server signals a change, and after
	// a reconnect, since a signal sent while we were away was missed.
	$effect(() => {
		if (!isJudgingReady || !isJudgeAdvisor || !app.isAccessControlEnabled()) {
			refNotes.clear();
			return;
		}
		void app.getReconnectionCount();
		void refNotes.version;

		app.wrpcClient.refLink.listNotes
			.query()
			.then((result) => refNotes.set(result))
			.catch((error) => console.error('Failed to load ref notes:', error));
	});

	$effect(() => {
		if (!isJudgingReady) return;
		// Read so this runs again after a reconnect: the server dropped our subscriptions.
		void app.getReconnectionCount();

		console.log('Subscribing to award rankings', $state.snapshot(targetJudgeGroupIds));
		app.wrpcClient.judging.subscribeAwardRankings.mutation({ judgeGroupIds: targetJudgeGroupIds, exclusive: true }).then((data) => {
			subscriptions.allJudgeGroupsAwardRankings = data.reduce(
				(acc, curr) => {
					acc[curr.judgeGroupId] = curr;
					return acc;
				},
				{} as Record<string, AwardRankingsFullUpdate>
			);
		});

		return async () => {
			console.log('Unsubscribing from award rankings');

			await app.wrpcClient.judging.unsubscribeAwardRankings.mutation();
		};
	});

	$effect(() => {
		if (!isJudgingReady) return;
		// Read so this runs again after a reconnect: the server dropped our subscriptions.
		void app.getReconnectionCount();

		console.log('Subscribing to reviewed teams', $state.snapshot(targetJudgeGroupIds));

		app.wrpcClient.judging.subscribeReviewedTeams.mutation({ judgeGroupIds: targetJudgeGroupIds, exclusive: true }).then((data) => {
			subscriptions.allJudgeGroupsReviewedTeams = data.reduce(
				(acc, curr) => {
					acc[curr.judgeGroupId] = curr.teamIds;
					return acc;
				},
				{} as Record<string, string[]>
			);
		});

		return async () => {
			console.log('Unsubscribing from reviewed teams');

			await app.wrpcClient.judging.unsubscribeReviewedTeams.mutation();
		};
	});

	$effect(() => {
		if (!isJudgingReady) return;
		// Read so this runs again after a reconnect: the server dropped our subscriptions.
		void app.getReconnectionCount();

		console.log('Subscribing to submission caches', $state.snapshot(targetJudgeGroupIds));

		app.wrpcClient.judging.subscribeSubmissionCaches.mutation({ judgeGroupIds: targetJudgeGroupIds, exclusive: true }).then((data) => {
			subscriptions.allSubmissionCaches = data.reduce(
				(acc, curr) => {
					acc[curr.tiId ?? curr.enrId ?? curr.tnId ?? 'null'] = curr;
					return acc;
				},
				{} as Record<string, SubmissionCache>
			);
		});

		return async () => {
			console.log('Unsubscribing from submission caches');

			await app.wrpcClient.judging.unsubscribeSubmissionCaches.mutation();
		};
	});

	$effect(() => {
		if (!isJudgingReady) return;
		// Reloaded after a reconnect too: photo updates sent while we were away were missed.
		void app.getReconnectionCount();

		console.log('Loading team photos');
		app.wrpcClient.media.listAllTeamPhotos.query().then((photos) => {
			subscriptions.allTeamPhotos = photos.reduce(
				(acc, photo) => {
					acc[photo.id] = photo;
					return acc;
				},
				{} as Record<string, TeamPhoto>
			);
		});
	});
</script>

<svelte:head>
	<title>{m.workspace()} | Judges' Room</title>
</svelte:head>

<div class="flex h-screen flex-col bg-slate-100">
	<!-- Header -->
	<Header />

	<!-- Tab Bar -->
	<TabBar {allTabs} {activeTabId} onSwitchTab={switchTab} onCloseTab={closeTab} onReorderTabs={reorderTabs} />

	<!-- Main Content -->
	<main class="flex-1 overflow-hidden">
		{#each allTabs as tab (tab.id)}
			<div class="h-full w-full" class:hidden={activeTabId !== tab.id}>
				<!--
					Each tab class pairs a component with its own props type, but `allTabs` is a
					union of those classes: TypeScript cannot see that tab.component and tab.props
					come from the same member, so it demands the intersection of every tab's props.
					The cast asserts the pairing the classes already guarantee.
				-->
				<!-- eslint-disable-next-line @typescript-eslint/no-explicit-any -->
				<tab.component isActive={activeTabId === tab.id} {...tab.props as any} />
			</div>
		{/each}
	</main>
</div>
