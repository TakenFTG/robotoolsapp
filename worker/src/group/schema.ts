import { sqliteTable, integer, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

/**
 * The EventGroup Durable Object's database.
 *
 * Its own schema, its own migrations, its own storage — a group is never a place where
 * judging data can accumulate. Everything here is either an address (which rooms belong)
 * or a credential (who may open them). If a table in this file ever starts holding a
 * rubric, a nomination or a ranking, the isolation that makes groups safe is gone.
 */

/** One row. Holds what the group is called; the group's id is its Durable Object name. */
export const groupMetadata = sqliteTable('GroupMetadata', {
	groupId: text('groupId').primaryKey(),
	name: text('name').notNull(),
	createdAt: integer('createdAt', { mode: 'timestamp_ms' }).notNull()
});

/**
 * Member rooms. An address and a label, nothing more.
 *
 * Removing a row here is how a room is cut off: the very next connect that presents a
 * group credential to that room is refused, because the room asks this table live.
 */
export const groupRooms = sqliteTable('GroupRooms', {
	roomId: text('roomId').primaryKey(),
	label: text('label').notNull(),
	position: integer('position').notNull()
});

/**
 * Group advisors: the same shape as a room's JudgeAdvisors, deliberately.
 *
 * They are Judge Advisors in every member room, so their credential must be no weaker
 * than a room's own.
 */
export const groupAdvisors = sqliteTable(
	'GroupAdvisors',
	{
		id: text('id').primaryKey(),
		name: text('name').notNull().default('Judge Advisor'),
		authToken: text('authToken').notNull(),
		/**
		 * Where this advisor's access link is emailed. Optional, null for advisors created
		 * before this column existed.
		 *
		 * A Judge Advisor link is the room's most powerful credential, so this was
		 * deliberately absent at first. It is here because the failure it prevents is worse
		 * than the one it risks: a judge who loses a link asks the Judge Advisor, while a
		 * Judge Advisor who loses theirs may have no way back into their own event.
		 */
		email: text('email')
	},
	(table) => [uniqueIndex('group_advisors_authToken').on(table.authToken)]
);
