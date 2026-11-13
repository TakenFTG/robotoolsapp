import { sqliteTable, integer, text } from 'drizzle-orm/sqlite-core';

/**
 * The admin registry's database.
 *
 * Durable Objects cannot be enumerated — there is no "list all rooms" call — so a room
 * that wants to be findable has to say so. This table is that list, and nothing more: it
 * holds the shape of an event, never its contents. Opening a room's detail goes to the
 * room itself, live, rather than mirroring judging data here where it would rot and where
 * destroying a room would no longer destroy everything about it.
 */

export const registeredRooms = sqliteTable('RegisteredRooms', {
	roomId: text('roomId').primaryKey(),
	eventName: text('eventName').notNull(),
	program: text('program').notNull(),
	eventGradeLevel: text('eventGradeLevel').notNull(),
	divisionId: integer('divisionId'),
	robotEventsSku: text('robotEventsSku'),
	accessControlEnabled: integer('accessControlEnabled', { mode: 'boolean' }).notNull().default(true),
	groupId: text('groupId'),
	createdAt: integer('createdAt', { mode: 'timestamp_ms' }).notNull(),
	updatedAt: integer('updatedAt', { mode: 'timestamp_ms' }).notNull()
});

/**
 * Live admin sessions, keyed by a SHA-256 of the bearer token.
 *
 * Hashed rather than stored plainly so that a dump of this Durable Object's storage does
 * not hand over a set of working sessions — the same reason a password is never stored as
 * typed.
 */
export const adminSessions = sqliteTable('AdminSessions', {
	tokenHash: text('tokenHash').primaryKey(),
	createdAt: integer('createdAt', { mode: 'timestamp_ms' }).notNull(),
	expiresAt: integer('expiresAt', { mode: 'timestamp_ms' }).notNull()
});

/**
 * Login attempt throttling. One row, because there is one admin.
 *
 * The password lives in a Worker secret and is not rotated casually, so an unthrottled
 * login endpoint is the weakest thing on the whole surface.
 */
export const adminLoginThrottle = sqliteTable('AdminLoginThrottle', {
	id: text('id').primaryKey(),
	failedAttempts: integer('failedAttempts').notNull().default(0),
	lockedUntil: integer('lockedUntil', { mode: 'timestamp_ms' })
});
