import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { GROUP_RPC_PATH } from '@robotools.app/protocol/src/group';
import { createServer } from '../server';
import { createRecordingEmailContext } from '../test-utils';
import { DataDirectory, migrationsPath, openDatabase } from './storage';
import { metadata } from '../db/schema';

/**
 * Requests anyone can send must not create storage.
 *
 * Opening a room or a group creates its database file. These HTTP paths used to open
 * whatever id they were given, so each request with a made-up id left a new database on
 * disk and an open handle in memory, with no credentials needed and no limit. A loop of
 * requests could fill the disk that every real event lives on.
 */
describe('anonymous requests for rooms and groups that do not exist', () => {
	let dataDir: string;
	let staticDir: string;
	let base: string;
	let stop: () => Promise<void>;
	const existingRoomId = crypto.randomUUID();

	/** Every database file under the data directory, so any new one shows up. */
	function databaseFiles(): string[] {
		return fs
			.readdirSync(dataDir, { recursive: true, encoding: 'utf8' })
			.filter((file) => file.endsWith('.sqlite'))
			.sort();
	}

	beforeEach(async () => {
		dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'anonymous-reads-'));
		staticDir = fs.mkdtempSync(path.join(os.tmpdir(), 'anonymous-reads-static-'));
		fs.writeFileSync(path.join(staticDir, 'join.html'), '<html><head><meta name="description" content="Default" /></head></html>');

		const storage = openDatabase(new DataDirectory(dataDir).roomFile(existingRoomId), migrationsPath('migrations'));
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
			staticDir,
			adminUsername: null,
			adminPassword: null,
			email: createRecordingEmailContext(),
			retention: { enabled: false, deleteAfterDays: 7, warnAfterDays: 5 }
		});
		await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
		base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
		stop = async () => {
			hub.closeConnections();
			await new Promise<void>((resolve) => server.close(() => resolve()));
			hub.close();
		};
	});

	afterEach(async () => {
		await stop();
		fs.rmSync(dataDir, { recursive: true, force: true });
		fs.rmSync(staticDir, { recursive: true, force: true });
	});

	it('serves the plain join page without creating a room', async () => {
		const before = databaseFiles();
		const response = await fetch(`${base}/join?roomId=${crypto.randomUUID()}`);
		expect(response.status).toBe(200);
		expect(await response.text()).toContain('content="Default"');
		expect(databaseFiles()).toEqual(before);
	});

	it('serves the plain join page without creating a group', async () => {
		const before = databaseFiles();
		const response = await fetch(`${base}/join?groupId=${crypto.randomUUID()}`);
		expect(response.status).toBe(200);
		expect(databaseFiles()).toEqual(before);
	});

	it('still describes a room that does exist', async () => {
		const response = await fetch(`${base}/join?roomId=${existingRoomId}`);
		expect(await response.text()).toContain('You have been invited to Regional');
	});

	it('answers 404 for a photo in a missing room without creating it', async () => {
		const before = databaseFiles();
		const response = await fetch(`${base}/media/photo?roomId=${crypto.randomUUID()}&photoId=${crypto.randomUUID()}&secret=x`);
		expect(response.status).toBe(404);
		expect(databaseFiles()).toEqual(before);
	});

	it('answers 404 for an upload to a missing room without creating it', async () => {
		const before = databaseFiles();
		const response = await fetch(`${base}/media/upload?roomId=${crypto.randomUUID()}`, {
			method: 'PUT',
			headers: { Authorization: 'Bearer anything', 'Content-Type': 'image/jpeg' },
			body: new Uint8Array([0xff, 0xd8, 0xff])
		});
		expect(response.status).toBe(404);
		expect(databaseFiles()).toEqual(before);
	});

	it('answers 404 for a missing room id that is not even a uuid', async () => {
		const before = databaseFiles();
		const response = await fetch(`${base}/media/photo?roomId=made-up-room&photoId=x&secret=y`);
		expect(response.status).toBe(404);
		expect(databaseFiles()).toEqual(before);
	});

	it('answers 404 for a missing event group without creating it', async () => {
		const before = databaseFiles();
		const response = await fetch(`${base}${GROUP_RPC_PATH}`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				groupId: crypto.randomUUID(),
				auth: 'AAAAAAAAAAAA',
				deviceId: crypto.randomUUID(),
				action: { kind: 'resolve' }
			})
		});
		expect(response.status).toBe(404);
		expect(databaseFiles()).toEqual(before);
	});
});
