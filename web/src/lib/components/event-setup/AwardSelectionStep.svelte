<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import CustomAwardDialog from './CustomAwardDialog.svelte';
	import { dialogs } from '$lib/index.svelte';
	import { getOfficialAwardOptionsList, type AwardOptions } from '$lib/award.svelte';
	import { isExcellenceAward, isDesignAward, type AwardType, type Program } from '@robotools.app/protocol/src/award';
	import type { EventGradeLevel } from '@robotools.app/protocol/src/event';
	import { getEventGradeLevelOptions } from '$lib/event.svelte';
	import ExcellenceAwardOptions from './ExcellenceAwardOptions.svelte';
	import DesignAwardOptions from './DesignAwardOptions.svelte';
	import AwardSelectionColumn from './AwardSelectionColumn.svelte';
	import { tick, untrack } from 'svelte';

	interface Props {
		selectedProgram: Program;
		selectedEventGradeLevel: EventGradeLevel;
		allAwardOptions: AwardOptions[];
		/** This is the final step: awards are the last thing chosen before the room exists. */
		onComplete: () => Promise<void>;
		onCancel: () => void;
		onPrev: () => void;
		isJudgesRoomJoined: boolean;
	}

	type DropEvent = CustomEvent<{ items: AwardOptions[] }>;

	let {
		selectedProgram,
		selectedEventGradeLevel,
		allAwardOptions = $bindable(),
		onComplete,
		onCancel,
		onPrev,
		isJudgesRoomJoined
	}: Props = $props();

	let isLoading = $state(false);

	async function handleComplete() {
		// submit() writes the chosen awards back through the bindable prop, and completing
		// reads them from the parent in the same turn. Previously this step only ever handed
		// off to another step, so the write had a render in between; now it does not.
		submit();
		await tick();

		isLoading = true;
		try {
			await onComplete();
		} finally {
			isLoading = false;
		}
	}

	const gradeOptions = $derived(getEventGradeLevelOptions(selectedProgram));
	const possibleGrades = $derived(gradeOptions.find((g) => g.value === selectedEventGradeLevel)?.grades ?? []);

	let excellenceAward = $state<AwardOptions[]>([]);
	let designAward = $state<AwardOptions[]>([]);
	let localState = $state<Record<AwardType, AwardOptions[]>>({
		performance: [],
		judged: [],
		volunteer_nominated: []
	});

	$effect(() => {
		let using = allAwardOptions;

		if (using.length === 0) {
			using = getOfficialAwardOptionsList(selectedProgram, possibleGrades);
		}

		untrack(() => {
			const j = using.filter((award) => award.selectedType === 'judged');
			excellenceAward = j.filter((award) => isExcellenceAward(award.name));
			designAward = j.filter((award) => isDesignAward(award.name));
			localState = {
				performance: using.filter((award) => award.selectedType === 'performance'),
				judged: j.filter((award) => !isExcellenceAward(award.name) && !isDesignAward(award.name)),
				volunteer_nominated: using.filter((award) => award.selectedType === 'volunteer_nominated')
			};
		});
	});

	let dropOut = $state<{ type: AwardType; awardOptions: AwardOptions[] } | null>(null);
	let dragIn = $state<{ type: AwardType; awardOptions: AwardOptions[] } | null>(null);

	function commit(type: AwardType, awardOptions: AwardOptions[]) {
		awardOptions.forEach((ao) => {
			ao.selectedType = type;
		});

		localState[type] = awardOptions;
	}

	function rollback(type: AwardType) {
		// force all columns to rollback their editing state
		// IMPORTANT: to avoid rendering warnings, we need to wait for the next tick
		tick().then(() => {
			localState[type] = [...localState[type]];
		});
	}

	function isAwardSelectionValid(type: AwardType, awardOptions: AwardOptions[]): boolean {
		return awardOptions.every((ao) => ao.possibleTypes.includes(type));
	}

	function handleAwardOptionsFinalize(type: AwardType, zone: string, e: DropEvent) {
		if (zone === 'others') {
			const originalState = localState[type];
			const proposedState = e.detail.items;
			if (originalState.length === proposedState.length) {
				if (isAwardSelectionValid(type, proposedState)) {
					commit(type, proposedState);
				} else {
					rollback(type);
				}
				return;
			} else if (originalState.length > proposedState.length) {
				dropOut = { type, awardOptions: proposedState };
			} else {
				dragIn = { type, awardOptions: proposedState };
			}

			if (dropOut && dragIn) {
				if (isAwardSelectionValid(dragIn.type, dragIn.awardOptions) && isAwardSelectionValid(dropOut.type, dropOut.awardOptions)) {
					commit(dragIn.type, dragIn.awardOptions);
					commit(dropOut.type, dropOut.awardOptions);
				} else {
					rollback(dragIn.type);
					rollback(dropOut.type);
				}
				dropOut = null;
				dragIn = null;
			}
		} else {
			if (isAwardSelectionValid(type, e.detail.items)) {
				commit(type, e.detail.items);
			} else {
				rollback(type);
			}
		}
	}

	async function openCustomAwardDialog() {
		const result = await dialogs.showCustom(CustomAwardDialog, {
			props: {
				existingAwards: [...allAwardOptions],
				selectedProgram,
				possibleGrades
			}
		});

		// If user didn't cancel, add the award to the appropriate list
		const customAward = result as AwardOptions | null;
		if (customAward) {
			if (customAward.selectedType === 'performance') {
				localState.performance.push(customAward);
			} else if (customAward.selectedType === 'judged') {
				localState.judged.push(customAward);
			} else {
				localState.volunteer_nominated.push(customAward);
			}
		}
	}

	function submit() {
		allAwardOptions = [
			...localState.performance,
			...excellenceAward,
			...designAward,
			...localState.judged,
			...localState.volunteer_nominated
		];
	}
</script>

<div class="space-y-6">
	<div class="flex items-center justify-between">
		<h2 class="text-xl font-semibold text-gray-900">{m.awards_setup()}</h2>
		<button onclick={openCustomAwardDialog} class="success tiny">{m.add_custom_award()}</button>
	</div>

	<div class="grid grid-cols-1 gap-6 lg:grid-cols-3">
		<!-- Performance Awards -->
		<div class="space-y-3">
			<div>
				<h3 class="text-base font-semibold text-gray-800">{m.performance_awards()}</h3>
				<p class="mb-3 text-xs text-gray-600">
					{m.performance_awards_description()}
				</p>
			</div>
			<div class="space-y-2 border-t pt-3">
				<AwardSelectionColumn
					type="performance"
					zone="performance"
					awardOptions={localState.performance}
					onFinalize={handleAwardOptionsFinalize}
				/>
			</div>
		</div>

		<!-- Judged Awards -->
		<div class="space-y-3">
			<div>
				<h3 class="text-base font-semibold text-gray-800">{m.judged_awards()}</h3>
				<p class="mb-3 text-xs text-gray-600">
					{m.judged_awards_description()}
				</p>
			</div>
			<div class="space-y-2 border-t pt-3">
				{#if excellenceAward.length > 0}
					<ExcellenceAwardOptions bind:awards={excellenceAward} />
				{/if}
				{#if designAward.length > 0}
					<DesignAwardOptions bind:awards={designAward} />
				{/if}
				<AwardSelectionColumn type="judged" zone="others" awardOptions={localState.judged} onFinalize={handleAwardOptionsFinalize} />
			</div>
		</div>

		<!-- Nominated Awards -->
		<div class="space-y-3">
			<div>
				<h3 class="text-base font-semibold text-gray-800">{m.volunteer_nominated_awards()}</h3>
				<p class="mb-3 text-xs text-gray-600">
					{m.volunteer_nominated_awards_description()}
				</p>
			</div>
			<div class="space-y-2 border-t pt-3">
				<AwardSelectionColumn
					type="volunteer_nominated"
					zone="others"
					awardOptions={localState.volunteer_nominated}
					onFinalize={handleAwardOptionsFinalize}
				/>
			</div>
		</div>
	</div>

	<div class="flex justify-between pt-4">
		{#if !isLoading}
			<div class="flex space-x-3">
				<button
					onclick={() => {
						submit();
						onPrev();
					}}
					class="secondary">{m.back()}</button
				>
				{#if isJudgesRoomJoined}
					<button onclick={onCancel} class="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
						{m.cancel()}
					</button>
				{/if}
			</div>
			<button onclick={handleComplete} class="success">{m.complete_setup()}</button>
		{:else}
			<div></div>
			<button disabled class="success cursor-not-allowed opacity-75">
				<svg class="mr-2 inline h-4 w-4 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
					<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
					<path
						class="opacity-75"
						fill="currentColor"
						d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
					></path>
				</svg>
				Loading...
			</button>
		{/if}
	</div>
</div>
