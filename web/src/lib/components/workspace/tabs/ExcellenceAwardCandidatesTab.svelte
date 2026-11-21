<script lang="ts">
	import RefNotesBadge from './RefNotesBadge.svelte';
	import TeamScreeningButton from './TeamScreeningButton.svelte';
	import { m } from '$lib/paraglide/messages.js';
	import './eligibility-table.css';
	import type { ExcellenceAwardCandidatesTab } from '$lib/tab.svelte';
	import { app } from '$lib/index.svelte';
	import {
		getEventDivisionExcellenceAwardCandidatesReport,
		getRobotEventsClient,
		sortByTeamNumberAndEligibility,
		type ExcellenceAwardTeamEligibility,
		type ExcellenceAwardCandidatesReport
	} from '$lib/robotevents-source';
	import { isExcellenceAward } from '@robotools.app/protocol/src/award';
	import RefreshIcon from '$lib/icon/RefreshIcon.svelte';
	import { sanitizeHTMLMessage } from '$lib/i18n';
	import { MediaQuery } from 'svelte/reactivity';
	import { rankTeamsByInterview, type InterviewStanding } from '$lib/interview-rank';
	import type { TeamInterviewScore } from '@robotools.app/protocol/src/rubric';
	import type { NotebookDevelopmentStatus } from '@robotools.app/protocol/src/team';

	interface Props {
		tab: ExcellenceAwardCandidatesTab;
		isActive: boolean;
	}

	let isFetching = $state(false);
	let { tab, isActive }: Props = $props();
	let reports = $state<Record<string, ExcellenceAwardCandidatesReport>>({});
	let interviewScores = $state<TeamInterviewScore[]>([]);

	const essentialData = $derived(app.getEssentialData());
	const hasRobotEventsId = $derived(!!essentialData?.robotEventsEventId && !!essentialData?.divisionId);
	const excellenceAwards = $derived(app.getAllAwards().filter((a) => isExcellenceAward(a.name)));

	/**
	 * Whether the event has reached award deliberations.
	 *
	 * This view is available before that point on purpose: eligibility is a live picture
	 * that firms up as qualification and skills progress, and it is more use watched during
	 * the day than met for the first time at deliberations. What it cannot be before then is
	 * final, so it says so rather than letting a half-run event look decided.
	 */
	const isAwardDeliberationStarted = $derived(essentialData?.judgingStep === 'award_deliberations');

	/** RobotEvents knows teams by number, and the room's own records are keyed by id. */
	const roomTeamsByNumber = $derived(new Map(Object.values(app.getAllTeamInfoAndData()).map((team) => [team.number, team])));

	function getNotebookIndicator(status: NotebookDevelopmentStatus | undefined) {
		if (status === 'fully_developed')
			return { text: m.fully_developed_notebook_status(), dot: 'bg-green-500', textClass: 'text-green-500' };
		if (status === 'developing') return { text: m.developing_notebook_status(), dot: 'bg-amber-400', textClass: '' };
		return { text: m.no_notebook_or_not_reviewed(), dot: 'bg-gray-300', textClass: 'text-gray-500' };
	}

	async function fetchInterviewScores() {
		try {
			interviewScores = await app.wrpcClient.judging.getTeamInterviewScores.query();
		} catch (error) {
			console.error('Failed to load interview scores:', error);
		}
	}

	async function fetchExcellenceAwardTeamEligibility() {
		if (!essentialData) return;
		const { robotEventsEventId, divisionId } = essentialData;
		if (!robotEventsEventId || !divisionId) return;

		isFetching = true;
		void fetchInterviewScores();
		try {
			const client = getRobotEventsClient();
			const result = await getEventDivisionExcellenceAwardCandidatesReport(client, robotEventsEventId, divisionId, excellenceAwards);

			if (result.error) {
				console.error('Failed to get event from RobotEvents:', result.error);
				app.addErrorNotice(m.failed_to_get_event_from_robotevents());
				return;
			}

			reports = result;
			// $inspect(eligibilityReport);
		} catch (error) {
			// TODO show alert
			console.error('Failed to get event from RobotEvents', error);
		} finally {
			isFetching = false;
		}
	}

	$effect(() => {
		if (isActive && essentialData) {
			fetchExcellenceAwardTeamEligibility();
		}
	});

	/** Below this the explanations start folded away. */
	const isWide = new MediaQuery('min-width: 768px');
</script>

{#snippet qualificationValue(team: ExcellenceAwardTeamEligibility)}
	#{team.qualRanking.no}
{/snippet}

{#snippet skillsValue(entry: ExcellenceAwardTeamEligibility['overallSkills'])}
	{#if entry.result === 'no data'}
		No Data
	{:else}
		#{entry.no} [Score: {entry.score}]
	{/if}
{/snippet}

{#snippet notebookValue(notebook: ReturnType<typeof getNotebookIndicator>)}
	<span class="h-2.5 w-2.5 shrink-0 rounded-full {notebook.dot}"></span>
	{notebook.text}
{/snippet}

{#snippet interviewValue(interview: InterviewStanding | undefined)}
	{#if interview}
		{m.excellence_interview_rank_value({ rank: interview.rank, average: Math.round(interview.average * 10) / 10 })}
	{:else}
		<span class="text-gray-500">{m.excellence_not_interviewed()}</span>
	{/if}
{/snippet}

<div class="h-full overflow-auto p-2 md:p-6">
	<div class="mx-auto max-w-6xl space-y-2 md:space-y-6">
		{#if essentialData && hasRobotEventsId && !isAwardDeliberationStarted}
			<div class="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
				{m.excellence_award_candidates_provisional()}
			</div>
		{/if}

		<!-- Header -->
		{#if essentialData && hasRobotEventsId}
			<div class="rounded-lg bg-white p-4 shadow-sm md:p-6">
				<div class="mb-2 flex flex-col items-start justify-between gap-2 sm:flex-row sm:gap-3">
					<div>
						<h2 class="text-xl font-semibold text-gray-900 sm:mb-2">{m.excellence_award_candidates()}</h2>
					</div>
					{#if hasRobotEventsId}
						<button onclick={fetchExcellenceAwardTeamEligibility} disabled={isFetching} class="lightweight tiny flex items-center gap-2">
							{#if isFetching}
								<RefreshIcon class="h-4 w-4 animate-spin" />
								<span class="text-nowrap">{m.fetching()}</span>
							{:else}
								<RefreshIcon class="h-4 w-4" />
								<span class="text-nowrap">{m.refresh_from_robotevents()}</span>
							{/if}
						</button>
					{/if}
				</div>
				<details class="text-sm text-gray-600" open={isWide.current}>
					<summary class="mb-2 cursor-pointer font-medium text-gray-700">{m.excellence_about_these_standings()}</summary>
					<p class="mb-2">
						{m.excellence_award_candidates_description1()}
					</p>
					<p class="mb-2">
						{m.excellence_award_candidates_description2()}
					</p>
					<p class="mb-2">
						{m.excellence_award_candidates_description3()}
					</p>
					<p class="mb-2">
						{m.excellence_award_candidates_description4()}
					</p>
					<p class="mb-2">{m.excellence_award_candidates_description5()}</p>
					<p class="mb-2">
						{m.event_code_colon()}<a
							class="text-blue-500 hover:text-blue-600"
							href={`https://events.vex.com/${essentialData.robotEventsSku}.html`}
							target="_blank">{essentialData.robotEventsSku}</a
						><br />{m.division_colon()}{essentialData.divisionId}
					</p>
				</details>
			</div>
			{#each Object.entries(reports) as [awardName, report] (awardName)}
				{@const award = excellenceAwards.find((a) => a.name === awardName)!}
				{@const isSingleGrade = award.acceptedGrades.length === 1}
				{@const teamsInGroupCount = report.teamsInGroup.length}
				{@const rankingEligibilityIntermediate = (teamsInGroupCount * 0.4).toFixed(2)}
				{@const skillsEligibilityIntermediate = (report.joinedTeamsInEventCount * 0.4).toFixed(2)}
				{@const rankingEligibilityThreshold = report.rankingEligibilityThreshold}
				{@const skillsEligibilityThreshold = report.skillsEligibilityThreshold}
				{@const divisionId = essentialData?.divisionId}
				{@const teams = sortByTeamNumberAndEligibility(report.teamsInGroup)}
				{@const eligibleTeams = teams.filter((t) => t.isEligible)}
				{@const interviewStandings = rankTeamsByInterview(
					interviewScores,
					teams.flatMap((t) => roomTeamsByNumber.get(t.teamNumber)?.id ?? [])
				)}
				<div class="mb-2 rounded-lg bg-white p-4 shadow-sm md:p-6">
					<h3 class="mb-2 text-lg font-semibold text-gray-900">{awardName}</h3>
					<div class="mb-3 space-y-2 text-sm text-gray-600">
						<details class="space-y-2" open={isWide.current}>
							<summary class="cursor-pointer font-medium text-gray-700">{m.excellence_how_eligibility_works()}</summary>
							{#if isSingleGrade}
								<p>
									<!-- There are {teamsInGroupCount} teams in the {award.acceptedGrades[0]} grade level <b>in Division {divisionId}</b>. At the
								conclusion of Qualification Matches, teams must be ranked in the top 40% of teams in this group in Qualification Match
								rankings. This is calculated by {teamsInGroupCount} * 40% = {rankingEligibilityIntermediate} rounded to {rankingEligibilityThreshold}
								teams. -->
									{@html sanitizeHTMLMessage(m.excellence_award_candidates_description6, {
										teamsInGroupCount,
										acceptedGrade: award.acceptedGrades[0],
										divisionId: divisionId ?? 'N/A',
										rankingEligibilityIntermediate,
										rankingEligibilityThreshold
									})}
								</p>
								<p>
									<!-- There are {report.joinedTeamsInEventCount} teams in the {award.acceptedGrades[0]} grade level <b>at the event</b>. This is
								the number of teams that actually arrived and participated in Qualification Matches. At the conclusion of the Robot Skills
								Challenge matches, teams must be ranked in the top 40% of all {award.acceptedGrades[0]} teams at the event. This is calculated
								by {report.joinedTeamsInEventCount} * 40% = {skillsEligibilityIntermediate} rounded to {skillsEligibilityThreshold} teams. -->
									{@html sanitizeHTMLMessage(m.excellence_award_candidates_description7, {
										joinedTeamsInEventCount: report.joinedTeamsInEventCount,
										acceptedGrade: award.acceptedGrades[0],
										skillsEligibilityIntermediate,
										skillsEligibilityThreshold
									})}
								</p>
								<p>
									<!-- At the conclusion of the Autonomous Coding Skills Challenge matches, teams must be with a score above 0 and ranked in the
								top 40% of all {award.acceptedGrades[0]} teams at the event. This is calculated by {report.joinedTeamsInEventCount}
								* 40% = {skillsEligibilityIntermediate} rounded to {skillsEligibilityThreshold} teams. -->
									{@html sanitizeHTMLMessage(m.excellence_award_candidates_description8, {
										joinedTeamsInEventCount: report.joinedTeamsInEventCount,
										acceptedGrade: award.acceptedGrades[0],
										skillsEligibilityIntermediate,
										skillsEligibilityThreshold
									})}
								</p>
							{:else}
								<p>
									<!-- There are {teamsInGroupCount} teams in all grade levels <b>in Division {divisionId}</b>. At the conclusion of Qualification
								Matches, teams must be ranked in the top 40% of teams in this group in Qualification Match rankings. This is calculated by {teamsInGroupCount}
								* 40% = {rankingEligibilityIntermediate}
								rounded to {rankingEligibilityThreshold} teams. -->
									{@html sanitizeHTMLMessage(m.excellence_award_candidates_description9, {
										teamsInGroupCount,
										divisionId: divisionId ?? 'N/A',
										rankingEligibilityIntermediate,
										rankingEligibilityThreshold
									})}
								</p>
								<p>
									<!-- There are {report.joinedTeamsInEventCount} teams in all grade levels <b>at the event</b>. This is the number of teams that
								actually arrived and participated in Qualification Matches. At the conclusion of the Robot Skills Challenge matches, teams
								must be ranked in the top 40% of all teams at the event. This is calculated by {report.joinedTeamsInEventCount} * 40% = {skillsEligibilityIntermediate}
								rounded to {skillsEligibilityThreshold} teams. -->
									{@html sanitizeHTMLMessage(m.excellence_award_candidates_description10, {
										joinedTeamsInEventCount: report.joinedTeamsInEventCount,
										skillsEligibilityIntermediate,
										skillsEligibilityThreshold
									})}
								</p>
								<p>
									<!-- At the conclusion of the Autonomous Coding Skills Challenge matches, teams must be with a score above 0 and ranked in the
								top 40% of all teams at the event. This is calculated by {report.joinedTeamsInEventCount} * 40% = {skillsEligibilityIntermediate}
								rounded to {skillsEligibilityThreshold} teams. -->
									{@html sanitizeHTMLMessage(m.excellence_award_candidates_description11, {
										joinedTeamsInEventCount: report.joinedTeamsInEventCount,
										skillsEligibilityIntermediate,
										skillsEligibilityThreshold
									})}
								</p>
							{/if}
							<p>{m.excellence_interview_rank_description()}</p>
						</details>
						{#if eligibleTeams.length > 0}
							<p>
								{m.teams_eligible_for_excellence_colon()}{#each eligibleTeams as team, index (team.teamNumber)}
									<span class="text-green-500">{team.teamNumber}</span>{#if index < eligibleTeams.length - 1},&nbsp;
									{/if}
								{/each}
							</p>
						{:else}
							<p>{m.no_teams_are_eligible_for_this_award()}</p>
						{/if}
					</div>

					<!-- A card per team, so no result is ever hidden off to the side. -->
					<ul class="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
						{#each teams as team (team.teamNumber)}
							{@const roomTeam = roomTeamsByNumber.get(team.teamNumber)}
							{@const notebook = getNotebookIndicator(roomTeam?.notebookDevelopmentStatus)}
							{@const interview = roomTeam ? interviewStandings.get(roomTeam.id) : undefined}
							<li class="rounded-lg border p-3 {team.isEligible ? 'border-green-500' : 'border-gray-200'}">
								<div class="flex items-center gap-2">
									<span class="text-base font-semibold" class:text-green-500={team.isEligible}>{team.teamNumber}</span>
									{#if team.isEligible}
										<span class="rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700">{m.excellence_eligible()}</span>
									{/if}
									<RefNotesBadge teamNumber={team.teamNumber} />
									{#if roomTeam}
										<span class="ml-auto">
											<TeamScreeningButton teamId={roomTeam.id} teamNumber={team.teamNumber} />
										</span>
									{/if}
								</div>
								<dl class="mt-2 grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
									<div>
										<dt class="text-xs text-gray-500">{m.qualification_rank()}</dt>
										<dd class:text-green-500={team.qualRanking.result === 'eligible'}>{@render qualificationValue(team)}</dd>
									</div>
									<div>
										<dt class="text-xs text-gray-500">{m.overall_skills_rank()}</dt>
										<dd class:text-green-500={team.overallSkills.result === 'eligible'}>{@render skillsValue(team.overallSkills)}</dd>
									</div>
									<div>
										<dt class="text-xs text-gray-500">{m.autonomous_coding_skills_rank()}</dt>
										<dd class:text-green-500={team.autoSkills.result === 'eligible'}>{@render skillsValue(team.autoSkills)}</dd>
									</div>
									<div>
										<dt class="text-xs text-gray-500">{m.excellence_notebook_status()}</dt>
										<dd class="flex items-start gap-1.5 {notebook.textClass} [&>span]:mt-1.5">{@render notebookValue(notebook)}</dd>
									</div>
									<div>
										<dt class="text-xs text-gray-500">{m.excellence_interview_rank()}</dt>
										<dd>{@render interviewValue(interview)}</dd>
									</div>
								</dl>
							</li>
						{/each}
					</ul>
				</div>
			{/each}
		{:else}
			<div class="flex flex-col items-center justify-center">
				<p class="text-center text-gray-500">
					{m.judges_room_not_connected_to_robotevents()}
				</p>
			</div>
		{/if}
	</div>
</div>
