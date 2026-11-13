import { describe, expect, it } from 'vitest';
import {
	EngineeringNotebookRubricSchema,
	NOTEBOOK_FULLY_DEVELOPED_BENCHMARK,
	NOTEBOOK_RUBRIC_CRITERIA_COUNT,
	NOTEBOOK_RUBRIC_MAX_SCORE,
	TEAM_INTERVIEW_RUBRIC_CRITERIA_COUNT,
	TEAM_INTERVIEW_RUBRIC_MAX_SCORE,
	TeamInterviewRubricSchema,
	generateNotebookRubricScores,
	generateTeamInterviewRubricScores,
	notebookRubricConfig,
	notebookRubricSections,
	roundRubricScore,
	sumRubricScores,
	teamInterviewEvidenceLevels,
	teamInterviewRubricConfig,
	teamInterviewRubricSections
} from './rubric';

describe('GRSF rubric config', () => {
	it('has expected row counts', () => {
		expect(notebookRubricConfig).toHaveLength(NOTEBOOK_RUBRIC_CRITERIA_COUNT);
		expect(teamInterviewRubricConfig).toHaveLength(TEAM_INTERVIEW_RUBRIC_CRITERIA_COUNT);
	});

	// Pinned against engineering-notebook-rubric-A4-v2.0.pdf. These numbers are the whole
	// point of the rubric being correct, so they are asserted rather than derived.
	it('notebook rubric matches GRSF v2.0', () => {
		expect(NOTEBOOK_RUBRIC_MAX_SCORE).toBe(64);
		expect(NOTEBOOK_RUBRIC_CRITERIA_COUNT).toBe(16);
		expect(notebookRubricSections).toHaveLength(5);
		expect(notebookRubricSections.map((section) => section.sectionMaxPoints)).toEqual([16, 12, 16, 12, 8]);
	});

	// 16 criteria at Proficient. GRSF offers it as a guide to Fully Developed rather than a
	// threshold, which is why nothing in the application compares a score to it unprompted.
	it('puts the Fully Developed benchmark at 48 of 64', () => {
		expect(NOTEBOOK_FULLY_DEVELOPED_BENCHMARK).toBe(48);
		expect(NOTEBOOK_FULLY_DEVELOPED_BENCHMARK).toBeLessThan(NOTEBOOK_RUBRIC_MAX_SCORE);
	});

	it('every notebook criterion is scored 4 down to 1', () => {
		for (const row of notebookRubricConfig) {
			expect(row.maxPoints).toBe(4);
			// v2.0 has no zero column, so a zero is not a judgement the rubric can express.
			expect(row.minPoints).toBe(1);
		}
		for (const section of notebookRubricSections) {
			expect(section.proficiencyHeaderScale).toBe('4_3_2_1');
			// The header says how many points the section is worth; it must agree with the
			// criteria under it, or the printed rubric contradicts itself.
			expect(section.criteria.reduce((sum, row) => sum + row.maxPoints, 0)).toBe(section.sectionMaxPoints);
		}
	});

	// Pinned against team-interview-rubric-A4-v2.0.pdf, for the same reason as the notebook.
	it('interview rubric matches GRSF v2.0', () => {
		expect(TEAM_INTERVIEW_RUBRIC_MAX_SCORE).toBe(12);
		expect(TEAM_INTERVIEW_RUBRIC_CRITERIA_COUNT).toBe(6);
		expect(teamInterviewRubricSections).toHaveLength(2);
		expect(teamInterviewRubricSections.map((section) => section.sectionMaxPoints)).toEqual([6, 6]);
	});

	it('every interview criterion is scored 2, 1 or 0 against the same three columns', () => {
		for (const row of teamInterviewRubricConfig) {
			expect(row.maxPoints).toBe(2);
			// Unlike the notebook, v2.0 does have a zero: "Not Yet Heard".
			expect(row.minPoints ?? 0).toBe(0);
			// The listen-fors are what tell a judge what the criterion asks about, so a row
			// without any is a row that cannot be scored consistently.
			expect(row.listenForKeys?.length ?? 0).toBeGreaterThan(0);
		}
		expect(teamInterviewEvidenceLevels.map((level) => level.points)).toEqual([2, 1, 0]);
		for (const section of teamInterviewRubricSections) {
			expect(section.criteria.reduce((sum, row) => sum + row.maxPoints, 0)).toBe(section.sectionMaxPoints);
			// "Choose 2-3 questions" only means something if there are more than three.
			expect(section.sampleQuestionKeys.length).toBeGreaterThanOrEqual(3);
		}
	});
});

describe('GRSF rubric schemas', () => {
	const notebookSubmission = {
		id: '00000000-0000-4000-8000-000000000001',
		teamId: '00000000-0000-4000-8000-000000000002',
		judgeId: '00000000-0000-4000-8000-000000000003',
		rubric: generateNotebookRubricScores(),
		notes: '',
		innovateAwardNotes: '',
		timestamp: Date.now()
	};

	const interviewSubmission = {
		id: '00000000-0000-4000-8000-000000000001',
		teamId: '00000000-0000-4000-8000-000000000002',
		judgeId: '00000000-0000-4000-8000-000000000003',
		rubric: generateTeamInterviewRubricScores(),
		notes: '',
		timestamp: Date.now()
	};

	it('accepts valid notebook rubric', () => {
		expect(EngineeringNotebookRubricSchema.safeParse(notebookSubmission).success).toBe(true);
	});

	it('accepts valid interview rubric', () => {
		expect(TeamInterviewRubricSchema.safeParse(interviewSubmission).success).toBe(true);
	});

	it('rejects notebook rubric with wrong length', () => {
		const result = EngineeringNotebookRubricSchema.safeParse({
			...notebookSubmission,
			rubric: [1, 2, 3]
		});
		expect(result.success).toBe(false);
	});

	it('rejects scores above row max', () => {
		const rubric = generateNotebookRubricScores();
		rubric[0] = 99;
		const result = EngineeringNotebookRubricSchema.safeParse({
			...notebookSubmission,
			rubric
		});
		expect(result.success).toBe(false);
	});

	it('rejects a zero, which v2.0 has no column for', () => {
		const rubric = generateNotebookRubricScores();
		rubric[0] = 0;
		expect(EngineeringNotebookRubricSchema.safeParse({ ...notebookSubmission, rubric }).success).toBe(false);
	});

	it('accepts the lowest and highest the rubric allows', () => {
		for (const fill of [1, 4]) {
			const rubric = notebookRubricConfig.map(() => fill);
			expect(EngineeringNotebookRubricSchema.safeParse({ ...notebookSubmission, rubric }).success).toBe(true);
		}
	});

	it('rejects a v1.0 interview rubric', () => {
		// Eight scores out of 100. Worth asserting rather than assuming: the failure mode
		// this guards against is a v1.0 submission being accepted and silently counted as
		// though it were six criteria out of 12.
		const result = TeamInterviewRubricSchema.safeParse({
			...interviewSubmission,
			rubric: [20, 15, 15, 10, 10, 10, 10, 10]
		});
		expect(result.success).toBe(false);
	});

	it('accepts every interview score the rubric offers, and nothing above', () => {
		for (const fill of [0, 1, 2]) {
			const rubric = teamInterviewRubricConfig.map(() => fill);
			expect(TeamInterviewRubricSchema.safeParse({ ...interviewSubmission, rubric }).success).toBe(true);
		}
		const tooHigh = teamInterviewRubricConfig.map(() => 3);
		expect(TeamInterviewRubricSchema.safeParse({ ...interviewSubmission, rubric: tooHigh }).success).toBe(false);
	});

	it('rejects a fractional score on either rubric', () => {
		// In range, one decimal place, and meaningless: neither v2.0 rubric has a column
		// between two of its levels.
		const interview = teamInterviewRubricConfig.map((_, i) => (i === 0 ? 1.5 : 1));
		expect(TeamInterviewRubricSchema.safeParse({ ...interviewSubmission, rubric: interview }).success).toBe(false);

		const notebook = notebookRubricConfig.map((_, i) => (i === 0 ? 3.5 : 3));
		expect(EngineeringNotebookRubricSchema.safeParse({ ...notebookSubmission, rubric: notebook }).success).toBe(false);
	});
});

describe('rubric score precision', () => {
	it('roundRubricScore normalizes floating-point drift', () => {
		expect(roundRubricScore(53.000000000004)).toBe(53);
	});

	it('sumRubricScores avoids accumulation drift', () => {
		// 25 values chosen to provoke drift, not because any rubric has 25 criteria.
		const driftProneScores = Array.from({ length: 25 }, () => 2.1);
		const naiveSum = driftProneScores.reduce((sum, score) => sum + score, 0);
		expect(naiveSum).not.toBe(52.5);
		expect(sumRubricScores(driftProneScores)).toBe(52.5);
	});

	it('generateNotebookRubricScores produces whole scores inside the rubric range', () => {
		const rubric = generateNotebookRubricScores();
		expect(rubric).toHaveLength(NOTEBOOK_RUBRIC_CRITERIA_COUNT);
		for (let i = 0; i < rubric.length; i++) {
			const score = rubric[i];
			// The floor matters: asserting >= 0 would pass on a rubric whose lowest column
			// is 1, and quietly stop testing anything.
			expect(score).toBeGreaterThanOrEqual(notebookRubricConfig[i].minPoints ?? 0);
			expect(score).toBeLessThanOrEqual(notebookRubricConfig[i].maxPoints);
			expect(Number.isInteger(score)).toBe(true);
		}
		expect(
			EngineeringNotebookRubricSchema.safeParse({
				id: '00000000-0000-4000-8000-000000000001',
				teamId: '00000000-0000-4000-8000-000000000002',
				judgeId: '00000000-0000-4000-8000-000000000003',
				rubric,
				notes: '',
				innovateAwardNotes: '',
				timestamp: Date.now()
			}).success
		).toBe(true);
	});

	it('generateTeamInterviewRubricScores produces whole scores inside the rubric range', () => {
		const rubric = generateTeamInterviewRubricScores();
		expect(rubric).toHaveLength(TEAM_INTERVIEW_RUBRIC_CRITERIA_COUNT);
		for (let i = 0; i < rubric.length; i++) {
			const score = rubric[i];
			expect(score).toBeGreaterThanOrEqual(teamInterviewRubricConfig[i].minPoints ?? 0);
			expect(score).toBeLessThanOrEqual(teamInterviewRubricConfig[i].maxPoints);
			// v2.0 is scored 2, 1 or 0 — there is no fractional judgement to record.
			expect(Number.isInteger(score)).toBe(true);
			expect(score).toBe(roundRubricScore(score));
		}
		expect(
			TeamInterviewRubricSchema.safeParse({
				id: '00000000-0000-4000-8000-000000000001',
				teamId: '00000000-0000-4000-8000-000000000002',
				judgeId: '00000000-0000-4000-8000-000000000003',
				rubric,
				notes: '',
				timestamp: Date.now()
			}).success
		).toBe(true);
	});
});
