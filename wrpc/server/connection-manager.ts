import type { AnyRouter } from './router';
import type { WRPCRequest, WRPCResponse } from './messages';
import type { WebSocketHandlerOptions } from './websocket-handler';
import type { ClientData, Network } from './types';
import { ConnectionCloseCode } from '../client';

/**
 * Server data stored in Durable Object storage
 */
interface ServerData {
	roomId: string | null;
	// This is the list of clients that are "likely"connected to the server
	// However, it is not guaranteed that the client is actually connected to the server
	// because the client may have disconnected and the server may not have removed the client from the list
	// isClientConnected is used to check if the client is actually connected to the server
	clients: ClientData[];
}

/**
 * Implementation of ConnectionManager for Cloudflare WebSocket Hibernation Server
 */
export class WebSocketConnectionManager implements Network {
	private opts: WebSocketHandlerOptions<AnyRouter>;
	private serverData: ServerData = { roomId: null, clients: [] };
	private isLoaded = false;
	private pendingRequests = new Map<
		string,
		{
			resolve: (response: WRPCResponse) => void;
			reject: (error: Error) => void;
			timeout: number;
		}
	>();

	constructor(opts: WebSocketHandlerOptions<AnyRouter>) {
		this.opts = opts;
	}

	/**
	 * Initialize the connection manager (must be called in constructor)
	 */
	async initialize() {
		await this.load();
		// Filter out clients that don't have a WebSocket connection
		this.serverData.clients = this.serverData.clients.filter((c) => this.opts.getWebSocket(c.clientId) !== null);
	}

	getRoomId(): string {
		if (!this.isRunning()) {
			throw new Error('Connection manager not initialized');
		}

		if (this.serverData.roomId === null) {
			throw new Error('Room ID not set');
		}

		return this.serverData.roomId;
	}

	/**
	 * Add a WebSocket connection with hibernation support
	 */
	async addConnection(ws: WebSocket, roomId: string, clientId: string, deviceId: string, deviceName: string) {
		if (!this.isRunning()) {
			// throw new Error('CRITICAL: Connection manager not initialized');
			// Just close the WebSocket and return
			ws.close(ConnectionCloseCode.NORMAL, 'Room is not initialized');
			return;
		}

		if (this.serverData.roomId !== null && this.serverData.roomId !== roomId) {
			throw new Error('CRITICAL: Room ID mismatch');
		}
		this.serverData.roomId = roomId;

		// A registration under this id already exists.
		//
		// This used to refuse the newcomer, with a close code the client reads as a kick —
		// so a judge whose connection had died without the server noticing was told they had
		// been removed from the room, and had their access permit deleted to match. The
		// arriving socket is the one demonstrably able to reach us; the registration it
		// collides with is, at best, about to be cleaned up.
		//
		// So the newcomer wins. If the old socket is somehow still alive it is closed with a
		// code that says "replaced", not "removed", and its client reconnects.
		const existingClient = this.serverData.clients.find((c) => c.clientId === clientId);
		if (existingClient) {
			const existingWs = this.opts.getWebSocket(clientId);
			if (existingWs && existingWs !== ws) {
				try {
					existingWs.close(ConnectionCloseCode.SUPERSEDED, 'Replaced by a newer connection');
				} catch (error) {
					// Already closing, or closed underneath us. Either way the registration
					// below is what matters.
					console.warn('Failed to close superseded socket', error);
				}
			}
			this.serverData.clients = this.serverData.clients.filter((c) => c.clientId !== clientId);
		}

		// Add new client data
		this.serverData.clients.push({
			clientId,
			deviceId,
			deviceName,
			connectedAt: Date.now()
		});

		await this.save();
	}

	/**
	 * Remove a WebSocket connection
	 */
	async removeConnection(clientId: string) {
		if (!this.isRunning()) {
			return; // Don't throw error during cleanup
		}

		this.serverData.clients = this.serverData.clients.filter((c) => c.clientId !== clientId);
		await this.save();

		// Reject any pending requests for this client
		for (const [requestId, pending] of this.pendingRequests) {
			if (requestId.startsWith(clientId + ':')) {
				clearTimeout(pending.timeout);
				pending.reject(new Error(`Client ${clientId} disconnected`));
				this.pendingRequests.delete(requestId);
			}
		}
	}

	/**
	 * Handle response from client
	 */
	handleResponse(response: WRPCResponse, clientId: string) {
		const requestKey = `${clientId}:${response.id}`;
		const pending = this.pendingRequests.get(requestKey);

		if (pending) {
			clearTimeout(pending.timeout);
			this.pendingRequests.delete(requestKey);

			if (response.result?.type === 'error') {
				const error = new Error(response.result.error?.message || 'Unknown error');
				pending.reject(error);
			} else {
				pending.resolve(response);
			}
		}
	}

	/**
	 * Send a request to a specific client
	 */
	async sendToClient(clientId: string, request: WRPCRequest): Promise<WRPCResponse> {
		// Check if client exists in storage
		const clientData = this.getClientData(clientId);
		if (!clientData) {
			throw new Error(`Client ${clientId} is not connected`);
		}

		// Get WebSocket using hibernation-compatible method
		const ws = this.opts.getWebSocket(clientId);
		if (!ws) {
			throw new Error(`Client ${clientId} WebSocket not found`);
		}

		return new Promise((resolve, reject) => {
			const requestKey = `${clientId}:${request.id}`;

			// Set up timeout
			const timeout = setTimeout(() => {
				this.pendingRequests.delete(requestKey);
				reject(new Error(`Request ${request.id} to client ${clientId} timed out`));
			}, 30000); // 30 second timeout

			// Store pending request
			this.pendingRequests.set(requestKey, {
				resolve,
				reject,
				timeout: timeout as unknown as number
			});

			// Send request to client
			ws.send(JSON.stringify(request));
		});
	}

	/**
	 * Send to one client and do not wait for a reply.
	 *
	 * Every procedure on the client router returns void — they are all "here is new state"
	 * notifications — so nothing the server does depends on the acknowledgement. Waiting
	 * for one anyway costs a pending entry and a 30-second timer per recipient, and at
	 * fifty judges that is fifty timers per broadcast, several times a minute, most of them
	 * armed against phones that are in someone's pocket.
	 *
	 * The client still replies; that reply now finds no pending request and is discarded.
	 * Removing the reply entirely would need a new message kind on both sides, which is a
	 * larger change than the problem warrants.
	 */
	notifyClient(clientId: string, request: WRPCRequest): void {
		// Kept synchronous so callers still see "not connected" immediately and can prune.
		const clientData = this.getClientData(clientId);
		if (!clientData) {
			throw new Error(`Client ${clientId} is not connected`);
		}

		const ws = this.opts.getWebSocket(clientId);
		if (!ws) {
			throw new Error(`Client ${clientId} WebSocket not found`);
		}

		ws.send(JSON.stringify(request));
	}

	/** Notify every connected client. Returns the ids that could not be written to. */
	notifyAll(request: WRPCRequest): string[] {
		const gone: string[] = [];

		for (const clientId of this.getConnectedClients()) {
			try {
				this.notifyClient(clientId, { ...request, id: `${request.id}-${clientId}` });
			} catch {
				gone.push(clientId);
			}
		}

		return gone;
	}

	/**
	 * Broadcast a request to all connected clients
	 */
	async broadcast(request: WRPCRequest): Promise<WRPCResponse[]> {
		const clientIds = this.getConnectedClients();

		if (clientIds.length === 0) {
			return [];
		}

		// Create separate requests for each client to avoid ID conflicts
		const promises = clientIds.map(async (clientId) => {
			const clientRequest: WRPCRequest = {
				...request,
				id: `${request.id}-${clientId}` // Make ID unique per client
			};

			try {
				// Awaited, not returned. `return` inside try hands the promise back before it
				// settles, so this catch only ever saw the synchronous throws — "client is not
				// connected" — and never a rejection. A client that simply stopped answering
				// therefore rejected 30 seconds later, out of Promise.all, out of a broadcast
				// nobody awaits, and straight into unhandledRejection.
				return await this.sendToClient(clientId, clientRequest);
			} catch (error) {
				// Return error response for failed broadcasts
				return {
					kind: 'response' as const,
					id: clientRequest.id,
					result: {
						type: 'error' as const,
						error: {
							message: error instanceof Error ? error.message : 'Broadcast failed',
							code: 'BROADCAST_ERROR'
						}
					}
				};
			}
		});

		// One unreachable client must not fail the broadcast for the rest of the room. Each
		// promise already resolves to an error response rather than rejecting, so this is
		// belt and braces — but a broadcast is fire-and-forget at every call site, and a
		// rejection escaping here has no one to catch it.
		const settled = await Promise.allSettled(promises);
		return settled.map((outcome, index) =>
			outcome.status === 'fulfilled'
				? outcome.value
				: {
						kind: 'response' as const,
						id: `${request.id}-${clientIds[index]}`,
						result: {
							type: 'error' as const,
							error: {
								message: outcome.reason instanceof Error ? outcome.reason.message : 'Broadcast failed',
								code: 'BROADCAST_ERROR'
							}
						}
					}
		);
	}

	/**
	 * Get all connected client IDs (hibernation-compatible)
	 */
	getConnectedClients(): Readonly<string[]> {
		if (!this.isRunning()) {
			return [];
		}
		// Filter clients that actually have active WebSocket connections
		return [
			...this.serverData.clients.filter((client) => this.opts.getWebSocket(client.clientId) !== null).map((client) => client.clientId)
		];
	}

	/**
	 * Check if a client is connected (hibernation-compatible)
	 */
	isClientConnected(clientId: string): boolean {
		return this.opts.getWebSocket(clientId) !== null;
	}

	/**
	 * Check if a device is connected (hibernation-compatible)
	 */
	isDeviceConnected(deviceId: string): boolean {
		return (
			this.serverData.clients
				.filter((c) => c.deviceId === deviceId) // Find all clients with the same device ID
				.find((c) => this.opts.getWebSocket(c.clientId) !== null) !== undefined // Check if any of the clients are connected
		);
	}

	/**
	 * Get all client data
	 */
	getAllClientData(): Readonly<Readonly<ClientData>[]> {
		if (!this.isRunning()) {
			return [];
		}
		return [...this.serverData.clients];
	}

	/**
	 * Get client data by clientId
	 */
	getClientData(clientId: string): Readonly<ClientData> | null {
		if (!this.isRunning()) {
			throw new Error('Connection manager not initialized');
		}
		return this.serverData.clients.find((c) => c.clientId === clientId) || null;
	}

	async kickClient(clientId: string) {
		if (!this.isRunning()) {
			return; // Don't throw error during cleanup
		}
		const ws = this.opts.getWebSocket(clientId);
		if (ws) {
			ws.close(ConnectionCloseCode.KICKED, 'Client kicked');
		}
		this.removeConnection(clientId);
	}

	/**
	 * Check if server is running
	 */
	private isRunning(): boolean {
		return this.isLoaded;
	}

	/**
	 * Load data from Durable Object storage
	 */
	private async load() {
		this.serverData = ((await this.opts.loadData()) || { roomId: null, clients: [] }) as ServerData;
		this.isLoaded = true;
	}

	/**
	 * Save data to Durable Object storage
	 */
	private async save() {
		if (!this.isRunning()) {
			throw new Error('Connection manager not initialized');
		}
		await this.opts.saveData(this.serverData);
	}

	/**
	 * Destroy all data (for cleanup)
	 */
	async destroy() {
		for (const client of this.serverData.clients) {
			this.opts.getWebSocket(client.clientId)?.close(ConnectionCloseCode.ROOM_DESTROYED, 'Room destroyed');
		}

		this.serverData = { roomId: null, clients: [] };
		this.isLoaded = false;
		await this.opts.destroy();
	}
}
