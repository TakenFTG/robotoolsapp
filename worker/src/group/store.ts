import { asc, eq } from 'drizzle-orm';
import type { AppDatabase } from '../runtime/storage';
import { groupAdvisors, groupMetadata, groupRooms } from './schema';
import type { GroupAdvisor, GroupDivision } from '@robotools.app/protocol/src/group';

/**
 * Queries over an EventGroup's own database.
 *
 * Nothing here reaches into a room, and nothing a room owns is readable from here — the
 * two Durable Objects share code, never storage.
 */
export type GroupDatabase = AppDatabase;

export type GroupMetadataRow = { groupId: string; name: string };

export async function getGroupMetadata(db: GroupDatabase): Promise<GroupMetadataRow | null> {
	const [row] = await db.select({ groupId: groupMetadata.groupId, name: groupMetadata.name }).from(groupMetadata).limit(1);
	return row ?? null;
}

export async function listGroupAdvisors(db: GroupDatabase): Promise<GroupAdvisor[]> {
	const rows = await db.select({ id: groupAdvisors.id, name: groupAdvisors.name }).from(groupAdvisors);
	return rows.map((row) => ({ groupAdvisorId: row.id, name: row.name }));
}

export async function countGroupAdvisors(db: GroupDatabase): Promise<number> {
	return (await db.select({ id: groupAdvisors.id }).from(groupAdvisors)).length;
}

/**
 * Which advisor a presented token is, or null.
 *
 * Note what is *not* here: no room may call this and receive a token back. A room asks
 * "is this token yours, and may it open me" and gets an answer, never a credential.
 */
export async function findGroupAdvisorByToken(
	db: GroupDatabase,
	authToken: string
): Promise<{ groupAdvisorId: string; name: string } | null> {
	const [row] = await db
		.select({ id: groupAdvisors.id, name: groupAdvisors.name })
		.from(groupAdvisors)
		.where(eq(groupAdvisors.authToken, authToken))
		.limit(1);
	return row ? { groupAdvisorId: row.id, name: row.name } : null;
}

export async function listGroupDivisions(db: GroupDatabase): Promise<GroupDivision[]> {
	const rows = await db
		.select({ roomId: groupRooms.roomId, label: groupRooms.label, position: groupRooms.position })
		.from(groupRooms)
		.orderBy(asc(groupRooms.position));
	return rows;
}

export async function isGroupMember(db: GroupDatabase, roomId: string): Promise<boolean> {
	const [row] = await db.select({ roomId: groupRooms.roomId }).from(groupRooms).where(eq(groupRooms.roomId, roomId)).limit(1);
	return !!row;
}

/** Append a room to the group, or update the label of one already in it. */
export async function upsertGroupRoom(db: GroupDatabase, roomId: string, label: string): Promise<void> {
	const existing = await listGroupDivisions(db);
	const current = existing.find((division) => division.roomId === roomId);
	const position = current ? current.position : existing.length;

	await db
		.insert(groupRooms)
		.values({ roomId, label, position })
		.onConflictDoUpdate({ target: [groupRooms.roomId], set: { label } });
}

export async function removeGroupRoom(db: GroupDatabase, roomId: string): Promise<boolean> {
	const deleted = await db.delete(groupRooms).where(eq(groupRooms.roomId, roomId)).returning({ roomId: groupRooms.roomId });
	return deleted.length > 0;
}
