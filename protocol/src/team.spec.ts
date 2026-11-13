import { describe, it, expect } from 'vitest';
import {
	TeamNumberSchema,
	TeamGroupNameSchema,
	TeamInfoSchema,
	TeamDataSchema,
	bySeasonSummaryFirst,
	canEnterNotebookRubric,
	notebookStatusAfterLinkChange,
	needsDevelopmentStatusDecision,
	type NotebookDevelopmentStatus
} from './team';
import type { Grade } from './award';
import { uuidv4 } from './utils';

describe('Teams Schema Validation', () => {
	describe('TeamNumberSchema', () => {
		it('should validate correct team numbers', () => {
			const validNumbers = ['123A', 'ABCD', '1234E', 'ABC123', 'Z', '1', '12345ABCDE'];
			validNumbers.forEach((number) => {
				expect(() => TeamNumberSchema.parse(number)).not.toThrow();
			});
		});

		it('should reject invalid team numbers', () => {
			const invalidNumbers = [
				'', // empty
				'abc', // lowercase
				'123a', // lowercase
				'12345678901', // too long (>10 chars)
				'123-A', // special characters
				'123 A', // spaces
				'123@A', // special characters
				'123.A', // dots
				'ABC_123' // underscores
			];

			invalidNumbers.forEach((number) => {
				expect(() => TeamNumberSchema.parse(number)).toThrow();
			});
		});
	});

	describe('TeamGroupNameSchema', () => {
		it('should validate correct group names', () => {
			const validNames = ['Group1', 'A', 'Team ABC', 'Group-123', 'My Team Group'];
			validNames.forEach((name) => {
				expect(() => TeamGroupNameSchema.parse(name)).not.toThrow();
			});
		});

		it('should reject invalid group names', () => {
			const invalidNames = [
				'', // empty
				' Group1', // leading space
				'Group1 ', // trailing space
				' Group1 ', // leading and trailing spaces
				'A'.repeat(101), // too long (>100 chars)
				'\t Group1', // leading tab
				'Group1\n' // trailing newline
			];

			invalidNames.forEach((name) => {
				expect(() => TeamGroupNameSchema.parse(name)).toThrow();
			});
		});
	});

	describe('TeamInfoSchema', () => {
		it('should validate complete team info', () => {
			const validTeamInfo = {
				id: uuidv4(),
				number: '123A',
				name: 'Test Team',
				city: 'Test City',
				state: 'Test State',
				country: 'Test Country',
				shortName: 'TT',
				school: 'Test School',
				grade: 'High School' as Grade,
				group: 'TestGroup'
			};

			expect(() => TeamInfoSchema.parse(validTeamInfo)).not.toThrow();
		});

		it('should reject invalid team info', () => {
			const invalidTeamInfo = {
				id: 'not-a-uuid',
				number: 'invalid-number',
				name: 'Test Team',
				city: 'Test City',
				state: 'Test State',
				country: 'Test Country',
				shortName: 'TT',
				school: 'Test School',
				grade: 'Invalid Grade' as Grade,
				group: ' InvalidGroup '
			};

			expect(() => TeamInfoSchema.parse(invalidTeamInfo)).toThrow();
		});
	});

	describe('TeamDataSchema', () => {
		it('should validate team data', () => {
			const validData = {
				id: '550e8400-e29b-41d4-a716-446655440000',
				notebookLink: 'https://example.com/notebook',
				hasInnovateAwardSubmissionForm: false,
				notebookDevelopmentStatus: 'undetermined',
				hasSeasonSummary: false,
				absent: false
			};

			expect(() => TeamDataSchema.parse(validData)).not.toThrow();
		});

		it('should handle empty notebook link', () => {
			const validData = {
				id: '6ba7b810-9dad-41d1-80b4-00c04fd430c8',
				notebookLink: '',
				hasInnovateAwardSubmissionForm: false,
				notebookDevelopmentStatus: 'undetermined',
				hasSeasonSummary: false,
				absent: true
			};

			expect(() => TeamDataSchema.parse(validData)).not.toThrow();
		});
	});
});

describe('bySeasonSummaryFirst', () => {
	const team = (number: string, hasSeasonSummary: boolean) => ({ number, hasSeasonSummary });

	it('puts notebooks with a Season Summary ahead of those without', () => {
		const ordered = bySeasonSummaryFirst([team('1A', false), team('2B', true), team('3C', false), team('4D', true)]);

		expect(ordered.map((t) => t.number)).toEqual(['2B', '4D', '1A', '3C']);
	});

	it('keeps the order it was given within each group', () => {
		// The caller has already sorted by team number, or by judge group assignment. Lifting
		// one group above the other must not disturb that, or a judge loses the order they
		// were reading down.
		const ordered = bySeasonSummaryFirst([team('9Z', true), team('1A', true), team('5M', false), team('2B', false)]);

		expect(ordered.map((t) => t.number)).toEqual(['9Z', '1A', '5M', '2B']);
	});

	it('leaves a list alone when every team is the same', () => {
		const allWith = [team('1A', true), team('2B', true)];
		const allWithout = [team('1A', false), team('2B', false)];

		expect(bySeasonSummaryFirst(allWith).map((t) => t.number)).toEqual(['1A', '2B']);
		expect(bySeasonSummaryFirst(allWithout).map((t) => t.number)).toEqual(['1A', '2B']);
	});

	it('does not mutate the list it was given', () => {
		const original = [team('1A', false), team('2B', true)];
		bySeasonSummaryFirst(original);

		expect(original.map((t) => t.number)).toEqual(['1A', '2B']);
	});

	it('handles an empty list', () => {
		expect(bySeasonSummaryFirst([])).toEqual([]);
	});
});

describe('canEnterNotebookRubric', () => {
	const team = (notebookDevelopmentStatus: NotebookDevelopmentStatus, notebookLink = '') => ({
		notebookDevelopmentStatus,
		notebookLink
	});

	it('allows a notebook that was sorted, link or no link', () => {
		expect(canEnterNotebookRubric(team('developing'))).toBe(true);
		expect(canEnterNotebookRubric(team('fully_developed'))).toBe(true);
		expect(canEnterNotebookRubric(team('developing', 'https://example.com/nb'))).toBe(true);
	});

	it('allows an unsorted notebook that arrived as a link', () => {
		// The case this exists for: a digital event, where nobody flicks through a pile and
		// the only evidence a notebook exists is its URL.
		expect(canEnterNotebookRubric(team('undetermined', 'https://example.com/nb'))).toBe(true);
	});

	it('refuses an unsorted team with nothing to read', () => {
		expect(canEnterNotebookRubric(team('undetermined'))).toBe(false);
	});

	it('treats a link of only whitespace as no link', () => {
		expect(canEnterNotebookRubric(team('undetermined', '   '))).toBe(false);
	});

	it('honours not_submitted even when a link is present', () => {
		// Only a person ever sets not_submitted. A judge who has said a team handed nothing
		// in should not then be offered its rubric because a link was imported earlier.
		expect(canEnterNotebookRubric(team('not_submitted', 'https://example.com/nb'))).toBe(false);
		expect(canEnterNotebookRubric(team('not_submitted'))).toBe(false);
	});
});

describe('needsDevelopmentStatusDecision', () => {
	it('is true for the statuses that carry no judgement', () => {
		expect(needsDevelopmentStatusDecision('undetermined')).toBe(true);
		expect(needsDevelopmentStatusDecision('not_submitted')).toBe(true);
	});

	it('is false once a judge has sorted the notebook', () => {
		// Scoring a team a second time must not reopen a decision already made.
		expect(needsDevelopmentStatusDecision('developing')).toBe(false);
		expect(needsDevelopmentStatusDecision('fully_developed')).toBe(false);
	});
});

describe('notebookStatusAfterLinkChange', () => {
	const team = (notebookDevelopmentStatus: NotebookDevelopmentStatus, notebookLink = '') => ({
		notebookDevelopmentStatus,
		notebookLink
	});

	it('returns a not_submitted team to undetermined when a link arrives', () => {
		// Not_submitted plus a link is a dead end: the rubric is refused, so the team can
		// never be scored and nothing says why.
		expect(notebookStatusAfterLinkChange(team('not_submitted'), 'https://example.com/nb')).toBe('undetermined');
	});

	it('returns it to undetermined when the link is replaced with a different one', () => {
		expect(notebookStatusAfterLinkChange(team('not_submitted', 'https://example.com/old'), 'https://example.com/new')).toBe('undetermined');
	});

	it('leaves it alone when the same link is imported again', () => {
		// Re-importing the Event Partner's report must not decide anything a second time.
		const link = 'https://example.com/nb';
		expect(notebookStatusAfterLinkChange(team('not_submitted', link), link)).toBe('not_submitted');
		expect(notebookStatusAfterLinkChange(team('not_submitted', link), `  ${link}  `)).toBe('not_submitted');
	});

	it('leaves it alone when the link is cleared', () => {
		expect(notebookStatusAfterLinkChange(team('not_submitted', 'https://example.com/nb'), '')).toBe('not_submitted');
		expect(notebookStatusAfterLinkChange(team('not_submitted', 'https://example.com/nb'), '   ')).toBe('not_submitted');
	});

	it('never overwrites a judge who has already sorted the notebook', () => {
		const link = 'https://example.com/nb';
		expect(notebookStatusAfterLinkChange(team('developing'), link)).toBe('developing');
		expect(notebookStatusAfterLinkChange(team('fully_developed'), link)).toBe('fully_developed');
		expect(notebookStatusAfterLinkChange(team('undetermined'), link)).toBe('undetermined');
	});

	it('leaves a team scoreable once the link has landed', () => {
		const before = team('not_submitted');
		const link = 'https://example.com/nb';
		expect(canEnterNotebookRubric(before)).toBe(false);

		const after = { notebookDevelopmentStatus: notebookStatusAfterLinkChange(before, link), notebookLink: link };
		expect(canEnterNotebookRubric(after)).toBe(true);
	});
});
