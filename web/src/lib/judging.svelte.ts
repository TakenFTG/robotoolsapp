import { v4 as uuidv4 } from 'uuid';
import { type TeamInfoAndData } from './team.svelte';
import { type Judge } from '@robotools.app/protocol/src/judging';
import { JudgeEmailSchema } from '@robotools.app/protocol/src/email';

export class EditingJudgeGroup {
	public readonly id: string;
	public name: string = $state('');
	public assignedTeams: TeamInfoAndData[] = $state([]);

	constructor(name: string) {
		this.id = uuidv4();
		this.name = name;
	}

	assignTeam(team: TeamInfoAndData) {
		if (!this.assignedTeams.find((t) => t.id === team.id)) {
			this.assignedTeams.push(team);
		}
	}

	unassignTeam(teamId: string) {
		const index = this.assignedTeams.findIndex((t) => t.id === teamId);
		if (index > -1) {
			this.assignedTeams.splice(index, 1);
		}
	}
}

export function createJudge(id: string, name: string, groupId: string, email: string | null = null): Judge {
	return { id, name, groupId, email };
}

/**
 * One line of the bulk judge box, as a name and an optional address.
 *
 * Both shapes people actually paste are accepted:
 *
 *   Ada Lovelace <ada@example.com>     copied out of a mail client
 *   Ada Lovelace, ada@example.com      copied out of a spreadsheet
 *
 * Anything that does not parse as an address is left as part of the name rather than
 * dropped — a judge with a comma in their name should end up mis-punctuated, not missing.
 */
export function parseJudgeEntry(line: string): { name: string; email: string | null } {
	const trimmed = line.trim();

	const angled = /^(.*?)\s*<([^<>]+)>$/.exec(trimmed);
	if (angled) {
		const name = angled[1]!.trim();
		const email = angled[2]!.trim();
		if (name && JudgeEmailSchema.safeParse(email).success) {
			return { name, email };
		}
	}

	const lastComma = trimmed.lastIndexOf(',');
	if (lastComma > 0) {
		const name = trimmed.slice(0, lastComma).trim();
		const email = trimmed.slice(lastComma + 1).trim();
		if (name && JudgeEmailSchema.safeParse(email).success) {
			return { name, email };
		}
	}

	return { name: trimmed, email: null };
}

export function createJudgeFromString(entry: string, groupId: string): Judge {
	const { name, email } = parseJudgeEntry(entry);
	return createJudge(uuidv4(), name.slice(0, 100), groupId, email);
}

export function parseJudgeNamesFromInput(input: string): string[] {
	return input
		.split(/[,\n]/)
		.map((name) => name.trim())
		.filter((name) => name.length > 0);
}

export function randomlyAssignTeamsToGroups(teams: TeamInfoAndData[], judgeGroups: EditingJudgeGroup[]): void {
	if (judgeGroups.length === 0) return;

	// Clear existing assignments
	judgeGroups.forEach((group) => {
		group.assignedTeams = [];
	});

	// Shuffle teams
	const shuffledTeams = [...teams].sort(() => Math.random() - 0.5);

	// Distribute teams evenly across groups
	shuffledTeams.forEach((team, index) => {
		const groupIndex = index % judgeGroups.length;
		judgeGroups[groupIndex].assignTeam(team);
	});
}

/**
 * Fisher–Yates, because the obvious `sort(() => Math.random() - 0.5)` is not a shuffle.
 *
 * A comparator that answers inconsistently gives the sort no total order, and the result
 * leans heavily towards the original arrangement — which for team assignment means the
 * same teams keep landing together, event after event.
 */
function shuffled<T>(items: readonly T[], random: () => number): T[] {
	const result = [...items];
	for (let i = result.length - 1; i > 0; i--) {
		const j = Math.floor(random() * (i + 1));
		[result[i], result[j]] = [result[j]!, result[i]!];
	}
	return result;
}

/** A judge group as far as team assignment is concerned. */
export interface TeamAssignableGroup {
	id: string;
	name: string;
	assignedTeams: readonly string[];
}

/**
 * Spread `teamIds` across `groups`, levelling the number of teams each group covers, and
 * leave every existing assignment where it is.
 *
 * Levelling rather than dealing round-robin: the point of assigning is that no group is
 * left with twice the interviews of another, and a board is usually part-assigned by hand
 * before anyone reaches for this — a group already holding six teams should not be given
 * an equal share of the remainder. So each team goes to whichever group is smallest at
 * that moment, which converges on even totals rather than an even split of the leftovers.
 *
 * Ties are broken at random. Always taking the first would hand every odd team to the same
 * group, and with three groups and one spare team that is a visible, repeatable unfairness.
 */
export function assignTeamsLevellingGroups<T extends TeamAssignableGroup>(
	groups: readonly T[],
	teamIds: readonly string[],
	random: () => number = Math.random
): (T & { assignedTeams: string[] })[] {
	const buckets = groups.map((group) => ({ ...group, assignedTeams: [...group.assignedTeams] }));
	if (buckets.length === 0) return buckets;

	// A team already in a group is not moved, and must not be added a second time if it
	// somehow also appears in the pile.
	//
	// A plain Set, not a SvelteSet: this is a local built and discarded inside one call of a
	// pure function, so nothing renders from it and reactivity would only cost. The rule
	// cannot tell the difference, since the file is a .svelte.ts.
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	const alreadyAssigned = new Set<string>(buckets.flatMap((bucket) => bucket.assignedTeams));

	for (const teamId of shuffled(teamIds, random)) {
		if (alreadyAssigned.has(teamId)) continue;

		const fewest = Math.min(...buckets.map((bucket) => bucket.assignedTeams.length));
		const smallest = buckets.filter((bucket) => bucket.assignedTeams.length === fewest);
		const target = smallest[Math.floor(random() * smallest.length)] ?? smallest[0]!;

		target.assignedTeams.push(teamId);
		alreadyAssigned.add(teamId);
	}

	return buckets;
}

export function getJudgesInGroup(judges: Judge[], groupId: string): Judge[] {
	return judges.filter((judge) => judge.groupId === groupId);
}
