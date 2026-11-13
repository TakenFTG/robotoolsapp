import { GROUP_RPC_PATH, GroupResponseSchema, type GroupAction, type GroupResponse } from '@robotools.app/protocol/src/group';

/**
 * Talking to an EventGroup.
 *
 * Following a group link happens before any Judges' Room is open, so this cannot ride on
 * the room WebSocket — it is a plain POST to the Worker, which forwards it to the group's
 * Durable Object. Every call carries the group link, which is how the group knows who you
 * are, and the device asking.
 */
export class GroupRpcError extends Error {
	constructor(
		readonly status: number,
		message: string
	) {
		super(message);
		this.name = 'GroupRpcError';
	}

	/** The link is not (or is no longer) a valid group credential. */
	get isRejected(): boolean {
		return this.status === 401 || this.status === 404;
	}
}

export async function callGroupRpc(
	origin: string,
	request: { groupId: string; auth: string; deviceId: string; action: GroupAction }
): Promise<GroupResponse> {
	let response: Response;
	try {
		response = await fetch(`${origin}${GROUP_RPC_PATH}`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(request)
		});
	} catch (error) {
		throw new GroupRpcError(0, error instanceof Error ? error.message : 'Could not reach the server');
	}

	if (!response.ok) {
		const message = await response
			.json()
			.then((body) => (body as { error?: string }).error)
			.catch(() => null);
		throw new GroupRpcError(response.status, message ?? 'Event group request failed');
	}

	return GroupResponseSchema.parse(await response.json());
}
