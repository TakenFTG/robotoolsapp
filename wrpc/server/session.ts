import type { AnyRouter } from './router';
import type { RouterBroadcastProxy, RouterProxy } from './types';
import type { WRPCRequest } from './messages';
import type { Network } from './types';

/**
 * Session interface for server-to-client communication
 *
 * Server-side sessions can call client procedures but cannot call server procedures.
 * Client-side sessions can call server procedures but cannot call client procedures or broadcast.
 */
export interface Session<TServerRouter extends AnyRouter> {
	/**
	 * Get a client proxy to call procedures on a specific client
	 * @throws Error when called from client-side session
	 */
	getClient<TClientRouter extends AnyRouter>(clientId: string): RouterProxy<TClientRouter>;

	/**
	 * Broadcast proxy to call procedures on all connected clients
	 * @throws Error when called from client-side session
	 */
	broadcast<TClientRouter extends AnyRouter>(): RouterBroadcastProxy<TClientRouter>;

	/**
	 * Get a server proxy to call procedures on the server
	 * @throws Error when called from server-side session
	 */
	getServer(): RouterProxy<TServerRouter>;

	/**
	 * Current session metadata
	 */
	readonly roomId: string;

	/**
	 * Current client metadata
	 */
	readonly currentClient: {
		clientId: string;
		deviceId: string;
		deviceName: string;
	};
}

/**
 * Session factory function type
 */
export type SessionFactory<TServerRouter extends AnyRouter> = (
	connectionManager: Network,
	roomId: string,
	clientId: string,
	deviceName?: string
) => Session<TServerRouter>;

/**
 * Create a client proxy that can call procedures on the client
 */
export function createClientProxy<TClientRouter extends AnyRouter>(
	connectionManager: Network,
	targetClientId?: string,
	pathParts: string[] = []
): RouterProxy<TClientRouter> {
	return new Proxy({} as RouterProxy<TClientRouter>, {
		get(_target, prop: string) {
			if (prop === 'query' || prop === 'mutation') {
				// Create a function that can be called
				const fn = async (input: unknown) => {
					const request: WRPCRequest = {
						kind: 'request',
						id: crypto.randomUUID(),
						type: prop as 'query' | 'mutation',
						path: pathParts.join('.'),
						input
					};

					// Client procedures are all notifications — every one returns void — so the
					// server never reads a reply. Sending without registering a pending request
					// removes a 30-second timer per recipient per broadcast, which at fifty
					// judges is the difference between a handful of timers and thousands.
					//
					// "Not connected" still throws synchronously, which is how callers such as
					// deliver() still learn to prune a subscription. What is no longer detected
					// is a client that is connected but silent, and waiting thirty seconds to
					// discover that was never worth what it cost.
					if (targetClientId) {
						connectionManager.notifyClient(targetClientId, request);
						return undefined;
					}

					const gone = connectionManager.notifyAll(request);
					return gone;
				};

				// Wrap it in a proxy to allow property access for traversal
				return new Proxy(fn, {
					get(_target, nestedProp: string | symbol) {
						if (typeof nestedProp === 'symbol') return undefined;
						// Continue traversal by treating it as a path segment
						return createClientProxy(connectionManager, targetClientId, [...pathParts, prop, nestedProp]);
					},
					apply(_target, _thisArg, args: unknown[]) {
						return fn(args[0]);
					}
				});
			}

			return createClientProxy(connectionManager, targetClientId, [...pathParts, prop]);
		}
	});
}

/**
 * Create a session instance
 */
export function createServerSideSession(
	connectionManager: Network,
	roomId: string,
	clientId: string,
	deviceId: string,
	deviceName: string
): Session<never> {
	return {
		getClient: (clientId: string) => createClientProxy(connectionManager, clientId),
		broadcast: () => createClientProxy(connectionManager), // No specific client ID = broadcast
		getServer: () => {
			throw new Error('getServer() cannot be called from server-side session. Server procedures should be called directly.');
		},
		roomId,
		currentClient: {
			clientId,
			deviceId,
			deviceName
		}
	};
}
