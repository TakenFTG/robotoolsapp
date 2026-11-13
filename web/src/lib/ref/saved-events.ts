import { z } from 'zod';
import { RefereeRoleSchema, RefRoomIdSchema } from '@robotools.app/protocol/src/ref';
import { AuthTokenSchema } from '@robotools.app/protocol/src/access';

/**
 * The ref links this device holds, one per event.
 *
 * A Head Ref or division manager can look after more than one event on the same day, an MS
 * and an HS comp say, and each event is its own ref room with its own link. The list keeps
 * them all so opening the second link does not lose the first.
 *
 * The event name, the ref's name and role are copied in when the room is opened, only so
 * the list has something to show before connecting. The room is always the authority.
 */

export const SavedRefEventSchema = z.object({
	roomId: RefRoomIdSchema,
	authToken: AuthTokenSchema,
	eventName: z.string().nullable(),
	refName: z.string().nullable(),
	role: RefereeRoleSchema.nullable(),
	lastOpenedAt: z.number()
});
export type SavedRefEvent = z.infer<typeof SavedRefEventSchema>;

export type RefLink = { roomId: string; authToken: string };

/**
 * Read the saved list, turning the single link older versions kept into a one-entry list.
 *
 * Entries that do not parse are dropped one by one, so one bad entry cannot lose the rest.
 */
export function readSavedEvents(listJson: string | null, legacyPermitJson: string | null): SavedRefEvent[] {
	if (listJson !== null) {
		try {
			const raw: unknown = JSON.parse(listJson);
			if (Array.isArray(raw)) {
				return dedupe(
					raw.flatMap((item) => {
						const parsed = SavedRefEventSchema.safeParse(item);
						return parsed.success ? [parsed.data] : [];
					})
				);
			}
		} catch {
			// Fall through to the legacy link, if there is one.
		}
	}
	if (legacyPermitJson !== null) {
		try {
			const raw = JSON.parse(legacyPermitJson) as Partial<RefLink>;
			const roomId = RefRoomIdSchema.safeParse(raw?.roomId);
			const authToken = AuthTokenSchema.safeParse(raw?.authToken);
			if (roomId.success && authToken.success) {
				return [{ roomId: roomId.data, authToken: authToken.data, eventName: null, refName: null, role: null, lastOpenedAt: 0 }];
			}
		} catch {
			// Nothing usable.
		}
	}
	return [];
}

/**
 * Add a link, or replace the saved one for the same event.
 *
 * A new link for an event already saved wins, since it is the one just handed over (a
 * rotated link, or the same person re-added). What was known about the event is kept
 * until the room says otherwise.
 */
export function upsertLink(events: SavedRefEvent[], link: RefLink, now: number): SavedRefEvent[] {
	const existing = events.find((event) => event.roomId === link.roomId);
	const sameToken = existing?.authToken === link.authToken;
	const entry: SavedRefEvent = {
		roomId: link.roomId,
		authToken: link.authToken,
		eventName: existing?.eventName ?? null,
		// A different link may belong to a different person, so their name is not carried over.
		refName: sameToken ? (existing?.refName ?? null) : null,
		role: sameToken ? (existing?.role ?? null) : null,
		lastOpenedAt: now
	};
	return [entry, ...events.filter((event) => event.roomId !== link.roomId)];
}

/** Record what the room said about itself once it is open. */
export function describeEvent(
	events: SavedRefEvent[],
	roomId: string,
	details: Pick<SavedRefEvent, 'eventName' | 'refName' | 'role'>
): SavedRefEvent[] {
	return events.map((event) => (event.roomId === roomId ? { ...event, ...details } : event));
}

export function removeEvent(events: SavedRefEvent[], roomId: string): SavedRefEvent[] {
	return events.filter((event) => event.roomId !== roomId);
}

/** Most recently opened first. */
export function sortByRecent(events: SavedRefEvent[]): SavedRefEvent[] {
	return [...events].sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
}

function dedupe(events: SavedRefEvent[]): SavedRefEvent[] {
	const seen = new Set<string>();
	return sortByRecent(events).filter((event) => {
		if (seen.has(event.roomId)) {
			return false;
		}
		seen.add(event.roomId);
		return true;
	});
}
