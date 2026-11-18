<script lang="ts">
	import RefNotesBadge from './RefNotesBadge.svelte';
	import TeamScreeningButton from './TeamScreeningButton.svelte';
	import { m } from '$lib/paraglide/messages.js';
	import './eligibility-table.css';
	import type { ExcellenceAwardCandidatesTab } from '$lib/tab.svelte';
	import { scrollSync } from '$lib/scroll-sync.svelte';
	import { app } from '$lib/index.svelte';
	import {
		getEventDivisionExcellenceAwardCandidatesReport,
		getRobotEventsClient,
		sortByTeamNumberAndEligibility,
		type ExcellenceAwardCandidatesReport
	} from '$lib/robotevents-source';
	import { isExcellenceAward } from '@robotools.app/protocol/src/award';
	import RefreshIcon from '$lib/icon/RefreshIcon.svelte';
	import { sanitizeHTMLMessage } from '$lib/i18n';
	import { rankTeamsByInterview } from '$lib/interview-rank';
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

	const { registerScrollContainer, scrollLeft, scrollRight } = scrollSync();
</script>

<div class="h-full overflow-auto p-2 md:p-6">
	<div class="mx-auto max-w-5xl space-y-2 md:space-y-6">
		{#if essentialData && hasRobotEventsId && !isAwardDeliberationStarted}
			<div class="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
				{m.excellence_award_candidates_provisional()}
			</div>
		{/if}

		<!-- Header -->
		{#if essentialData && hasRobotEventsId}
			<div class="rounded-lg bg-white p-6 shadow-sm">
				<div class="mb-2 flex flex-row items-start justify-between gap-3">
					<div>
						<h2 class="mb-2 text-xl font-semibold text-gray-900">{m.excellence_award_candidates()}</h2>
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
				<div class="text-sm text-gray-600">
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
				</div>
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
				<div class="mb-2 rounded-lg bg-white p-6 shadow-sm">
					<h3 class="mb-2 text-lg font-semibold text-gray-900">{awardName}</h3>
					<div class="mb-2 space-y-2 text-sm text-gray-600">
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
						<p>{m.excellence_interview_rank_description()}</p>
					</div>
					<div>
						<award-rankings-table>
							<table-header>
								<team>{m.team_number()}</team>
								<scroll-container use:registerScrollContainer class="bg-gray-200">
									<content>
										<div class="flex min-h-14 max-w-1/3 min-w-40 items-center justify-center p-2 text-center">{m.qualification_rank()}</div>
										<div class="flex min-h-14 max-w-1/3 min-w-40 items-center justify-center p-2 text-center">
											{m.overall_skills_rank()}
										</div>
										<div class="flex min-h-14 max-w-1/3 min-w-40 items-center justify-center p-2 text-center">
											{m.autonomous_coding_skills_rank()}
										</div>
										<div class="flex min-h-14 max-w-1/3 min-w-40 items-center justify-center p-2 text-center">
											{m.excellence_notebook_status()}
										</div>
										<div class="flex min-h-14 max-w-1/3 min-w-40 items-center justify-center p-2 text-center">
											{m.excellence_interview_rank()}
										</div>
									</content>
								</scroll-container>
							</table-header>
							<table-body>
								{#each teams as team (team.teamNumber)}
									{@const roomTeam = roomTeamsByNumber.get(team.teamNumber)}
									{@const notebook = getNotebookIndicator(roomTeam?.notebookDevelopmentStatus)}
									{@const interview = roomTeam ? interviewStandings.get(roomTeam.id) : undefined}
									<row>
										<team>
											<div class="flex items-center gap-1" class:text-green-500={team.isEligible}>
												{team.teamNumber}
												<RefNotesBadge teamNumber={team.teamNumber} />
												{#if roomTeam}
													<TeamScreeningButton teamId={roomTeam.id} teamNumber={team.teamNumber} />
												{/if}
											</div>
										</team>
										<scroll-container use:registerScrollContainer>
											<content>
												<div class="min-w-40 border-black text-center" class:text-green-500={team.qualRanking.result === 'eligible'}>
													#{team.qualRanking.no}
												</div>
												<div class="min-w-40 border-black text-center" class:text-green-500={team.overallSkills.result === 'eligible'}>
													{#if team.overallSkills.result === 'no data'}
														No Data
													{:else}
														#{team.overallSkills.no} [Score: {team.overallSkills.score}]
													{/if}
												</div>
												<div class="min-w-40 border-black text-center" class:text-green-500={team.autoSkills.result === 'eligible'}>
													{#if team.autoSkills.result === 'no data'}
														No Data
													{:else}
														#{team.autoSkills.no} [Score: {team.autoSkills.score}]
													{/if}
												</div>
												<div class="flex min-w-40 items-center justify-center gap-2 border-black text-center {notebook.textClass}">
													<span class="h-2.5 w-2.5 shrink-0 rounded-full {notebook.dot}"></span>
													{notebook.text}
												</div>
												<div class="min-w-40 border-black text-center">
													{#if interview}
														{m.excellence_interview_rank_value({ rank: interview.rank, average: Math.round(interview.average * 10) / 10 })}
													{:else}
														<span class="text-gray-500">{m.excellence_not_interviewed()}</span>
													{/if}
												</div>
											</content>
										</scroll-container>
									</row>
								{/each}
							</table-body>
						</award-rankings-table>
					</div>
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
