import { eq } from 'drizzle-orm';
import { metadata } from '../db/schema';
import type { DatabaseOrTransaction } from '../server-router';

export type { EventGroupGateway, GroupDescription, GroupSessionValidation } from './types';
export { noEventGroupGateway } from './types';

/** The EventGroup this room belongs to, or null. Only an address; it grants nothing. */
export async function getRoomGroupId(db: DatabaseOrTransaction): Promise<string | null> {
	const [row] = await db.select({ groupId: metadata.groupId }).from(metadata).limit(1);
	return row?.groupId ?? null;
}

export async function setRoomGroupId(db: DatabaseOrTransaction, groupId: string | null): Promise<void> {
	await db.update(metadata).set({ groupId });
}

/**
 * Forget a group, but only the one named.
 *
 * Called by a group removing this room. Matching on the id first means a stale or spoofed
 * call from some other group cannot detach a room from the group it actually belongs to.
 */
export async function clearRoomGroupId(db: DatabaseOrTransaction, groupId: string): Promise<void> {
	await db.update(metadata).set({ groupId: null }).where(eq(metadata.groupId, groupId));
}
