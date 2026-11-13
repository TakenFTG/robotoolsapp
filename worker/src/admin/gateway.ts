/**
 * What a room tells the registry about itself.
 *
 * Declared here rather than alongside the Durable Object so this module stays free of
 * Cloudflare types — the web workspace type-imports the server router, and the server
 * router's context references this gateway.
 */
export type RegisterRoomInput = {
	roomId: string;
	eventName: string;
	program: string;
	eventGradeLevel: string;
	divisionId: number | null;
	robotEventsSku: string | null;
	accessControlEnabled: boolean;
	groupId: string | null;
};

/**
 * How a room tells the registry it exists.
 *
 * An interface, and free of Cloudflare types, for the same reason the event group's is:
 * the web workspace type-imports the server router and must not be dragged into Durable
 * Object types. The concrete binding lives in ./binding.ts.
 */
export interface AdminRegistryGateway {
	registerRoom(input: RegisterRoomInput): Promise<void>;
	deregisterRoom(roomId: string): Promise<void>;
}

/**
 * The gateway for a deployment with no registry, and for tests.
 *
 * Registration is bookkeeping, never a precondition: a room that cannot reach the
 * registry must still be created, joined and used.
 */
export const noAdminRegistryGateway: AdminRegistryGateway = {
	async registerRoom() {},
	async deregisterRoom() {}
};
