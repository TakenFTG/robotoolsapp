import { z } from 'zod';
import { AuthTokenSchema, JudgeAdvisorIdSchema, JudgeAdvisorNameSchema } from './access';
import { RefereeNameSchema, RefereeRoleSchema } from './ref';

/**
 * The operator's admin view.
 *
 * This is the one place in the system that sees across rooms. Everywhere else, a Judges'
 * Room is sealed: its data is reachable only by someone holding a credential for that
 * room. So the boundary here is drawn deliberately and narrowly — **no judging content
 * ever crosses it**. No rubric, no nomination, no ranking, no score, no team photo, no
 * notebook link. What the operator can see is the shape of an event and who is working on
 * it, which is what running the service actually requires.
 *
 * Everything here is gated on a username and password held in Worker secrets. If those
 * secrets are unset the whole surface is off — there is no default account.
 */

export const ADMIN_RPC_PATH = '/admin/rpc';

/**
 * How long an admin session survives without being used.
 *
 * Sliding rather than absolute: an operator working through a list of events should not
 * be thrown out mid-task, and one who walks away should not leave a live session behind.
 * Every authenticated request pushes the expiry back by another hour.
 */
export const ADMIN_SESSION_IDLE_MS = 60 * 60 * 1000;

/** Failed logins before the admin login is throttled, and for how long. */
export const ADMIN_LOGIN_MAX_ATTEMPTS = 5;
export const ADMIN_LOGIN_LOCKOUT_MS = 15 * 60 * 1000;

/**
 * What the registry knows about a room without asking it.
 *
 * Cached at creation and refreshed when the event setup changes, so the list loads
 * without waking every room in the estate.
 */
export const AdminRoomSummarySchema = z.object({
	roomId: z.uuidv4(),
	eventName: z.string(),
	program: z.string(),
	eventGradeLevel: z.string(),
	divisionId: z.number().int().nullable(),
	robotEventsSku: z.string().nullable(),
	accessControlEnabled: z.boolean(),
	/** The event group this division belongs to, if any. */
	groupId: z.uuidv4().nullable(),
	createdAt: z.number().int(),
	/**
	 * When the event's *setup* last changed — renamed, re-scoped, awards altered.
	 *
	 * Not when the event was last used. Judging does not touch this, so on a room that was
	 * set up once and then judged all weekend it stays at the creation time. That is
	 * correct, and it is also almost never the question being asked, which is why
	 * `lastActivityAt` exists beside it.
	 */
	updatedAt: z.number().int(),
	/**
	 * When a person was last in the room, read live from the room itself.
	 *
	 * Null for a room that has never been connected to and predates the column it comes
	 * from — the same fallback retention uses, so the list and the deletion clock cannot
	 * disagree about whether an event is idle.
	 */
	lastActivityAt: z.number().int().nullable()
});

export type AdminRoomSummary = z.infer<typeof AdminRoomSummarySchema>;

/** What the registry itself stores. Activity is live, so it is composed in by the gateway. */
export type AdminRoomRegistration = Omit<AdminRoomSummary, 'lastActivityAt'>;

export const AdminJudgeSchema = z.object({
	judgeId: z.uuidv4(),
	name: z.string(),
	groupId: z.string(),
	groupName: z.string()
});

export const AdminJudgeAdvisorSchema = z.object({
	judgeAdvisorId: JudgeAdvisorIdSchema,
	name: z.string(),
	origin: z.enum(['room', 'group'])
});

/**
 * A single room, read live.
 *
 * Counts rather than contents: `teamCount` is a number because the operator has a
 * legitimate interest in how big an event is and none whatsoever in which teams are in it.
 */
export const AdminRoomDetailSchema = AdminRoomSummarySchema.extend({
	judgeGroups: z.array(z.object({ id: z.string(), name: z.string() })),
	judges: z.array(AdminJudgeSchema),
	judgeAdvisors: z.array(AdminJudgeAdvisorSchema),
	teamCount: z.number().int(),
	onlineDeviceCount: z.number().int()
});

export type AdminRoomDetail = z.infer<typeof AdminRoomDetailSchema>;

/**
 * A ref room, as the operator's list shows it.
 *
 * Ref rooms are not in the registry: they live in their own folder and are read straight
 * off disk, so there is nothing to reconcile and no setup-changed date to report. The
 * same boundary applies as for Judges' Rooms — counts, never contents. No incident, no
 * note, no team.
 */
export const AdminRefRoomSummarySchema = z.object({
	refRoomId: z.uuidv4(),
	eventName: z.string(),
	program: z.string(),
	robotEventsSku: z.string().nullable(),
	createdAt: z.number().int(),
	/** When a person last connected or left. Null if nobody ever has. */
	lastActivityAt: z.number().int().nullable(),
	refereeCount: z.number().int(),
	linkedDivisionCount: z.number().int()
});

export type AdminRefRoomSummary = z.infer<typeof AdminRefRoomSummarySchema>;

export const AdminRefRoomDetailSchema = AdminRefRoomSummarySchema.extend({
	divisions: z.array(z.object({ id: z.number().int(), name: z.string() })),
	/** Names and roles only. Their emails and links stay in the room. */
	referees: z.array(z.object({ id: z.string(), name: z.string(), role: z.enum(['head_referee', 'referee']) })),
	linkedDivisions: z.array(z.object({ judgesRoomId: z.string(), label: z.string(), linkedAt: z.number().int() })),
	linkedGroupId: z.string().nullable(),
	incidentCount: z.number().int(),
	onlineDeviceCount: z.number().int()
});

export type AdminRefRoomDetail = z.infer<typeof AdminRefRoomDetailSchema>;

export const AdminActionSchema = z.discriminatedUnion('kind', [
	z.object({ kind: z.literal('login'), username: z.string().min(1).max(200), password: z.string().min(1).max(400) }),
	z.object({ kind: z.literal('logout') }),
	z.object({ kind: z.literal('list_rooms') }),
	z.object({ kind: z.literal('room_detail'), roomId: z.uuidv4() }),
	z.object({ kind: z.literal('destroy_room'), roomId: z.uuidv4() }),
	z.object({ kind: z.literal('add_judge'), roomId: z.uuidv4(), name: z.string().min(1).max(100), groupId: z.string().min(1) }),
	z.object({ kind: z.literal('remove_judge'), roomId: z.uuidv4(), judgeId: z.uuidv4() }),
	z.object({ kind: z.literal('add_judge_advisor'), roomId: z.uuidv4(), name: JudgeAdvisorNameSchema }),
	z.object({ kind: z.literal('remove_judge_advisor'), roomId: z.uuidv4(), judgeAdvisorId: JudgeAdvisorIdSchema }),
	z.object({ kind: z.literal('list_ref_rooms') }),
	z.object({ kind: z.literal('ref_room_detail'), refRoomId: z.uuidv4() }),
	z.object({ kind: z.literal('destroy_ref_room'), refRoomId: z.uuidv4() }),
	/** No email: the operator hands the link over themselves, and emails stay out of this view. */
	z.object({ kind: z.literal('add_referee'), refRoomId: z.uuidv4(), name: RefereeNameSchema, role: RefereeRoleSchema }),
	z.object({ kind: z.literal('remove_referee'), refRoomId: z.uuidv4(), refereeId: z.uuidv4() })
]);

export type AdminAction = z.infer<typeof AdminActionSchema>;

export const AdminRequestSchema = z.object({
	/** Absent only for `login`. */
	token: z.string().min(1).max(200).nullable(),
	action: AdminActionSchema
});

export type AdminRequest = z.infer<typeof AdminRequestSchema>;

export const AdminResponseSchema = z.discriminatedUnion('kind', [
	z.object({ kind: z.literal('session'), token: z.string(), expiresAt: z.number().int() }),
	z.object({ kind: z.literal('ok') }),
	z.object({ kind: z.literal('rooms'), rooms: z.array(AdminRoomSummarySchema) }),
	z.object({ kind: z.literal('room'), room: AdminRoomDetailSchema.nullable() }),
	z.object({ kind: z.literal('ref_rooms'), refRooms: z.array(AdminRefRoomSummarySchema) }),
	z.object({ kind: z.literal('ref_room'), refRoom: AdminRefRoomDetailSchema.nullable() }),
	/**
	 * A credential that was just minted, returned once.
	 *
	 * The server does not keep a way to show it again — the room stores the token, and the
	 * only thing that can hand it out is the moment it was created.
	 */
	z.object({ kind: z.literal('access_link'), authToken: AuthTokenSchema })
]);

export type AdminResponse = z.infer<typeof AdminResponseSchema>;
