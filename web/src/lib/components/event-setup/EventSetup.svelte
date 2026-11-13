<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import JudgeAdvisorStep from './JudgeAdvisorStep.svelte';
	import CompetitionSetupStep from './CompetitionSetupStep.svelte';
	import AwardSelectionStep from './AwardSelectionStep.svelte';
	import TeamGroupsStep from './TeamGroupsStep.svelte';
	import JudgeSetupStep from './JudgeSetupStep.svelte';
	import { onMount } from 'svelte';
	import { app, AppUI, dialogs } from '$lib/index.svelte';
	import { AwardOptions, getOfficialAwardOptionsList, restoreAwardOptions } from '$lib/award.svelte';
	import { EditingJudgeGroup } from '$lib/judging.svelte';
	import { type TeamInfoAndData } from '$lib/team.svelte';
	import type { Program } from '@robotools.app/protocol/src/award';
	import type { EssentialData, EventGradeLevel } from '@robotools.app/protocol/src/event';
	import type { JudgingMethod, Judge, JudgingStep } from '@robotools.app/protocol/src/judging';
	import { getEventGradeLevelOptions } from '$lib/event.svelte';
	import EventCodeSetup from './EventCodeSetup.svelte';
	import AccessLinkDialog from '$lib/components/access/AccessLinkDialog.svelte';

	// Step management
	let currentStep = $state(0);
	let judgeAdvisorName = $state('');
	let judgeAdvisorEmail = $state('');
	// Six steps since the Judge Advisor step was added at the front. It asks who is running
	// the event, which nothing used to ask: the first advisor was created anonymously.

	let isEditingEventSetup = $state(false);

	// Six steps when creating an event, five when editing one.
	//
	// The Judge Advisor step at the front asks who is running the event and where to send
	// their link. Both are answered once, at creation: an existing event already has an
	// advisor, whose name and address are changed in the Users dialog rather than by
	// walking back through setup. Showing it while editing would offer a field that
	// silently does nothing.
	const firstStep = $derived(isEditingEventSetup ? 2 : 1);
	const totalSteps = $derived(isEditingEventSetup ? 5 : 6);
	/** Absolute number of the final step; the award step is always last. */
	const lastStep = 6;
	/**
	 * Access control is not optional for a new room.
	 *
	 * A Judges' Room holds deliberation data, and the alternative — a room anyone with the
	 * link can open, in any role — is not a setting worth offering by default. Making it
	 * the only answer removes a whole setup step and the decision that went with it.
	 *
	 * Existing rooms keep whatever they were set to: loadCurrentData overwrites this, and
	 * a room already running without access control is not something setup should silently
	 * switch on mid-event.
	 */
	let accessControlEnabled = $state(true);
	let wasAccessControlEnabled = $state(false);

	// RobotEvents import state
	let robotEventsSku: string | null = $state(null);
	let robotEventsEventId: number | null = $state(null);
	let divisionId: number | null = $state(null);

	// Event setup state
	let eventName: string = $state('My Event');
	let selectedProgram: Program = $state('V5RC');
	let selectedEventGradeLevel: EventGradeLevel = $state('Blended');

	// Teams
	let teams: TeamInfoAndData[] = $state([]);

	// Judging
	let judgingMethod: JudgingMethod = $state('assigned');
	let judgingStep: JudgingStep = $state('beginning');
	let judgeGroups: EditingJudgeGroup[] = $state([]);
	let judges: Judge[] = $state([]);
	let unassignedTeams: TeamInfoAndData[] = $state([]);

	let originalJudges = app.getAllJudges();

	// Award state - will be managed by the AwardSelectionStep
	let awardOptions: AwardOptions[] = $state([]);

	/**
	 * Load current data from app
	 */
	function loadCurrentData() {
		const eventSetup = app.getEssentialData();
		const allTeamData = app.getAllTeamData();
		const allJudges = app.getAllJudges();

		if (eventSetup) {
			// Seeded setup for a *new* division also arrives with essential data, so key this
			// off whether a room actually exists rather than off the data being present.
			isEditingEventSetup = app.isJudgesRoomJoined();

			// Load RobotEvents import info
			robotEventsSku = eventSetup.robotEventsSku;
			robotEventsEventId = eventSetup.robotEventsEventId;
			divisionId = eventSetup.divisionId;

			// Load event info
			eventName = eventSetup.eventName;
			selectedProgram = eventSetup.program;
			selectedEventGradeLevel = eventSetup.eventGradeLevel;

			// Load awards
			const gradeOptions = getEventGradeLevelOptions(selectedProgram);
			const possibleGrades = gradeOptions.find((g) => g.value === selectedEventGradeLevel)?.grades ?? [];
			const officialAwardOptions = getOfficialAwardOptionsList(selectedProgram, possibleGrades);
			awardOptions = restoreAwardOptions(eventSetup.awards, officialAwardOptions, selectedProgram);

			// Load teams
			teams = eventSetup.teamInfos.map((teamInfo) => {
				const teamData = allTeamData[teamInfo.id] || {
					id: teamInfo.id,
					notebookLink: '',
					hasInnovateAwardSubmissionForm: false,
					notebookDevelopmentStatus: 'undetermined' as const,
					hasSeasonSummary: false,
					absent: false
				};
				return { ...teamInfo, ...teamData } satisfies TeamInfoAndData;
			});

			// Load judging setup
			const assignedTeamIds = new Set<string>();

			judgingMethod = eventSetup.judgingMethod;
			judgingStep = eventSetup.judgingStep;
			accessControlEnabled = eventSetup.accessControlEnabled;
			wasAccessControlEnabled = eventSetup.accessControlEnabled;
			judgeGroups = eventSetup.judgeGroups.map((group) => {
				const judgeGroup = new EditingJudgeGroup(group.name);
				// Copy the properties instead of setting id directly
				Object.assign(judgeGroup, { id: group.id });

				judgeGroup.assignedTeams = group.assignedTeams.map((id) => teams.find((t) => t.id === id) ?? null).filter((t) => t !== null);

				return judgeGroup;
			});

			// Load judges
			judges = [...allJudges];

			// Update unassigned teams
			unassignedTeams = teams.filter((team) => !assignedTeamIds.has(team.id));
		}
	}

	function nextStep() {
		if (currentStep < lastStep) {
			currentStep++;
		}
	}

	function prevStep() {
		if (currentStep > firstStep) {
			currentStep--;
		}
	}

	async function cancelSetup() {
		// Editing an existing event: straight back to its workspace.
		if (app.isJudgesRoomJoined()) {
			AppUI.appPhase = 'workspace';
			return;
		}

		// Setting up an *additional* event: return to the one it was started from rather
		// than stranding the user on the start screen with their event apparently gone.
		if (await app.cancelAdditionalEvent()) {
			AppUI.appPhase = 'joining_judges_room';
			return;
		}

		AppUI.appPhase = 'begin';
	}

	async function completeSetup() {
		try {
			// Create the event setup object
			const essentialData = {
				robotEventsSku,
				robotEventsEventId,
				divisionId,
				eventName,
				program: selectedProgram,
				eventGradeLevel: selectedEventGradeLevel,
				judgingMethod,
				judgingStep,
				accessControlEnabled,
				teamInfos: teams.map((team) => ({
					id: team.id,
					number: team.number,
					name: team.name,
					city: team.city,
					state: team.state,
					country: team.country,
					shortName: team.shortName,
					school: team.school,
					grade: team.grade,
					group: team.group
				})),
				judgeGroups: judgeGroups.map((group) => ({
					id: group.id,
					name: group.name,
					assignedTeams: group.assignedTeams.map((team) => team.id)
				})),
				awards: awardOptions.filter((award) => award.isSelected).map((award) => award.generateAward())
			} satisfies EssentialData;

			// Redirect based on whether user is judging ready
			if (app.isJudgesRoomJoined()) {
				await app.wrpcClient.essential.updateEssentialData.mutation(essentialData);
				await app.wrpcClient.team.updateAllTeamData.mutation(
					teams.map((team) => ({
						id: team.id,
						notebookLink: team.notebookLink,
						hasInnovateAwardSubmissionForm: team.hasInnovateAwardSubmissionForm,
						notebookDevelopmentStatus: team.notebookDevelopmentStatus,
						hasSeasonSummary: team.hasSeasonSummary,
						absent: team.absent
					}))
				);

				// Just in case: keep judges that are created during the event setup
				const currentJudges = app.getAllJudges();
				const newJudges = currentJudges
					.filter((judge) => !originalJudges.some((originalJudge) => originalJudge.id === judge.id))
					.filter((judge) => judgeGroups.some((group) => group.id === judge.groupId));

				await app.wrpcClient.judge.updateAllJudges.mutation([...newJudges, ...judges]);

				AppUI.appPhase = 'workspace';

				if (accessControlEnabled && !wasAccessControlEnabled) {
					const accessLink = app.getJudgesRoomUrl();
					await dialogs.showCustom(AccessLinkDialog, {
						props: { link: accessLink, audience: 'self' as const, name: judgeAdvisorName },
						maxWidth: 'max-w-xl'
					});
				}
			} else {
				app.handleEssentialDataUpdate(essentialData);
				app.handleAllTeamDataUpdate(
					teams.map((team) => ({
						id: team.id,
						notebookLink: team.notebookLink,
						hasInnovateAwardSubmissionForm: team.hasInnovateAwardSubmissionForm,
						notebookDevelopmentStatus: team.notebookDevelopmentStatus,
						hasSeasonSummary: team.hasSeasonSummary,
						absent: team.absent
					}))
				);
				app.handleAllJudgesUpdate(judges);

				// No PIN. Each person now holds their own link, which is emailed rather than
				// read out, so the link is the credential — see the note in essential.ts.
				await app.createJudgesRoom(judgeAdvisorName, judgeAdvisorEmail || null);
				if (accessControlEnabled) {
					app.setCurrentUserLocally({ role: 'judge_advisor' });
				} else {
					await app.selectUser({ role: 'judge_advisor' });
				}

				AppUI.appPhase = 'workspace';

				if (accessControlEnabled) {
					const accessLink = app.getJudgesRoomUrl();
					await dialogs.showCustom(AccessLinkDialog, {
						props: { link: accessLink, audience: 'self' as const, name: judgeAdvisorName },
						maxWidth: 'max-w-xl'
					});
				}
			}
		} catch (error) {
			console.error('Failed to complete setup:', error);
			// You might want to show an error message to the user here
			// TODO: This will be a major issue, ask the user to report the issue to the developer
		}
	}

	// Initialize component
	onMount(async () => {
		// Load current data from app
		loadCurrentData();

		currentStep = firstStep; // IMPORTANT: set after loading, since it depends on edit mode
	});
</script>

<svelte:head>
	<title>{m.event_setup()} | Judges' Room</title>
</svelte:head>

<div class="h-full overflow-auto bg-slate-100 p-2 md:p-6">
	<div class="mx-auto max-w-5xl space-y-2 md:space-y-6">
		<!-- Step Indicator -->
		<div class="mb-4 md:mb-8">
			<!-- Mobile: Simple text indicator -->
			<div class="flex items-center justify-between md:hidden">
				<h1 class="text-xl font-bold text-gray-900">{m.event_setup()}</h1>
				<div class="text-sm font-medium text-gray-600">
					{m.step_of({ current: currentStep - firstStep + 1, total: totalSteps })}
				</div>
			</div>

			<!-- Desktop: Full visual indicator -->
			<div class="hidden items-center justify-between md:flex">
				<h1 class="text-3xl font-bold text-gray-900">{m.event_setup()}</h1>
				<div class="flex items-center">
					{#each Array(totalSteps) as _, i (i)}
						<div class="flex items-center">
							<div
								class="flex h-8 w-8 items-center justify-center rounded-full text-sm font-medium transition-colors"
								class:bg-primary={i + firstStep <= currentStep}
								class:text-on-primary={i + firstStep <= currentStep}
								class:bg-gray-200={i + firstStep > currentStep}
								class:text-gray-500={i + firstStep > currentStep}
							>
								{i + 1}
							</div>
							{#if i < totalSteps - 1}
								<div
									class="mx-2 h-0.5 w-12 transition-colors"
									class:bg-primary={i + firstStep < currentStep}
									class:bg-gray-200={i + firstStep >= currentStep}
								></div>
							{/if}
						</div>
					{/each}
				</div>
			</div>
		</div>

		<!-- Step Content -->
		<div class="rounded-lg bg-white p-6 shadow-sm">
			{#if currentStep === 1}
				<JudgeAdvisorStep bind:name={judgeAdvisorName} bind:email={judgeAdvisorEmail} onNext={nextStep} onCancel={cancelSetup} />
			{:else if currentStep === 2}
				<EventCodeSetup
					{isEditingEventSetup}
					bind:robotEventsSku
					bind:robotEventsEventId
					bind:divisionId
					bind:eventName
					bind:selectedProgram
					bind:selectedEventGradeLevel
					bind:teams
					bind:awardOptions
					onNext={nextStep}
					onCancel={cancelSetup}
				/>
			{:else if currentStep === 3}
				<CompetitionSetupStep
					{robotEventsEventId}
					bind:eventName
					bind:selectedProgram
					bind:selectedEventGradeLevel
					bind:teams
					bind:awardOptions
					onNext={nextStep}
					onPrev={prevStep}
				/>
			{:else if currentStep === 4}
				<TeamGroupsStep bind:teams onNext={nextStep} onPrev={prevStep} />
			{:else if currentStep === 5}
				<JudgeSetupStep
					{isEditingEventSetup}
					{teams}
					bind:judgingMethod
					bind:judgeGroups
					bind:judges
					bind:unassignedTeams
					onNext={nextStep}
					onPrev={prevStep}
				/>
			{:else if currentStep === 6}
				<!-- The last step. There was a sixth for "other settings", but the only setting
				     on it was whether to turn access control on, and that is no longer a
				     question — so completing the setup happens here. -->
				<AwardSelectionStep
					{selectedProgram}
					{selectedEventGradeLevel}
					bind:allAwardOptions={awardOptions}
					onComplete={completeSetup}
					onCancel={cancelSetup}
					onPrev={prevStep}
					isJudgesRoomJoined={app.isJudgesRoomJoined()}
				/>
			{/if}
		</div>
	</div>
</div>

<style lang="postcss">
	@reference '../../../app.css';

	:global {
		body {
			@apply bg-slate-100;
		}
	}
</style>
