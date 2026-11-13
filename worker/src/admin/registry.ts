import { asc, eq, lte } from 'drizzle-orm';
import type { AppDatabase } from '../runtime/storage';
import { adminLoginThrottle, adminSessions, registeredRooms } from './schema';
import type { RegisterRoomInput } from './gateway';
import {
	ADMIN_LOGIN_LOCKOUT_MS,
	ADMIN_LOGIN_MAX_ATTEMPTS,
	ADMIN_SESSION_IDLE_MS,
	type AdminRoomRegistration
} from '@robotools.app/protocol/src/admin';

/** One row, one admin. */
const THROTTLE_ROW_ID = 'admin';

export type { RegisterRoomInput };

export type AdminLoginResult =
	| { ok: true; token: string; expiresAt: number }
	| { ok: false; reason: 'disabled' | 'invalid' }
	| { ok: false; reason: 'throttled'; retryAfterMs: number };

/**
 * Length-independent, non-short-circuiting comparison.
 *
 * Both the username and the password go through this. Comparing a username with `===`
 * would leak, by timing, whether a guessed username was the right one — which is half the
 * credential.
 */
function constantTimeEquals(a: string, b: string): boolean {
	const encoder = new TextEncoder();
	const left = encoder.encode(a);
	const right = encoder.encode(b);
	// Fold the length difference into the result rather than returning early on it.
	let diff = left.length ^ right.length;
	const max = Math.max(left.length, right.length);
	for (let i = 0; i < max; i++) {
		diff |= (left[i] ?? 0) ^ (right[i] ?? 0);
	}
	return diff === 0;
}

async function sha256Hex(value: string): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
	return Array.from(new Uint8Array(digest))
		.map((byte) => byte.toString(16).padStart(2, '0'))
		.join('');
}

function generateSessionToken(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(32));
	return Array.from(bytes)
		.map((byte) => byte.toString(16).padStart(2, '0'))
		.join('');
}

/**
 * The admin registry.
 *
 * A single Durable Object holding the list of rooms that exist, and the operator's
 * sessions. It is the only component that knows about more than one room, which is why it
 * is kept deliberately thin: an index and a door, with no judging data behind it.
 *
 * Writes happen when a room is created, renamed or destroyed — rare enough that a single
 * object is not a bottleneck.
 */
export class AdminRegistry {
	private readonly db: AppDatabase;
	/**
	 * The configured operator credentials, or nulls.
	 *
	 * Passed in rather than read from the environment here so there is exactly one place
	 * that decides whether the admin surface exists at all.
	 */
	private readonly credentials: { username: string | null; password: string | null };

	constructor(options: { db: AppDatabase; username?: string | null; password?: string | null }) {
		this.db = options.db;
		this.credentials = { username: options.username ?? null, password: options.password ?? null };
	}

	// ============================================================================
	// Called by rooms
	// ============================================================================

	/**
	 * Record or refresh a room. Called on creation and whenever event setup changes, so a
	 * renamed event does not show up here under its old name for the rest of the weekend.
	 */
	async registerRoom(input: RegisterRoomInput): Promise<void> {
		const now = new Date();
		await this.db
			.insert(registeredRooms)
			.values({ ...input, createdAt: now, updatedAt: now })
			.onConflictDoUpdate({
				target: [registeredRooms.roomId],
				// createdAt is deliberately not in the update set: it records when the event
				// first appeared, not when it was last touched.
				set: {
					eventName: input.eventName,
					program: input.program,
					eventGradeLevel: input.eventGradeLevel,
					divisionId: input.divisionId,
					robotEventsSku: input.robotEventsSku,
					accessControlEnabled: input.accessControlEnabled,
					groupId: input.groupId,
					updatedAt: now
				}
			});
	}

	/** One room's registration, for the detail view. */
	async getRoom(roomId: string): Promise<AdminRoomRegistration | null> {
		const [row] = await this.db.select().from(registeredRooms).where(eq(registeredRooms.roomId, roomId)).limit(1);
		if (!row) {
			return null;
		}
		return {
			roomId: row.roomId,
			eventName: row.eventName,
			program: row.program,
			eventGradeLevel: row.eventGradeLevel,
			divisionId: row.divisionId,
			robotEventsSku: row.robotEventsSku,
			accessControlEnabled: row.accessControlEnabled,
			groupId: row.groupId,
			createdAt: row.createdAt.getTime(),
			updatedAt: row.updatedAt.getTime()
		};
	}

	/** A destroyed room stops existing here too, so the list never offers a dead room. */
	async deregisterRoom(roomId: string): Promise<void> {
		await this.db.delete(registeredRooms).where(eq(registeredRooms.roomId, roomId));
	}

	// ============================================================================
	// Called by the Worker gateway, on the operator's behalf
	// ============================================================================

	/**
	 * Exchange a username and password for a session.
	 *
	 * Credentials live in Worker secrets. If either is unset the admin surface is off
	 * entirely — there is no default account, and an unconfigured deployment must not ship
	 * with a door that opens.
	 */
	async login(username: string, password: string, now: Date = new Date()): Promise<AdminLoginResult> {
		const { username: expectedUsername, password: expectedPassword } = this.credentials;
		if (!expectedUsername || !expectedPassword) {
			return { ok: false, reason: 'disabled' };
		}

		const [throttle] = await this.db.select().from(adminLoginThrottle).where(eq(adminLoginThrottle.id, THROTTLE_ROW_ID)).limit(1);

		if (throttle?.lockedUntil && throttle.lockedUntil.getTime() > now.getTime()) {
			return { ok: false, reason: 'throttled', retryAfterMs: throttle.lockedUntil.getTime() - now.getTime() };
		}

		// Both compared, and both in constant time, before either result is used — so the
		// response time does not reveal which half was wrong.
		const usernameMatches = constantTimeEquals(username, expectedUsername);
		const passwordMatches = constantTimeEquals(password, expectedPassword);

		if (!usernameMatches || !passwordMatches) {
			const priorAttempts = throttle?.lockedUntil && throttle.lockedUntil.getTime() <= now.getTime() ? 0 : (throttle?.failedAttempts ?? 0);
			const failedAttempts = priorAttempts + 1;
			const reachedLimit = failedAttempts >= ADMIN_LOGIN_MAX_ATTEMPTS;

			await this.db
				.insert(adminLoginThrottle)
				.values({
					id: THROTTLE_ROW_ID,
					failedAttempts,
					lockedUntil: reachedLimit ? new Date(now.getTime() + ADMIN_LOGIN_LOCKOUT_MS) : null
				})
				.onConflictDoUpdate({
					target: [adminLoginThrottle.id],
					set: {
						failedAttempts,
						lockedUntil: reachedLimit ? new Date(now.getTime() + ADMIN_LOGIN_LOCKOUT_MS) : null
					}
				});

			if (reachedLimit) {
				return { ok: false, reason: 'throttled', retryAfterMs: ADMIN_LOGIN_LOCKOUT_MS };
			}
			return { ok: false, reason: 'invalid' };
		}

		await this.db
			.insert(adminLoginThrottle)
			.values({ id: THROTTLE_ROW_ID, failedAttempts: 0, lockedUntil: null })
			.onConflictDoUpdate({ target: [adminLoginThrottle.id], set: { failedAttempts: 0, lockedUntil: null } });

		const token = generateSessionToken();
		const expiresAt = new Date(now.getTime() + ADMIN_SESSION_IDLE_MS);
		await this.db.insert(adminSessions).values({ tokenHash: await sha256Hex(token), createdAt: now, expiresAt });

		// Cheap opportunistic sweep; sessions are few and this is the only write path.
		await this.db.delete(adminSessions).where(lte(adminSessions.expiresAt, now));

		return { ok: true, token, expiresAt: expiresAt.getTime() };
	}

	/**
	 * Whether a bearer token is a live session, extending it if so.
	 *
	 * Sliding, by an hour, on every authenticated request. An operator working through a
	 * list of events should not be signed out mid-task; one who walks away should not leave
	 * a session usable indefinitely. Idle time is the thing worth measuring, not age.
	 */
	async validateSession(token: string, now: Date = new Date()): Promise<boolean> {
		if (!this.credentials.username || !this.credentials.password) {
			return false;
		}

		const tokenHash = await sha256Hex(token);
		const [row] = await this.db.select().from(adminSessions).where(eq(adminSessions.tokenHash, tokenHash)).limit(1);
		if (!row) {
			return false;
		}
		if (row.expiresAt.getTime() <= now.getTime()) {
			await this.db.delete(adminSessions).where(eq(adminSessions.tokenHash, tokenHash));
			return false;
		}

		await this.db
			.update(adminSessions)
			.set({ expiresAt: new Date(now.getTime() + ADMIN_SESSION_IDLE_MS) })
			.where(eq(adminSessions.tokenHash, tokenHash));

		return true;
	}

	async logout(token: string): Promise<void> {
		await this.db.delete(adminSessions).where(eq(adminSessions.tokenHash, await sha256Hex(token)));
	}

	/** Is this room already indexed? Used when reconciling against what is on disk. */
	async hasRoom(roomId: string): Promise<boolean> {
		const [row] = await this.db
			.select({ roomId: registeredRooms.roomId })
			.from(registeredRooms)
			.where(eq(registeredRooms.roomId, roomId))
			.limit(1);
		return !!row;
	}

	/** Every roomId the index currently holds. */
	async listRoomIds(): Promise<string[]> {
		const rows = await this.db.select({ roomId: registeredRooms.roomId }).from(registeredRooms);
		return rows.map((row) => row.roomId);
	}

	/**
	 * What the registry knows, which is the shape of each event and nothing about its use.
	 *
	 * Deliberately not AdminRoomSummary: that carries lastActivityAt, and this table has no
	 * idea when anyone was last in a room. The gateway composes the two, so the type makes
	 * it impossible to serve a summary whose activity was quietly left out.
	 */
	async listRooms(): Promise<AdminRoomRegistration[]> {
		const rows = await this.db.select().from(registeredRooms).orderBy(asc(registeredRooms.eventName));
		return rows.map((row) => ({
			roomId: row.roomId,
			eventName: row.eventName,
			program: row.program,
			eventGradeLevel: row.eventGradeLevel,
			divisionId: row.divisionId,
			robotEventsSku: row.robotEventsSku,
			accessControlEnabled: row.accessControlEnabled,
			groupId: row.groupId,
			createdAt: row.createdAt.getTime(),
			updatedAt: row.updatedAt.getTime()
		}));
	}
}
