import type { GroupAdvisor, GroupDivision } from '@robotools.app/protocol/src/group';

/**
 * The contract between a room and its EventGroup, with no Cloudflare types in sight.
 *
 * This matters more than it looks: the web workspace type-imports the server router, and
 * therefore everything the router's modules reference. Anything that pulls in
 * `cloudflare:workers`, `Env` or a `.sql` import breaks type-checking for a package that
 * has no business knowing about Durable Objects. The concrete binding lives in
 * ./binding.ts, which only the Worker entrypoint imports.
 */

export type GroupSessionValidation =
	| { valid: false; reason: 'unknown_token' | 'not_a_member' | 'no_group' }
	| {
			valid: true;
			groupId: string;
			groupAdvisorId: string;
			name: string;
	  };

export type GroupDescription = { groupId: string; name: string; divisions: GroupDivision[]; advisors: GroupAdvisor[] };

/**
 * How a room reaches its EventGroup.
 *
 * An interface rather than a direct `env.EVENT_GROUP` call so that the room's rules — who
 * may connect, who counts as a Judge Advisor, when the last one may be removed — can be
 * tested without standing up a second Durable Object. The real implementation is a thin
 * stub call; everything interesting is on the group's side of it.
 */
export interface EventGroupGateway {
	validateSession(groupId: string, input: { authToken: string; roomId: string }): Promise<GroupSessionValidation>;
	describe(groupId: string, roomId: string): Promise<GroupDescription | null>;
	advisorCount(groupId: string, roomId: string): Promise<number>;
	create(
		groupId: string,
		input: { name: string; roomId: string; divisionLabel: string; advisorName: string; advisorEmail: string | null }
	): Promise<{ ok: true; groupAdvisorId: string; authToken: string } | { ok: false; error: string }>;
	attach(
		groupId: string,
		input: { authToken: string; roomId: string; label: string }
	): Promise<{ ok: true } | { ok: false; error: string }>;
	detach(groupId: string, roomId: string): Promise<void>;
}

/**
 * A gateway for a room that has no group, and for tests that do not exercise one.
 * Every answer is the safe one: no group, no advisors, nothing admitted.
 */
export const noEventGroupGateway: EventGroupGateway = {
	async validateSession() {
		return { valid: false, reason: 'no_group' };
	},
	async describe() {
		return null;
	},
	async advisorCount() {
		return 0;
	},
	async create() {
		return { ok: false, error: 'Event groups are not available on this server' };
	},
	async attach() {
		return { ok: false, error: 'Event groups are not available on this server' };
	},
	async detach() {}
};
