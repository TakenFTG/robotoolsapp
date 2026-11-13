import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import path from 'path';
import { ADMIN_LOGIN_MAX_ATTEMPTS } from '@robotools.app/protocol/src/admin';
import { AdminRegistry } from './registry';

/**
 * The admin door.
 *
 * This is the one credential in the system that sees across every event, so what is
 * tested here is mostly what the door refuses: an unconfigured deployment, a wrong
 * password, a guessed token, an expired session, and a login endpoint hammered.
 */

type RegistryHarness = { registry: AdminRegistry; cleanup: () => void };

/**
 * Stand up a real AdminRegistry over an in-memory database.
 *
 * Now that it is a plain class rather than a Durable Object, it can simply be constructed
 * — the database and the credentials are the whole of its input.
 */
function createRegistry(credentials: { username?: string; password?: string }): RegistryHarness {
	const sqlite = new Database(':memory:');
	const db = drizzle(sqlite);
	migrate(db, { migrationsFolder: path.join(__dirname, '../../drizzle/admin-migrations') });

	const registry = new AdminRegistry({
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		db: db as any,
		username: credentials.username ?? null,
		password: credentials.password ?? null
	});

	return { registry, cleanup: () => sqlite.close() };
}

const GOOD_USER = 'operator';
const GOOD_PASSWORD = 'a-long-and-unguessable-password';

describe('admin registry', () => {
	it('is disabled entirely when no credentials are configured', async () => {
		const { registry, cleanup } = createRegistry({});
		try {
			// An unconfigured deployment must not ship with a door that opens, and an empty
			// password must not match an empty secret.
			expect(await registry.login('', '')).toEqual({ ok: false, reason: 'disabled' });
			expect(await registry.login(GOOD_USER, GOOD_PASSWORD)).toEqual({ ok: false, reason: 'disabled' });
			expect(await registry.validateSession('anything')).toBe(false);
		} finally {
			cleanup();
		}
	});

	it('issues a session for the right credentials and refuses the wrong ones', async () => {
		const { registry, cleanup } = createRegistry({ username: GOOD_USER, password: GOOD_PASSWORD });
		try {
			expect(await registry.login(GOOD_USER, 'wrong')).toMatchObject({ ok: false, reason: 'invalid' });
			expect(await registry.login('wrong', GOOD_PASSWORD)).toMatchObject({ ok: false, reason: 'invalid' });

			const result = await registry.login(GOOD_USER, GOOD_PASSWORD);
			expect(result.ok).toBe(true);
			if (!result.ok) return;

			expect(await registry.validateSession(result.token)).toBe(true);
			// The stored form is a hash, so a token that merely resembles one is worthless.
			expect(await registry.validateSession(`${result.token}0`)).toBe(false);
		} finally {
			cleanup();
		}
	});

	it('throttles repeated failures, and a good password does not bypass the lockout', async () => {
		const { registry, cleanup } = createRegistry({ username: GOOD_USER, password: GOOD_PASSWORD });
		try {
			for (let attempt = 1; attempt < ADMIN_LOGIN_MAX_ATTEMPTS; attempt++) {
				expect(await registry.login(GOOD_USER, 'wrong')).toMatchObject({ ok: false, reason: 'invalid' });
			}

			expect(await registry.login(GOOD_USER, 'wrong')).toMatchObject({ ok: false, reason: 'throttled' });
			expect(await registry.login(GOOD_USER, GOOD_PASSWORD)).toMatchObject({ ok: false, reason: 'throttled' });
		} finally {
			cleanup();
		}
	});

	it('slides a session on use, and expires it after an hour idle', async () => {
		const { registry, cleanup } = createRegistry({ username: GOOD_USER, password: GOOD_PASSWORD });
		try {
			const result = await registry.login(GOOD_USER, GOOD_PASSWORD);
			if (!result.ok) throw new Error('expected a session');

			// Used before it lapses: the expiry moves out rather than the session ending.
			const nearExpiry = new Date(result.expiresAt - 1000);
			expect(await registry.validateSession(result.token, nearExpiry)).toBe(true);
			// That push means the original expiry is no longer the deadline.
			expect(await registry.validateSession(result.token, new Date(result.expiresAt + 1))).toBe(true);

			// Left alone for longer than the idle window, it is gone.
			const wellPast = new Date(result.expiresAt + 2 * 60 * 60 * 1000);
			expect(await registry.validateSession(result.token, wellPast)).toBe(false);
			expect(await registry.validateSession(result.token)).toBe(false);
		} finally {
			cleanup();
		}
	});

	it('signing out invalidates the token immediately', async () => {
		const { registry, cleanup } = createRegistry({ username: GOOD_USER, password: GOOD_PASSWORD });
		try {
			const result = await registry.login(GOOD_USER, GOOD_PASSWORD);
			if (!result.ok) throw new Error('expected a session');

			await registry.logout(result.token);
			expect(await registry.validateSession(result.token)).toBe(false);
		} finally {
			cleanup();
		}
	});

	it('lists registered rooms and forgets destroyed ones', async () => {
		const { registry, cleanup } = createRegistry({ username: GOOD_USER, password: GOOD_PASSWORD });
		try {
			const roomId = '550e8400-e29b-41d4-a716-446655449001';
			await registry.registerRoom({
				roomId,
				eventName: 'Test Event',
				program: 'VIQRC',
				eventGradeLevel: 'MS Only',
				divisionId: 1,
				robotEventsSku: 'RE-VIQRC-24-8288',
				accessControlEnabled: true,
				groupId: null
			});

			expect(await registry.listRooms()).toMatchObject([{ roomId, eventName: 'Test Event' }]);

			// Re-registering is how a renamed event stays current, and must not duplicate it.
			await registry.registerRoom({
				roomId,
				eventName: 'Renamed Event',
				program: 'VIQRC',
				eventGradeLevel: 'MS Only',
				divisionId: 1,
				robotEventsSku: null,
				accessControlEnabled: true,
				groupId: null
			});

			const rooms = await registry.listRooms();
			expect(rooms).toHaveLength(1);
			expect(rooms[0]!.eventName).toBe('Renamed Event');

			await registry.deregisterRoom(roomId);
			expect(await registry.listRooms()).toEqual([]);
		} finally {
			cleanup();
		}
	});

	it('reads one room, and reports no activity of its own', async () => {
		const { registry, cleanup } = createRegistry({ username: GOOD_USER, password: GOOD_PASSWORD });
		try {
			const roomId = '550e8400-e29b-41d4-a716-446655449002';
			await registry.registerRoom({
				roomId,
				eventName: 'Detail Event',
				program: 'V5RC',
				eventGradeLevel: 'HS Only',
				divisionId: null,
				robotEventsSku: null,
				accessControlEnabled: true,
				groupId: null
			});

			const room = await registry.getRoom(roomId);
			expect(room).toMatchObject({ roomId, eventName: 'Detail Event', program: 'V5RC' });
			expect(room!.createdAt).toBeGreaterThan(0);

			// The registry knows what an event is, never when it was last used. Asserting the
			// absence is the point: lastActivityAt is composed in by the gateway from the room
			// itself, and a value appearing here would mean something had started mirroring
			// room state into the index.
			expect(room).not.toHaveProperty('lastActivityAt');
			expect((await registry.listRooms())[0]).not.toHaveProperty('lastActivityAt');

			expect(await registry.getRoom('550e8400-e29b-41d4-a716-446655449999')).toBeNull();
		} finally {
			cleanup();
		}
	});
});
