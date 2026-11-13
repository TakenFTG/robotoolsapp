import { z } from 'zod';
import { AuthTokenSchema } from './access';
import { ProgramSchema } from './award';
import { EmailCapabilitySchema, EmailSendOutcomeSchema, JudgeEmailSchema } from './email';
import { MatchSummarySchema } from './matches';

/**
 * The referee app: incident notes logged at the field, shared live between refs.
 *
 * A ref room is its own thing, with its own storage and its own links. It covers one whole
 * event rather than one division, because Head Refs and skills refs work across divisions
 * and splitting them would split the people who need to see each other's notes.
 *
 * Nothing in here refers to judging. A ref never sees judging data, and this module is
 * where that is easiest to check: if a rubric, nomination or ranking ever appears below,
 * the separation is gone.
 */

export const REF_RPC_PATH = '/ref-rpc';
export const REF_WS_PATH = '/ref-ws';

export const RefRoomIdSchema = z.uuidv4();
export type RefRoomId = z.infer<typeof RefRoomIdSchema>;

/** A trimmed, non-empty name, the same rule the rest of the app uses for people. */
const PersonNameSchema = z
	.string()
	.nonempty()
	.max(100)
	.regex(/^\S.*\S$|^\S$/, { message: 'Name must not have leading or trailing whitespace' });

export const RefereeNameSchema = PersonNameSchema;

export const RefereeRoleSchema = z.enum(['head_referee', 'referee']);
export type RefereeRole = z.infer<typeof RefereeRoleSchema>;

/**
 * A referee as everyone in the room sees them. No token: links are only ever handed to
 * a Head Ref, one at a time, on request.
 */
export const RefereeSchema = z.object({
	id: z.uuidv4(),
	name: RefereeNameSchema,
	role: RefereeRoleSchema,
	email: JudgeEmailSchema.nullable()
});
export type Referee = z.infer<typeof RefereeSchema>;

export const RefDivisionSchema = z.object({
	id: z.number().int(),
	name: z.string().min(1).max(200)
});
export type RefDivision = z.infer<typeof RefDivisionSchema>;

export const RefTeamSchema = z.object({
	number: z.string().min(1).max(20),
	name: z.string().max(200),
	school: z.string().max(200)
});
export type RefTeam = z.infer<typeof RefTeamSchema>;

export const RefEventSchema = z.object({
	eventName: z.string().min(1).max(200),
	program: ProgramSchema,
	robotEventsSku: z.string().max(50).nullable(),
	robotEventsEventId: z.number().int().nullable(),
	divisions: z.array(RefDivisionSchema).max(50)
});
export type RefEvent = z.infer<typeof RefEventSchema>;

/**
 * How serious an incident is, mildest first.
 *
 * `positive` is something a team did well. `note` is for anything else worth remembering
 * that is not a violation. `inspection` is a
 * robot that has to go back to inspection, which is a different kind of problem from a
 * foul and is filtered on separately.
 */
export const IncidentSeveritySchema = z.enum(['positive', 'note', 'warning', 'minor', 'major', 'disabled', 'dq', 'inspection']);
export type IncidentSeverity = z.infer<typeof IncidentSeveritySchema>;

export const INCIDENT_SEVERITIES = IncidentSeveritySchema.options;

/** Where the incident happened: a scheduled match, or a skills run. */
export const IncidentContextSchema = z.enum(['match', 'skills']);
export type IncidentContext = z.infer<typeof IncidentContextSchema>;

export const SkillsRunTypeSchema = z.enum(['driver', 'programming']);
export type SkillsRunType = z.infer<typeof SkillsRunTypeSchema>;

/**
 * A rule code as refs write it: `SG6`, `G1`, `R4`.
 *
 * Stored without the angle brackets the game manual puts round them, and in capitals, so
 * `<sg6>`, `SG6` and ` sg6 ` are the same rule when filtering. Free text rather than a
 * fixed list: a rule missing from any list we ship must never stop a ref logging.
 */
export const RuleCodeSchema = z
	.string()
	.transform((value) => normalizeRuleCode(value))
	.pipe(
		z
			.string()
			.min(1)
			.max(12)
			.regex(/^[A-Z0-9.-]+$/, { message: 'Rule codes are letters, numbers, dots and dashes' })
	);

export function normalizeRuleCode(value: string): string {
	return value.replace(/[<>\s]/g, '').toUpperCase();
}

export const IncidentNoteSchema = z.string().max(2000);

/**
 * What a ref sends when they log or edit an incident.
 *
 * The id is made on the device, so sending the same incident twice — a retry after a
 * dropped connection — updates it rather than logging it twice.
 */
export const IncidentInputSchema = z
	.object({
		id: z.uuidv4(),
		context: IncidentContextSchema,
		teamNumber: z.string().min(1).max(20),
		matchId: z.number().int().nullable(),
		matchName: z.string().max(50).nullable(),
		skillsRunType: SkillsRunTypeSchema.nullable(),
		ruleCodes: z.array(RuleCodeSchema).max(10),
		severity: IncidentSeveritySchema,
		note: IncidentNoteSchema,
		private: z.boolean()
	})
	.refine((input) => input.context === 'skills' || input.skillsRunType === null, {
		message: 'Only a skills incident has a run type',
		path: ['skillsRunType']
	})
	.refine((input) => input.context === 'match' || (input.matchId === null && input.matchName === null), {
		message: 'A skills incident is not tied to a match',
		path: ['matchId']
	});
export type IncidentInput = z.infer<typeof IncidentInputSchema>;

export const IncidentSchema = z.object({
	id: z.uuidv4(),
	context: IncidentContextSchema,
	teamNumber: z.string(),
	matchId: z.number().int().nullable(),
	matchName: z.string().nullable(),
	skillsRunType: SkillsRunTypeSchema.nullable(),
	ruleCodes: z.array(z.string()),
	severity: IncidentSeveritySchema,
	note: z.string(),
	private: z.boolean(),
	/** Null once the ref who wrote it has been removed; the name is kept. */
	authorRefereeId: z.string().nullable(),
	authorName: z.string(),
	createdAt: z.number().int(),
	updatedAt: z.number().int()
});
export type Incident = z.infer<typeof IncidentSchema>;

/** Who this connection is, as far as the room is concerned. */
export const RefSelfSchema = z.object({
	refereeId: z.uuidv4(),
	name: RefereeNameSchema,
	role: RefereeRoleSchema
});
export type RefSelf = z.infer<typeof RefSelfSchema>;

// ============================================================================
// Linking to Judges' Rooms
// ============================================================================

/**
 * How long a link code works. Long enough to read it out across a hall and type it in,
 * short enough that a code on a photo of a screen is useless by the time anyone tries it.
 */
export const REF_LINK_CODE_TTL_MS = 15 * 60 * 1000;

/** Letters and digits that cannot be misread for one another: no 0/O, 1/I/L. */
export const REF_LINK_CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

/** A link code as typed: case, spaces and the dash do not matter. */
export const RefLinkCodeSchema = z
	.string()
	.transform((value) => normalizeRefLinkCode(value))
	.pipe(z.string().regex(new RegExp(`^[${REF_LINK_CODE_ALPHABET}]{8}$`), { message: 'A link code is 8 letters and numbers' }));

export function normalizeRefLinkCode(value: string): string {
	return value.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
}

/** Shown as two groups of four, which is easier to read out and type. */
export function formatRefLinkCode(code: string): string {
	return `${code.slice(0, 4)}-${code.slice(4)}`;
}

/** One Judges' Room this ref room is linked to. */
export const LinkedDivisionSchema = z.object({
	judgesRoomId: z.uuidv4(),
	divisionId: z.number().int().nullable(),
	label: z.string(),
	linkedAt: z.number().int()
});
export type LinkedDivision = z.infer<typeof LinkedDivisionSchema>;

/** A Judges' Room's view of its own link, for its Judge Advisors. */
export const RefLinkStatusSchema = z.object({
	/**
	 * The ref event this division is linked to, or null. `refsUsingApp` is false while the
	 * linked notes have no referees yet: the room made with the division, where its Judge
	 * Advisors write down what the refs tell them.
	 */
	linkedTo: z.object({ eventName: z.string(), refsUsingApp: z.boolean() }).nullable(),
	/** Set when this advisor can make a code for every division of the room's event group. */
	group: z.object({ name: z.string(), divisionCount: z.number().int() }).nullable(),
	/** Whether the server can email a Head Ref their link, which creating referee notes needs. */
	emailEnabled: z.boolean()
});
export type RefLinkStatus = z.infer<typeof RefLinkStatusSchema>;

/** A Judge Advisor creating referee notes for this division or group, for a Head Ref to run. */
export const CreateLinkedRefRoomInputSchema = z.object({
	scope: z.enum(['room', 'group']),
	headReferee: z.object({ name: RefereeNameSchema, email: JudgeEmailSchema })
});
export type CreateLinkedRefRoomInput = z.infer<typeof CreateLinkedRefRoomInputSchema>;

export const RefLinkCodeResultSchema = z.object({
	code: z.string(),
	expiresAt: z.number().int(),
	scope: z.enum(['room', 'group'])
});
export type RefLinkCodeResult = z.infer<typeof RefLinkCodeResultSchema>;

// ============================================================================
// Ref notes as a Judges' Room sees them
// ============================================================================

/**
 * An incident as a linked Judges' Room receives it.
 *
 * Narrower than a ref's own view: no ref id and no "refs only" flag, because a note marked
 * refs only never gets this far. Only notes about the division's own teams are sent.
 */
export const JudgeRefNoteSchema = z.object({
	id: z.uuidv4(),
	teamNumber: z.string(),
	context: IncidentContextSchema,
	matchName: z.string().nullable(),
	skillsRunType: SkillsRunTypeSchema.nullable(),
	ruleCodes: z.array(z.string()),
	severity: IncidentSeveritySchema,
	note: z.string(),
	authorName: z.string(),
	/** Written by this division's Judge Advisors, so they may change or remove it. */
	editable: z.boolean(),
	createdAt: z.number().int(),
	updatedAt: z.number().int()
});
export type JudgeRefNote = z.infer<typeof JudgeRefNoteSchema>;

export const JudgeRefNotesSchema = z.object({
	/** False when this division is not linked to referee notes, so there is nothing to show. */
	linked: z.boolean(),
	/** False while the linked notes have no referees: only Judge Advisors are writing in them. */
	refsUsingApp: z.boolean(),
	/** Newest first. */
	notes: z.array(JudgeRefNoteSchema)
});
export type JudgeRefNotes = z.infer<typeof JudgeRefNotesSchema>;

/** Everything a ref needs on joining, in one round trip. */
export const RefJoiningKitSchema = z.object({
	event: RefEventSchema,
	self: RefSelfSchema,
	referees: z.array(RefereeSchema),
	teams: z.array(RefTeamSchema),
	incidents: z.array(IncidentSchema),
	/** Whether this server can email links, so the Head Ref is not offered a button that always fails. */
	emailCapability: EmailCapabilitySchema,
	linkedDivisions: z.array(LinkedDivisionSchema)
});
export type RefJoiningKit = z.infer<typeof RefJoiningKitSchema>;

/**
 * What happened to one ref's link email. Same outcomes as a judge's (see email.ts): sent,
 * no address recorded, or the mail server refused — with its reason, never the link.
 */
export const RefEmailSendResultSchema = z.object({
	refereeId: z.uuidv4(),
	name: z.string(),
	email: JudgeEmailSchema.nullable(),
	outcome: EmailSendOutcomeSchema,
	error: z.string().max(300).optional()
});
export type RefEmailSendResult = z.infer<typeof RefEmailSendResultSchema>;

/** The schedule for one division, as fetched from RobotEvents. */
export const RefDivisionMatchesSchema = z.object({
	divisionId: z.number().int(),
	divisionName: z.string(),
	matches: z.array(MatchSummarySchema)
});
export type RefDivisionMatches = z.infer<typeof RefDivisionMatchesSchema>;

export const RefMatchesSnapshotSchema = z.object({
	divisions: z.array(RefDivisionMatchesSchema),
	fetchedAt: z.number().nullable(),
	error: z.string().nullable(),
	/** False when the event has no RobotEvents link, so there is no schedule to fetch. */
	available: z.boolean()
});
export type RefMatchesSnapshot = z.infer<typeof RefMatchesSnapshotSchema>;

/**
 * A note a Judge Advisor writes down for the refs, when the refs are not using the app.
 *
 * The same shape as a ref's incident, less what a Judge Advisor cannot know or choose: no
 * schedule match id, and never refs only, since it is the judges who need to see it.
 */
export const JudgeRefNoteInputSchema = z
	.object({
		id: z.uuidv4(),
		context: IncidentContextSchema,
		teamNumber: z.string().min(1).max(20),
		matchName: z.string().trim().max(50).nullable(),
		skillsRunType: SkillsRunTypeSchema.nullable(),
		ruleCodes: z.array(RuleCodeSchema).max(10),
		severity: IncidentSeveritySchema,
		note: IncidentNoteSchema
	})
	.refine((input) => input.context === 'skills' || input.skillsRunType === null, {
		message: 'Only a skills incident has a run type',
		path: ['skillsRunType']
	})
	.refine((input) => input.context === 'match' || input.matchName === null, {
		message: 'A skills incident is not tied to a match',
		path: ['matchName']
	});
export type JudgeRefNoteInput = z.infer<typeof JudgeRefNoteInputSchema>;

// ============================================================================
// Creating a ref room (plain HTTP, before anyone holds a link)
// ============================================================================

export const CreateRefRoomRequestSchema = z.object({
	kind: z.literal('create'),
	event: RefEventSchema,
	teams: z.array(RefTeamSchema).max(2000),
	headReferee: z.object({
		name: RefereeNameSchema,
		email: JudgeEmailSchema.nullable()
	})
});
export type CreateRefRoomRequest = z.infer<typeof CreateRefRoomRequestSchema>;

export const RefRequestSchema = z.discriminatedUnion('kind', [CreateRefRoomRequestSchema]);
export type RefRequest = z.infer<typeof RefRequestSchema>;

export const CreateRefRoomResponseSchema = z.object({
	roomId: RefRoomIdSchema,
	authToken: AuthTokenSchema
});
export type CreateRefRoomResponse = z.infer<typeof CreateRefRoomResponseSchema>;

/** The link a referee opens. Separate from `/join` so a ref never lands in the judging app. */
export function buildRefRoomJoinUrl(origin: string, roomId: string, authToken: string): string {
	const url = new URL('/ref', origin);
	url.searchParams.set('roomId', roomId);
	url.searchParams.set('auth', authToken);
	return url.toString();
}

/** Close reasons a ref client can tell apart from a dropped connection. */
export const RefCloseReason = {
	ACCESS_LINK_REQUIRED: 'REF_ACCESS_LINK_REQUIRED',
	INVALID_ACCESS_LINK: 'REF_INVALID_ACCESS_LINK',
	ROOM_NOT_FOUND: 'REF_ROOM_NOT_FOUND',
	ACCESS_CHANGED: 'REF_ACCESS_CHANGED'
} as const;
export type RefCloseReason = (typeof RefCloseReason)[keyof typeof RefCloseReason];

export function isRefCloseReason(reason: string): reason is RefCloseReason {
	return (Object.values(RefCloseReason) as string[]).includes(reason.trim());
}
