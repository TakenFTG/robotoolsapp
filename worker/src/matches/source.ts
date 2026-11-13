import { Client, type Event as RobotEventsEvent } from 'events.vex';
import type { MatchSummary, SkillsEntry, TeamRanking } from '@robotools.app/protocol/src/matches';

/**
 * Reading the match schedule from RobotEvents.
 *
 * This lives on the server, not in the browser. The API key is rate limited, so the request
 * rate has to be bounded by the number of *rooms*, not the number of judges — fifty devices
 * polling would be throttled at the exact hour the schedule matters most.
 */

/**
 * The VEX Events (RobotEvents) API key, from ROBOTEVENTS_TOKEN in judging.env.
 *
 * Read on each fetch rather than once at import, so a missing key fails the request that
 * needs it with a message saying what to set, instead of stopping the server.
 */
export function getRobotEventsToken(): string | null {
	return process.env.ROBOTEVENTS_TOKEN?.trim() || null;
}

type AllianceLike = { score?: number | null; teams?: { team?: { name?: string | null } | null; sitting?: boolean | null }[] } | null;

/**
 * Team numbers on an alliance, skipping any that sat out.
 *
 * Rare in modern competition, but a sitting team is listed on the alliance without
 * playing, and showing them would send a judge to the wrong field.
 */
function allianceTeamNumbers(alliance: AllianceLike): string[] {
	if (!alliance?.teams) {
		return [];
	}

	return alliance.teams
		.filter((entry) => !entry.sitting)
		.map((entry) => entry.team?.name ?? '')
		.filter((number) => number.length > 0);
}

export interface DivisionData {
	matches: MatchSummary[];
	rankings: TeamRanking[];
	skills: SkillsEntry[];
}

/**
 * The division standings.
 *
 * Deliberately forgiving where the schedule is not: a failure here returns no rankings
 * rather than propagating, because rankings are a secondary view and losing the whole
 * schedule over them would be the wrong trade. It is also the normal case for an event
 * that has not published standings, which RobotEvents reports as an error rather than an
 * empty list on some events.
 */
async function fetchRankings(event: RobotEventsEvent, division: number): Promise<TeamRanking[]> {
	try {
		const result = await event.rankings(division);

		// Read through a widened view rather than off `result` directly: the generated types
		// declare only a 200 for this path, so TypeScript believes the error branch cannot
		// happen — but the client does return one, and a 404 for an event with no published
		// standings is the case this exists for.
		const failure = (result as { error?: unknown }).error;
		if (failure) {
			console.warn('RobotEvents returned no rankings for division', division, failure);
			return [];
		}

		return (result.data ?? [])
			.map((entry): TeamRanking => ({
				rank: entry.rank ?? 0,
				teamNumber: entry.team?.name ?? '',
				wins: entry.wins ?? 0,
				losses: entry.losses ?? 0,
				ties: entry.ties ?? 0,
				wp: entry.wp ?? 0,
				ap: entry.ap ?? 0,
				sp: entry.sp ?? 0,
				highScore: entry.high_score ?? 0,
				averagePoints: entry.average_points ?? 0,
				totalPoints: entry.total_points ?? 0
			}))
			.filter((entry) => entry.teamNumber.length > 0)
			.sort((a, b) => a.rank - b.rank);
	} catch (error) {
		console.warn('Failed to fetch rankings for division', division, error);
		return [];
	}
}

/**
 * Combined skills standings.
 *
 * RobotEvents returns one row per team per run type, already ranked within its own type.
 * The combined table is what the hall reads, so the rows are folded together here and
 * ranked as the game manual does: total first, then the higher programming score, then the
 * higher driver score. Teams still tied after all three genuinely are tied and share a
 * rank, rather than being separated by whatever order the API happened to return.
 *
 * Skills are an event-level endpoint — deliberately, because skills belong to the team
 * rather than to the division it was seeded into.
 *
 * Forgiving in the same way as rankings: no skills is the normal state of an event before
 * anyone has run, and it must not cost the room its schedule.
 */
async function fetchSkills(event: RobotEventsEvent): Promise<SkillsEntry[]> {
	try {
		const result = await event.skills();

		const failure = (result as { error?: unknown }).error;
		if (failure) {
			console.warn('RobotEvents returned no skills for event', event.id, failure);
			return [];
		}

		const byTeam = new Map<string, SkillsEntry>();
		for (const run of result.data ?? []) {
			const teamNumber = run.team?.name ?? '';
			// package_delivery_time is an ADC run type and does not belong in this table.
			if (!teamNumber || (run.type !== 'driver' && run.type !== 'programming')) {
				continue;
			}

			const entry = byTeam.get(teamNumber) ?? {
				rank: 0,
				teamNumber,
				driverScore: 0,
				driverAttempts: 0,
				programmingScore: 0,
				programmingAttempts: 0,
				totalScore: 0
			};

			// Highest run wins, which is what the standings show. RobotEvents already reports
			// a team's best per type, but taking the maximum costs nothing and is correct
			// either way.
			if (run.type === 'driver') {
				entry.driverScore = Math.max(entry.driverScore, run.score ?? 0);
				entry.driverAttempts = Math.max(entry.driverAttempts, run.attempts ?? 0);
			} else {
				entry.programmingScore = Math.max(entry.programmingScore, run.score ?? 0);
				entry.programmingAttempts = Math.max(entry.programmingAttempts, run.attempts ?? 0);
			}

			byTeam.set(teamNumber, entry);
		}

		const entries = [...byTeam.values()];
		for (const entry of entries) {
			entry.totalScore = entry.driverScore + entry.programmingScore;
		}

		entries.sort((a, b) => b.totalScore - a.totalScore || b.programmingScore - a.programmingScore || b.driverScore - a.driverScore);

		// Standard competition ranking: teams level on every tiebreaker share a rank, and
		// the next rank skips accordingly. Handing out 4th and 5th to two identical teams
		// would be inventing a distinction the game does not make.
		entries.forEach((entry, index) => {
			const previous = entries[index - 1];
			const tied =
				previous !== undefined &&
				previous.totalScore === entry.totalScore &&
				previous.programmingScore === entry.programmingScore &&
				previous.driverScore === entry.driverScore;
			entry.rank = tied ? previous.rank : index + 1;
		});

		return entries;
	} catch (error) {
		console.warn('Failed to fetch skills for event', event.id, error);
		return [];
	}
}

const REQUEST_TIMEOUT_MS = 15_000;
const REFRESH_TIMEOUT_MS = 30_000;

export async function fetchDivisionData(evtId: number, divisionId: number | null): Promise<DivisionData> {
	const token = getRobotEventsToken();
	if (!token) {
		throw new Error('No VEX Events API key is configured. Set ROBOTEVENTS_TOKEN in judging.env and restart the server.');
	}
	// Bounded, so a slow or hung RobotEvents cannot hold a refresh open indefinitely: each
	// request gets REQUEST_TIMEOUT_MS, and the whole refresh — event, paged matches,
	// rankings and skills together — gets REFRESH_TIMEOUT_MS. A timeout surfaces as the
	// snapshot's error, with the last good schedule still shown.
	const refreshDeadline = AbortSignal.timeout(REFRESH_TIMEOUT_MS);
	const client = Client({
		authorization: { token },
		request: {
			fetch: (request: Request) => fetch(request, { signal: AbortSignal.any([refreshDeadline, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]) })
		}
	});

	const evtResult = await client.events.get(evtId);
	if (!evtResult.data) {
		throw new Error('Event not found on RobotEvents');
	}

	// A division is optional in this app's data but required by RobotEvents. Falling back
	// to the event's first division is how single-division events are normally set up.
	const division = divisionId ?? evtResult.data.divisions?.[0]?.id;
	if (division === undefined || division === null) {
		return { matches: [], rankings: [], skills: await fetchSkills(evtResult.data) };
	}

	const [result, rankings, skills] = await Promise.all([
		evtResult.data.matches(division),
		fetchRankings(evtResult.data, division),
		fetchSkills(evtResult.data)
	]);

	return { matches: toMatchSummaries(result.data ?? []), rankings, skills };
}

type RobotEventsMatch = NonNullable<Awaited<ReturnType<RobotEventsEvent['matches']>>['data']>[number];

function toMatchSummaries(matches: RobotEventsMatch[]): MatchSummary[] {
	return matches
		.map((match): MatchSummary => {
			const red = match.alliance('red') as AllianceLike;
			const blue = match.alliance('blue') as AllianceLike;
			return {
				id: match.id,
				name: match.shortName(),
				round: match.round,
				matchnum: match.matchnum,
				field: match.field ?? null,
				scheduledAt: match.scheduled ?? null,
				startedAt: match.started ?? null,
				scored: match.scored,
				red: { score: red?.score ?? 0, teamNumbers: allianceTeamNumbers(red) },
				blue: { score: blue?.score ?? 0, teamNumbers: allianceTeamNumbers(blue) }
			};
		})
		.sort((a, b) => a.round - b.round || a.matchnum - b.matchnum);
}

/**
 * The match schedule for several divisions of one event, and nothing else.
 *
 * For the ref room, which covers a whole event. Rankings and skills standings are a
 * judging concern and are not fetched, so a ref room costs one event lookup plus one
 * schedule request per division.
 *
 * Divisions are fetched one after another rather than together, for the same reason the
 * hub polls rooms one at a time: a burst on a shared token is what gets it throttled.
 */
export async function fetchEventMatches(evtId: number, divisionIds: number[]): Promise<Map<number, MatchSummary[]>> {
	const token = getRobotEventsToken();
	if (!token) {
		throw new Error('No VEX Events API key is configured. Set ROBOTEVENTS_TOKEN in judging.env and restart the server.');
	}
	const refreshDeadline = AbortSignal.timeout(REFRESH_TIMEOUT_MS);
	const client = Client({
		authorization: { token },
		request: {
			fetch: (request: Request) => fetch(request, { signal: AbortSignal.any([refreshDeadline, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]) })
		}
	});

	const evtResult = await client.events.get(evtId);
	if (!evtResult.data) {
		throw new Error('Event not found on RobotEvents');
	}

	const byDivision = new Map<number, MatchSummary[]>();
	for (const divisionId of divisionIds) {
		const result = await evtResult.data.matches(divisionId);
		byDivision.set(divisionId, toMatchSummaries(result.data ?? []));
	}
	return byDivision;
}

/** An event's name and divisions, for setting up a ref room that covers the whole event. */
export async function fetchEventSummary(evtId: number): Promise<{ name: string; divisions: { id: number; name: string }[] }> {
	const token = getRobotEventsToken();
	if (!token) {
		throw new Error('No VEX Events API key is configured.');
	}
	const client = Client({
		authorization: { token },
		request: { fetch: (request: Request) => fetch(request, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) }) }
	});
	const result = await client.events.get(evtId);
	if (!result.data) {
		throw new Error('Event not found on RobotEvents');
	}
	const divisions = (result.data.divisions ?? [])
		.filter((division) => typeof division.id === 'number' && !!division.name)
		.map((division) => ({ id: division.id as number, name: (division.name as string).slice(0, 200) }));
	return { name: result.data.name, divisions };
}
