import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import WebSocket from 'ws';
import { createServer } from '../server';
import { createRecordingEmailContext } from '../test-utils';
import type { Hub } from './hub';

/**
 * A device connecting while the room's lock is held.
 *
 * The browser sends its first request the moment the socket opens, which can be long before
 * the room gets round to attaching that socket. The request has to wait, not vanish: a lost
 * join leaves the judge on the joining screen until the client gives up thirty seconds later.
 */
describe('connecting while the room is busy', () => {
	let dataDir: string;
	let port: number;
	let hub: Hub;
	let stop: () => Promise<void>;

	beforeEach(async () => {
		dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'room-connect-'));
		const created = createServer({
			port: 0,
			host: '127.0.0.1',
			dataDir,
			staticDir: null,
			adminUsername: null,
			adminPassword: null,
			email: createRecordingEmailContext('https://judging.example.com'),
			retention: { enabled: false, deleteAfterDays: 7, warnAfterDays: 5 }
		});
		hub = created.hub;
		await new Promise<void>((resolve) => created.server.listen(0, '127.0.0.1', resolve));
		port = (created.server.address() as AddressInfo).port;
		stop = async () => {
			hub.closeConnections();
			await new Promise<void>((resolve) => created.server.close(() => resolve()));
			hub.close();
		};
	});

	afterEach(async () => {
		await stop();
		fs.rmSync(dataDir, { recursive: true, force: true });
	});

	it('answers a request sent before the socket was attached', async () => {
		const roomId = crypto.randomUUID();
		const room = hub.room(roomId);

		let releaseLock = () => {};
		const lockHeld = new Promise<void>((resolve) => (releaseLock = resolve));
		void room.mutex.run(() => lockHeld);

		const query = new URLSearchParams({
			roomId,
			clientId: crypto.randomUUID(),
			deviceId: crypto.randomUUID(),
			deviceName: 'Test phone',
			action: 'join'
		});
		const socket = new WebSocket(`ws://127.0.0.1:${port}/ws?${query}`);
		const answered = new Promise<{ id: string }>((resolve) => {
			socket.on('message', (data) => resolve(JSON.parse(String(data)) as { id: string }));
		});

		await new Promise<void>((resolve) => socket.on('open', () => resolve()));
		socket.send(JSON.stringify({ kind: 'request', id: 'first', type: 'mutation', path: 'handshake.joinJudgesRoom' }));

		// Long enough for the frame to reach the server while the lock is still held.
		await new Promise((resolve) => setTimeout(resolve, 100));
		releaseLock();

		const outcome = await Promise.race([answered, new Promise<null>((resolve) => setTimeout(() => resolve(null), 2_000))]);
		socket.close();

		// This room was never set up, so the answer is a refusal. Any answer proves it arrived.
		expect(outcome?.id).toBe('first');
	});
});
