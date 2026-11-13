import { z } from 'zod';
import { AuthTokenSchema, JudgeAdvisorIdSchema, JudgeAdvisorNameSchema } from './access';
import { JudgeEmailSchema } from './email';

/**
 * An EventGroup ties the divisions of one competition together.
 *
 * It owns credentials and membership and nothing else: no rubric, nomination or ranking
 * ever lives here. A group is addressed by `idFromName(groupId)` exactly as a room is
 * addressed by `idFromName(roomId)`, so the two never share storage.
 */
export const GroupIdSchema = z.uuidv4();
export type GroupId = z.infer<typeof GroupIdSchema>;

export const GroupNameSchema = z
	.string()
	.nonempty()
	.max(200)
	.regex(/^\S.*\S$|^\S$/, { message: 'Group name must not have leading or trailing whitespace' });

/** What a member room is called inside the group — "Science Division", "Division 2". */
export const DivisionLabelSchema = z
	.string()
	.nonempty()
	.max(100)
	.regex(/^\S.*\S$|^\S$/, { message: 'Division label must not have leading or trailing whitespace' });

/**
 * One member room as the group sees it. Deliberately just an address and a label:
 * the group must never become a second place where event data lives.
 */
export const GroupDivisionSchema = z.object({
	roomId: z.uuidv4(),
	label: DivisionLabelSchema,
	position: z.number().int().min(0)
});

export type GroupDivision = z.infer<typeof GroupDivisionSchema>;

/** A group advisor, in the same shape a room reports its own advisors. */
export const GroupAdvisorSchema = z.object({
	groupAdvisorId: JudgeAdvisorIdSchema,
	name: JudgeAdvisorNameSchema
});

export type GroupAdvisor = z.infer<typeof GroupAdvisorSchema>;

/** What one group advisor may see about their group. */
export const GroupSessionStateSchema = z.object({
	groupId: GroupIdSchema,
	name: GroupNameSchema,
	advisor: GroupAdvisorSchema,
	divisions: z.array(GroupDivisionSchema),
	/** Every advisor on the group, this one included. */
	advisors: z.array(GroupAdvisorSchema)
});

export type GroupSessionState = z.infer<typeof GroupSessionStateSchema>;

/**
 * Group operations reach the Durable Object over one HTTP endpoint rather than a second
 * WebSocket router: they happen before any room is open (following a group link) or as
 * rare administration, so a persistent connection would be machinery for its own sake.
 */
export const GROUP_RPC_PATH = '/group/rpc';

export const GroupActionSchema = z.discriminatedUnion('kind', [
	/** Read the group as this advisor. */
	z.object({ kind: z.literal('resolve') }),
	z.object({
		kind: z.literal('add_advisor'),
		name: JudgeAdvisorNameSchema,
		/**
		 * Optional. Given one, the group emails the new advisor their link instead of the
		 * person adding them having to relay it — which matters more here than for a judge,
		 * since a group link admits to every division at once.
		 */
		email: JudgeEmailSchema.nullable().optional()
	}),
	z.object({ kind: z.literal('rename_advisor'), groupAdvisorId: JudgeAdvisorIdSchema, name: JudgeAdvisorNameSchema }),
	z.object({ kind: z.literal('remove_advisor'), groupAdvisorId: JudgeAdvisorIdSchema }),
	z.object({ kind: z.literal('rotate_own_auth') }),
	z.object({ kind: z.literal('rename_group'), name: GroupNameSchema }),
	z.object({ kind: z.literal('rename_division'), roomId: z.uuidv4(), label: DivisionLabelSchema }),
	z.object({ kind: z.literal('remove_room'), roomId: z.uuidv4() })
]);

export type GroupAction = z.infer<typeof GroupActionSchema>;

export const GroupRequestSchema = z.object({
	groupId: GroupIdSchema,
	auth: AuthTokenSchema,
	/**
	 * Which device is asking, so rotating your own link can sign out your other devices
	 * and leave this one alone.
	 */
	deviceId: z.uuidv4(),
	action: GroupActionSchema
});

export type GroupRequest = z.infer<typeof GroupRequestSchema>;

export const GroupResponseSchema = z.object({
	state: GroupSessionStateSchema,
	/**
	 * Present when the action minted a credential (adding an advisor, rotating your own
	 * link). Returned once and never stored anywhere the group can hand it out again.
	 */
	issuedAuthToken: AuthTokenSchema.optional()
});

export type GroupResponse = z.infer<typeof GroupResponseSchema>;

/**
 * Group advisors are recorded inside a room under a prefixed id.
 *
 * A room's `JudgeAdvisors` rows and a group's advisors are separate tables that both feed
 * the same `judgeAdvisorId` field on a connection. Prefixing guarantees the two id spaces
 * cannot collide, so nothing that keys off `judgeAdvisorId` — kicking devices, for one —
 * can ever act on the wrong advisor.
 */
export const GROUP_ADVISOR_ID_PREFIX = 'group:';

export function groupScopedAdvisorId(groupAdvisorId: string): string {
	return `${GROUP_ADVISOR_ID_PREFIX}${groupAdvisorId}`;
}

export function isGroupScopedAdvisorId(judgeAdvisorId: string): boolean {
	return judgeAdvisorId.startsWith(GROUP_ADVISOR_ID_PREFIX);
}

export function unscopeGroupAdvisorId(judgeAdvisorId: string): string | null {
	return isGroupScopedAdvisorId(judgeAdvisorId) ? judgeAdvisorId.slice(GROUP_ADVISOR_ID_PREFIX.length) : null;
}

export function buildEventGroupJoinUrl(origin: string, groupId: string, authToken?: string | null): string {
	const url = new URL('/join', origin);
	url.searchParams.set('groupId', groupId);
	if (authToken) {
		url.searchParams.set('auth', authToken);
	}
	return url.toString();
}
