import type { WebSocket as NodeWebSocket } from 'ws';
import type { HibernatableWebSocket } from '../network/judges-room-network';

/**
 * A `ws` socket dressed up as the socket the room code expects.
 *
 * On Workers, a hibernating Durable Object can be evicted from memory with its sockets
 * still open, so per-connection state had to be handed to the platform via
 * `serializeAttachment`. Here the process stays up and the state is simply a property —
 * but the room code, the network layer and the connection manager are all written against
 * that API, and they are the parts worth not rewriting.
 *
 * So the shape is kept and the mechanism is trivial. Nothing is serialized; the object is
 * held as-is.
 */
export type AdaptedSocket = HibernatableWebSocket & {
	/** The client id this socket belongs to, standing in for Durable Object tags. */
	clientId: string | null;
};

export function adaptSocket(socket: NodeWebSocket): AdaptedSocket {
	let attachment: unknown = null;

	const adapted = socket as unknown as AdaptedSocket;
	adapted.serializeAttachment = (value: unknown) => {
		attachment = value;
	};
	adapted.deserializeAttachment = () => attachment;
	adapted.clientId = null;

	return adapted;
}

/**
 * `ws` and the browser agree on the numeric ready states, and wrpc compares against the
 * global `WebSocket.OPEN`. Node has provided that global since 22, but asserting it here
 * turns a silent "no message ever sends" into a startup failure.
 */
export function assertWebSocketGlobals(): void {
	if (typeof WebSocket === 'undefined' || WebSocket.OPEN !== 1) {
		throw new Error('CRITICAL: a global WebSocket with standard ready states is required (Node 22+)');
	}
}
