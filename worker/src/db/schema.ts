import { sqliteTable, integer, text, blob, primaryKey, index, uniqueIndex, unique } from 'drizzle-orm/sqlite-core';

// JERRY: To prevent potential issues, do not limit the length of the text columns

export const subscriptions = sqliteTable(
	'Subscriptions',
	{
		id: text('id').notNull(),
		judgeGroupId: text('judgeGroupId').references(() => judgeGroups.id, { onDelete: 'cascade' }),
		topic: text('topic').notNull()
	},
	(table) => [primaryKey({ columns: [table.id, table.judgeGroupId, table.topic] })]
);

export const offlineDevices = sqliteTable('OfflineDevices', {
	deviceId: text('deviceId').primaryKey(),
	deviceName: text('deviceName').notNull(),
	connectedAt: integer('connectedAt', { mode: 'timestamp' }).notNull()
});

export const metadata = sqliteTable('Metadata', {
	robotEventsSku: text('robotEventsSku'), // nullable, for example: RE-VIQRC-24-8288
	robotEventsEventId: integer('robotEventsEventId'), // nullable, for example: 58288
	divisionId: integer('divisionId'), // nullable, for example: 1
	eventName: text('eventName').notNull(),
	program: text('program', { enum: ['V5RC', 'VIQRC', 'VURC'] }).notNull(),
	eventGradeLevel: text('eventGradeLevel', { enum: ['ES Only', 'MS Only', 'HS Only', 'Blended', 'College Only'] }).notNull(),
	judgingMethod: text('judgingMethod', { enum: ['assigned', 'walk_in'] }).notNull(),
	judgingStep: text('judgingStep', { enum: ['beginning', 'award_deliberations'] }).notNull(),
	accessControlEnabled: integer('accessControlEnabled', { mode: 'boolean' }).notNull().default(false),
	/**
	 * The EventGroup this room belongs to, or null for a standalone room.
	 *
	 * Only an address: the room stores no group credential and no shared secret, so this
	 * column on its own grants nothing. It is what tells the room whom to *ask* when a
	 * token it does not recognise turns up — see JudgesRoomNetwork.authorizeConnect.
	 *
	 * One group per room, deliberately. Two would mean two answers to "who may open this
	 * room" and two places to revoke, and revocation is the whole point of live delegation.
	 */
	groupId: text('groupId'),
	/**
	 * When the Judge Advisor was last warned that this event is about to be deleted.
	 *
	 * Null until a warning goes out, and cleared again the moment the room sees activity —
	 * so an event that is picked up again earns a fresh warning next time it goes quiet,
	 * rather than being deleted off the back of a notice sent a fortnight ago.
	 */
	retentionWarningSentAt: integer('retentionWarningSentAt', { mode: 'timestamp_ms' }),
	/**
	 * When a person last used this room, which is what retention counts from.
	 *
	 * Deliberately not the file's modification time. The retention sweep writes to the
	 * room when it records a warning, and that write touches the database — so an idle
	 * clock read from the filesystem would be reset by the very act of warning, and
	 * nothing would ever reach the deletion threshold.
	 *
	 * Stamped when a socket attaches and when one closes, rather than on every mutation:
	 * a room with anyone connected is never deleted regardless, so what matters is when
	 * the last person left. Null on rooms created before this column, which fall back to
	 * the file's timestamp.
	 */
	lastActivityAt: integer('lastActivityAt', { mode: 'timestamp_ms' }),
	/**
	 * The ref room this division is linked to, or null.
	 *
	 * This room is the authority for its own data: a ref room can read this division's teams
	 * and schedule only while this column names it, checked on every request. Clearing it is
	 * the whole of unlinking from this side.
	 */
	linkedRefRoomId: text('linkedRefRoomId'),
	/**
	 * The linked ref room's event name, kept here so this room can say what it is linked to
	 * without having to ask the ref room — which would mean waiting on its lock.
	 */
	linkedRefEventName: text('linkedRefEventName')
});

export const judgeAdvisors = sqliteTable(
	'JudgeAdvisors',
	{
		id: text('id').primaryKey(),
		/**
		 * A room can have several Judge Advisors, all with equal powers. The one created
		 * with the room keeps the legacy sentinel id; the rest get uuids.
		 */
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
	(table) => [uniqueIndex('judge_advisors_authToken').on(table.authToken)]
);

export const awards = sqliteTable(
	'Awards',
	{
		name: text('name').primaryKey(),
		type: text('type', { enum: ['performance', 'judged', 'volunteer_nominated'] }).notNull(), // Performance, Judged, Volunteer Nominated award
		acceptedGrades: text('acceptedGrades', { mode: 'json' }).notNull(),
		winnersCount: integer('winnersCount').notNull(),
		requireNotebook: integer('requireNotebook', { mode: 'boolean' }).notNull(),
		requireTeamInterview: integer('requireTeamInterview', { mode: 'boolean' }).notNull(),
		position: integer('position').notNull()
	},
	(table) => [index('type').on(table.type)]
);

export const teams = sqliteTable(
	'Teams',
	{
		id: text('id').primaryKey(),
		number: text('number').notNull(),
		name: text('name').notNull(),
		city: text('city').notNull(),
		state: text('state').notNull(),
		country: text('country').notNull(),
		shortName: text('shortName').notNull(),
		school: text('school').notNull(),
		grade: text('grade', { enum: ['Elementary School', 'Middle School', 'High School', 'College'] }).notNull(),
		group: text('group_').notNull(),
		notebookLink: text('notebookLink').notNull().default(''),
		hasInnovateAwardSubmissionForm: integer('hasInnovateAwardSubmissionForm', { mode: 'boolean' }).notNull().default(false),
		notebookDevelopmentStatus: text('notebookDevelopmentStatus', {
			enum: ['undetermined', 'not_submitted', 'developing', 'fully_developed']
		})
			.notNull()
			.default('undetermined'),
		// Whether the notebook arrived with a Season Summary, which decides where it sits in
		// the pile. Defaults false so a room created before this existed reads as "nobody has
		// said", which orders the same way and claims nothing about the team.
		hasSeasonSummary: integer('hasSeasonSummary', { mode: 'boolean' }).notNull().default(false),
		absent: integer('absent', { mode: 'boolean' }).notNull().default(false)
	},
	(table) => [uniqueIndex('teams_number').on(table.number), index('teams_group').on(table.group)]
);

export const judgeGroups = sqliteTable('JudgeGroups', {
	id: text('id').primaryKey(),
	name: text('name').notNull()
});

export const judgeGroupsAssignedTeams = sqliteTable(
	'JudgeGroupsAssignedTeams',
	{
		order: integer('order').unique().notNull(),
		judgeGroupId: text('judgeGroupId')
			.references(() => judgeGroups.id, { onDelete: 'cascade' })
			.notNull(),
		teamId: text('teamId')
			.primaryKey()
			.references(() => teams.id, { onDelete: 'cascade' })
	},
	(table) => [index('assignment').on(table.judgeGroupId, table.teamId)]
);

export const judges = sqliteTable(
	'Judges',
	{
		id: text('id').primaryKey(),
		name: text('name').notNull(),
		groupId: text('groupId')
			.references(() => judgeGroups.id, { onDelete: 'cascade' })
			.notNull(),
		/** Always minted; enforced only when access control is enabled. */
		authToken: text('authToken').notNull(),
		/**
		 * Where to email this judge their access link. Optional, and null for every judge
		 * created before this column existed.
		 *
		 * Deliberately not unique: two judges legitimately share an address when a Judge
		 * Advisor is collecting links on behalf of a panel, and rejecting that would be a
		 * surprising failure at the worst moment. It lives in the room's own database, so
		 * destroying the event destroys the addresses with it.
		 */
		email: text('email')
	},
	(table) => [uniqueIndex('judges_authToken').on(table.authToken)]
);

export const engineeringNotebookRubrics = sqliteTable(
	'EngineeringNotebookRubrics',
	{
		id: text('id').primaryKey(),
		teamId: text('teamId')
			.references(() => teams.id, { onDelete: 'cascade' })
			.notNull(),
		judgeId: text('judgeId')
			.references(() => judges.id, { onDelete: 'cascade' })
			.notNull(),
		rubric: text('rubric', { mode: 'json' }).notNull(),
		notes: text('notes').notNull(),
		innovateAwardNotes: text('innovateAwardNotes').notNull(),
		timestamp: integer('timestamp').notNull()
	},
	(table) => [
		index('engineering_notebook_rubrics_teamId').on(table.teamId),
		index('engineering_notebook_rubrics_judgeId').on(table.judgeId)
	]
);

export const teamInterviewRubrics = sqliteTable(
	'TeamInterviewRubrics',
	{
		id: text('id').primaryKey(),
		teamId: text('teamId')
			.references(() => teams.id, { onDelete: 'cascade' })
			.notNull(),
		judgeId: text('judgeId')
			.references(() => judges.id, { onDelete: 'cascade' })
			.notNull(),
		rubric: text('rubric', { mode: 'json' }).notNull(),
		notes: text('notes').notNull(),
		timestamp: integer('timestamp').notNull()
	},
	(table) => [index('team_interview_rubrics_teamId').on(table.teamId), index('team_interview_rubrics_judgeId').on(table.judgeId)]
);

export const teamInterviewNotes = sqliteTable(
	'TeamInterviewNotes',
	{
		id: text('id').primaryKey(),
		teamId: text('teamId')
			.references(() => teams.id, { onDelete: 'cascade' })
			.notNull(),
		judgeId: text('judgeId')
			.references(() => judges.id, { onDelete: 'cascade' })
			.notNull(),
		rows: text('rows', { mode: 'json' }).notNull(),
		timestamp: integer('timestamp').notNull()
	},
	(table) => [index('team_interview_notes_teamId').on(table.teamId), index('team_interview_notes_judgeId').on(table.judgeId)]
);

export const judgeGroupsSubmissionsCache = sqliteTable(
	'JudgeGroupsSubmissionsCache',
	{
		judgeGroupId: text('judgeGroupId')
			.references(() => judgeGroups.id, { onDelete: 'cascade' })
			.notNull(),
		teamId: text('teamId')
			.references(() => teams.id, { onDelete: 'cascade' })
			.notNull(),
		judgeId: text('judgeId')
			.references(() => judges.id, { onDelete: 'cascade' })
			.notNull(),
		timestamp: integer('timestamp').notNull(),
		enrId: text('enrId').references(() => engineeringNotebookRubrics.id, { onDelete: 'cascade' }),
		tiId: text('tiId').references(() => teamInterviewRubrics.id, { onDelete: 'cascade' }),
		tnId: text('tnId').references(() => teamInterviewNotes.id, { onDelete: 'cascade' }),
		score: integer('score') // optional for backward compatibility, added in 0.2.0
	},
	(table) => [
		primaryKey({ columns: [table.enrId, table.tiId, table.tnId] }),
		index('judge_groups_submissions_cache_judgeGroupId').on(table.judgeGroupId)
	]
);

export const judgeGroupsReviewedTeams = sqliteTable(
	'JudgeGroupsReviewedTeams',
	{
		judgeGroupId: text('judgeGroupId')
			.references(() => judgeGroups.id, { onDelete: 'cascade' })
			.notNull(),
		teamId: text('teamId')
			.references(() => teams.id, { onDelete: 'cascade' })
			.notNull()
	},
	(table) => [primaryKey({ columns: [table.judgeGroupId, table.teamId] })]
);

export const awardRankings = sqliteTable(
	'AwardRankings',
	{
		judgeGroupId: text('judgeGroupId')
			.references(() => judgeGroups.id, { onDelete: 'cascade' })
			.notNull(),
		awardName: text('awardName')
			.references(() => awards.name, { onDelete: 'cascade' })
			.notNull(),
		teamId: text('teamId')
			.references(() => teams.id, { onDelete: 'cascade' })
			.notNull(),
		ranking: integer('ranking').notNull()
	},
	(table) => [
		primaryKey({ columns: [table.judgeGroupId, table.awardName, table.teamId] }),
		index('award_rankings_judgeGroupId').on(table.judgeGroupId)
	]
);

export const finalAwardNominations = sqliteTable(
	'FinalAwardNominations',
	{
		awardName: text('awardName')
			.references(() => awards.name, { onDelete: 'cascade' })
			.notNull(),
		ranking: integer('ranking').notNull(), // start at 0
		teamId: text('teamId')
			.references(() => teams.id, { onDelete: 'cascade' })
			.notNull(),
		judgeGroupId: text('judgeGroupId').references(() => judgeGroups.id, { onDelete: 'cascade' })
	},
	(table) => [
		uniqueIndex('final_award_nominations_awardName_ranking').on(table.awardName, table.ranking),
		unique('final_award_nominations_awardName_teamId').on(table.awardName, table.teamId)
	]
);

export const teamPhotos = sqliteTable(
	'TeamPhotos',
	{
		id: text('id').primaryKey(),
		teamId: text('teamId')
			.references(() => teams.id, { onDelete: 'cascade' })
			.notNull(),
		contentType: text('contentType').notNull(),
		byteSize: integer('byteSize').notNull(),
		createdAt: integer('createdAt', { mode: 'timestamp' }).notNull(),
		createdByDeviceId: text('createdByDeviceId').notNull(),
		createdByJudgeId: text('createdByJudgeId'),
		viewSecret: text('viewSecret').notNull()
	},
	(table) => [index('team_photos_teamId').on(table.teamId)]
);

/**
 * The photo bytes themselves, in the room that owns them.
 *
 * Previously an object store shared by every room, keyed by photo id. Keeping the bytes
 * in the room's own database makes the isolation literal rather than conventional: a
 * photo cannot be fetched from a room that does not hold it, and destroying a room
 * destroys its photos in the same operation that destroys everything else — no orphaned
 * objects, no separate cleanup that can fail halfway.
 */
export const teamPhotoBlobs = sqliteTable('TeamPhotoBlobs', {
	photoId: text('photoId').primaryKey(),
	contentType: text('contentType').notNull(),
	bytes: blob('bytes', { mode: 'buffer' }).notNull()
});

export const pendingPhotoUploads = sqliteTable('PendingPhotoUploads', {
	token: text('token').primaryKey(),
	photoId: text('photoId').notNull(),
	teamId: text('teamId')
		.references(() => teams.id, { onDelete: 'cascade' })
		.notNull(),
	contentType: text('contentType').notNull(),
	byteSize: integer('byteSize').notNull(),
	createdByDeviceId: text('createdByDeviceId').notNull(),
	createdByJudgeId: text('createdByJudgeId'),
	expiresAt: integer('expiresAt', { mode: 'timestamp' }).notNull()
});
