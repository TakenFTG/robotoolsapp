import { z } from 'zod';
import { EmailCapabilitySchema, JudgeEmailSchema } from './email';

export const AUTH_TOKEN_LENGTH = 12;
export const AUTH_TOKEN_ALPHABET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

/**
 * Primary key of the Judge Advisor created with the room. Additional advisors get uuids;
 * this fixed id is kept so rooms created before multi-advisor support keep working.
 */
export const JUDGE_ADVISOR_SINGLETON_ID = 'judge_advisor';

/** Row id of a Judge Advisor: the legacy sentinel above, or a uuid. */
export const JudgeAdvisorIdSchema = z.string().min(1).max(64);
export type JudgeAdvisorId = z.infer<typeof JudgeAdvisorIdSchema>;

export const JudgeAdvisorNameSchema = z
	.string()
	.nonempty()
	.max(100)
	.regex(/^\S.*\S$|^\S$/, { message: 'Judge Advisor name must not have leading or trailing whitespace' });

export const AuthTokenSchema = z
	.string()
	.length(AUTH_TOKEN_LENGTH)
	.regex(/^[a-zA-Z0-9]+$/, { message: 'Auth token must be alphanumeric' });

export type AuthToken = z.infer<typeof AuthTokenSchema>;

export function generateAuthToken(): AuthToken {
	const bytes = new Uint8Array(AUTH_TOKEN_LENGTH);
	crypto.getRandomValues(bytes);
	let token = '';
	for (let i = 0; i < AUTH_TOKEN_LENGTH; i++) {
		token += AUTH_TOKEN_ALPHABET[bytes[i]! % AUTH_TOKEN_ALPHABET.length];
	}
	return token as AuthToken;
}

/**
 * Where a Judge Advisor connection's credential came from, when it is not the room's own.
 *
 * Deliberately not a separate role: inside a room a group advisor *is* a Judge Advisor,
 * with the same powers. What the room needs to know is that the credential is administered
 * elsewhere, so it refuses to rotate it or offer to delete it locally.
 *
 * Declared here rather than imported from ./group to keep access.ts free of cycles — group.ts
 * builds on this module, not the other way round.
 */
export const GroupOriginSchema = z.object({
	groupId: z.uuidv4(),
	/** The group's own id for this advisor, unprefixed. See groupScopedAdvisorId. */
	groupAdvisorId: JudgeAdvisorIdSchema,
	name: JudgeAdvisorNameSchema
});

export type GroupOrigin = z.infer<typeof GroupOriginSchema>;

/** Connection/session auth stored on the WebSocket attachment and returned to the owning client. */
// z.union (not discriminatedUnion): Zod 4 forbids duplicate discriminator values (two `true` arms).
export const ClientAuthenticationSchema = z.union([
	z.object({
		isAccessControlled: z.literal(true),
		authToken: AuthTokenSchema,
		role: z.literal('judge_advisor'),
		/** Which Judge Advisor this connection is — a room may have several. */
		judgeAdvisorId: JudgeAdvisorIdSchema,
		/**
		 * Set when this session was admitted by an EventGroup rather than by one of the
		 * room's own advisors. Optional so a client running older code, or an attachment
		 * written before groups existed, still parses.
		 */
		groupOrigin: GroupOriginSchema.optional()
	}),
	z.object({
		isAccessControlled: z.literal(true),
		authToken: AuthTokenSchema,
		role: z.literal('judge'),
		judgeId: z.uuidv4()
	}),
	z.object({
		isAccessControlled: z.literal(false)
	})
]);

export type ClientAuthentication = z.infer<typeof ClientAuthenticationSchema>;

export const uncontrolledAuthentication = { isAccessControlled: false } as const satisfies ClientAuthentication;

/** Close-reason strings for connect-time access-control denials (accept-then-close). */
export const ConnectAuthCloseReason = {
	ACCESS_LINK_REQUIRED: 'Access link required',
	INVALID_ACCESS_LINK: 'Invalid or expired access link',
	DEVICE_AUTH_CONFLICT: 'Device already authenticated with different credentials'
} as const;

export type ConnectAuthCloseReason = (typeof ConnectAuthCloseReason)[keyof typeof ConnectAuthCloseReason];

export function isConnectAuthCloseReason(reason: string): boolean {
	return (Object.values(ConnectAuthCloseReason) as string[]).includes(reason.trim());
}

/**
 * The URL that admits someone to a room.
 *
 * This used to live in the web package, which was fine while links were only ever built
 * in a browser from `window.location.origin`. Emailing a link means the *server* has to
 * build one, and two implementations of the same URL shape is how they drift apart.
 */
export function buildJudgesRoomJoinUrl(origin: string, roomId: string, authToken?: string | null): string {
	const url = new URL('/join', origin);
	url.searchParams.set('roomId', roomId);
	if (authToken) {
		url.searchParams.set('auth', authToken);
	}
	return url.toString();
}

export function isJudgeAdvisor(authentication: ClientAuthentication): boolean {
	return authentication.isAccessControlled && authentication.role === 'judge_advisor';
}

/** The EventGroup that admitted this connection, or null for a room's own advisor. */
export function getGroupOrigin(authentication: ClientAuthentication): GroupOrigin | null {
	if (!authentication.isAccessControlled || authentication.role !== 'judge_advisor') {
		return null;
	}
	return authentication.groupOrigin ?? null;
}

/** Structural equality for connection/session ClientAuthentication values. */
export function clientAuthenticationsEqual(a: ClientAuthentication, b: ClientAuthentication): boolean {
	if (a.isAccessControlled !== b.isAccessControlled) {
		return false;
	}
	if (!a.isAccessControlled || !b.isAccessControlled) {
		return true;
	}
	if (a.role !== b.role || a.authToken !== b.authToken) {
		return false;
	}
	if (a.role === 'judge' && b.role === 'judge') {
		return a.judgeId === b.judgeId;
	}
	if (a.role === 'judge_advisor' && b.role === 'judge_advisor') {
		return a.judgeAdvisorId === b.judgeAdvisorId;
	}
	return true;
}

/** Public device-list auth (never includes authToken). */
export const DeviceAuthenticatedSchema = z.discriminatedUnion('role', [
	z.object({
		role: z.literal('judge_advisor'),
		judgeAdvisorId: JudgeAdvisorIdSchema
	}),
	z.object({
		role: z.literal('judge'),
		judgeId: z.uuidv4()
	})
]);

export type DeviceAuthenticated = z.infer<typeof DeviceAuthenticatedSchema>;

export function toDeviceAuthenticated(authentication: ClientAuthentication): DeviceAuthenticated | null {
	if (!authentication.isAccessControlled) {
		return null;
	}
	if (authentication.role === 'judge_advisor') {
		return { role: 'judge_advisor', judgeAdvisorId: authentication.judgeAdvisorId };
	}
	return { role: 'judge', judgeId: authentication.judgeId };
}

export const AccessLinkJudgeSchema = z.object({
	judgeId: z.uuidv4(),
	name: z.string(),
	authToken: AuthTokenSchema,
	/** Null when no address has been recorded, which is the default. */
	email: JudgeEmailSchema.nullable().default(null)
});

export type AccessLinkJudge = z.infer<typeof AccessLinkJudgeSchema>;

export const AccessLinkJudgeAdvisorSchema = z.object({
	judgeAdvisorId: JudgeAdvisorIdSchema,
	name: JudgeAdvisorNameSchema,
	/**
	 * Null for a group advisor: their credential belongs to the EventGroup, which never
	 * hands it to a member room. The room can say who they are and cannot leak their link.
	 */
	authToken: AuthTokenSchema.nullable(),
	/**
	 * Where this advisor's link is emailed, or null. Always null for a group advisor: their
	 * address is held by the event group, which is also the only place it can be changed.
	 */
	email: JudgeEmailSchema.nullable().default(null),
	/**
	 * Which of the two kinds of Judge Advisor this is. Both have identical powers inside
	 * the room; only 'room' advisors can be renamed, rotated or removed from within it.
	 */
	origin: z.enum(['room', 'group']).default('room')
});

export type AccessLinkJudgeAdvisor = z.infer<typeof AccessLinkJudgeAdvisorSchema>;

export const AccessLinksSchema = z.object({
	judgeAdvisors: z.array(AccessLinkJudgeAdvisorSchema).min(1),
	judges: z.array(AccessLinkJudgeSchema),
	/**
	 * Whether this server can email links at all.
	 *
	 * Carried with the list rather than fetched separately so the dialog never renders a
	 * Send button it cannot honour. Defaulted for clients talking to a server that predates
	 * email support.
	 */
	emailCapability: EmailCapabilitySchema.default({ enabled: false, fromAddress: null })
});

export type AccessLinks = z.infer<typeof AccessLinksSchema>;
