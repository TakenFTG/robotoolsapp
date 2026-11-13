import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { ConnectAuthCloseReason } from '@robotools.app/protocol/src/access';
import { createServer } from '../server';
import { createRecordingEmailContext } from '../test-utils';
import { DataDirectory, migrationsPath, openDatabase } from './storage';
import { metadata } from '../db/schema';

/**
 * A refused connection has to learn why promptly.
 *
 * The room pauses a socket while it decides whether to admit it. Refusing without resuming
 * left the closing handshake waiting on a reply the paused socket never read, so the device
 * sat for ws's thirty-second close timeout before it could tell the judge their link was bad.
 */
describe('refused Judges Room connection', () => {
	let dataDir: string;
	let port: number;
	let stop: () => Promise<void>;
	const roomId = crypto.randomUUID();

	beforeEach(async () => {
		dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'room-refusal-'));

		// A room with access control on, so a link that matches nobody is refused.
		const storage = openDatabase(new DataDirectory(dataDir).roomFile(roomId), migrationsPath('migrations'));
		await storage.db.insert(metadata).values({
			eventName: 'Regional',
			program: 'V5RC',
			eventGradeLevel: 'HS Only',
			judgingMethod: 'assigned',
			judgingStep: 'beginning',
			accessControlEnabled: true
		});
		storage.close();

		const { server, hub } = createServer({
			port: 0,
			host: '127.0.0.1',
			dataDir,
			staticDir: null,
			adminUsername: null,
			adminPassword: null,
			email: createRecordingEmailContext(),
			retention: { enabled: false, deleteAfterDays: 7, warnAfterDays: 5 }
		});
		await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
		port = (server.address() as AddressInfo).port;
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

	it('tells the device why within a moment, not after the close timeout', async () => {
		const url = new URL(`ws://127.0.0.1:${port}/ws`);
		url.searchParams.set('roomId', roomId);
		url.searchParams.set('clientId', crypto.randomUUID());
		url.searchParams.set('deviceId', crypto.randomUUID());
		url.searchParams.set('deviceName', 'Test');
		url.searchParams.set('action', 'join');
		url.searchParams.set('auth', 'AAAAAAAAAAAA');

		const started = Date.now();
		const closed = await new Promise<{ reason: string }>((resolve) => {
			const ws = new WebSocket(url);
			ws.onclose = (event) => resolve({ reason: event.reason });
		});

		expect(closed.reason).toBe(ConnectAuthCloseReason.INVALID_ACCESS_LINK);
		expect(Date.now() - started).toBeLessThan(2000);
	});
});
