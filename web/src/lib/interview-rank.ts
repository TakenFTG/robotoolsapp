import type { TeamInterviewScore } from '@robotools.app/protocol/src/rubric';

export interface InterviewStanding {
	/** 1 is the best. Teams on the same average share a rank, and the next rank is skipped. */
	rank: number;
	average: number;
}

/**
 * Rank teams by their average interview rubric score.
 *
 * An average rather than a total, because a team interviewed by two judge groups would
 * otherwise outrank a stronger team interviewed once. Teams with no rubric are left out of
 * the result, and scores for teams outside `teamIds` are ignored, so each Excellence Award
 * ranks only its own grade group.
 */
export function rankTeamsByInterview(scores: readonly TeamInterviewScore[], teamIds: readonly string[]): Map<string, InterviewStanding> {
	const included = new Set(teamIds);
	const totals = new Map<string, { sum: number; count: number }>();

	for (const { teamId, score } of scores) {
		if (!included.has(teamId)) continue;
		const total = totals.get(teamId) ?? { sum: 0, count: 0 };
		total.sum += score;
		total.count += 1;
		totals.set(teamId, total);
	}

	const ordered = [...totals].map(([teamId, { sum, count }]) => ({ teamId, average: sum / count })).sort((a, b) => b.average - a.average);

	const standings = new Map<string, InterviewStanding>();
	ordered.forEach(({ teamId, average }, index) => {
		const previous = index > 0 ? ordered[index - 1] : undefined;
		const rank = previous?.average === average ? standings.get(previous.teamId)!.rank : index + 1;
		standings.set(teamId, { rank, average });
	});
	return standings;
}
