import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { generateAuthToken } from '@robotools.app/protocol/src/access';
import type {
	Incident,
	IncidentInput,
	JudgeRefNote,
	JudgeRefNoteInput,
	LinkedDivision,
	RefEvent,
	Referee,
	RefereeRole,
	RefTeam
} from '@robotools.app/protocol/src/ref';
import type { AppDatabase } from '../runtime/storage';
import { incidents, linkedDivisions, referees as refereesTable, refMetadata, refTeams } from './schema';

/**
 * Reads and writes for one ref room's database.
 *
 * Plain functions over a drizzle handle, like the Judges' Room routes, so they can be
 * tested against an in-memory database without a socket in sight.
 */

export type RefereeRow = typeof refereesTable.$inferSelect;

export async function getRefMetadata(db: AppDatabase) {
	const rows = await db.select().from(refMetadata).limit(1);
	return rows[0] ?? null;
}

export async function getRefEvent(db: AppDatabase): Promise<RefEvent | null> {
	const row = await getRefMetadata(db);
	if (!row) {
		return null;
	}
	return {
		eventName: row.eventName,
		program: row.program,
		robotEventsSku: row.robotEventsSku,
		robotEventsEventId: row.robotEventsEventId,
		divisions: row.divisions
	};
}

/**
 * Set up a new ref room: its event, its teams and its first Head Ref.
 *
 * One transaction, so a room is either fully created or not at all — a room with an event
 * and no Head Ref would be one nobody could ever open.
 */
export function createRefRoom(
	db: AppDatabase,
	input: { event: RefEvent; teams: RefTeam[]; headReferee: { name: string; email: string | null } }
): { refereeId: string; authToken: string } {
	const refereeId = crypto.randomUUID();
	const authToken = generateAuthToken();
	const now = new Date();

	db.transaction((tx) => {
		insertRefEvent(tx, input.event, input.teams, now);

		tx.insert(refereesTable)
			.values({
				id: refereeId,
				name: input.headReferee.name,
				role: 'head_referee',
				authToken,
				email: input.headReferee.email?.trim().toLowerCase() || null,
				createdAt: now
			})
			.run();
	});

	return { refereeId, authToken };
}

/**
 * Set up a ref room with nobody in it yet: the one made with a Judges' Room, where its Judge
 * Advisors write down what the refs tell them. A Head Ref is added if the refs start using
 * the app; until then nobody can open the room itself, and its notes are reached only
 * through the linked division.
 */
export function createUnclaimedRefRoom(db: AppDatabase, event: RefEvent): void {
	db.transaction((tx) => insertRefEvent(tx, event, [], new Date()));
}

function insertRefEvent(tx: Parameters<Parameters<AppDatabase['transaction']>[0]>[0], event: RefEvent, teams: RefTeam[], now: Date): void {
	const existing = tx.select().from(refMetadata).limit(1).all();
	if (existing.length > 0) {
		throw new Error('This ref room has already been set up');
	}

	tx.insert(refMetadata)
		.values({
			eventName: event.eventName,
			program: event.program,
			robotEventsSku: event.robotEventsSku,
			robotEventsEventId: event.robotEventsEventId,
			divisions: event.divisions,
			createdAt: now,
			lastActivityAt: now
		})
		.run();

	for (const team of dedupeTeams(teams)) {
		tx.insert(refTeams).values(team).run();
	}
}

/** RobotEvents occasionally lists a team twice; the team number is the key either way. */
function dedupeTeams(teams: RefTeam[]): RefTeam[] {
	const byNumber = new Map<string, RefTeam>();
	for (const team of teams) {
		byNumber.set(team.number, team);
	}
	return [...byNumber.values()];
}

// ============================================================================
// Teams
// ============================================================================

export async function getRefTeams(db: AppDatabase): Promise<RefTeam[]> {
	return db.select().from(refTeams).orderBy(asc(refTeams.number));
}

/**
 * Replace the team list, for a Head Ref re-importing after late registrations.
 *
 * Incidents are not touched. A team that drops off the list keeps its history, because an
 * incident logged against it still happened.
 */
export function replaceRefTeams(db: AppDatabase, teams: RefTeam[]): void {
	db.transaction((tx) => {
		tx.delete(refTeams).run();
		for (const team of dedupeTeams(teams)) {
			tx.insert(refTeams).values(team).run();
		}
	});
}

// ============================================================================
// Referees
// ============================================================================

function toReferee(row: RefereeRow): Referee {
	return { id: row.id, name: row.name, role: row.role, email: row.email };
}

export async function getReferees(db: AppDatabase): Promise<Referee[]> {
	const rows = await db.select().from(refereesTable).orderBy(asc(refereesTable.createdAt));
	return rows.map(toReferee);
}

export async function getRefereeRows(db: AppDatabase): Promise<RefereeRow[]> {
	return db.select().from(refereesTable).orderBy(asc(refereesTable.createdAt));
}

export async function getRefereeRow(db: AppDatabase, refereeId: string): Promise<RefereeRow | null> {
	const rows = await db.select().from(refereesTable).where(eq(refereesTable.id, refereeId)).limit(1);
	return rows[0] ?? null;
}

export async function getRefereeByToken(db: AppDatabase, authToken: string): Promise<RefereeRow | null> {
	const rows = await db.select().from(refereesTable).where(eq(refereesTable.authToken, authToken)).limit(1);
	return rows[0] ?? null;
}

export async function addReferee(db: AppDatabase, input: { name: string; role: RefereeRole; email: string | null }): Promise<RefereeRow> {
	const row: RefereeRow = {
		id: crypto.randomUUID(),
		name: input.name,
		role: input.role,
		authToken: generateAuthToken(),
		email: input.email?.trim().toLowerCase() || null,
		createdAt: new Date()
	};
	await db.insert(refereesTable).values(row);
	return row;
}

/** Whether any ref can open this room. A plain read, safe without the room's lock. */
export function hasReferees(db: AppDatabase): boolean {
	return db.select({ id: refereesTable.id }).from(refereesTable).limit(1).all().length > 0;
}

async function countHeadReferees(db: AppDatabase): Promise<number> {
	const rows = await db.select({ id: refereesTable.id }).from(refereesTable).where(eq(refereesTable.role, 'head_referee'));
	return rows.length;
}

/**
 * Change a ref's name, email or role.
 *
 * Refuses to demote the last Head Ref: a room with no Head Ref has nobody who can add refs,
 * replace a lost link or destroy it.
 */
export async function updateReferee(
	db: AppDatabase,
	refereeId: string,
	input: { name: string; role: RefereeRole; email: string | null }
): Promise<{ before: RefereeRow; after: RefereeRow }> {
	const before = await getRefereeRow(db, refereeId);
	if (!before) {
		throw new Error('Referee not found');
	}
	if (before.role === 'head_referee' && input.role !== 'head_referee' && (await countHeadReferees(db)) <= 1) {
		throw new Error('A ref room must keep at least one Head Referee');
	}

	const after: RefereeRow = { ...before, name: input.name, role: input.role, email: input.email?.trim().toLowerCase() || null };
	await db.update(refereesTable).set({ name: after.name, role: after.role, email: after.email }).where(eq(refereesTable.id, refereeId));
	return { before, after };
}

export async function removeReferee(db: AppDatabase, refereeId: string): Promise<void> {
	const row = await getRefereeRow(db, refereeId);
	if (!row) {
		throw new Error('Referee not found');
	}
	if (row.role === 'head_referee' && (await countHeadReferees(db)) <= 1) {
		throw new Error('A ref room must keep at least one Head Referee');
	}

	// Their incidents stay, still signed with their name.
	db.transaction((tx) => {
		tx.update(incidents).set({ authorRefereeId: null }).where(eq(incidents.authorRefereeId, refereeId)).run();
		tx.delete(refereesTable).where(eq(refereesTable.id, refereeId)).run();
	});
}

/** Give a ref a new link. The old one stops working at once. */
export async function rotateRefereeToken(db: AppDatabase, refereeId: string): Promise<RefereeRow> {
	const row = await getRefereeRow(db, refereeId);
	if (!row) {
		throw new Error('Referee not found');
	}
	const authToken = generateAuthToken();
	await db.update(refereesTable).set({ authToken }).where(eq(refereesTable.id, refereeId));
	return { ...row, authToken };
}

// ============================================================================
// Incidents
// ============================================================================

type IncidentRow = typeof incidents.$inferSelect;

function toIncident(row: IncidentRow): Incident {
	return {
		id: row.id,
		context: row.context,
		teamNumber: row.teamNumber,
		matchId: row.matchId,
		matchName: row.matchName,
		skillsRunType: row.skillsRunType,
		ruleCodes: row.ruleCodes,
		severity: row.severity,
		note: row.note,
		private: row.private,
		authorRefereeId: row.authorRefereeId,
		authorName: row.authorName,
		createdAt: row.createdAt.getTime(),
		updatedAt: row.updatedAt.getTime()
	};
}

export async function getIncidents(db: AppDatabase): Promise<Incident[]> {
	const rows = await db.select().from(incidents).orderBy(desc(incidents.createdAt));
	return rows.map(toIncident);
}

export async function getIncident(db: AppDatabase, id: string): Promise<Incident | null> {
	const rows = await db.select().from(incidents).where(eq(incidents.id, id)).limit(1);
	return rows[0] ? toIncident(rows[0]) : null;
}

/** Whether this ref may change or remove this incident: its author, or any Head Ref. */
export function canModifyIncident(incident: Incident, actor: { refereeId: string; role: RefereeRole }): boolean {
	return actor.role === 'head_referee' || incident.authorRefereeId === actor.refereeId;
}

/**
 * Log a new incident, or update one this ref is allowed to change.
 *
 * Keyed on the id the device made, so a resend after a dropped connection lands on the
 * same row. Who wrote it and when are kept from the first save: a Head Ref correcting a
 * ref's note does not become its author.
 */
export async function saveIncident(
	db: AppDatabase,
	input: IncidentInput,
	actor: { refereeId: string; role: RefereeRole; name: string }
): Promise<Incident> {
	const existing = await getIncident(db, input.id);
	const now = new Date();

	const fields = {
		context: input.context,
		teamNumber: input.teamNumber,
		matchId: input.context === 'match' ? input.matchId : null,
		matchName: input.context === 'match' ? input.matchName : null,
		skillsRunType: input.context === 'skills' ? input.skillsRunType : null,
		ruleCodes: [...new Set(input.ruleCodes)],
		severity: input.severity,
		note: input.note.trim(),
		private: input.private,
		updatedAt: now
	};

	if (existing) {
		if (!canModifyIncident(existing, actor)) {
			throw new Error('Only the ref who logged this, or a Head Referee, can change it');
		}
		await db.update(incidents).set(fields).where(eq(incidents.id, input.id));
	} else {
		await db.insert(incidents).values({
			id: input.id,
			...fields,
			authorRefereeId: actor.refereeId,
			authorName: actor.name,
			createdAt: now
		});
	}

	const saved = await getIncident(db, input.id);
	if (!saved) {
		throw new Error('CRITICAL: incident missing after save');
	}
	return saved;
}

export async function removeIncident(db: AppDatabase, id: string, actor: { refereeId: string; role: RefereeRole }): Promise<boolean> {
	const existing = await getIncident(db, id);
	if (!existing) {
		return false;
	}
	if (!canModifyIncident(existing, actor)) {
		throw new Error('Only the ref who logged this, or a Head Referee, can remove it');
	}
	await db.delete(incidents).where(eq(incidents.id, id));
	return true;
}

/**
 * Save a note a linked division's Judge Advisor wrote down for the refs.
 *
 * Signed with the advisor's name and marked with their division, so their fellow advisors can
 * correct it later and nobody else can, short of a Head Ref. Never refs only: it is for the
 * judges.
 */
export async function saveJudgeNote(
	db: AppDatabase,
	input: JudgeRefNoteInput,
	actor: { judgesRoomId: string; name: string },
	options: { createOnly?: boolean } = {}
): Promise<Incident> {
	const existing = (await db.select().from(incidents).where(eq(incidents.id, input.id)).limit(1))[0];
	const now = new Date();

	// A judge only ever adds. Sending the same note again (a retry after a dropped connection)
	// changes nothing, and an id that is already taken is never overwritten.
	if (existing && options.createOnly) {
		return toIncident(existing);
	}

	const fields = {
		context: input.context,
		teamNumber: input.teamNumber,
		matchId: null,
		matchName: input.context === 'match' ? input.matchName || null : null,
		skillsRunType: input.context === 'skills' ? input.skillsRunType : null,
		ruleCodes: [...new Set(input.ruleCodes)],
		severity: input.severity,
		note: input.note.trim(),
		private: false,
		updatedAt: now
	};

	if (existing) {
		if (existing.authorJudgesRoomId !== actor.judgesRoomId) {
			throw new Error('Only the Judge Advisors who wrote this note can change it');
		}
		await db.update(incidents).set(fields).where(eq(incidents.id, input.id));
	} else {
		await db.insert(incidents).values({
			id: input.id,
			...fields,
			authorRefereeId: null,
			authorName: actor.name,
			authorJudgesRoomId: actor.judgesRoomId,
			createdAt: now
		});
	}

	const saved = await getIncident(db, input.id);
	if (!saved) {
		throw new Error('CRITICAL: incident missing after save');
	}
	return saved;
}

export async function removeJudgeNote(db: AppDatabase, id: string, judgesRoomId: string): Promise<boolean> {
	const existing = (await db.select().from(incidents).where(eq(incidents.id, id)).limit(1))[0];
	if (!existing) {
		return false;
	}
	if (existing.authorJudgesRoomId !== judgesRoomId) {
		throw new Error('Only the Judge Advisors who wrote this note can remove it');
	}
	await db.delete(incidents).where(eq(incidents.id, id));
	return true;
}

/** Every incident as stored, for moving them into another ref room. */
export function getIncidentRows(db: AppDatabase): IncidentRow[] {
	return db.select().from(incidents).all();
}

/**
 * Bring in incidents from another ref room, as they were: same ids, authors and times. An id
 * already here is left alone, so moving the same notes twice cannot duplicate them.
 */
export function importIncidentRows(db: AppDatabase, rows: IncidentRow[]): Incident[] {
	const imported: Incident[] = [];
	db.transaction((tx) => {
		for (const row of rows) {
			const result = tx.insert(incidents).values(row).onConflictDoNothing().run();
			if (result.changes > 0) {
				imported.push(toIncident(row));
			}
		}
	});
	return imported;
}

export type { IncidentRow };

// ============================================================================
// Linked Judges' Rooms
// ============================================================================

export async function getLinkedDivisions(db: AppDatabase): Promise<LinkedDivision[]> {
	const rows = await db.select().from(linkedDivisions).orderBy(asc(linkedDivisions.linkedAt), asc(linkedDivisions.label));
	return rows.map((row) => ({
		judgesRoomId: row.judgesRoomId,
		divisionId: row.divisionId,
		label: row.label,
		linkedAt: row.linkedAt.getTime()
	}));
}

/** Record divisions as linked. Relinking a division already here just refreshes its label. */
export function addLinkedDivisions(
	db: AppDatabase,
	divisions: { judgesRoomId: string; divisionId: number | null; label: string }[],
	groupId: string | null
): void {
	const now = new Date();
	db.transaction((tx) => {
		for (const division of divisions) {
			tx.insert(linkedDivisions)
				.values({ ...division, linkedAt: now })
				.onConflictDoUpdate({ target: linkedDivisions.judgesRoomId, set: { divisionId: division.divisionId, label: division.label } })
				.run();
		}
		if (groupId) {
			tx.update(refMetadata).set({ linkedGroupId: groupId }).run();
		}
	});
}

export async function removeLinkedDivision(db: AppDatabase, judgesRoomId: string): Promise<boolean> {
	const removed = await db
		.delete(linkedDivisions)
		.where(eq(linkedDivisions.judgesRoomId, judgesRoomId))
		.returning({ id: linkedDivisions.judgesRoomId });
	// With nothing left linked, the group link is over too: a division joining the group
	// later should not quietly relink a room the Head Ref has finished with.
	if ((await getLinkedDivisions(db)).length === 0) {
		await db.update(refMetadata).set({ linkedGroupId: null });
	}
	return removed.length > 0;
}

export async function getLinkedGroupId(db: AppDatabase): Promise<string | null> {
	return (await getRefMetadata(db))?.linkedGroupId ?? null;
}

/**
 * Notes a linked Judges' Room may see: about its own teams, and not marked refs only.
 *
 * The refs-only filter is applied here, in the ref room, before anything leaves it — so no
 * setting or bug on the judging side can ever reveal one.
 */
export async function getSharedIncidents(db: AppDatabase, teamNumbers: string[], judgesRoomId: string): Promise<JudgeRefNote[]> {
	if (teamNumbers.length === 0) {
		return [];
	}
	const rows = await db
		.select()
		.from(incidents)
		.where(and(eq(incidents.private, false), inArray(incidents.teamNumber, teamNumbers)))
		.orderBy(desc(incidents.createdAt));
	return rows.map((row) => ({
		id: row.id,
		teamNumber: row.teamNumber,
		context: row.context,
		matchName: row.matchName,
		skillsRunType: row.skillsRunType,
		ruleCodes: row.ruleCodes,
		severity: row.severity,
		note: row.note,
		authorName: row.authorName,
		editable: row.authorJudgesRoomId === judgesRoomId,
		createdAt: row.createdAt.getTime(),
		updatedAt: row.updatedAt.getTime()
	}));
}

export async function isLinkedDivision(db: AppDatabase, judgesRoomId: string): Promise<boolean> {
	const rows = await db
		.select({ id: linkedDivisions.judgesRoomId })
		.from(linkedDivisions)
		.where(eq(linkedDivisions.judgesRoomId, judgesRoomId))
		.limit(1);
	return rows.length > 0;
}
