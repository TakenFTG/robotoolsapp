import { z } from 'zod';

/**
 * The match schedule and results, as the judging room needs them.
 *
 * Fetched by the server rather than by each device. Every RobotEvents call used to run in
 * the browser on a token shared with every other installation of this app, so a room of
 * fifty judges multiplied the request rate by fifty — and being throttled would take the
 * schedule away from the whole hall at the busiest point of the day. One poll per room
 * serves everyone in it, and the token stops travelling to judges' devices at all.
 */
export const MatchAllianceSchema = z.object({
	score: z.number().int(),
	teamNumbers: z.array(z.string())
});
export type MatchAlliance = z.infer<typeof MatchAllianceSchema>;

export const MatchSummarySchema = z.object({
	id: z.number().int(),
	/** "Q 23", "QF 1-1" — the label people in the hall actually use. */
	name: z.string(),
	round: z.number().int(),
	matchnum: z.number().int(),
	field: z.string().nullable(),
	scheduledAt: z.string().nullable(),
	startedAt: z.string().nullable(),
	scored: z.boolean(),
	red: MatchAllianceSchema,
	blue: MatchAllianceSchema
});
export type MatchSummary = z.infer<typeof MatchSummarySchema>;

/**
 * A team's standing in the division.
 *
 * Which of these columns mean anything depends on the program: VRC and VEXU rank on
 * WP/AP/SP, VIQRC on average points. Rather than the server guessing the program, all of
 * them are carried and the client shows the set that the data itself supports.
 */
export const TeamRankingSchema = z.object({
	rank: z.number().int(),
	teamNumber: z.string(),
	wins: z.number().int(),
	losses: z.number().int(),
	ties: z.number().int(),
	wp: z.number(),
	ap: z.number(),
	sp: z.number(),
	highScore: z.number(),
	averagePoints: z.number(),
	totalPoints: z.number()
});
export type TeamRanking = z.infer<typeof TeamRankingSchema>;

/**
 * A team's skills standing: its best driver run and its best programming run.
 *
 * RobotEvents reports skills as individual runs, one row per team per type, and ranks each
 * type separately. What everyone in the hall actually reads is the combined table, so the
 * runs are folded into one row per team here rather than in each client.
 *
 * Skills are event-wide, not per-division — a team's skills scores follow the team, not
 * the division it was seeded into.
 */
export const SkillsEntrySchema = z.object({
	rank: z.number().int(),
	teamNumber: z.string(),
	driverScore: z.number().int(),
	driverAttempts: z.number().int(),
	programmingScore: z.number().int(),
	programmingAttempts: z.number().int(),
	totalScore: z.number().int()
});
export type SkillsEntry = z.infer<typeof SkillsEntrySchema>;

export const MatchesSnapshotSchema = z.object({
	matches: z.array(MatchSummarySchema),
	/**
	 * The division standings, in rank order.
	 *
	 * Empty before the first match is scored, and empty for an event whose rankings are
	 * not published — neither is an error, and both look the same to a judge.
	 */
	rankings: z.array(TeamRankingSchema),
	/** Combined skills standings, best score first. Empty until someone has run. */
	skills: z.array(SkillsEntrySchema),
	/** When the server last reached RobotEvents, or null if it never has. */
	fetchedAt: z.number().nullable(),
	/**
	 * Why the last attempt failed, if it did.
	 *
	 * Carried alongside the matches rather than thrown, so a room keeps showing the last
	 * good schedule while saying it could not be updated. A stale schedule presented as
	 * current is the one outcome worth avoiding — a judge acts on it.
	 */
	error: z.string().nullable(),
	/** False when the event was never linked to RobotEvents; there is nothing to fetch. */
	available: z.boolean()
});
export type MatchesSnapshot = z.infer<typeof MatchesSnapshotSchema>;

/** How often the server refreshes a room that people are actually using. */
export const MATCH_POLL_INTERVAL_MS = 5 * 60 * 1000;
