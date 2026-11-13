<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import { app, dialogs, tabs } from '$lib/index.svelte';
	import EditIcon from '$lib/icon/EditIcon.svelte';
	import { NotebookRubricTab } from '$lib/tab.svelte';
	import type { TeamInfoAndData } from '$lib/team.svelte';
	import { canEnterNotebookRubric, type NotebookDevelopmentStatus } from '@robotools.app/protocol/src/team';
	import EditTeamDataDialog from './EditTeamDataDialog.svelte';
	import QRCodeButton from './QRCodeButton.svelte';

	interface Props {
		team: TeamInfoAndData;
		isSubmitted: boolean;
	}

	let { team, isSubmitted }: Props = $props();

	const devStatus = $derived(team.notebookDevelopmentStatus);
	// A link is reason enough to offer the rubric, so this is not the same as "submitted".
	const canScoreNotebook = $derived(canEnterNotebookRubric(team));

	// Function to update notebook development status
	async function updateNotebookStatus(notebookDevelopmentStatus: NotebookDevelopmentStatus) {
		try {
			await app.wrpcClient.team.updateTeamData.mutation({
				...team,
				notebookDevelopmentStatus
			});
		} catch (error) {
			app.addErrorNotice(m.failed_to_update_notebook_status());
		}
	}

	/**
	 * Record whether the notebook arrived with a Season Summary.
	 *
	 * Deliberately a separate question from the development status. Whether a summary is
	 * present is a check, not a judgement: you are looking for a page, not reading it. The
	 * two are set in the same pass because both happen with the notebook open in front of
	 * you, but one decides how the pile is ordered and the other is an assessment.
	 */
	async function updateSeasonSummary(hasSeasonSummary: boolean) {
		try {
			await app.wrpcClient.team.updateTeamData.mutation({
				...team,
				hasSeasonSummary
			});
		} catch (error) {
			app.addErrorNotice(m.failed_to_update_season_summary());
		}
	}

	// Function to open notebook rubric for a team
	function openNotebookRubric() {
		tabs.addOrReuseTab(new NotebookRubricTab({ teamId: team.id }));
	}

	// Open team data edit dialog
	function openEditTeamDataDialog(team: TeamInfoAndData) {
		dialogs.showCustom(EditTeamDataDialog, { props: { team } });
	}
</script>

<div
	class="relative flex min-h-53 flex-col rounded-lg border border-gray-200 bg-white p-3 transition-shadow hover:shadow-lg"
	class:border-green-500={devStatus === 'fully_developed'}
	class:border-yellow-500={devStatus === 'developing'}
	class:border-gray-500={devStatus === 'not_submitted'}
>
	<!-- Team Info Header -->
	<div class="mb-2 flex items-center justify-between">
		<div class="flex items-center gap-2">
			<span class="font-medium text-gray-900">{team.number}</span>
			<button
				onclick={() => openEditTeamDataDialog(team)}
				class="text-gray-400 hover:text-gray-600 active:text-gray-800"
				title={m.edit_team_data({ teamNumber: team.number })}
			>
				<EditIcon size={16} />
			</button>
			{#if team.absent}
				<span class="text-xs font-bold text-red-600" title="Absent">ABS</span>
			{/if}
			{#if team.hasSeasonSummary}
				<span class="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700" title={m.season_summary_badge_title()}>
					{m.season_summary_badge()}
				</span>
			{/if}
		</div>
	</div>

	<!-- Notebook Link -->
	{#if team.notebookLink}
		<div class="relative mb-2 flex flex-row items-center justify-end gap-1">
			<!-- eslint-disable svelte/no-navigation-without-resolve -- An engineering notebook lives on someone else's site; resolve() takes an app route. -->
			<a
				href={team.notebookLink}
				target="_blank"
				class="absolute left-0 w-[calc(100%-30px)] overflow-hidden text-xs text-ellipsis whitespace-nowrap text-blue-600 underline hover:text-blue-800 active:text-blue-900"
				title={team.notebookLink}
			>
				{team.notebookLink.replace(/^https?:\/\//, '')}
			</a>
			<!-- eslint-enable svelte/no-navigation-without-resolve -->
			<QRCodeButton link={team.notebookLink} />
		</div>
	{:else}
		<div class="mb-2 flex h-6 items-center">
			<span class="block text-xs text-gray-400">{m.no_notebook_link()}</span>
		</div>
	{/if}

	<div class="flex flex-col gap-2">
		<label class="flex items-center gap-2">
			<input
				type="radio"
				checked={devStatus === 'fully_developed'}
				value="fully_developed"
				class="mt-0.5 mr-2 rounded border-gray-300 sm:mt-0"
				onchange={() => updateNotebookStatus('fully_developed')}
			/>
			<span class="text-sm text-gray-700">{m.fully_developed_notebook_status()}</span>
		</label>
		<label class="flex items-center gap-2">
			<input
				type="radio"
				checked={devStatus === 'developing'}
				value="developing"
				class="mt-0.5 mr-2 rounded border-gray-300 sm:mt-0"
				onchange={() => updateNotebookStatus('developing')}
			/>
			<span class="text-sm text-gray-700">{m.developing_notebook_status()}</span>
		</label>
		<label class="flex items-center gap-2">
			<input
				type="radio"
				checked={devStatus === 'not_submitted'}
				value="not_submitted"
				class="mt-0.5 mr-2 rounded border-gray-300 sm:mt-0"
				onchange={() => updateNotebookStatus('not_submitted')}
			/>
			<span class="text-sm text-gray-700">{m.not_submitted_notebook_status()}</span>
		</label>

		<label class="mt-1 flex items-center gap-2 border-t border-gray-100 pt-2">
			<input
				type="checkbox"
				checked={team.hasSeasonSummary}
				class="mt-0.5 mr-2 rounded border-gray-300 sm:mt-0"
				onchange={(event) => updateSeasonSummary(event.currentTarget.checked)}
			/>
			<span class="text-sm text-gray-700">{m.submitted_with_season_summary()}</span>
		</label>
	</div>

	<!-- Also shown once this judge has scored it, so their own rubric stays reachable even if
	     the team was later marked not submitted. -->
	{#if canScoreNotebook || isSubmitted}
		<button onclick={() => openNotebookRubric()} class="primary tiny mt-2 w-full" class:bg-green-800!={isSubmitted}>
			{#if isSubmitted}
				{m.you_submitted()}
			{:else}
				{m.start_rubric()}
			{/if}
		</button>
	{/if}

	<!-- Status Indicator -->
	{#if devStatus !== 'undetermined'}
		<div class="absolute top-2 right-2">
			{#if devStatus === 'fully_developed'}
				<div class="h-2 w-2 rounded-full bg-green-500" title={m.fully_developed_notebook_status()}></div>
			{:else if devStatus === 'developing'}
				<div class="h-2 w-2 rounded-full bg-yellow-500" title={m.developing_notebook_status()}></div>
			{:else}
				<div class="h-2 w-2 rounded-full bg-gray-400" title={m.not_submitted_notebook_status()}></div>
			{/if}
		</div>
	{/if}
</div>
