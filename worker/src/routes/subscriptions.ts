import { eq, and } from 'drizzle-orm';
import { subscriptions } from '../db/schema';
import type { DatabaseOrTransaction } from '../server-router';
import type { RouterProxy } from '@robotools.app/wrpc/server';
import type { ClientRouter } from '../client-router';
import { transaction } from '../utils';

export type ClientSource = { getClient: (clientId: string) => RouterProxy<ClientRouter> };

export async function subscribeTopic(db: DatabaseOrTransaction, clientId: string, topic: string) {
	await db.insert(subscriptions).values({ id: clientId, topic }).onConflictDoNothing();
}

export async function subscribeJudgeGroupTopic(
	db: DatabaseOrTransaction,
	clientId: string,
	judgeGroupIds: string[],
	topic: string,
	exclusive: boolean
) {
	await transaction(db, async (tx) => {
		if (exclusive) {
			await unsubscribeTopic(tx, clientId, topic);
		}
		for (const judgeGroupId of judgeGroupIds) {
			await tx.insert(subscriptions).values({ id: clientId, judgeGroupId, topic }).onConflictDoNothing();
		}
	});
}

export async function unsubscribeTopic(db: DatabaseOrTransaction, clientId: string, topic: string) {
	await db.delete(subscriptions).where(and(eq(subscriptions.id, clientId), eq(subscriptions.topic, topic)));
}

export async function unsubscribeTopics(db: DatabaseOrTransaction, clientId: string) {
	await db.delete(subscriptions).where(eq(subscriptions.id, clientId));
}

/**
 * Deliver to every subscriber, and survive the ones that have gone.
 *
 * A subscription is a row keyed by clientId, but a client is a live socket. The two go out
 * of step constantly — a tab closes, a laptop sleeps, the server restarts — and sending to
 * a client that is no longer connected throws. With `Promise.all` a single such subscriber
 * rejected the whole broadcast, and since callers fire broadcasts without awaiting them,
 * that surfaced as an unhandled rejection and took the process down. One stale row should
 * not be able to stop an event.
 *
 * A failed send is also taken as evidence the row is garbage, so it is removed rather than
 * left to fail again on every future broadcast. Clients resubscribe when they reconnect.
 */
async function deliver<T>(
	db: DatabaseOrTransaction,
	subscriberIds: string[],
	source: ClientSource,
	callback: (client: RouterProxy<ClientRouter>) => Promise<T>
): Promise<T[]> {
	const results = await Promise.allSettled(subscriberIds.map((clientId) => callback(source.getClient(clientId))));

	const delivered: T[] = [];
	const gone: string[] = [];

	results.forEach((result, index) => {
		if (result.status === 'fulfilled') {
			delivered.push(result.value);
		} else {
			gone.push(subscriberIds[index]!);
		}
	});

	for (const clientId of gone) {
		try {
			await unsubscribeTopics(db, clientId);
		} catch (error) {
			console.error('Failed to drop subscriptions for a disconnected client', clientId, error);
		}
	}

	return delivered;
}

export async function broadcastJudgeGroupTopic<T>(
	db: DatabaseOrTransaction,
	judgeGroupId: string,
	topic: string,
	source: ClientSource,
	callback: (client: RouterProxy<ClientRouter>) => Promise<T>
): Promise<T[]> {
	const subscribers = await db
		.select()
		.from(subscriptions)
		.where(and(eq(subscriptions.judgeGroupId, judgeGroupId), eq(subscriptions.topic, topic)));

	return deliver(
		db,
		subscribers.map((subscriber) => subscriber.id),
		source,
		callback
	);
}

export async function broadcastTopic<T>(
	db: DatabaseOrTransaction,
	topic: string,
	source: ClientSource,
	callback: (client: RouterProxy<ClientRouter>) => Promise<T>
): Promise<T[]> {
	const subscribers = await db.select().from(subscriptions).where(eq(subscriptions.topic, topic));

	return deliver(
		db,
		subscribers.map((subscriber) => subscriber.id),
		source,
		callback
	);
}

/**
 * Forget every subscription in this room.
 *
 * Called when a room is opened. Subscriptions name clientIds, and a clientId belongs to a
 * socket that cannot outlive the process — so any row still here when the room opens is
 * left over from a previous run and can never be delivered to.
 */
export async function clearAllSubscriptions(db: DatabaseOrTransaction) {
	await db.delete(subscriptions);
}
