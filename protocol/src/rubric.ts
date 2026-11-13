import { z } from 'zod';
import { AwardNameSchema } from './award';

export const SubmissionSchema = z.object({
	id: z.uuidv4(),
	judgeId: z.uuidv4()
});

export type Submission = z.infer<typeof SubmissionSchema>;

export const SubmissionCacheSchema = z.object({
	judgeGroupId: z.uuidv4(),
	teamId: z.uuidv4(),
	judgeId: z.uuidv4(),
	enrId: z.uuidv4().nullable(),
	tiId: z.uuidv4().nullable(),
	tnId: z.uuidv4().nullable(),
	score: z.number().nullable()
});

export type SubmissionCache = z.infer<typeof SubmissionCacheSchema>;

/**
 * A submission that no longer exists, announced to the judge group that held it.
 *
 * `submissionId` is the rubric or note id, which is also the key every client files the
 * submission under — so a client can drop it without knowing which of the three kinds it
 * was.
 *
 * Deliberately separate from the reviewed-team message rather than combined with it.
 * Submissions and reviewed teams are different subscription topics, and a device
 * subscribed to one and not the other must be able to act on what it receives without
 * being handed state it does not hold.
 */
export const SubmissionRemovalSchema = z.object({
	judgeGroupId: z.uuidv4(),
	teamId: z.uuidv4(),
	submissionId: z.uuidv4()
});

export type SubmissionRemoval = z.infer<typeof SubmissionRemovalSchema>;

/** Award candidate star rankings (0–5). Not used for rubric criterion scores. */
export const RankSchema = z.number().min(0).max(5);

export const RubricPointSchema = z.number().min(0);

export type RubricRowConfig = {
	messageKeyPrefix: string;
	maxPoints: number;
	/**
	 * The lowest score the rubric offers, which is not always zero.
	 *
	 * The notebook rubric's proficiency columns run 4/3/2/1 with no zero, so a zero is not
	 * a judgement it can express. Defaults to 0 for rubrics that do have one.
	 */
	minPoints?: number;
	categoryKey?: string;
	/**
	 * The "listen for" bullets printed under an interview criterion.
	 *
	 * Listed explicitly rather than derived from a count, so a missing translation is a
	 * missing key rather than a silently short list — the bullets are what tells a judge
	 * what the criterion is asking about, and three of four is not the same rubric.
	 *
	 * Unused by the notebook rubric, whose evidence lives in its proficiency columns.
	 */
	listenForKeys?: string[];
};

/**
 * Proficiency column header point values.
 *
 * v2.0 uses one scale for every criterion — Exemplary 4 down to Beginning 1, with no zero
 * column — where v1.0 varied the scale by section.
 */
export type NotebookProficiencyHeaderScale = '4_3_2_1';

export type NotebookRubricSectionConfig = {
	categoryKey: string;
	sectionMaxPoints: number;
	proficiencyHeaderScale: NotebookProficiencyHeaderScale;
	criteria: RubricRowConfig[];
};

/**
 * The Engineering Notebook Rubric, GRSF v2.0 (A4, 2026).
 *
 * 16 criteria over five sections, every one scored 4/3/2/1, totalling 64. Transcribed from
 * engineering-notebook-rubric-A4-v2.0.pdf; the wording is the rubric's, not a paraphrase,
 * because two judges reading different words are not applying the same rubric.
 */
export const notebookRubricSections: NotebookRubricSectionConfig[] = [
	{
		categoryKey: 'rubric_nb_cat_organization',
		sectionMaxPoints: 16,
		proficiencyHeaderScale: '4_3_2_1',
		criteria: [
			{ messageKeyPrefix: 'rubric_nb_org_reference', maxPoints: 4, minPoints: 1, categoryKey: 'rubric_nb_cat_organization' },
			{ messageKeyPrefix: 'rubric_nb_org_contributors', maxPoints: 4, minPoints: 1, categoryKey: 'rubric_nb_cat_organization' },
			{ messageKeyPrefix: 'rubric_nb_org_season', maxPoints: 4, minPoints: 1, categoryKey: 'rubric_nb_cat_organization' },
			{ messageKeyPrefix: 'rubric_nb_org_sources', maxPoints: 4, minPoints: 1, categoryKey: 'rubric_nb_cat_organization' }
		]
	},
	{
		categoryKey: 'rubric_nb_cat_define',
		sectionMaxPoints: 12,
		proficiencyHeaderScale: '4_3_2_1',
		criteria: [
			{ messageKeyPrefix: 'rubric_nb_define_criteria', maxPoints: 4, minPoints: 1, categoryKey: 'rubric_nb_cat_define' },
			{ messageKeyPrefix: 'rubric_nb_define_strategy', maxPoints: 4, minPoints: 1, categoryKey: 'rubric_nb_cat_define' },
			{ messageKeyPrefix: 'rubric_nb_define_brainstorm', maxPoints: 4, minPoints: 1, categoryKey: 'rubric_nb_cat_define' }
		]
	},
	{
		categoryKey: 'rubric_nb_cat_develop',
		sectionMaxPoints: 16,
		proficiencyHeaderScale: '4_3_2_1',
		criteria: [
			{ messageKeyPrefix: 'rubric_nb_develop_prototypes', maxPoints: 4, minPoints: 1, categoryKey: 'rubric_nb_cat_develop' },
			{ messageKeyPrefix: 'rubric_nb_develop_tests', maxPoints: 4, minPoints: 1, categoryKey: 'rubric_nb_cat_develop' },
			{ messageKeyPrefix: 'rubric_nb_develop_data', maxPoints: 4, minPoints: 1, categoryKey: 'rubric_nb_cat_develop' },
			{ messageKeyPrefix: 'rubric_nb_develop_decisions', maxPoints: 4, minPoints: 1, categoryKey: 'rubric_nb_cat_develop' }
		]
	},
	{
		categoryKey: 'rubric_nb_cat_optimize',
		sectionMaxPoints: 12,
		proficiencyHeaderScale: '4_3_2_1',
		criteria: [
			{ messageKeyPrefix: 'rubric_nb_optimize_mechanisms', maxPoints: 4, minPoints: 1, categoryKey: 'rubric_nb_cat_optimize' },
			{ messageKeyPrefix: 'rubric_nb_optimize_code', maxPoints: 4, minPoints: 1, categoryKey: 'rubric_nb_cat_optimize' },
			{ messageKeyPrefix: 'rubric_nb_optimize_changes', maxPoints: 4, minPoints: 1, categoryKey: 'rubric_nb_cat_optimize' }
		]
	},
	{
		categoryKey: 'rubric_nb_cat_reflection',
		sectionMaxPoints: 8,
		proficiencyHeaderScale: '4_3_2_1',
		criteria: [
			{ messageKeyPrefix: 'rubric_nb_reflect_throughout', maxPoints: 4, minPoints: 1, categoryKey: 'rubric_nb_cat_reflection' },
			{ messageKeyPrefix: 'rubric_nb_reflect_iteration', maxPoints: 4, minPoints: 1, categoryKey: 'rubric_nb_cat_reflection' }
		]
	}
];

export const notebookRubricConfig: RubricRowConfig[] = notebookRubricSections.flatMap((section) => section.criteria);

/**
 * What a judge can enter for one interview criterion.
 *
 * Three named columns rather than a range. v2.0 scores what was actually heard in the
 * conversation, and the distinction it draws is between a concrete answer, a general one
 * and no answer at all — which is a choice between three descriptions, not a position on
 * a scale. Ordered highest first, as the rubric prints them.
 */
export type InterviewEvidenceLevel = {
	points: number;
	/** Column heading, e.g. "Heard, with Specifics (2 points)". */
	headerKey: string;
	/** What that column means, e.g. "Team gave concrete details". */
	descriptionKey: string;
};

export const teamInterviewEvidenceLevels: InterviewEvidenceLevel[] = [
	{ points: 2, headerKey: 'rubric_ti_hdr_specifics', descriptionKey: 'rubric_ti_desc_specifics' },
	{ points: 1, headerKey: 'rubric_ti_hdr_heard', descriptionKey: 'rubric_ti_desc_heard' },
	{ points: 0, headerKey: 'rubric_ti_hdr_not_yet', descriptionKey: 'rubric_ti_desc_not_yet' }
];

export type TeamInterviewRubricSectionConfig = {
	categoryKey: string;
	sectionMaxPoints: number;
	/** The "choose 2–3" prompts printed above the section. */
	sampleQuestionKeys: string[];
	criteria: RubricRowConfig[];
};

/**
 * The Team Interview Rubric, GRSF v2.0 (A4, 2026).
 *
 * Six criteria over two sections, each scored 2/1/0, totalling 12 — where v1.0 had eight
 * criteria on varying scales totalling 100. That is a deliberate change of what is being
 * measured, not a rescaling: v2.0 asks only what the judges heard students say, and the
 * evidence columns are the same three for every criterion. Transcribed from
 * team-interview-rubric-A4-v2.0.pdf, in the rubric's own words.
 *
 * Note that scores recorded under v1.0 are not convertible. Eight numbers out of 100 do
 * not carry the information six out of 12 need, so an event mid-flight should not be
 * upgraded — deploy this between events.
 */
export const teamInterviewRubricSections: TeamInterviewRubricSectionConfig[] = [
	{
		categoryKey: 'rubric_ti_cat_explain',
		sectionMaxPoints: 6,
		sampleQuestionKeys: [
			'rubric_ti_q_explain_1',
			'rubric_ti_q_explain_2',
			'rubric_ti_q_explain_3',
			'rubric_ti_q_explain_4',
			'rubric_ti_q_explain_5'
		],
		criteria: [
			{
				messageKeyPrefix: 'rubric_ti_explain_own_work',
				maxPoints: 2,
				categoryKey: 'rubric_ti_cat_explain',
				listenForKeys: [
					'rubric_ti_explain_own_work_listen_1',
					'rubric_ti_explain_own_work_listen_2',
					'rubric_ti_explain_own_work_listen_3',
					'rubric_ti_explain_own_work_listen_4'
				]
			},
			{
				messageKeyPrefix: 'rubric_ti_explain_trace',
				maxPoints: 2,
				categoryKey: 'rubric_ti_cat_explain',
				listenForKeys: ['rubric_ti_explain_trace_listen_1', 'rubric_ti_explain_trace_listen_2', 'rubric_ti_explain_trace_listen_3']
			},
			{
				messageKeyPrefix: 'rubric_ti_explain_evidence',
				maxPoints: 2,
				categoryKey: 'rubric_ti_cat_explain',
				listenForKeys: ['rubric_ti_explain_evidence_listen_1', 'rubric_ti_explain_evidence_listen_2', 'rubric_ti_explain_evidence_listen_3']
			}
		]
	},
	{
		categoryKey: 'rubric_ti_cat_others',
		sectionMaxPoints: 6,
		sampleQuestionKeys: [
			'rubric_ti_q_others_1',
			'rubric_ti_q_others_2',
			'rubric_ti_q_others_3',
			'rubric_ti_q_others_4',
			'rubric_ti_q_others_5'
		],
		criteria: [
			{
				messageKeyPrefix: 'rubric_ti_others_learned',
				maxPoints: 2,
				categoryKey: 'rubric_ti_cat_others',
				listenForKeys: ['rubric_ti_others_learned_listen_1', 'rubric_ti_others_learned_listen_2', 'rubric_ti_others_learned_listen_3']
			},
			{
				messageKeyPrefix: 'rubric_ti_others_decisions',
				maxPoints: 2,
				categoryKey: 'rubric_ti_cat_others',
				listenForKeys: ['rubric_ti_others_decisions_listen_1', 'rubric_ti_others_decisions_listen_2', 'rubric_ti_others_decisions_listen_3']
			},
			{
				messageKeyPrefix: 'rubric_ti_others_outside_ideas',
				maxPoints: 2,
				categoryKey: 'rubric_ti_cat_others',
				listenForKeys: [
					'rubric_ti_others_outside_ideas_listen_1',
					'rubric_ti_others_outside_ideas_listen_2',
					'rubric_ti_others_outside_ideas_listen_3',
					'rubric_ti_others_outside_ideas_listen_4'
				]
			}
		]
	}
];

export const teamInterviewRubricConfig: RubricRowConfig[] = teamInterviewRubricSections.flatMap((section) => section.criteria);

export const NOTEBOOK_RUBRIC_CRITERIA_COUNT = notebookRubricConfig.length;
export const TEAM_INTERVIEW_RUBRIC_CRITERIA_COUNT = teamInterviewRubricConfig.length;

export const NOTEBOOK_RUBRIC_MAX_SCORE = notebookRubricConfig.reduce((sum, row) => sum + row.maxPoints, 0);
export const TEAM_INTERVIEW_RUBRIC_MAX_SCORE = teamInterviewRubricConfig.reduce((sum, row) => sum + row.maxPoints, 0);

/** What one criterion scores in the Proficient column of the 4/3/2/1 proficiency scale. */
const NOTEBOOK_PROFICIENT_POINTS = 3;

/**
 * The score at which GRSF suggests a notebook is Fully Developed: Proficient on average,
 * across every criterion. Derived rather than written as 48 so it follows the rubric.
 *
 * A guide and not a rule, which is the whole reason it is only ever shown beside the two
 * buttons rather than used to set the status. Where the line actually falls depends on what
 * was submitted at the event in front of the judge, and this application does not know that.
 */
export const NOTEBOOK_FULLY_DEVELOPED_BENCHMARK = NOTEBOOK_RUBRIC_CRITERIA_COUNT * NOTEBOOK_PROFICIENT_POINTS;

export function createEmptyNotebookRubricScores(): number[] {
	return Array(NOTEBOOK_RUBRIC_CRITERIA_COUNT).fill(-1);
}

export function createEmptyTeamInterviewRubricScores(): number[] {
	return Array(TEAM_INTERVIEW_RUBRIC_CRITERIA_COUNT).fill(-1);
}

/** Normalize a score to one decimal place. */
export function roundRubricScore(score: number): number {
	return Math.round(score * 10) / 10;
}

function randomRubricScore(maxPoints: number, minPoints = 0): number {
	// Whole points within the rubric's own range, matching what a judge can actually enter.
	// Generated fixtures showing 3.3, or a zero on a rubric with no zero column, would be
	// small permanent lies.
	return minPoints + Math.floor(Math.random() * (maxPoints - minPoints + 1));
}

export function generateNotebookRubricScores(): number[] {
	return notebookRubricConfig.map((row) => randomRubricScore(row.maxPoints, row.minPoints));
}

export function generateTeamInterviewRubricScores(): number[] {
	return teamInterviewRubricConfig.map((row) => randomRubricScore(row.maxPoints, row.minPoints));
}

/**
 * A rubric score as a judge should read it.
 *
 * A decimal only when the score has one. Both rubrics are now scored in whole points —
 * the GRSF proficiency columns are 3/2/1/0 and the like — and rendering those as "3.0"
 * invites the question of whether 3.1 exists.
 *
 * Scores saved before that change still hold tenths, and those keep their decimal rather
 * than being rounded away in the display. A submitted rubric showing 3 while its total
 * adds up as 3.3 would be a worse kind of wrong than an unexpected decimal.
 */
export function formatRubricScore(score: number): string {
	return Number.isInteger(score) ? String(score) : score.toFixed(1);
}

export function sumRubricScores(scores: number[]): number {
	const totalTenths = scores.reduce((sum, score) => sum + Math.round(score * 10), 0);
	return totalTenths / 10;
}

function validateRubricArray(scores: number[], config: RubricRowConfig[], path: string, ctx: z.RefinementCtx) {
	if (scores.length !== config.length) {
		ctx.addIssue({
			code: 'custom',
			path: [path],
			message: `Expected ${config.length} rubric scores, received ${scores.length}`
		});
		return;
	}

	for (let i = 0; i < scores.length; i++) {
		const score = scores[i];
		const maxPoints = config[i].maxPoints;
		const minPoints = config[i].minPoints ?? 0;
		if (score < minPoints || score > maxPoints) {
			ctx.addIssue({
				code: 'custom',
				path: [path, i],
				message: `Score must be between ${minPoints} and ${maxPoints}`
			});
		}
		// Whole points only.
		//
		// This used to allow one decimal place, from a time when the rubrics were scored on
		// wide ranges and a tenth was arguably a judgement. Neither v2.0 rubric has any such
		// thing: the notebook is four proficiency columns and the interview is three named
		// ones, so 1.5 on a criterion whose only meanings are "Heard, with Specifics",
		// "Heard" and "Not Yet Heard" does not describe anything a judge could have decided.
		//
		// Nothing stored is lost by tightening it. Both rubrics changed length in v2.0 — 26
		// criteria to 16, and 8 to 6 — so a submission carrying old fractional scores is
		// already rejected by the length check above.
		if (!Number.isInteger(score)) {
			ctx.addIssue({
				code: 'custom',
				path: [path, i],
				message: 'Score must be a whole number of points'
			});
		}
	}
}

const notebookRubricArraySchema = z.array(RubricPointSchema).length(NOTEBOOK_RUBRIC_CRITERIA_COUNT);
const teamInterviewRubricArraySchema = z.array(RubricPointSchema).length(TEAM_INTERVIEW_RUBRIC_CRITERIA_COUNT);

export const EngineeringNotebookRubricSchema = z
	.object({
		id: z.uuidv4(),
		teamId: z.uuidv4(),
		judgeId: z.uuidv4(),
		rubric: notebookRubricArraySchema,
		notes: z.string(),
		innovateAwardNotes: z.string(),
		timestamp: z.number()
	})
	.superRefine((data, ctx) => validateRubricArray(data.rubric, notebookRubricConfig, 'rubric', ctx));

export type EngineeringNotebookRubric = z.infer<typeof EngineeringNotebookRubricSchema>;

export const TeamInterviewRubricSchema = z
	.object({
		id: z.uuidv4(),
		teamId: z.uuidv4(),
		judgeId: z.uuidv4(),
		rubric: teamInterviewRubricArraySchema,
		notes: z.string(),
		timestamp: z.number()
	})
	.superRefine((data, ctx) => validateRubricArray(data.rubric, teamInterviewRubricConfig, 'rubric', ctx));

export type TeamInterviewRubric = z.infer<typeof TeamInterviewRubricSchema>;

export const TeamInterviewNoteSchema = z.object({
	id: z.uuidv4(),
	teamId: z.uuidv4(),
	judgeId: z.uuidv4(),
	rows: z.array(z.string()),
	timestamp: z.number()
});

export type TeamInterviewNote = z.infer<typeof TeamInterviewNoteSchema>;

export const AwardRankingsFullUpdateSchema = z.object({
	judgeGroupId: z.uuidv4(),
	judgedAwards: z.array(AwardNameSchema),
	// team id: [award 1 rank, award 2 rank, ...]
	rankings: z.record(z.uuidv4(), z.array(RankSchema))
});

export type AwardRankingsFullUpdate = z.infer<typeof AwardRankingsFullUpdateSchema>;

export const AwardRankingsPartialUpdateSchema = z.object({
	judgeGroupId: z.uuidv4(),
	teamId: z.uuidv4(),
	awardName: AwardNameSchema,
	ranking: RankSchema
});

export type AwardRankingsPartialUpdate = z.infer<typeof AwardRankingsPartialUpdateSchema>;

export const AwardNominationSchema = z.object({
	teamId: z.uuidv4(),
	judgeGroupId: z.uuidv4().nullable()
});

export type AwardNomination = z.infer<typeof AwardNominationSchema>;
