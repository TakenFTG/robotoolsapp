import { metadata } from '../db/schema';
import type { ServerContext } from '../server-router';

/**
 * Tell the registry what this room currently is.
 *
 * Read straight from Metadata rather than from whatever the caller happened to be
 * holding, so the registry cannot drift from the room it claims to describe. Called on
 * creation and after any event setup change, since an event renamed on Saturday morning
 * should not still be listed under its old name on Sunday.
 *
 * Never throws: the gateway swallows its own failures, and registration is bookkeeping
 * for the operator, not a precondition for running an event.
 */
export async function syncRoomRegistration(ctx: ServerContext): Promise<void> {
	if (!ctx.roomId) {
		return;
	}

	const [row] = await ctx.db.select().from(metadata).limit(1);
	if (!row) {
		return;
	}

	await ctx.registry.registerRoom({
		roomId: ctx.roomId,
		eventName: row.eventName,
		program: row.program,
		eventGradeLevel: row.eventGradeLevel,
		divisionId: row.divisionId,
		robotEventsSku: row.robotEventsSku,
		accessControlEnabled: row.accessControlEnabled,
		groupId: row.groupId
	});
}
