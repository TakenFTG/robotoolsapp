<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import { resolve } from '$app/paths';
	import { sanitizeHTMLMessage } from '$lib/i18n';
	import { createJudgeFromString } from '$lib/judging.svelte';
	import { type User } from '$lib/user.svelte';
	import { app, AppUI } from '$lib/index.svelte';
	import type { ConnectionState } from '@robotools.app/wrpc/client';

	let connectionState: ConnectionState = $derived(app.getConnectionState());
	let selectedJudgeId = $state('');
	let selectedRole: 'judge' | 'judge_advisor' = $state('judge');
	let newJudgeName = $state('');
	let showNameInput = $state(false);
	let selectedJudgeGroupId = $state('');

	const essentialData = $derived(app.getEssentialData());

	// Get all existing judges grouped by judge group
	const judgesByGroup = $derived(() => app.getExistingJudgesGroupedByGroup());

	const judgeGroups = $derived(app.getAllJudgeGroups());

	async function selectExistingJudge() {
		if (!selectedJudgeId || !app.hasEssentialData()) return;

		const judge = app.findJudgeById(selectedJudgeId);
		if (judge) {
			const user: User = { role: 'judge', judge };
			await app.selectUser(user);
			AppUI.appPhase = 'workspace';
		}
	}

	async function selectJudgeAdvisor() {
		const user: User = { role: 'judge_advisor' };
		await app.selectUser(user);
		AppUI.appPhase = 'workspace';
	}

	async function createNewJudge() {
		if (!newJudgeName.trim() || !selectedJudgeGroupId) return;

		try {
			const newJudge = createJudgeFromString(newJudgeName.trim(), selectedJudgeGroupId);
			const user: User = { role: 'judge', judge: newJudge };
			await app.selectUser(user);
			AppUI.appPhase = 'workspace';
		} catch (error) {
			app.reportWriteFailure(error, m.write_context_judge());
		}
	}

	function toggleNameInput() {
		showNameInput = !showNameInput;
		selectedJudgeId = '';
		newJudgeName = '';
		selectedJudgeGroupId = '';
	}

	function handleRoleChange() {
		selectedJudgeId = '';
		newJudgeName = '';
		showNameInput = false;
	}

	// Initialize with first judge group if available
	$effect(() => {
		if (judgeGroups.length > 0 && !selectedJudgeGroupId) {
			selectedJudgeGroupId = judgeGroups[0].id;
		}
	});

	// Handle disconnection, kicked, or Judges' Room destroyed scenarios
	$effect(() => {
		// If we lose connection or have errors, redirect to choose action
		if (connectionState === 'error' || connectionState === 'offline') {
			AppUI.appPhase = 'begin';
		}
	});
</script>

<svelte:head>
	<title>{m.role_selection()} | Judges' Room</title>
</svelte:head>

<div class="relative flex h-screen flex-col bg-surface">
	<div class="flex flex-1 flex-col items-center justify-center p-2">
		<div class="flex w-full max-w-3xl flex-col items-center gap-6">
			<div class="flex flex-col items-center justify-center gap-2">
				<h2 class="text-display-small text-on-surface">{m.product_name()}</h2>

				<p class="text-center text-body-large text-on-surface-variant">
					{m.quaint_stock_seahorse_fetch()}
				</p>
			</div>

			{#if !essentialData}
				<div class="text-center text-gray-500">
					<p>{m.loading_judges_room_data_description()}</p>
				</div>
			{:else if connectionState === 'connecting' || connectionState === 'reconnecting'}
				<div class="rounded-lg bg-warning-container p-4 text-center text-on-warning-container">
					<p>{m.connecting_to_judges_room_description()}</p>
				</div>
			{:else}
				<div class="max-w-2xl rounded-2xl bg-surface-container-low p-4 shadow-elev-1 sm:p-6">
					<!-- Role Selection -->
					<div class="space-y-6">
						<div class="space-y-4">
							<h3 class="text-headline-small text-on-surface">{m.join_judges_room()}</h3>
							<p class="mt-4 mb-2 text-body-medium text-on-surface-variant">
								{@html sanitizeHTMLMessage(m.you_are_connected_to, {
									eventName: essentialData.eventName,
									divisionId: essentialData.divisionId ?? ''
								})}
							</p>
							<p class="mt-2 mb-2 text-body-medium text-on-surface-variant">
								{m.choose_your_identity_to_start_participating_in_the_judges_room()}
							</p>
							<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
								<label
									class="flex cursor-pointer items-center space-x-3 rounded-lg border-2 p-4 transition-colors"
									class:border-primary={selectedRole === 'judge'}
									class:bg-secondary-container={selectedRole === 'judge'}
									class:border-outline-variant={selectedRole !== 'judge'}
								>
									<input type="radio" bind:group={selectedRole} value="judge" onchange={handleRoleChange} class="size-4" />
									<div>
										<div class="font-medium text-gray-900">{m.judge()}</div>
										<div class="text-sm text-gray-500">{m.evaluate_teams_and_participate_in_scoring()}</div>
									</div>
								</label>

								<label
									class="flex cursor-pointer items-center space-x-3 rounded-lg border-2 p-4 transition-colors"
									class:border-primary={selectedRole === 'judge_advisor'}
									class:bg-secondary-container={selectedRole === 'judge_advisor'}
									class:border-outline-variant={selectedRole !== 'judge_advisor'}
								>
									<input type="radio" bind:group={selectedRole} value="judge_advisor" onchange={handleRoleChange} class="size-4" />
									<div>
										<div class="font-medium text-gray-900">{m.judge_advisor()}</div>
										<div class="text-sm text-gray-500">{m.manage_the_judges_room_and_oversee_judges()}</div>
									</div>
								</label>
							</div>
						</div>

						{#if selectedRole === 'judge'}
							<!-- Judge Selection -->
							<div class="space-y-4">
								<!-- Toggle between existing and new judge -->
								<div class="flex justify-center">
									<div class="flex rounded-lg bg-gray-100 p-1">
										<button
											onclick={toggleNameInput}
											class="rounded-md px-3 py-1 text-sm font-medium transition-colors"
											class:bg-white={!showNameInput}
											class:text-gray-900={!showNameInput}
											class:text-gray-500={showNameInput}
										>
											{m.find_my_name()}
										</button>
										<button
											onclick={toggleNameInput}
											class="rounded-md px-3 py-1 text-sm font-medium transition-colors"
											class:bg-white={showNameInput}
											class:text-gray-900={showNameInput}
											class:text-gray-500={!showNameInput}
										>
											{m.cant_find_your_name()}
										</button>
									</div>
								</div>

								{#if !showNameInput}
									<!-- Select Existing Judge -->
									<div class="space-y-4">
										{#if Object.keys(judgesByGroup()).length === 0}
											<div class="py-8 text-center text-gray-500">
												<p>{m.no_judges_have_been_set_up_yet()}</p>
												<p class="text-sm">{m.you_can_add_your_name_instead()}</p>
											</div>
										{:else}
											<div class="space-y-4">
												{#each judgeGroups as group (group.id)}
													{@const judges = judgesByGroup()[group.id] || []}
													<div class="rounded-lg border bg-gray-50 p-4">
														<h4 class="mb-2 font-medium text-gray-900">{group.name}</h4>

														{#if judges.length === 0}
															<p class="text-sm text-gray-500">{m.no_judges_in_this_group()}</p>
														{:else}
															<div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
																{#each judges as judge (judge.id)}
																	<label class="flex cursor-pointer items-center space-x-2">
																		<input type="radio" bind:group={selectedJudgeId} value={judge.id} class="size-4" />
																		<span class="text-sm">{judge.name}</span>
																	</label>
																{/each}
															</div>
														{/if}
													</div>
												{/each}
											</div>

											<div class="text-center">
												<button onclick={selectExistingJudge} disabled={!selectedJudgeId} class="primary">
													{m.continue_as_selected_judge()}
												</button>
											</div>
										{/if}
									</div>
								{:else}
									<!-- Add New Judge -->
									<div class="space-y-4">
										<div class="space-y-4">
											<div>
												<label for="judgeName" class="block text-sm font-medium text-gray-700">{m.your_name()}</label>
												<input
													id="judgeName"
													type="text"
													bind:value={newJudgeName}
													placeholder={m.enter_your_name()}
													class="classic mt-1 block w-full"
												/>
											</div>

											<div>
												<label for="judgeGroup" class="block text-sm font-medium text-gray-700">{m.judge_group()}</label>
												<select id="judgeGroup" bind:value={selectedJudgeGroupId} class="classic mt-1 block w-full">
													{#each judgeGroups as group (group.id)}
														<option value={group.id}>{group.name}</option>
													{/each}
												</select>
											</div>

											<div class="text-center">
												<button onclick={createNewJudge} disabled={!newJudgeName.trim() || !selectedJudgeGroupId} class="primary">
													{m.continue_with_this_name()}
												</button>
											</div>
										</div>
									</div>
								{/if}
							</div>
						{:else if selectedRole === 'judge_advisor'}
							<!-- Judge Advisor Selection -->
							<div class="space-y-4">
								<div class="rounded-lg border bg-slate-50 p-4 text-center">
									<h4 class="font-medium text-gray-900">{m.judge_advisor()}</h4>
									<p class="mt-2 text-sm text-gray-600">
										{m.as_a_judge_advisor_you_can()}
									</p>
									<div class="mt-4">
										<button onclick={selectJudgeAdvisor} class="primary">
											{m.continue_as_judge_advisor()}
										</button>
									</div>
								</div>
							</div>
						{/if}
					</div>
				</div>
			{/if}
		</div>

		<div class="mt-4 flex max-w-2xl flex-row flex-wrap justify-center gap-2 text-sm text-gray-500">
			<a href={resolve('/help')} target="_blank">{m.help_and_instructions()}</a>
			<span aria-hidden="true">·</span>
			<a href={resolve('/privacy')} target="_blank">{m.data_protection_and_privacy()}</a>
		</div>

		<!-- Attribution: a derivative of a GPL-3.0 project, said plainly. -->
		<p class="mt-2 max-w-2xl text-center text-xs text-gray-400">
			{m.attribution_modified_from()}
			<a href="https://github.com/Jerrylum/judgesroom.com" target="_blank" rel="noopener noreferrer">judgesroom.com</a
			>{m.attribution_used_under()}
			<a href="https://www.gnu.org/licenses/gpl-3.0.html" target="_blank" rel="noopener noreferrer">GNU General Public License v3.0</a
			>{m.attribution_end()}
			<a href="https://github.com/TakenFTG/robotoolsapp" target="_blank" rel="noopener noreferrer">{m.attribution_source_code()}</a>
			<br />{m.attribution_legal_notice()}
		</p>
	</div>
</div>

<style lang="postcss">
	@reference '../../../app.css';

	a {
		@apply text-on-surface-variant underline hover:text-on-surface;
	}
</style>
