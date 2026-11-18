import { describe, expect, it } from 'vitest';
import { rankTeamsByInterview } from './interview-rank';

describe('rankTeamsByInterview', () => {
	it('ranks the highest average first', () => {
		const standings = rankTeamsByInterview(
			[
				{ teamId: 'a', score: 20 },
				{ teamId: 'b', score: 30 }
			],
			['a', 'b']
		);

		expect(standings.get('b')).toEqual({ rank: 1, average: 30 });
		expect(standings.get('a')).toEqual({ rank: 2, average: 20 });
	});

	it('averages several rubrics instead of adding them up', () => {
		const standings = rankTeamsByInterview(
			[
				{ teamId: 'twice', score: 20 },
				{ teamId: 'twice', score: 24 },
				{ teamId: 'once', score: 25 }
			],
			['twice', 'once']
		);

		expect(standings.get('once')?.rank).toBe(1);
		expect(standings.get('twice')).toEqual({ rank: 2, average: 22 });
	});

	it('gives tied teams the same rank and skips the next one', () => {
		const standings = rankTeamsByInterview(
			[
				{ teamId: 'a', score: 30 },
				{ teamId: 'b', score: 25 },
				{ teamId: 'c', score: 25 },
				{ teamId: 'd', score: 10 }
			],
			['a', 'b', 'c', 'd']
		);

		expect(['a', 'b', 'c', 'd'].map((teamId) => standings.get(teamId)?.rank)).toEqual([1, 2, 2, 4]);
	});

	it('leaves out teams with no rubric and teams outside the group', () => {
		const standings = rankTeamsByInterview(
			[
				{ teamId: 'in', score: 10 },
				{ teamId: 'other-grade', score: 40 }
			],
			['in', 'not-interviewed']
		);

		expect(standings.get('in')?.rank).toBe(1);
		expect(standings.has('not-interviewed')).toBe(false);
		expect(standings.has('other-grade')).toBe(false);
	});
});
