<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import { app } from '$lib/index.svelte';
	import ConnectionStatusIndicator from './ConnectionStatusIndicator.svelte';
	import UserMenu from './UserMenu.svelte';

	// Takes no props: everything it renders comes from app state.

	const currentUser = $derived(app.getCurrentUser());

	// Get judge group name for display
	const judgeGroupName = $derived(() => {
		if (!app.hasEssentialData() || !currentUser || currentUser.role === 'judge_advisor') return null;
		if (currentUser.role === 'judge') {
			const group = app.findJudgeGroupByJudgeId(currentUser.judge.id);
			return group?.name || null;
		}
		return null;
	});
</script>

<header class="bg-surface-container px-2 py-2 md:px-6">
	<!-- The title takes whatever the controls leave and truncates, so it can never push them off-screen. -->
	<div class="flex items-center gap-4">
		<div class="min-w-0 flex-1">
			<div>
				<h1 class="truncate text-title-large text-on-surface">
					{app.getEventName() || "Judges' Room"}
				</h1>
				<div class="flex items-center space-x-2 text-body-medium text-on-surface-variant">
					{#if currentUser?.role === 'judge_advisor'}
						<span>{m.judge_advisor()}</span>
					{:else if currentUser && currentUser.role === 'judge'}
						<span>{currentUser.judge.name || 'Unknown'}</span>
						<span>•</span>
						<span>{judgeGroupName()}</span>
					{:else}
						<span>{m.unknown()}</span>
					{/if}
				</div>
			</div>
		</div>

		<div class="flex shrink-0 items-center gap-2 md:gap-4">
			<ConnectionStatusIndicator />
			<UserMenu />
		</div>
	</div>
</header>
