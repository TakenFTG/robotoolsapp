import type { Program } from '@robotools.app/protocol/src/award';
import { normalizeRuleCode } from '@robotools.app/protocol/src/ref';
import data from './rules-2026-2027.json';

/**
 * The season's rules, as an index refs can search and pick from.
 *
 * Taken from VEX's official online game manuals at manuals.vex.com: each rule's code, its
 * one-line headline, the section it sits in, and a link to the rule itself. Rule text is
 * deliberately not copied — the manual is the authority, and every rule links straight to
 * it. A few rules have no headline in the manual; those show the start of their first
 * sentence instead.
 *
 * To update for a new manual version or season, re-read the same pages (the rule anchors
 * and the bold headline that follows each code) and replace the JSON, keeping its shape:
 * [code, headline, section, "page/#anchor"].
 *
 * Not taken from RoboRef, which has no licence.
 */

export type Rule = {
	/** As refs write it, without brackets: "SG6". */
	code: string;
	title: string;
	group: string;
	/** The rule in the official online manual. */
	url: string;
};

export type Ruleset = {
	program: Program;
	season: string;
	game: string;
	version: string;
	manualUrl: string;
	/** The official Q&A for the program and season. */
	qaUrl: string;
	rules: Rule[];
};

type Row = [code: string, title: string, group: string, path: string];

const V5_MANUAL = 'https://manuals.vex.com/v5/override/v2.1/';
const IQ_MANUAL = 'https://manuals.vex.com/iq/level-up/v2.1/';

function rows(base: string, list: Row[]): Rule[] {
	return list.map(([code, title, group, path]) => ({ code, title, group, url: base + path }));
}

const v5Rules = rows(V5_MANUAL, data.v5 as Row[]);

const RULESETS: Record<Program, Ruleset> = {
	V5RC: {
		program: 'V5RC',
		season: '2026-2027',
		game: 'Override',
		version: '2.1',
		manualUrl: `${V5_MANUAL}game/`,
		qaUrl: 'https://events.vex.com/V5RC/2026-2027/QA',
		rules: v5Rules
	},
	// VEX U plays the V5 game with its own modifications, which come first: they are what a
	// ref most needs to check when a VEX U rule differs.
	VURC: {
		program: 'VURC',
		season: '2026-2027',
		game: 'Override',
		version: '2.1',
		manualUrl: `${V5_MANUAL}vex-u/`,
		qaUrl: 'https://events.vex.com/VURC/2026-2027/QA',
		rules: [...rows(V5_MANUAL, data.vu as Row[]), ...v5Rules]
	},
	VIQRC: {
		program: 'VIQRC',
		season: '2026-2027',
		game: 'Level Up',
		version: '2.1',
		manualUrl: `${IQ_MANUAL}game/`,
		qaUrl: 'https://events.vex.com/VIQRC/2026-2027/QA',
		rules: rows(IQ_MANUAL, data.iq as Row[])
	}
};

export function rulesetFor(program: Program): Ruleset {
	return RULESETS[program];
}

/** The rule a code refers to, however it was typed: "<SG6>", "sg6", " SG6 ". */
export function findRule(ruleset: Ruleset, code: string): Rule | null {
	const clean = normalizeRuleCode(code);
	return ruleset.rules.find((rule) => rule.code === clean) ?? null;
}

/** Q&A questions tagged with this rule. */
export function qaUrlFor(ruleset: Ruleset, code: string): string {
	return `${ruleset.qaUrl}/tag/${encodeURIComponent(normalizeRuleCode(code))}`;
}

/** Sections in manual order, each once. */
export function groupsOf(ruleset: Ruleset): string[] {
	return [...new Set(ruleset.rules.map((rule) => rule.group))];
}

/** Match a search against code, headline or section. "sg6", "<SG6>" and "possession" all find SG6. */
export function matchesSearch(rule: Rule, query: string): boolean {
	const trimmed = query.trim();
	if (!trimmed) {
		return true;
	}
	const asCode = normalizeRuleCode(trimmed);
	const lower = trimmed.toLowerCase();
	return rule.code.startsWith(asCode) || rule.title.toLowerCase().includes(lower) || rule.group.toLowerCase().includes(lower);
}

/** A colour per kind of rule, so a code reads at a glance: safety stands out, robot rules recede. */
export function groupClass(group: string): string {
	const name = group.toLowerCase();
	if (name.includes('safety')) return 'bg-error-container text-on-error-container';
	if (name.includes('specific')) return 'bg-primary-container text-on-primary-container';
	if (name.includes('general game')) return 'bg-secondary-container text-on-secondary-container';
	if (name.includes('general')) return 'bg-tertiary-container text-on-tertiary-container';
	if (name.includes('skills')) return 'bg-warning-container text-on-warning-container';
	if (name.includes('modification')) return 'bg-success-container text-on-success-container';
	return 'bg-surface-container-highest text-on-surface-variant';
}
