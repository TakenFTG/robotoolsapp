import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import path from 'node:path';
import { IncidentInputSchema, type IncidentInput } from '@robotools.app/protocol/src/ref';
import type { AppDatabase } from '../runtime/storage';
import {
	addReferee,
	createRefRoom,
	createUnclaimedRefRoom,
	getIncidentRows,
	getIncidents,
	getSharedIncidents,
	hasReferees,
	importIncidentRows,
	removeJudgeNote,
	saveJudgeNote,
	getReferees,
	getRefTeams,
	removeIncident,
	removeReferee,
	replaceRefTeams,
	rotateRefereeToken,
	saveIncident,
	updateReferee,
	getRefereeByToken
} from './store';

function openRefDatabase() {
	const sqlite = new Database(':memory:');
	const db = drizzle(sqlite);
	migrate(db, { migrationsFolder: path.join(import.meta.dirname, '../../drizzle/ref-migrations') });
	return { db: db as AppDatabase, close: () => sqlite.close() };
}

const event = {
	eventName: 'State Championship',
	program: 'V5RC' as const,
	robotEventsSku: 'RE-V5RC-26-0001',
	robotEventsEventId: 1,
	divisions: [
		{ id: 1, name: 'Science' },
		{ id: 2, name: 'Technology' }
	]
};

function incident(overrides: Partial<IncidentInput> = {}): IncidentInput {
	return IncidentInputSchema.parse({
		id: crypto.randomUUID(),
		context: 'match',
		teamNumber: '1234A',
		matchId: 10,
		matchName: 'Q 12',
		skillsRunType: null,
		ruleCodes: ['<sg6>'],
		severity: 'minor',
		note: '  Held a pin for a 5-count  ',
		private: false,
		...overrides
	});
}

describe('ref room store', () => {
	let db: AppDatabase;
	let close: () => void;
	let head: { refereeId: string; authToken: string };

	beforeEach(() => {
		({ db, close } = openRefDatabase());
		head = createRefRoom(db, {
			event,
			teams: [
				{ number: '1234A', name: 'Alpha', school: 'North High' },
				{ number: '1234A', name: 'Alpha (duplicate)', school: 'North High' },
				{ number: '99X', name: 'Xray', school: 'South High' }
			],
			headReferee: { name: 'Hana', email: ' Hana@Example.com ' }
		});
	});

	afterEach(() => close());

	it('sets up the event, de-duplicated teams and a Head Referee whose link resolves', async () => {
		expect((await getRefTeams(db)).map((team) => team.number)).toEqual(['1234A', '99X']);
		const referees = await getReferees(db);
		expect(referees).toEqual([{ id: head.refereeId, name: 'Hana', role: 'head_referee', email: 'hana@example.com' }]);
		expect((await getRefereeByToken(db, head.authToken))?.id).toBe(head.refereeId);
	});

	it('refuses to set the same room up twice', () => {
		expect(() => createRefRoom(db, { event, teams: [], headReferee: { name: 'Other', email: null } })).toThrow('already been set up');
	});

	it('normalises rule codes and trims the note', async () => {
		const saved = await saveIncident(db, incident({ ruleCodes: ['<sg6>', 'SG6', ' g1 '] }), {
			refereeId: head.refereeId,
			role: 'head_referee',
			name: 'Hana'
		});
		expect(saved.ruleCodes).toEqual(['SG6', 'G1']);
		expect(saved.note).toBe('Held a pin for a 5-count');
		expect(saved.authorName).toBe('Hana');
	});

	it('updates in place when the same incident is sent twice', async () => {
		const input = incident();
		const actor = { refereeId: head.refereeId, role: 'head_referee' as const, name: 'Hana' };
		const first = await saveIncident(db, input, actor);
		const second = await saveIncident(db, { ...input, severity: 'major' }, actor);
		expect(await getIncidents(db)).toHaveLength(1);
		expect(second.severity).toBe('major');
		expect(second.createdAt).toBe(first.createdAt);
	});

	it('clears match fields on a skills incident', async () => {
		const saved = await saveIncident(db, incident({ context: 'skills', matchId: null, matchName: null, skillsRunType: 'driver' }), {
			refereeId: head.refereeId,
			role: 'head_referee',
			name: 'Hana'
		});
		expect(saved).toMatchObject({ context: 'skills', matchId: null, matchName: null, skillsRunType: 'driver' });
	});

	it('lets a ref change only their own incidents, and a Head Ref change any', async () => {
		const ref = await addReferee(db, { name: 'Ray', role: 'referee', email: null });
		const other = await addReferee(db, { name: 'Olu', role: 'referee', email: null });
		const input = incident();
		await saveIncident(db, input, { refereeId: ref.id, role: 'referee', name: 'Ray' });

		await expect(saveIncident(db, { ...input, note: 'changed' }, { refereeId: other.id, role: 'referee', name: 'Olu' })).rejects.toThrow(
			'Only the ref who logged this'
		);
		await expect(removeIncident(db, input.id, { refereeId: other.id, role: 'referee' })).rejects.toThrow('Only the ref who logged this');

		const edited = await saveIncident(
			db,
			{ ...input, note: 'Head Ref edit' },
			{ refereeId: head.refereeId, role: 'head_referee', name: 'Hana' }
		);
		// Editing does not take over authorship.
		expect(edited.authorName).toBe('Ray');
		expect(await removeIncident(db, input.id, { refereeId: head.refereeId, role: 'head_referee' })).toBe(true);
	});

	it('keeps a removed ref’s incidents, signed with their name', async () => {
		const ref = await addReferee(db, { name: 'Ray', role: 'referee', email: null });
		await saveIncident(db, incident(), { refereeId: ref.id, role: 'referee', name: 'Ray' });
		await removeReferee(db, ref.id);

		const [kept] = await getIncidents(db);
		expect(kept).toMatchObject({ authorRefereeId: null, authorName: 'Ray' });
	});

	it('never leaves the room without a Head Referee', async () => {
		await expect(removeReferee(db, head.refereeId)).rejects.toThrow('at least one Head Referee');
		await expect(updateReferee(db, head.refereeId, { name: 'Hana', role: 'referee', email: null })).rejects.toThrow(
			'at least one Head Referee'
		);

		const second = await addReferee(db, { name: 'Second', role: 'head_referee', email: null });
		await updateReferee(db, head.refereeId, { name: 'Hana', role: 'referee', email: null });
		await expect(removeReferee(db, second.id)).rejects.toThrow('at least one Head Referee');
	});

	it('stops the old link working when a link is replaced', async () => {
		const rotated = await rotateRefereeToken(db, head.refereeId);
		expect(rotated.authToken).not.toBe(head.authToken);
		expect(await getRefereeByToken(db, head.authToken)).toBeNull();
		expect((await getRefereeByToken(db, rotated.authToken))?.id).toBe(head.refereeId);
	});

	it('replaces teams without touching incidents', async () => {
		await saveIncident(db, incident(), { refereeId: head.refereeId, role: 'head_referee', name: 'Hana' });
		replaceRefTeams(db, [{ number: '5555B', name: 'Bravo', school: 'East' }]);
		expect((await getRefTeams(db)).map((team) => team.number)).toEqual(['5555B']);
		expect(await getIncidents(db)).toHaveLength(1);
	});
});

describe("Judge Advisors' notes", () => {
	let handle: ReturnType<typeof openRefDatabase>;
	const science = crypto.randomUUID();
	const technology = crypto.randomUUID();
	const judgeNote = (id: string, note: string) => ({
		id,
		context: 'skills' as const,
		teamNumber: '1234A',
		matchName: null,
		skillsRunType: 'driver' as const,
		ruleCodes: ['G1'],
		severity: 'warning' as const,
		note
	});

	beforeEach(() => {
		handle = openRefDatabase();
	});
	afterEach(() => handle.close());

	it('starts a room with no refs, and lets only the writing division change its notes', async () => {
		createUnclaimedRefRoom(handle.db, event);
		expect(hasReferees(handle.db)).toBe(false);

		const id = crypto.randomUUID();
		const saved = await saveJudgeNote(handle.db, judgeNote(id, 'Told at the field'), {
			judgesRoomId: science,
			name: 'Ana (Judge Advisor)'
		});
		expect(saved).toMatchObject({ authorRefereeId: null, authorName: 'Ana (Judge Advisor)', private: false, matchId: null });

		await expect(saveJudgeNote(handle.db, judgeNote(id, 'Overwritten'), { judgesRoomId: technology, name: 'Ben' })).rejects.toThrow();
		await expect(removeJudgeNote(handle.db, id, technology)).rejects.toThrow();

		expect((await getSharedIncidents(handle.db, ['1234A'], science))[0]).toMatchObject({ editable: true });
		expect((await getSharedIncidents(handle.db, ['1234A'], technology))[0]).toMatchObject({ editable: false });

		expect(await removeJudgeNote(handle.db, id, science)).toBe(true);
		expect(await getIncidents(handle.db)).toEqual([]);
	});

	it('moves notes between rooms without duplicating them', async () => {
		createUnclaimedRefRoom(handle.db, event);
		await saveJudgeNote(handle.db, judgeNote(crypto.randomUUID(), 'One'), { judgesRoomId: science, name: 'Ana' });
		const rows = getIncidentRows(handle.db);

		const other = openRefDatabase();
		try {
			createRefRoom(other.db, { event, teams: [], headReferee: { name: 'Hana', email: null } });
			expect(importIncidentRows(other.db, rows)).toHaveLength(1);
			expect(importIncidentRows(other.db, rows)).toHaveLength(0);
			expect((await getSharedIncidents(other.db, ['1234A'], science))[0]).toMatchObject({ note: 'One', editable: true });
		} finally {
			other.close();
		}
	});
});
