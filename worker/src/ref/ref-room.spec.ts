import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { createWRPCClient, type WebsocketClient } from '@robotools.app/wrpc/client';
import { REF_RPC_PATH, RefCloseReason, type CreateRefRoomRequest, type Incident } from '@robotools.app/protocol/src/ref';
import { buildRefClientRouter, type RefClientRouter } from '@robotools.app/web/src/lib/ref/ref-client-router-def';
import { createServer } from '../server';
import { createRecordingEmailContext } from '../test-utils';
import type { RefServerRouter } from './router';
import type { WRPCClient } from '@robotools.app/wrpc/client';

/**
 * A ref room end to end: the real server, real sockets, the real client library.
 *
 * The unit tests in store.spec.ts cover the rules. This covers what only shows up when the
 * pieces are joined — who gets let in, who hears about what, and what a removed ref sees.
 */

type Received = { saved: Incident[]; removed: string[]; refereeUpdates: number };

type Connected = {
	client: WebsocketClient<RefClientRouter>;
	wrpc: WRPCClient<RefServerRouter>;
	received: Received;
	closed: Promise<{ code: number; reason: string }>;
};

const request: CreateRefRoomRequest = {
	kind: 'create',
	event: { eventName: 'Regional', program: 'V5RC', robotEventsSku: null, robotEventsEventId: null, divisions: [] },
	teams: [
		{ number: '1234A', name: 'Alpha', school: 'North' },
		{ number: '99X', name: 'Xray', school: 'South' }
	],
	headReferee: { name: 'Hana', email: 'hana@example.com' }
};

describe('ref room over the network', () => {
	let dataDir: string;
	let baseUrl: string;
	let wsUrl: string;
	let stop: () => Promise<void>;
	let email: ReturnType<typeof createRecordingEmailContext>;
	const clients: WebsocketClient<RefClientRouter>[] = [];

	beforeEach(async () => {
		dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ref-room-'));
		email = createRecordingEmailContext('https://judging.example.com');
		const { server, hub } = createServer({
			port: 0,
			host: '127.0.0.1',
			dataDir,
			staticDir: null,
			adminUsername: null,
			adminPassword: null,
			email,
			retention: { enabled: false, deleteAfterDays: 7, warnAfterDays: 5 }
		});
		await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
		const { port } = server.address() as AddressInfo;
		baseUrl = `http://127.0.0.1:${port}`;
		wsUrl = `ws://127.0.0.1:${port}/ref-ws`;
		stop = async () => {
			for (const client of clients.splice(0)) {
				client.disconnect();
			}
			hub.closeConnections();
			await new Promise<void>((resolve) => server.close(() => resolve()));
			hub.close();
		};
	});

	afterEach(async () => {
		await stop();
		fs.rmSync(dataDir, { recursive: true, force: true });
	});

	async function createRoom(): Promise<{ roomId: string; authToken: string }> {
		const response = await fetch(`${baseUrl}${REF_RPC_PATH}`, { method: 'POST', body: JSON.stringify(request) });
		expect(response.status).toBe(200);
		return (await response.json()) as { roomId: string; authToken: string };
	}

	function connect(roomId: string, authToken: string | null): Connected {
		const received: Received = { saved: [], removed: [], refereeUpdates: 0 };
		let resolveClosed: (value: { code: number; reason: string }) => void = () => {};
		const closed = new Promise<{ code: number; reason: string }>((resolve) => (resolveClosed = resolve));

		const router = buildRefClientRouter({
			onIncidentSaved: (incident) => void received.saved.push(incident),
			onIncidentRemoved: ({ id }) => void received.removed.push(id),
			onRefereesUpdate: () => void received.refereeUpdates++,
			onTeamsUpdate: () => {},
			onLinkedDivisionsUpdate: () => {}
		});

		const [client, wrpc] = createWRPCClient<RefServerRouter, RefClientRouter>(
			{
				wsUrl: authToken ? `${wsUrl}?auth=${authToken}` : wsUrl,
				roomId,
				clientId: crypto.randomUUID(),
				deviceId: crypto.randomUUID(),
				deviceName: 'Test phone',
				onContext: async () => ({}),
				onOpen: () => {},
				onClosed: (code, reason) => resolveClosed({ code, reason }),
				onConnectionStateChange: () => {}
			},
			router
		);
		clients.push(client);
		return { client, wrpc, received, closed };
	}

	async function eventually(check: () => void, timeoutMs = 2000): Promise<void> {
		const deadline = Date.now() + timeoutMs;
		for (;;) {
			try {
				check();
				return;
			} catch (error) {
				if (Date.now() > deadline) throw error;
				await new Promise((resolve) => setTimeout(resolve, 20));
			}
		}
	}

	it('creates a room, emails the Head Ref their link, and lets them in', async () => {
		const { roomId, authToken } = await createRoom();

		expect(email.sent).toHaveLength(1);
		expect(email.sent[0]!.to).toBe('hana@example.com');
		expect(email.sent[0]!.text).toContain(`https://judging.example.com/ref?roomId=${roomId}&auth=${authToken}`);
		expect(fs.existsSync(path.join(dataDir, 'ref-rooms', `${roomId}.sqlite`))).toBe(true);

		const head = connect(roomId, authToken);
		const kit = await head.wrpc.session.join.mutation();
		expect(kit.self).toMatchObject({ name: 'Hana', role: 'head_referee' });
		// Numeric order, the way the pit map reads.
		expect(kit.teams.map((team) => team.number)).toEqual(['99X', '1234A']);
	});

	it('refuses an unknown link and a room that does not exist, with reasons the app can show', async () => {
		const { roomId } = await createRoom();

		const stranger = connect(roomId, 'AAAAAAAAAAAA');
		await expect(stranger.wrpc.session.join.mutation()).rejects.toThrow();
		expect((await stranger.closed).reason).toBe(RefCloseReason.INVALID_ACCESS_LINK);

		const missingId = crypto.randomUUID();
		const lost = connect(missingId, 'AAAAAAAAAAAA');
		await expect(lost.wrpc.session.join.mutation()).rejects.toThrow();
		expect((await lost.closed).reason).toBe(RefCloseReason.ROOM_NOT_FOUND);
		// Asking about a room that does not exist must not create one.
		expect(fs.existsSync(path.join(dataDir, 'ref-rooms', `${missingId}.sqlite`))).toBe(false);
	});

	it('shares incidents live, and only a Head Ref can manage refs', async () => {
		const { roomId, authToken } = await createRoom();
		const head = connect(roomId, authToken);
		await head.wrpc.session.join.mutation();

		const ray = await head.wrpc.referees.add.mutation({ name: 'Ray', role: 'referee', email: null });
		const { authToken: rayToken } = await head.wrpc.referees.getLink.query({ refereeId: ray.id });

		const field = connect(roomId, rayToken);
		const kit = await field.wrpc.session.join.mutation();
		expect(kit.self).toMatchObject({ refereeId: ray.id, role: 'referee' });

		const id = crypto.randomUUID();
		await field.wrpc.incidents.save.mutation({
			id,
			context: 'match',
			teamNumber: '1234A',
			matchId: 1,
			matchName: 'Q 1',
			skillsRunType: null,
			ruleCodes: ['SG6'],
			severity: 'warning',
			note: 'Possession, warned',
			private: true
		});
		await eventually(() => expect(head.received.saved.map((incident) => incident.id)).toContain(id));
		expect(head.received.saved[0]).toMatchObject({ authorName: 'Ray', private: true });

		await expect(field.wrpc.referees.add.mutation({ name: 'Sneaky', role: 'head_referee', email: null })).rejects.toThrow(
			'Only a Head Referee'
		);
		await expect(field.wrpc.event.destroy.mutation()).rejects.toThrow('Only a Head Referee');

		await head.wrpc.incidents.remove.mutation({ id });
		await eventually(() => expect(field.received.removed).toContain(id));
	});

	it('signs a removed ref out with a reason, and keeps what they logged', async () => {
		const { roomId, authToken } = await createRoom();
		const head = connect(roomId, authToken);
		await head.wrpc.session.join.mutation();
		const ray = await head.wrpc.referees.add.mutation({ name: 'Ray', role: 'referee', email: null });
		const { authToken: rayToken } = await head.wrpc.referees.getLink.query({ refereeId: ray.id });

		const field = connect(roomId, rayToken);
		await field.wrpc.session.join.mutation();
		await field.wrpc.incidents.save.mutation({
			id: crypto.randomUUID(),
			context: 'skills',
			teamNumber: '99X',
			matchId: null,
			matchName: null,
			skillsRunType: 'programming',
			ruleCodes: [],
			severity: 'note',
			note: 'Field reset late',
			private: false
		});

		await head.wrpc.referees.remove.mutation({ refereeId: ray.id });
		expect((await field.closed).reason).toBe(RefCloseReason.ACCESS_CHANGED);

		const after = await head.wrpc.session.join.mutation();
		expect(after.referees.map((referee) => referee.name)).toEqual(['Hana']);
		expect(after.incidents[0]).toMatchObject({ authorName: 'Ray', authorRefereeId: null });

		// The old link no longer opens the room.
		const again = connect(roomId, rayToken);
		await expect(again.wrpc.session.join.mutation()).rejects.toThrow();
		expect((await again.closed).reason).toBe(RefCloseReason.INVALID_ACCESS_LINK);
	});

	it('replacing a Head Ref’s own link keeps the device that asked signed in', async () => {
		const { roomId, authToken } = await createRoom();
		const head = connect(roomId, authToken);
		const kit = await head.wrpc.session.join.mutation();
		const otherDevice = connect(roomId, authToken);
		await otherDevice.wrpc.session.join.mutation();

		const rotated = await head.wrpc.referees.rotateLink.mutation({ refereeId: kit.self.refereeId });
		expect(rotated.authToken).not.toBe(authToken);
		expect((await otherDevice.closed).reason).toBe(RefCloseReason.ACCESS_CHANGED);
		// Still connected and still allowed.
		expect((await head.wrpc.session.join.mutation()).self.role).toBe('head_referee');
	});

	it('emails links only when asked, reports each ref, and paces repeat sends', async () => {
		const { roomId, authToken } = await createRoom();
		const head = connect(roomId, authToken);
		const kit = await head.wrpc.session.join.mutation();
		expect(kit.emailCapability).toEqual({ enabled: true, fromAddress: 'judging@example.com' });
		email.sent.length = 0;

		const ray = await head.wrpc.referees.add.mutation({ name: 'Ray', role: 'referee', email: 'ray@example.com' });
		await head.wrpc.referees.add.mutation({ name: 'Bad', role: 'referee', email: 'bounce@example.com' });
		await head.wrpc.referees.add.mutation({ name: 'Nomail', role: 'referee', email: null });
		// Adding someone sends nothing by itself.
		expect(email.sent).toHaveLength(0);

		const realSend = email.sender.send.bind(email.sender);
		email.sender.send = async (message) => {
			if (message.to === 'bounce@example.com') throw new Error('550 mailbox unavailable');
			await realSend(message);
		};

		const { results } = await head.wrpc.referees.sendLinks.mutation({ refereeIds: null });
		const outcome = Object.fromEntries(results.map((result) => [result.name, result.outcome]));
		// Hana is the Head Ref; her address came in with the room.
		expect(outcome).toEqual({ Hana: 'sent', Ray: 'sent', Bad: 'failed', Nomail: 'no_address' });
		expect(results.find((result) => result.name === 'Bad')!.error).toContain('550');
		expect(email.sent.map((message) => message.to).sort()).toEqual(['hana@example.com', 'ray@example.com']);
		expect(email.sent.find((message) => message.to === 'ray@example.com')!.text).not.toContain(authToken);

		// Straight away again is refused: a stuck client must not burn the day's mail quota.
		await expect(head.wrpc.referees.sendLinks.mutation({ refereeIds: [ray.id] })).rejects.toThrow('Sending too quickly');
	});

	it('refuses to email when the server has no email set up', async () => {
		email.sender = { enabled: false, fromAddress: null, send: async () => {} };
		const { roomId, authToken } = await createRoom();
		const head = connect(roomId, authToken);
		const kit = await head.wrpc.session.join.mutation();
		expect(kit.emailCapability.enabled).toBe(false);
		await expect(head.wrpc.referees.sendLinks.mutation({ refereeIds: null })).rejects.toThrow('not set up');
	});

	it('deletes the room file when a Head Ref destroys it', async () => {
		const { roomId, authToken } = await createRoom();
		const head = connect(roomId, authToken);
		await head.wrpc.session.join.mutation();

		await head.wrpc.event.destroy.mutation().catch(() => {
			// The socket closes as part of destroying, which can beat the reply.
		});
		await eventually(() => expect(fs.existsSync(path.join(dataDir, 'ref-rooms', `${roomId}.sqlite`))).toBe(false));
	});
});
