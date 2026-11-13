import z from 'zod';
import type { WRPCRootObject } from '@robotools.app/wrpc/server';
import { MatchesSnapshotSchema } from '@robotools.app/protocol/src/matches';
import type { ServerContext } from '../server-router';

/**
 * Everything the room knows from RobotEvents — schedule, division standings and skills —
 * served from its cache as one snapshot.
 *
 * One procedure rather than three because it is one poll and one cache: the matches tab
 * and the skills tab read the same fetch, so a second tab costs no second request.
 *
 * The client never talks to RobotEvents. It asks the room, which holds whatever the last
 * poll produced — so opening a tab costs one local request no matter how many judges do
 * it at once, and the external request rate stays bounded by the number of rooms.
 */
export function buildMatchesRoute(w: WRPCRootObject<object, ServerContext, Record<string, never>>) {
	return {
		getSnapshot: w.procedure
			.input(z.object({ force: z.boolean().default(false) }).default({ force: false }))
			.output(MatchesSnapshotSchema)
			.query(async ({ ctx, input }) => {
				// `force` is what the refresh button sends. It still goes through the room's
				// own throttle, so a judge tapping it repeatedly re-reads the cache rather
				// than reaching RobotEvents again.
				return ctx.network.matches(input.force);
			})
	};
}
