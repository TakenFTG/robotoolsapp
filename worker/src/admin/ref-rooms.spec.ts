import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { ADMIN_RPC_PATH, type AdminAction, type AdminResponse } from '@robotools.app/protocol/src/admin';
import { REF_RPC_PATH, type CreateRefRoomRequest } from '@robotools.app/protocol/src/ref';
import { createServer } from '../server';
import { createRecordingEmailContext } from '../test-utils';

/**
 * The operator's view of ref rooms, through the real server.
 *
 * What matters is that the list reads the folder, that detail stays on the counts side of
 * the line (no incident text, no referee email or link), and that destroy removes the file.
 */

const USER = 'operator';
const PASSWORD = 'a-long-and-unguessable-password';

const request: CreateRefRoomRequest = {
	kind: 'create',
	event: {
		eventName: 'Regional',
		program: 'V5RC',
		robotEventsSku: 'RE-V5RC-26-0001',
		robotEventsEventId: null,
		divisions: [{ id: 1, name: 'Division 1' }]
	},
	teams: [{ number: '1234A', name: 'Alpha', school: 'North' }],
	headReferee: { name: 'Hana', email: 'hana@example.com' }
};

describe('admin ref rooms', () => {
	let dataDir: string;
	let baseUrl: string;
	let stop: () => Promise<void>;

	beforeEach(async () => {
		dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'admin-ref-'));
		const { server, hub } = createServer({
			port: 0,
			host: '127.0.0.1',
			dataDir,
			staticDir: null,
			adminUsername: USER,
			adminPassword: PASSWORD,
			email: createRecordingEmailContext('https://judging.example.com'),
			retention: { enabled: false, deleteAfterDays: 7, warnAfterDays: 5 }
		});
		await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
		baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
		stop = async () => {
			hub.closeConnections();
			await new Promise<void>((resolve) => server.close(() => resolve()));
			hub.close();
		};
	});

	afterEach(async () => {
		await stop();
		fs.rmSync(dataDir, { recursive: true, force: true });
	});

	async function admin(token: string | null, action: AdminAction): Promise<{ status: number; body: AdminResponse }> {
		const response = await fetch(`${baseUrl}${ADMIN_RPC_PATH}`, { method: 'POST', body: JSON.stringify({ token, action }) });
		return { status: response.status, body: (await response.json()) as AdminResponse };
	}

	async function signIn(): Promise<string> {
		const { body } = await admin(null, { kind: 'login', username: USER, password: PASSWORD });
		if (body.kind !== 'session') throw new Error('expected a session');
		return body.token;
	}

	async function createRefRoom(): Promise<string> {
		const response = await fetch(`${baseUrl}${REF_RPC_PATH}`, { method: 'POST', body: JSON.stringify(request) });
		expect(response.status).toBe(200);
		return ((await response.json()) as { roomId: string }).roomId;
	}

	it('refuses without a session', async () => {
		expect((await admin(null, { kind: 'list_ref_rooms' })).status).toBe(401);
	});

	it('lists, details and destroys a ref room', async () => {
		const token = await signIn();
		const refRoomId = await createRefRoom();

		const list = await admin(token, { kind: 'list_ref_rooms' });
		expect(list.body).toMatchObject({
			kind: 'ref_rooms',
			refRooms: [{ refRoomId, eventName: 'Regional', program: 'V5RC', refereeCount: 1, linkedDivisionCount: 0 }]
		});

		const detail = await admin(token, { kind: 'ref_room_detail', refRoomId });
		expect(detail.body.kind).toBe('ref_room');
		if (detail.body.kind !== 'ref_room' || !detail.body.refRoom) throw new Error('expected detail');
		expect(detail.body.refRoom).toMatchObject({
			referees: [{ name: 'Hana', role: 'head_referee' }],
			divisions: [{ id: 1, name: 'Division 1' }],
			incidentCount: 0,
			onlineDeviceCount: 0
		});
		// Names and roles only: the email and the access link stay in the room.
		const serialised = JSON.stringify(detail.body);
		expect(serialised).not.toContain('hana@example.com');
		expect(detail.body.refRoom.referees[0]).not.toHaveProperty('authToken');

		expect((await admin(token, { kind: 'destroy_ref_room', refRoomId })).body).toEqual({ kind: 'ok' });
		expect((await admin(token, { kind: 'list_ref_rooms' })).body).toEqual({ kind: 'ref_rooms', refRooms: [] });
		expect(fs.existsSync(path.join(dataDir, 'ref-rooms', `${refRoomId}.sqlite`))).toBe(false);
	});

	it('adds a ref whose link works, and removes them', async () => {
		const token = await signIn();
		const refRoomId = await createRefRoom();

		const added = await admin(token, { kind: 'add_referee', refRoomId, name: 'Rio', role: 'referee' });
		expect(added.body.kind).toBe('access_link');
		if (added.body.kind !== 'access_link') throw new Error('expected a link');

		const detail = await admin(token, { kind: 'ref_room_detail', refRoomId });
		if (detail.body.kind !== 'ref_room' || !detail.body.refRoom) throw new Error('expected detail');
		const rio = detail.body.refRoom.referees.find((referee) => referee.name === 'Rio');
		expect(rio).toMatchObject({ role: 'referee' });
		// The link is never readable back from the detail.
		expect(JSON.stringify(detail.body)).not.toContain(added.body.authToken);

		expect((await admin(token, { kind: 'remove_referee', refRoomId, refereeId: rio!.id })).body).toEqual({ kind: 'ok' });
		const after = await admin(token, { kind: 'ref_room_detail', refRoomId });
		if (after.body.kind !== 'ref_room' || !after.body.refRoom) throw new Error('expected detail');
		expect(after.body.refRoom.referees.map((referee) => referee.name)).toEqual(['Hana']);
	});

	it('refuses to remove the last Head Referee', async () => {
		const token = await signIn();
		const refRoomId = await createRefRoom();
		const detail = await admin(token, { kind: 'ref_room_detail', refRoomId });
		if (detail.body.kind !== 'ref_room' || !detail.body.refRoom) throw new Error('expected detail');
		const hana = detail.body.refRoom.referees[0]!;

		const refused = await admin(token, { kind: 'remove_referee', refRoomId, refereeId: hana.id });
		expect(refused.status).toBe(400);
		expect(refused.body).toMatchObject({ error: expect.stringContaining('Head Referee') });
	});

	it('does not create a file for a ref room that does not exist', async () => {
		const token = await signIn();
		const missing = '550e8400-e29b-41d4-a716-446655449abc';
		expect((await admin(token, { kind: 'ref_room_detail', refRoomId: missing })).status).toBe(404);
		expect((await admin(token, { kind: 'destroy_ref_room', refRoomId: missing })).status).toBe(404);
		expect(fs.existsSync(path.join(dataDir, 'ref-rooms', `${missing}.sqlite`))).toBe(false);
	});
});
