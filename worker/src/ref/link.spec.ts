import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { createWRPCClient, type WebsocketClient, type WRPCClient } from '@robotools.app/wrpc/client';
import { generateAuthToken } from '@robotools.app/protocol/src/access';
import { REF_RPC_PATH, type CreateRefRoomRequest, type LinkedDivision, type RefTeam } from '@robotools.app/protocol/src/ref';
import { buildClientRouter, type ClientRouter, type ClientRouterHandlers } from '@robotools.app/web/src/lib/client-router-def';
import { buildRefClientRouter, type RefClientRouter } from '@robotools.app/web/src/lib/ref/ref-client-router-def';
import { createServer } from '../server';
import type { Hub } from '../runtime/hub';
import type { ServerRouter } from '../server-router';
import { createRecordingEmailContext } from '../test-utils';
import { DataDirectory, migrationsPath, openDatabase } from '../runtime/storage';
import { judgeAdvisors, judgeGroups, judgeGroupsAssignedTeams, judges, metadata, teams } from '../db/schema';
import { eq } from 'drizzle-orm';
import type { RefServerRouter } from './router';

/**
 * Linking a ref room to Judges' Rooms, end to end: real server, real sockets.
 *
 * What matters most here is the boundary. A link carries a division's team list and
 * schedule to the refs and nothing else, only while the Judges' Room says so.
 */

const EVENT_ID = 5501;

type JudgesSeed = { divisionId: number; eventName?: string; eventId?: number; teams: string[]; groupId?: string };

describe('linking a ref room to Judges Rooms', () => {
	let dataDir: string;
	let port: number;
	let hub: Hub;
	let email: ReturnType<typeof createRecordingEmailContext>;
	let stop: () => Promise<void>;
	const sockets: { disconnect(): void }[] = [];

	// No RobotEvents here, even where CI has a key: these tests are about the link, and a
	// network call would make them depend on a real event's data.
	const savedToken = process.env.ROBOTEVENTS_TOKEN;

	beforeEach(async () => {
		delete process.env.ROBOTEVENTS_TOKEN;
		dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ref-link-'));
		email = createRecordingEmailContext('https://judging.example.com');
		const created = createServer({
			port: 0,
			host: '127.0.0.1',
			dataDir,
			staticDir: null,
			adminUsername: null,
			adminPassword: null,
			email,
			retention: { enabled: false, deleteAfterDays: 7, warnAfterDays: 5 }
		});
		hub = created.hub;
		await new Promise<void>((resolve) => created.server.listen(0, '127.0.0.1', resolve));
		port = (created.server.address() as AddressInfo).port;
		stop = async () => {
			for (const socket of sockets.splice(0)) socket.disconnect();
			hub.closeConnections();
			await new Promise<void>((resolve) => created.server.close(() => resolve()));
			hub.close();
		};
	});

	afterEach(async () => {
		if (savedToken !== undefined) process.env.ROBOTEVENTS_TOKEN = savedToken;
		await stop();
		fs.rmSync(dataDir, { recursive: true, force: true });
	});

	/** A Judges' Room on disk with access control on and one advisor. Returns the advisor's token. */
	async function seedJudgesRoom(roomId: string, seed: JudgesSeed): Promise<string> {
		const storage = openDatabase(new DataDirectory(dataDir).roomFile(roomId), migrationsPath('migrations'));
		await storage.db.insert(metadata).values({
			eventName: seed.eventName ?? 'Regional',
			program: 'V5RC',
			eventGradeLevel: 'HS Only',
			judgingMethod: 'assigned',
			judgingStep: 'beginning',
			accessControlEnabled: true,
			robotEventsEventId: seed.eventId ?? EVENT_ID,
			divisionId: seed.divisionId,
			groupId: seed.groupId ?? null
		});
		const token = generateAuthToken();
		await storage.db.insert(judgeAdvisors).values({ id: crypto.randomUUID(), name: 'JA', authToken: token });
		for (const number of seed.teams) {
			await storage.db.insert(teams).values({
				id: crypto.randomUUID(),
				number,
				name: `Team ${number}`,
				city: 'City',
				state: 'State',
				country: 'Country',
				shortName: number,
				school: `School ${number}`,
				grade: 'High School',
				group: 'A',
				// Judging data: must never reach a ref room.
				notebookLink: 'https://secret.example.com/notebook'
			});
		}
		storage.close();
		return token;
	}

	/** A judge in their own judge group, assigned these teams. Returns the judge's token. */
	async function seedJudge(roomId: string, name: string, assignedTeams: string[], judgingMethod?: 'walk_in'): Promise<string> {
		const storage = openDatabase(new DataDirectory(dataDir).roomFile(roomId), migrationsPath('migrations'));
		const groupId = crypto.randomUUID();
		await storage.db.insert(judgeGroups).values({ id: groupId, name: `${name}'s group` });
		const token = generateAuthToken();
		await storage.db.insert(judges).values({ id: crypto.randomUUID(), name, groupId, authToken: token });
		for (const [index, number] of assignedTeams.entries()) {
			const [team] = await storage.db.select().from(teams).where(eq(teams.number, number));
			await storage.db.insert(judgeGroupsAssignedTeams).values({ order: Date.now() + index, judgeGroupId: groupId, teamId: team!.id });
		}
		if (judgingMethod) {
			await storage.db.update(metadata).set({ judgingMethod });
		}
		storage.close();
		return token;
	}

	function connectJudges(roomId: string, token: string | null, handlers: Partial<ClientRouterHandlers> = {}): WRPCClient<ServerRouter> {
		const noop = new Proxy(
			{},
			{ get: (_target, key: string) => handlers[key as keyof ClientRouterHandlers] ?? (() => {}) }
		) as ClientRouterHandlers;
		const [client, wrpc] = createWRPCClient<ServerRouter, ClientRouter>(
			{
				wsUrl: token ? `ws://127.0.0.1:${port}/ws?auth=${token}` : `ws://127.0.0.1:${port}/ws`,
				roomId,
				clientId: crypto.randomUUID(),
				deviceId: crypto.randomUUID(),
				deviceName: 'JA laptop',
				onContext: async () => ({}),
				onOpen: () => {},
				onClosed: () => {},
				onConnectionStateChange: () => {}
			},
			buildClientRouter(noop)
		);
		sockets.push(client);
		return wrpc;
	}

	async function createRefRoom(eventId: number | null = EVENT_ID): Promise<{
		wrpc: WRPCClient<RefServerRouter>;
		received: { teams: RefTeam[][]; linked: LinkedDivision[][] };
	}> {
		const request: CreateRefRoomRequest = {
			kind: 'create',
			event: {
				eventName: 'Regional',
				program: 'V5RC',
				robotEventsSku: null,
				robotEventsEventId: eventId,
				divisions: [
					{ id: 1, name: 'Science' },
					{ id: 2, name: 'Technology' }
				]
			},
			teams: [],
			headReferee: { name: 'Hana', email: null }
		};
		const response = await fetch(`http://127.0.0.1:${port}${REF_RPC_PATH}`, { method: 'POST', body: JSON.stringify(request) });
		const { roomId, authToken } = (await response.json()) as { roomId: string; authToken: string };

		return connectRef(roomId, authToken);
	}

	async function connectRef(
		roomId: string,
		authToken: string
	): Promise<{ wrpc: WRPCClient<RefServerRouter>; received: { teams: RefTeam[][]; linked: LinkedDivision[][] } }> {
		const received = { teams: [] as RefTeam[][], linked: [] as LinkedDivision[][] };
		const [client, wrpc] = createWRPCClient<RefServerRouter, RefClientRouter>(
			{
				wsUrl: `ws://127.0.0.1:${port}/ref-ws?auth=${authToken}`,
				roomId,
				clientId: crypto.randomUUID(),
				deviceId: crypto.randomUUID(),
				deviceName: 'Head ref',
				onContext: async () => ({}),
				onOpen: () => {},
				onClosed: () => {},
				onConnectionStateChange: () => {}
			},
			buildRefClientRouter({
				onIncidentSaved: () => {},
				onIncidentRemoved: () => {},
				onRefereesUpdate: () => {},
				onTeamsUpdate: (input) => void received.teams.push(input),
				onLinkedDivisionsUpdate: (input) => void received.linked.push(input)
			})
		);
		sockets.push(client as WebsocketClient<RefClientRouter>);
		await wrpc.session.join.mutation();
		return { wrpc, received };
	}

	async function eventually(check: () => void | Promise<void>, timeoutMs = 2000): Promise<void> {
		const deadline = Date.now() + timeoutMs;
		for (;;) {
			try {
				await check();
				return;
			} catch (error) {
				if (Date.now() > deadline) throw error;
				await new Promise((resolve) => setTimeout(resolve, 20));
			}
		}
	}

	it('links one division with a code, carrying only number, name and school', async () => {
		const roomId = crypto.randomUUID();
		const token = await seedJudgesRoom(roomId, { divisionId: 1, teams: ['1A', '2B'] });
		const judges = connectJudges(roomId, token);
		const ref = await createRefRoom();

		expect((await judges.refLink.getStatus.query()).linkedTo).toBeNull();
		const { code, scope } = await judges.refLink.createCode.mutation({ scope: 'room' });
		expect(scope).toBe('room');

		// Typed the way a person types it: lower case, with a dash.
		const linked = await ref.wrpc.links.link.mutation({ code: `${code.slice(0, 4).toLowerCase()}-${code.slice(4)}` });
		expect(linked).toEqual([expect.objectContaining({ judgesRoomId: roomId, divisionId: 1, label: 'Science' })]);

		const kit = await ref.wrpc.session.join.mutation();
		expect(kit.teams).toEqual([
			{ number: '1A', name: 'Team 1A', school: 'School 1A' },
			{ number: '2B', name: 'Team 2B', school: 'School 2B' }
		]);
		expect(JSON.stringify(kit)).not.toContain('secret.example.com');
		expect((await judges.refLink.getStatus.query()).linkedTo).toEqual({ eventName: 'Regional', refsUsingApp: true });

		// A code works once.
		await expect(ref.wrpc.links.link.mutation({ code })).rejects.toThrow('wrong or has expired');
	});

	it('refuses a code from a different event, and a division already linked elsewhere', async () => {
		const other = crypto.randomUUID();
		const otherToken = await seedJudgesRoom(other, { divisionId: 1, eventId: 9999, eventName: 'Somewhere else', teams: [] });
		const ref = await createRefRoom();
		const { code } = await connectJudges(other, otherToken).refLink.createCode.mutation({ scope: 'room' });
		await expect(ref.wrpc.links.link.mutation({ code })).rejects.toThrow('different event (Somewhere else)');

		const roomId = crypto.randomUUID();
		const token = await seedJudgesRoom(roomId, { divisionId: 1, teams: [] });
		const judges = connectJudges(roomId, token);
		await ref.wrpc.links.link.mutation({ code: (await judges.refLink.createCode.mutation({ scope: 'room' })).code });

		const second = await createRefRoom();
		await expect(
			second.wrpc.links.link.mutation({ code: (await judges.refLink.createCode.mutation({ scope: 'room' })).code })
		).rejects.toThrow('already linked to other referee notes');
	});

	it('stops sharing the moment the Judge Advisor unlinks, and the refs are told', async () => {
		const roomId = crypto.randomUUID();
		const token = await seedJudgesRoom(roomId, { divisionId: 2, teams: ['7C'] });
		const judges = connectJudges(roomId, token);
		const ref = await createRefRoom();
		await ref.wrpc.links.link.mutation({ code: (await judges.refLink.createCode.mutation({ scope: 'room' })).code });

		await judges.refLink.unlink.mutation();
		await eventually(() => expect(ref.received.linked.at(-1)).toEqual([]));

		const kit = await ref.wrpc.session.join.mutation();
		expect(kit.teams).toEqual([]);
		expect(kit.linkedDivisions).toEqual([]);
	});

	it('lets the Head Ref unlink, which the Judges Room sees', async () => {
		const roomId = crypto.randomUUID();
		const token = await seedJudgesRoom(roomId, { divisionId: 1, teams: ['1A'] });
		const judges = connectJudges(roomId, token);
		const ref = await createRefRoom();
		await ref.wrpc.links.link.mutation({ code: (await judges.refLink.createCode.mutation({ scope: 'room' })).code });

		await ref.wrpc.links.unlink.mutation({ judgesRoomId: null });
		expect((await judges.refLink.getStatus.query()).linkedTo).toBeNull();
	});

	it('releases its divisions when the ref room is deleted', async () => {
		const roomId = crypto.randomUUID();
		const token = await seedJudgesRoom(roomId, { divisionId: 1, teams: [] });
		const judges = connectJudges(roomId, token);
		const ref = await createRefRoom();
		await ref.wrpc.links.link.mutation({ code: (await judges.refLink.createCode.mutation({ scope: 'room' })).code });

		await ref.wrpc.event.destroy.mutation().catch(() => {});
		await eventually(async () => expect((await judges.refLink.getStatus.query()).linkedTo).toBeNull());
	});

	it('links every division of an event group with one code, and divisions that join later', async () => {
		const groupId = crypto.randomUUID();
		const science = crypto.randomUUID();
		const technology = crypto.randomUUID();
		const arts = crypto.randomUUID();
		await seedJudgesRoom(science, { divisionId: 1, teams: ['1A'], groupId });
		const technologyToken = await seedJudgesRoom(technology, { divisionId: 2, teams: ['2B'], groupId });
		const artsToken = await seedJudgesRoom(arts, { divisionId: 3, teams: ['3C'] });

		const group = await hub.onGroup(groupId, (g) =>
			g.createGroup({ groupId, name: 'State', roomId: science, divisionLabel: 'Science', advisorName: 'Group JA', advisorEmail: null })
		);
		if (!group.ok) throw new Error(group.error);
		await hub.onGroup(groupId, (g) => g.attachRoom({ authToken: group.authToken, roomId: technology, label: 'Technology' }));

		// A division's own advisor cannot speak for the whole group.
		const localAdvisor = connectJudges(technology, technologyToken);
		await expect(localAdvisor.refLink.createCode.mutation({ scope: 'group' })).rejects.toThrow('advisor of the event group');

		const groupAdvisor = connectJudges(science, group.authToken);
		expect((await groupAdvisor.refLink.getStatus.query()).group).toEqual({ name: 'State', divisionCount: 2 });
		const ref = await createRefRoom();
		const linked = await ref.wrpc.links.link.mutation({ code: (await groupAdvisor.refLink.createCode.mutation({ scope: 'group' })).code });
		expect(linked.map((division) => division.label).sort()).toEqual(['Science', 'Technology']);

		// Arts joins the group afterwards and is linked without anyone entering a code.
		const artsAdvisor = connectJudges(arts, artsToken);
		await artsAdvisor.group.attachToGroup.mutation({ groupId, groupAuthToken: group.authToken, divisionLabel: 'Arts' });
		await eventually(() =>
			expect(
				ref.received.linked
					.at(-1)
					?.map((division) => division.label)
					.sort()
			).toEqual(['Arts', 'Science', 'Technology'])
		);
		expect((await artsAdvisor.refLink.getStatus.query()).linkedTo).toEqual({ eventName: 'Regional', refsUsingApp: true });

		const kit = await ref.wrpc.session.join.mutation();
		expect(kit.teams.map((team) => team.number)).toEqual(['1A', '2B', '3C']);
	});

	it('lets a Judge Advisor create referee notes, linked, and emails the link only to the Head Ref', async () => {
		const roomId = crypto.randomUUID();
		const token = await seedJudgesRoom(roomId, { divisionId: 1, teams: ['1A'] });
		const judges = connectJudges(roomId, token);
		expect((await judges.refLink.getStatus.query()).emailEnabled).toBe(true);

		const { sentTo } = await judges.refLink.createRefRoom.mutation({
			scope: 'room',
			headReferee: { name: 'Hana', email: 'Hana@Example.com' }
		});
		expect(sentTo).toBe('hana@example.com');
		expect(email.sent).toHaveLength(1);
		const link = /https:\/\/judging\.example\.com\/ref\?roomId=([0-9a-f-]+)&auth=([A-Za-z0-9]+)/.exec(email.sent[0]!.text);
		expect(link).not.toBeNull();

		// The Head Ref opens the emailed link and finds the division already linked.
		const ref = await connectRef(link![1]!, link![2]!);
		const kit = await ref.wrpc.session.join.mutation();
		expect(kit.self).toMatchObject({ name: 'Hana', role: 'head_referee' });
		expect(kit.linkedDivisions.map((division) => division.judgesRoomId)).toEqual([roomId]);
		expect(kit.teams.map((team) => team.number)).toEqual(['1A']);
		expect((await judges.refLink.getStatus.query()).linkedTo).not.toBeNull();

		// Once linked, it cannot be set up a second time.
		await expect(
			judges.refLink.createRefRoom.mutation({ scope: 'room', headReferee: { name: 'Other', email: 'other@example.com' } })
		).rejects.toThrow('already linked');
	});

	it('keeps nothing when the Head Ref email cannot be sent', async () => {
		const roomId = crypto.randomUUID();
		const token = await seedJudgesRoom(roomId, { divisionId: 1, teams: [] });
		const judges = connectJudges(roomId, token);
		email.sender.send = async () => {
			throw new Error('550 mailbox unavailable');
		};

		await expect(
			judges.refLink.createRefRoom.mutation({ scope: 'room', headReferee: { name: 'Hana', email: 'bounce@example.com' } })
		).rejects.toThrow('Nothing was created');
		expect((await judges.refLink.getStatus.query()).linkedTo).toBeNull();
		const refRoomsDir = path.join(dataDir, 'ref-rooms');
		expect(fs.existsSync(refRoomsDir) ? fs.readdirSync(refRoomsDir).filter((name) => name.endsWith('.sqlite')) : []).toEqual([]);
	});

	it('refuses to create when the server cannot email, so codes are the way in', async () => {
		email.sender = { enabled: false, fromAddress: null, send: async () => {} };
		const roomId = crypto.randomUUID();
		const token = await seedJudgesRoom(roomId, { divisionId: 1, teams: [] });
		const judges = connectJudges(roomId, token);
		expect((await judges.refLink.getStatus.query()).emailEnabled).toBe(false);
		await expect(
			judges.refLink.createRefRoom.mutation({ scope: 'room', headReferee: { name: 'Hana', email: 'hana@example.com' } })
		).rejects.toThrow('Email is not set up');
	});

	it('creates referee notes for a whole event group from one of its advisors', async () => {
		const groupId = crypto.randomUUID();
		const science = crypto.randomUUID();
		const technology = crypto.randomUUID();
		await seedJudgesRoom(science, { divisionId: 1, teams: ['1A'], groupId });
		await seedJudgesRoom(technology, { divisionId: 2, teams: ['2B'], groupId });
		const group = await hub.onGroup(groupId, (g) =>
			g.createGroup({ groupId, name: 'State', roomId: science, divisionLabel: 'Science', advisorName: 'Group JA', advisorEmail: null })
		);
		if (!group.ok) throw new Error(group.error);
		await hub.onGroup(groupId, (g) => g.attachRoom({ authToken: group.authToken, roomId: technology, label: 'Technology' }));

		const groupAdvisor = connectJudges(science, group.authToken);
		await groupAdvisor.refLink.createRefRoom.mutation({ scope: 'group', headReferee: { name: 'Hana', email: 'hana@example.com' } });

		const link = /roomId=([0-9a-f-]+)&auth=([A-Za-z0-9]+)/.exec(email.sent.at(-1)!.text)!;
		const kit = await (await connectRef(link[1]!, link[2]!)).wrpc.session.join.mutation();
		expect(kit.event.eventName).toBe('State');
		expect(kit.linkedDivisions.map((division) => division.label).sort()).toEqual(['Science', 'Technology']);
		expect(kit.teams.map((team) => team.number)).toEqual(['1A', '2B']);
	});

	it('shows Judge Advisors the notes about their own teams, never refs-only ones, and says when they change', async () => {
		const science = crypto.randomUUID();
		const technology = crypto.randomUUID();
		const scienceToken = await seedJudgesRoom(science, { divisionId: 1, teams: ['1A', '1B'] });
		const technologyToken = await seedJudgesRoom(technology, { divisionId: 2, teams: ['2A'] });
		let scienceSignals = 0;
		const scienceJA = connectJudges(science, scienceToken, { onRefNotesChanged: () => void scienceSignals++ });
		const technologyJA = connectJudges(technology, technologyToken);

		// Before linking there is nothing to see.
		expect(await scienceJA.refLink.listNotes.query()).toEqual({ linked: false, refsUsingApp: false, notes: [] });

		const ref = await createRefRoom();
		await ref.wrpc.links.link.mutation({ code: (await scienceJA.refLink.createCode.mutation({ scope: 'room' })).code });
		await ref.wrpc.links.link.mutation({ code: (await technologyJA.refLink.createCode.mutation({ scope: 'room' })).code });

		const log = (teamNumber: string, note: string, isPrivate = false, id: string = crypto.randomUUID()) =>
			ref.wrpc.incidents.save.mutation({
				id,
				context: 'match',
				teamNumber,
				matchId: null,
				matchName: 'Q 4',
				skillsRunType: null,
				ruleCodes: ['SG6'],
				severity: 'minor',
				note,
				private: isPrivate
			});

		const signalsBefore = scienceSignals;
		const sharedId = crypto.randomUUID();
		await log('1A', 'Held a pin', false, sharedId);
		await log('1B', 'Field reset, refs only', true);
		await log('2A', 'Other division');
		await eventually(() => expect(scienceSignals).toBeGreaterThan(signalsBefore));

		const science1 = await scienceJA.refLink.listNotes.query();
		expect(science1.linked).toBe(true);
		expect(science1.notes.map((note) => note.note)).toEqual(['Held a pin']);
		expect(science1.notes[0]).not.toHaveProperty('private');
		expect(science1.notes[0]).not.toHaveProperty('authorRefereeId');
		expect((await technologyJA.refLink.listNotes.query()).notes.map((note) => note.note)).toEqual(['Other division']);

		// Marking a shared note refs only takes it away from the Judge Advisors.
		await log('1A', 'Held a pin', true, sharedId);
		expect((await scienceJA.refLink.listNotes.query()).notes).toEqual([]);

		// Unlinked, the division sees nothing again.
		await ref.wrpc.links.unlink.mutation({ judgesRoomId: science });
		expect(await scienceJA.refLink.listNotes.query()).toEqual({ linked: false, refsUsingApp: false, notes: [] });
	});
	describe('when the refs are not using the app', () => {
		const note = (teamNumber: string, text: string, id: string = crypto.randomUUID()) => ({
			id,
			context: 'match' as const,
			teamNumber,
			matchName: 'Q 12',
			skillsRunType: null,
			ruleCodes: ['<sg6>'],
			severity: 'minor' as const,
			note: text
		});

		it('lets a Judge Advisor start notes, and write, correct and remove what the refs tell them', async () => {
			const science = crypto.randomUUID();
			const technology = crypto.randomUUID();
			const scienceToken = await seedJudgesRoom(science, { divisionId: 1, teams: ['1A'] });
			const technologyToken = await seedJudgesRoom(technology, { divisionId: 2, teams: ['2A'] });
			const scienceJA = connectJudges(science, scienceToken);
			const technologyJA = connectJudges(technology, technologyToken);

			await expect(scienceJA.refLink.saveNote.mutation(note('1A', 'Pinning'))).rejects.toThrow("isn't linked");

			await scienceJA.refLink.start.mutation();
			// Starting twice keeps the one room.
			await scienceJA.refLink.start.mutation();
			expect((await scienceJA.refLink.getStatus.query()).linkedTo).toEqual({ eventName: 'Regional', refsUsingApp: false });
			expect(new DataDirectory(dataDir).listRefRoomIds()).toHaveLength(1);

			const id = crypto.randomUUID();
			await scienceJA.refLink.saveNote.mutation(note('1A', 'Pinning', id));
			await expect(scienceJA.refLink.saveNote.mutation(note('2A', 'Not ours'))).rejects.toThrow("isn't in this division");

			const listed = await scienceJA.refLink.listNotes.query();
			expect(listed).toMatchObject({ linked: true, refsUsingApp: false });
			expect(listed.notes).toEqual([
				expect.objectContaining({ id, teamNumber: '1A', ruleCodes: ['SG6'], authorName: 'JA (Judge Advisor)', editable: true })
			]);

			await scienceJA.refLink.saveNote.mutation({ ...note('1A', 'Pinning, warned'), id });
			expect((await scienceJA.refLink.listNotes.query()).notes.map((item) => item.note)).toEqual(['Pinning, warned']);

			// Another division's advisor can neither see nor touch it.
			await technologyJA.refLink.start.mutation();
			expect((await technologyJA.refLink.listNotes.query()).notes).toEqual([]);
			await technologyJA.refLink.removeNote.mutation({ id });
			expect((await scienceJA.refLink.listNotes.query()).notes).toHaveLength(1);

			await scienceJA.refLink.removeNote.mutation({ id });
			expect((await scienceJA.refLink.listNotes.query()).notes).toEqual([]);
		});

		it("moves the Judge Advisors' notes into the refs' room when the Head Ref links with a code", async () => {
			const roomId = crypto.randomUUID();
			const token = await seedJudgesRoom(roomId, { divisionId: 1, teams: ['1A'] });
			const judges = connectJudges(roomId, token);
			await judges.refLink.start.mutation();
			const id = crypto.randomUUID();
			await judges.refLink.saveNote.mutation(note('1A', 'Told by the Head Ref', id));
			const before = new DataDirectory(dataDir).listRefRoomIds();
			expect(before).toHaveLength(1);

			const ref = await createRefRoom();
			await ref.wrpc.links.link.mutation({ code: (await judges.refLink.createCode.mutation({ scope: 'room' })).code });

			expect((await judges.refLink.getStatus.query()).linkedTo).toEqual({ eventName: 'Regional', refsUsingApp: true });
			const kit = await ref.wrpc.session.join.mutation();
			expect(kit.incidents).toEqual([expect.objectContaining({ id, note: 'Told by the Head Ref', authorRefereeId: null })]);
			// The old, refless room is gone.
			await eventually(() => expect(new DataDirectory(dataDir).listRefRoomIds()).not.toContain(before[0]));

			// Its advisors can still correct what they wrote.
			expect((await judges.refLink.listNotes.query()).notes).toEqual([expect.objectContaining({ id, editable: true })]);
			await judges.refLink.saveNote.mutation({ ...note('1A', 'Corrected'), id });
			expect((await ref.wrpc.session.join.mutation()).incidents.map((item) => item.note)).toEqual(['Corrected']);
		});

		it('moves them too when the Judge Advisor invites the Head Ref by email', async () => {
			const roomId = crypto.randomUUID();
			const token = await seedJudgesRoom(roomId, { divisionId: 1, teams: ['1A'] });
			const judges = connectJudges(roomId, token);
			await judges.refLink.start.mutation();
			await judges.refLink.saveNote.mutation(note('1A', 'Before the refs joined'));

			await judges.refLink.createRefRoom.mutation({ scope: 'room', headReferee: { name: 'Hana', email: 'hana@example.com' } });

			const link = /roomId=([0-9a-f-]+)&auth=([A-Za-z0-9]+)/.exec(email.sent.at(-1)!.text)!;
			const kit = await (await connectRef(link[1]!, link[2]!)).wrpc.session.join.mutation();
			expect(kit.incidents.map((item) => item.note)).toEqual(['Before the refs joined']);
			expect(new DataDirectory(dataDir).listRefRoomIds()).toEqual([link[1]]);
			expect((await judges.refLink.getStatus.query()).linkedTo?.refsUsingApp).toBe(true);
		});

		it('lets a judge send notes about their own teams, and shows them nothing back', async () => {
			const roomId = crypto.randomUUID();
			const jaToken = await seedJudgesRoom(roomId, { divisionId: 1, teams: ['1A', '1B'] });
			const judgeToken = await seedJudge(roomId, 'Jo', ['1A']);
			const ja = connectJudges(roomId, jaToken);
			const judge = connectJudges(roomId, judgeToken);

			await expect(judge.refLink.submitNote.mutation(note('1A', 'Too early'))).rejects.toThrow("aren't set up");
			await ja.refLink.start.mutation();

			const id = crypto.randomUUID();
			await judge.refLink.submitNote.mutation(note('1A', 'Team said they were disabled in Q 12', id));
			// Only their group's teams.
			await expect(judge.refLink.submitNote.mutation(note('1B', 'Not mine'))).rejects.toThrow("isn't one of your judge group's teams");
			// Sending it again is harmless, and cannot rewrite it.
			await judge.refLink.submitNote.mutation({ ...note('1A', 'Rewritten'), id });

			// The Judge Advisor sees it, signed, and can correct it.
			expect((await ja.refLink.listNotes.query()).notes).toEqual([
				expect.objectContaining({ id, note: 'Team said they were disabled in Q 12', authorName: 'Jo (Judge)', editable: true })
			]);

			// A judge reads nothing and changes nothing.
			await expect(judge.refLink.listNotes.query()).rejects.toThrow();
			await expect(judge.refLink.getStatus.query()).rejects.toThrow();
			await expect(judge.refLink.saveNote.mutation({ ...note('1A', 'Edit'), id })).rejects.toThrow();
			await expect(judge.refLink.removeNote.mutation({ id })).rejects.toThrow();
			// And a Judge Advisor uses their own path, not this one.
			await expect(ja.refLink.submitNote.mutation(note('1A', 'JA'))).rejects.toThrow('Only a judge');
		});

		it('lets a judge write about any team in the division with walk-in judging', async () => {
			const roomId = crypto.randomUUID();
			const jaToken = await seedJudgesRoom(roomId, { divisionId: 1, teams: ['1A', '1B'] });
			const judgeToken = await seedJudge(roomId, 'Jo', [], 'walk_in');
			await connectJudges(roomId, jaToken).refLink.start.mutation();

			await connectJudges(roomId, judgeToken).refLink.submitNote.mutation(note('1B', 'Walked in'));
			await expect(connectJudges(roomId, judgeToken).refLink.submitNote.mutation(note('9Z', 'Elsewhere'))).rejects.toThrow(
				"isn't in this division"
			);
		});

		it('deletes a refless room when its division unlinks', async () => {
			const roomId = crypto.randomUUID();
			const token = await seedJudgesRoom(roomId, { divisionId: 1, teams: ['1A'] });
			const judges = connectJudges(roomId, token);
			await judges.refLink.start.mutation();
			expect(new DataDirectory(dataDir).listRefRoomIds()).toHaveLength(1);

			await judges.refLink.unlink.mutation();
			await eventually(() => expect(new DataDirectory(dataDir).listRefRoomIds()).toEqual([]));
		});

		it('creates referee notes for a new event, and keeps the link through later setup saves', async () => {
			const roomId = crypto.randomUUID();
			const judges = connectJudges(roomId, null);
			const essential = {
				eventName: 'Fresh Event',
				robotEventsSku: null,
				robotEventsEventId: null,
				divisionId: null,
				program: 'V5RC' as const,
				eventGradeLevel: 'HS Only' as const,
				judgingMethod: 'walk_in' as const,
				judgingStep: 'beginning' as const,
				accessControlEnabled: true,
				awards: [],
				teamInfos: [],
				judgeGroups: [{ id: crypto.randomUUID(), name: 'Group 1', assignedTeams: [] }]
			};
			await judges.handshake.createJudgesRoom.mutation({
				essentialData: essential,
				teamData: [],
				judges: [],
				judgeAdvisorName: 'Ana'
			});
			await eventually(async () =>
				expect((await judges.refLink.getStatus.query()).linkedTo).toEqual({ eventName: 'Fresh Event', refsUsingApp: false })
			);

			await judges.essential.updateEssentialData.mutation({ ...essential, eventName: 'Renamed' });
			expect((await judges.refLink.getStatus.query()).linkedTo).not.toBeNull();
			expect(new DataDirectory(dataDir).listRefRoomIds()).toHaveLength(1);
		});
	});
});
