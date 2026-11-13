import { DeviceInfoSchema } from '@robotools.app/protocol/src/client';
import type { ServerContext } from '../server-router';
import z from 'zod';
import { offlineDevices } from '../db/schema';
import type { WRPCRootObject } from '@robotools.app/wrpc/server';
import { assertAuthenticatedJudgeAdvisor } from '../access/tokens';
import { broadcastTopic, type ClientSource, subscribeTopic, unsubscribeTopic } from './subscriptions';
import { type DeviceAuthenticated, toDeviceAuthenticated } from '@robotools.app/protocol/src/access';

type DeviceListContext = Pick<ServerContext, 'db' | 'network'>;

export async function getDevices(ctx: DeviceListContext) {
	const listOfOfflineDevices = await ctx.db.select().from(offlineDevices);

	const roles = new Map<string, DeviceAuthenticated>();
	for (const entry of ctx.network.getAllClientAuthentications()) {
		const authenticated = toDeviceAuthenticated(entry.authentication);
		if (authenticated) {
			roles.set(entry.deviceId, authenticated);
		}
	}

	return listOfOfflineDevices.map((device) => ({
		deviceId: device.deviceId,
		deviceName: device.deviceName,
		connectedAt: device.connectedAt.getTime(),
		isOnline: ctx.network.isDeviceConnected(device.deviceId),
		authenticated: roles.get(device.deviceId) ?? null
	}));
}

/**
 * How long connects and disconnects are gathered up before one update goes out.
 *
 * Long enough that fifty judges arriving over a few minutes produce a handful of
 * broadcasts instead of fifty, short enough that a Judge Advisor watching the Users dialog
 * does not notice the delay. Every device that appears in that window is in the update
 * that follows it, because the list is read when the timer fires rather than when it was
 * set — so coalescing loses nothing but the intermediate states nobody was reading.
 */
const DEVICE_LIST_COALESCE_MS = 400;

/**
 * Pending device-list broadcasts, one slot per room.
 *
 * Keyed by database rather than room id because that is what this module is given. A
 * WeakMap so a destroyed room's entry goes with it rather than pinning the handle.
 */
const pendingDeviceListBroadcasts = new WeakMap<object, { timer: ReturnType<typeof setTimeout>; source: ClientSource }>();

/**
 * Drop any pending device-list broadcast for a database that is closing.
 *
 * Without this the timer outlives the connection: it fires four hundred milliseconds
 * later, queries a handle that has been closed, and logs an error for a room that no
 * longer exists. Harmless — it is caught — but it is noise standing in for a leak, and it
 * shows up in every test that tears a room down.
 */
export function cancelDeviceListBroadcast(db: object): void {
	const pending = pendingDeviceListBroadcasts.get(db);
	if (pending) {
		clearTimeout(pending.timer);
		pendingDeviceListBroadcasts.delete(db);
	}
}

/**
 * Tell everyone the device list changed, at most once per window.
 *
 * Every connect and every disconnect calls this, and the list it sends is the whole list.
 * Fifty judges checking in therefore meant fifty broadcasts to up to fifty recipients
 * each — a couple of thousand messages in a burst, at the exact moment everyone is
 * watching the screen. Collapsing a burst into one message costs nothing, because each
 * update supersedes the last completely.
 *
 * The most recent caller's `source` wins. It is only used to reach the connection
 * manager, which is per-room and identical for every caller in that room.
 */
export function broadcastDeviceListUpdate(ctx: DeviceListContext, source: ClientSource) {
	const key = ctx.db as unknown as object;
	const existing = pendingDeviceListBroadcasts.get(key);

	if (existing) {
		// Already scheduled: keep the timer running so a steady stream of arrivals still
		// produces updates at a fixed rate rather than being pushed back indefinitely.
		existing.source = source;
		return;
	}

	const timer = setTimeout(() => {
		const entry = pendingDeviceListBroadcasts.get(key);
		pendingDeviceListBroadcasts.delete(key);
		if (!entry) {
			return;
		}

		// Read the list now, not when the broadcast was requested, so it reflects every
		// change that happened during the window.
		void getDevices(ctx)
			.then((devices) =>
				broadcastTopic(ctx.db, 'deviceList', entry.source, (client) => {
					return client.onDeviceListUpdate.mutation(devices);
				})
			)
			.catch((error: unknown) => {
				console.error('Failed to broadcast the device list:', error);
			});
	}, DEVICE_LIST_COALESCE_MS);

	// Never keep the process alive for a pending device-list update.
	timer.unref?.();

	pendingDeviceListBroadcasts.set(key, { timer, source });
}

export function buildDeviceRoute(w: WRPCRootObject<object, ServerContext, Record<string, never>>) {
	return {
		getDevices: w.procedure.output(z.array(DeviceInfoSchema)).query(async ({ ctx }) => {
			return getDevices(ctx);
		}),

		subscribeDeviceList: w.procedure.output(z.array(DeviceInfoSchema)).mutation(async ({ ctx, session }) => {
			await subscribeTopic(ctx.db, session.currentClient.clientId, 'deviceList');
			return getDevices(ctx);
		}),

		unsubscribeDeviceList: w.procedure.mutation(async ({ ctx, session }) => {
			await unsubscribeTopic(ctx.db, session.currentClient.clientId, 'deviceList');
		}),

		kickDevice: w.procedure.input(z.object({ deviceId: z.string() })).mutation(async ({ ctx, input, session }) => {
			if (await ctx.network.isAccessControlEnabled()) {
				assertAuthenticatedJudgeAdvisor(ctx.auth);
			}
			await ctx.network.kickDevice(input.deviceId);
			// Always broadcast: already-offline kicks do not get a webSocketClose update.
			broadcastDeviceListUpdate(ctx, session);
		})
	};
}
