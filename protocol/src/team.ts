import { z } from 'zod';
import { GradeSchema } from './award';

export const TeamNumberSchema = z
	.string()
	.nonempty()
	.max(10)
	.regex(/^[A-Z0-9]+$/, {
		message: 'Team number must only contain uppercase letters (A-Z) and digits (0-9)'
	});

export const TeamGroupNameSchema = z
	.string()
	.nonempty()
	.max(100)
	.regex(/^\S.*\S$|^\S$/, {
		message: 'Team group name must not have leading or trailing whitespace'
	});

export const TeamInfoSchema = z.object({
	id: z.uuidv4(),
	number: TeamNumberSchema,
	name: z.string(),
	city: z.string(),
	state: z.string(),
	country: z.string(),
	shortName: z.string(),
	school: z.string(),
	grade: GradeSchema,
	group: TeamGroupNameSchema
});

export type TeamInfo = z.infer<typeof TeamInfoSchema>;

export const NotebookDevelopmentStatusSchema = z.enum(['undetermined', 'not_submitted', 'developing', 'fully_developed']);

export type NotebookDevelopmentStatus = z.infer<typeof NotebookDevelopmentStatusSchema>;

export const TeamDataSchema = z.object({
	id: z.uuidv4(),
	notebookLink: z.string(),
	hasInnovateAwardSubmissionForm: z.boolean(),
	notebookDevelopmentStatus: NotebookDevelopmentStatusSchema,
	/**
	 * Whether the notebook was handed in with a Season Summary.
	 *
	 * GRSF asks judges to score notebooks that arrived with one first, because a summary
	 * points at the entries behind each highlight and makes ten minutes enough; a notebook
	 * without one asks a judge to find the substance themselves. The flag exists to order
	 * the pile, and nothing else: the summaries are explicitly not scored, so this must
	 * never reach eligibility or a rubric.
	 *
	 * Recorded while scanning, alongside the development status. Absent means nobody has
	 * said either way, which is the same as false for ordering but is not a claim that the
	 * team failed to submit one.
	 */
	hasSeasonSummary: z.boolean(),
	absent: z.boolean()
});

export type TeamData = z.infer<typeof TeamDataSchema>;

export function isSubmittedNotebook(notebookDevelopmentStatus: NotebookDevelopmentStatus): boolean {
	return notebookDevelopmentStatus === 'fully_developed' || notebookDevelopmentStatus === 'developing';
}

/**
 * Whether a judge can open the notebook rubric for this team.
 *
 * Wider than isSubmittedNotebook, and deliberately not the same question. That one asks
 * how developed a notebook is, which is a judgement, and awards are still decided on it.
 * This one asks only whether there is a notebook here to read.
 *
 * A digital notebook arrives as a link, and the link is the evidence it exists. The sorting
 * step it would otherwise have to pass through was designed for a table of physical books a
 * judge can flick through in a few seconds; nobody can do that to thirty URLs, and telling
 * Developing from Fully Developed is something the rubric answers rather than something to
 * guess beforehand. So a link plus an undetermined status is enough to start scoring.
 *
 * Not_submitted is honoured, link or no link. That status is only ever set by a person, and
 * a judge who has said a team handed nothing in should not then be offered its rubric.
 */
export function canEnterNotebookRubric(team: Pick<TeamData, 'notebookDevelopmentStatus' | 'notebookLink'>): boolean {
	if (isSubmittedNotebook(team.notebookDevelopmentStatus)) {
		return true;
	}
	return team.notebookDevelopmentStatus === 'undetermined' && team.notebookLink.trim() !== '';
}

/**
 * The development status a team should carry once its notebook link becomes `newLink`.
 *
 * Not_submitted plus a working link is a dead end: the rubric is refused, so the team can
 * never be scored and never becomes eligible for anything, and nothing in the room tells
 * anyone why. That state is almost always a stale judgement rather than a deliberate one.
 * A notebook marked missing at the door, whose link then arrives in the Event Partner's
 * report, was not missing after all.
 *
 * So a link landing on a not_submitted team returns it to undetermined, which is honest:
 * nobody has looked at this notebook yet. It is not marked submitted, because whether it
 * was is still a judgement and this is a URL. Every other status is left alone, including
 * an unchanged link, so re-importing the same report decides nothing a second time and a
 * judge's Developing or Fully Developed is never overwritten.
 */
export function notebookStatusAfterLinkChange(
	team: Pick<TeamData, 'notebookDevelopmentStatus' | 'notebookLink'>,
	newLink: string
): NotebookDevelopmentStatus {
	if (team.notebookDevelopmentStatus !== 'not_submitted') {
		return team.notebookDevelopmentStatus;
	}
	const arrived = newLink.trim();
	if (arrived === '' || arrived === team.notebookLink.trim()) {
		return team.notebookDevelopmentStatus;
	}
	return 'undetermined';
}

/**
 * Whether a judge should still be asked how developed this notebook is.
 *
 * True for exactly the teams that reached a rubric without a judgement being recorded: the
 * link-only ones above, and anything scored in spite of being marked not_submitted. The
 * answer decides award eligibility, so it is asked for once the rubric is in rather than
 * inferred from the fact that one exists.
 */
export function needsDevelopmentStatusDecision(notebookDevelopmentStatus: NotebookDevelopmentStatus): boolean {
	return !isSubmittedNotebook(notebookDevelopmentStatus);
}

/**
 * Order a team list the way GRSF asks the pile to be worked through: notebooks submitted
 * with a Season Summary first, everything else after, and the existing order preserved
 * within each group.
 *
 * Stable rather than clever. Callers have already sorted by team number or by judge group
 * assignment, and this must not undo that — it only lifts one group above the other, so a
 * judge reading down the list still sees their own teams in the order they expect.
 */
export function bySeasonSummaryFirst<T extends { hasSeasonSummary: boolean }>(teams: readonly T[]): T[] {
	const withSummary = teams.filter((team) => team.hasSeasonSummary);
	const without = teams.filter((team) => !team.hasSeasonSummary);
	return [...withSummary, ...without];
}
