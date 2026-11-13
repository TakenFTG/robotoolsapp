import { sqliteTable, integer, text, index, uniqueIndex } from 'drizzle-orm/sqlite-core';

/**
 * A ref room's database.
 *
 * Its own file, its own migrations. Nothing here is judging data and nothing in a Judges'
 * Room file is reachable from here — the two only ever meet through the hub, and only for
 * what the design allows to cross.
 */

/** One row: the event this room covers. Written once, when the room is created. */
export const refMetadata = sqliteTable('RefMetadata', {
	eventName: text('eventName').notNull(),
	program: text('program', { enum: ['V5RC', 'VIQRC', 'VURC'] }).notNull(),
	robotEventsSku: text('robotEventsSku'),
	robotEventsEventId: integer('robotEventsEventId'),
	/** The event's divisions as RobotEvents lists them, `{ id, name }[]`. */
	divisions: text('divisions', { mode: 'json' }).$type<{ id: number; name: string }[]>().notNull(),
	createdAt: integer('createdAt', { mode: 'timestamp_ms' }).notNull(),
	/** When a person last connected or left. Retention counts from here. */
	lastActivityAt: integer('lastActivityAt', { mode: 'timestamp_ms' }),
	retentionWarningSentAt: integer('retentionWarningSentAt', { mode: 'timestamp_ms' }),
	/**
	 * The event group this room was linked through, if it was linked with a group code.
	 * A division that joins that group later is linked automatically.
	 */
	linkedGroupId: text('linkedGroupId')
});

/**
 * Everyone who can open the room, each with their own link.
 *
 * The link is the credential, the same as a judge's: it is emailed to one person,
 * can be replaced for that person alone, and stops working the moment they are removed.
 */
export const referees = sqliteTable(
	'Referees',
	{
		id: text('id').primaryKey(),
		name: text('name').notNull(),
		role: text('role', { enum: ['head_referee', 'referee'] }).notNull(),
		authToken: text('authToken').notNull(),
		email: text('email'),
		createdAt: integer('createdAt', { mode: 'timestamp_ms' }).notNull()
	},
	(table) => [uniqueIndex('referees_authToken').on(table.authToken)]
);

export const refTeams = sqliteTable('RefTeams', {
	number: text('number').primaryKey(),
	name: text('name').notNull(),
	school: text('school').notNull()
});

export const incidents = sqliteTable(
	'Incidents',
	{
		id: text('id').primaryKey(),
		context: text('context', { enum: ['match', 'skills'] }).notNull(),
		teamNumber: text('teamNumber').notNull(),
		matchId: integer('matchId'),
		matchName: text('matchName'),
		skillsRunType: text('skillsRunType', { enum: ['driver', 'programming'] }),
		ruleCodes: text('ruleCodes', { mode: 'json' }).$type<string[]>().notNull(),
		severity: text('severity', { enum: ['positive', 'note', 'warning', 'minor', 'major', 'disabled', 'dq', 'inspection'] }).notNull(),
		note: text('note').notNull(),
		/** Refs only. Never leaves this room, whatever is linked to it. */
		private: integer('private', { mode: 'boolean' }).notNull().default(false),
		/**
		 * Not a foreign key on purpose: removing a ref must not remove what they logged. The
		 * id is cleared and the name stays, so the note still says who wrote it.
		 */
		authorRefereeId: text('authorRefereeId'),
		authorName: text('authorName').notNull(),
		/**
		 * Set when a linked division's Judge Advisor wrote it down, because the refs were not
		 * using the app. Only that division's advisors may change it; a Head Ref still can.
		 */
		authorJudgesRoomId: text('authorJudgesRoomId'),
		createdAt: integer('createdAt', { mode: 'timestamp_ms' }).notNull(),
		updatedAt: integer('updatedAt', { mode: 'timestamp_ms' }).notNull()
	},
	(table) => [index('incidents_teamNumber').on(table.teamNumber), index('incidents_createdAt').on(table.createdAt)]
);

/**
 * Judges' Rooms this ref room is linked to, one per division.
 *
 * A record of the link, not the authority for it: each Judges' Room decides for itself, on
 * every request, whether it is still linked here. A row whose room says no is dropped.
 */
export const linkedDivisions = sqliteTable('LinkedDivisions', {
	judgesRoomId: text('judgesRoomId').primaryKey(),
	/** The RobotEvents division id, when the room has one. Matches the room's schedule to ours. */
	divisionId: integer('divisionId'),
	label: text('label').notNull(),
	linkedAt: integer('linkedAt', { mode: 'timestamp_ms' }).notNull()
});
