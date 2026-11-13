import { z } from 'zod';
import type { AnyProcedure } from '../server/procedure';
import type { ProcedureResolver } from '../server/procedure-builder';
import type { AnyRouter } from '../server/router';
import type { WRPCRequest, WRPCResponse, WRPCPing, WRPCPong } from '../server/messages';
import { parseWRPCMessage } from '../server/utils';
import { createClientSideSession } from './session';
import type { ClientOptions, PendingRequest } from './types';
import type { InferRouterContext } from '../server/types';
import type { Session } from '../server/session';

// ============================================================================
// Connection State
// ============================================================================

export const ConnectionStateSchema = z.enum(['offline', 'connecting', 'connected', 'reconnecting', 'error']);
export type ConnectionState = z.infer<typeof ConnectionStateSchema>;

/** The slice of EventTarget this client needs, so the DOM lib is not required. */
interface EventTargetLike {
	addEventListener(type: string, listener: () => void): void;
	removeEventListener(type: string, listener: () => void): void;
}

export enum ConnectionCloseCode {
	NORMAL = 1000,
	/**
	 * The server is going away and expects the client back.
	 *
	 * 1001 is the standard "going away" code and a server may send it. It matters that this
	 * is *not* NORMAL: the client treats NORMAL as a deliberate end and stays offline, so a
	 * restart closing sockets with 1000 left every device in the room disconnected until
	 * somebody reloaded the page — silently, on every deploy.
	 */
	GOING_AWAY = 1001,
	KICKED = 3000,
	ROOM_DESTROYED = 3001,
	/**
	 * The client decided its own socket was dead and closed it to force a reconnect.
	 *
	 * In the 3000-4999 range because browsers reject anything else from `close()` — 1006
	 * is what this situation actually is, but it is reserved and cannot be sent. Being a
	 * distinct code keeps it out of the "closed on purpose, stay offline" branch.
	 */
	STALE = 3002,
	/**
	 * An older socket for the same client was replaced by a newer one.
	 *
	 * Not a kick. It means the server was still holding a registration this client had
	 * already moved on from — the usual cause being a connection that died without the
	 * server ever learning of it. Treating it as a kick told judges they had been removed
	 * from a room they were sitting in, and threw away their access permit to prove it.
	 */
	SUPERSEDED = 3003
}

/**
 * WRPC WebSocket client implementation
 */
export class WebsocketClient<TClientRouter extends AnyRouter> {
	private connectingPromise: Promise<WebSocket> | null = null;
	private ws: WebSocket | null = null;
	private requestId = 0;
	private pendingRequests = new Map<string, PendingRequest>();
	private reconnectAttempts = 0;
	private reconnectDelay = 1000;
	/**
	 * Backoff ceiling. There is deliberately no attempt limit.
	 *
	 * There used to be one — five attempts, then nothing. Nothing meant nothing: no further
	 * timer, and `connectionState` left on 'reconnecting', so the UI announced that it was
	 * reconnecting forever while no code existed that would ever try again. A phone that
	 * slept through a network blip woke to a dead room and a reassuring message, and only a
	 * full page reload fixed it.
	 *
	 * Giving up is never the right answer for a device in a judging room. The judge is
	 * holding it, the event is still running, and the only thing that changed is that a
	 * screen turned off.
	 */
	private readonly maxReconnectDelay = 30_000;
	private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	/** Set by disconnect(), so an intentional close is not undone by a reconnect. */
	private stopped = false;
	/** Removes the wake/online listeners; null when they were never attached (SSR). */
	private detachLifecycleListeners: (() => void) | null = null;
	private livenessTimer: ReturnType<typeof setTimeout> | null = null;
	private clientRouter: TClientRouter;
	private _connectionState: ConnectionState = 'offline';
	private pingTimer: ReturnType<typeof setTimeout> | null = null;
	/**
	 * How long the socket may sit silent before the client pokes it.
	 *
	 * Must stay comfortably under the shortest idle timeout anywhere on the path, because
	 * every hop gets to close a connection it thinks is dead. The binding constraint is
	 * Cloudflare, which closes an idle WebSocket after 100 seconds on its Free and Pro
	 * plans; nginx's default `proxy_read_timeout` of 240s is the other one worth knowing
	 * about, which is why docs/self-hosting.md tells you to raise it on any proxy you put
	 * in front.
	 *
	 * 45 seconds leaves room for one ping to be lost and the next to still land inside the
	 * 100-second window. The cost is negligible — a ping is a 17-byte frame, and the timer
	 * is reset by any message received, so an actively used room rarely sends one at all.
	 *
	 * This was 4.5 minutes, which was fine against the original Cloudflare Workers origin
	 * and is not fine behind a Cloudflare proxy: every device in the hall would be
	 * disconnected and reconnected every 100 seconds, all day.
	 */
	private readonly PING_INTERVAL = 45 * 1000;

	private set connectionState(state: ConnectionState) {
		this._connectionState = state;
		this.options.onConnectionStateChange(state);
	}

	private get connectionState(): ConnectionState {
		return this._connectionState;
	}

	/**
	 * The id this socket is registered under, which is not the same thing for the life of
	 * the client.
	 *
	 * A clientId names a socket; the device is named by deviceId. Reusing one across
	 * reconnects meant a client could collide with its own ghost: the server still held the
	 * registration from a connection that had died silently — a phone that slept, a network
	 * that vanished without a close frame — and refused the new socket as a duplicate. The
	 * refusal arrived as a kick.
	 *
	 * The first connection keeps the id it was given, so anything that arranged an id in
	 * advance still sees it. Every attempt after that mints its own.
	 */
	private currentClientId: string;

	constructor(
		private options: ClientOptions<TClientRouter>,
		clientRouter: TClientRouter
	) {
		this.clientRouter = clientRouter;
		this.currentClientId = options.clientId;
		this.attachLifecycleListeners();
	}

	/** The id the current socket is registered under. */
	getClientId(): string {
		return this.currentClientId;
	}

	/**
	 * A new id for a new socket.
	 *
	 * `crypto.randomUUID` needs a secure context, which a self-hosted deployment on plain
	 * HTTP is not, so a counter-and-random suffix is the fallback. Uniqueness only has to
	 * hold within one room, and the original id is already unique per client.
	 */
	private nextClientId(): string {
		const cryptoApi = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
		if (typeof cryptoApi?.randomUUID === 'function') {
			return cryptoApi.randomUUID();
		}
		return `${this.options.clientId}-${++this.connectionAttempt}-${Math.random().toString(36).slice(2, 10)}`;
	}

	/** How many sockets this client has opened, used only to keep fallback ids distinct. */
	private connectionAttempt = 0;

	/** False until the first socket is opened, so the given id is used once as handed over. */
	private hasConnectedBefore = false;

	/**
	 * Reconnect when the device comes back, rather than waiting out a backoff.
	 *
	 * A phone waking is the single most common way this connection dies, and the browser
	 * tells us about it. Without these the client sits on whatever delay it had reached —
	 * up to the ceiling — while a judge stares at a stale screen.
	 *
	 * `visibilitychange` covers the screen coming on and the tab being returned to;
	 * `online` covers moving between wifi and mobile data. Both are advisory, so they
	 * trigger an attempt rather than assuming success.
	 */
	private attachLifecycleListeners(): void {
		// Reached through globalThis rather than the DOM lib: this package's tsconfig is
		// shared with the server, where `document` does not exist and should not be
		// declared. The guards are real, not ceremonial — this class is constructed during
		// SSR and in tests too.
		const global = globalThis as unknown as {
			document?: EventTargetLike & { visibilityState?: string };
			window?: EventTargetLike;
		};

		const doc = global.document;
		const win = global.window;
		if (!doc?.addEventListener || !win?.addEventListener) {
			return;
		}

		const onWake = () => {
			if (this.stopped) return;
			// 'visibilitychange' also fires on the way *out*. Reconnecting as a tab is being
			// hidden is pointless work on a device that is about to sleep again.
			if (doc.visibilityState === 'hidden') return;
			this.reconnectNow();
		};

		doc.addEventListener('visibilitychange', onWake);
		win.addEventListener('online', onWake);
		win.addEventListener('focus', onWake);

		this.detachLifecycleListeners = () => {
			doc.removeEventListener('visibilitychange', onWake);
			win.removeEventListener('online', onWake);
			win.removeEventListener('focus', onWake);
		};
	}

	/**
	 * Come back as fast as possible.
	 *
	 * A socket that survived sleep cannot be trusted just because `readyState` says OPEN:
	 * the connection may have been dropped by an intermediary while the radio was off, and
	 * nothing will report that until something is written and the TCP stack eventually
	 * gives up — which can take minutes. So the open case is probed rather than believed.
	 */
	private reconnectNow(): void {
		if (this.ws && this.ws.readyState === WebSocket.OPEN) {
			this.probeLiveness();
			return;
		}

		// A pending backoff is cancelled and the count reset: the reason to wait was that
		// the network looked broken, and it has just stopped looking broken.
		if (this.reconnectTimer !== null) {
			clearTimeout(this.reconnectTimer);
			this.reconnectTimer = null;
		}
		this.reconnectAttempts = 0;

		if (!this.connectingPromise) {
			this.connect().catch(() => {
				// Failure schedules its own retry through onclose/onerror; swallowing here
				// only stops an unhandled rejection.
			});
		}
	}

	/** Ping, and treat silence as a dead socket. Any inbound message clears the timer. */
	private probeLiveness(): void {
		if (this.livenessTimer !== null) return;

		this.sendPing();
		this.livenessTimer = setTimeout(() => {
			this.livenessTimer = null;
			const ws = this.ws;
			if (ws && ws.readyState === WebSocket.OPEN) {
				// Closing produces an onclose, which runs the normal reconnect path.
				ws.close(ConnectionCloseCode.STALE);
			}
		}, 5000);
	}

	private clearLivenessTimer(): void {
		if (this.livenessTimer !== null) {
			clearTimeout(this.livenessTimer);
			this.livenessTimer = null;
		}
	}

	private generateRequestId(): string {
		return `req_${++this.requestId}_${Date.now()}`;
	}

	private resetPingTimer(): void {
		// Clear existing timer
		if (this.pingTimer !== null) {
			clearTimeout(this.pingTimer);
			this.pingTimer = null;
		}

		// Only set up new timer if connected
		if (this.ws && this.ws.readyState === WebSocket.OPEN) {
			this.pingTimer = setTimeout(() => {
				this.sendPing();
			}, this.PING_INTERVAL);
		}
	}

	private sendPing(): void {
		if (this.ws && this.ws.readyState === WebSocket.OPEN) {
			const ping: WRPCPing = { kind: 'ping' };
			this.ws.send(JSON.stringify(ping));
			// Reset timer after sending ping to wait for next ping interval
			this.resetPingTimer();
		}
	}

	private clearPingTimer(): void {
		if (this.pingTimer !== null) {
			clearTimeout(this.pingTimer);
			this.pingTimer = null;
		}
	}

	private async connect(): Promise<WebSocket> {
		if (this.ws && this.ws.readyState === WebSocket.OPEN) {
			return this.ws;
		}

		if (this.connectingPromise) {
			return this.connectingPromise;
		}

		this.connectionState = 'connecting';
		// Every socket after the first gets its own id, so a reconnect can never be mistaken
		// for the connection it is replacing.
		if (this.hasConnectedBefore) {
			this.currentClientId = this.nextClientId();
		}
		this.hasConnectedBefore = true;

		this.connectingPromise = new Promise((resolve, reject) => {
			const { wsUrl, roomId, deviceId, deviceName } = this.options;
			const url = new URL(wsUrl);

			url.searchParams.set('roomId', roomId);
			url.searchParams.set('clientId', this.currentClientId);
			url.searchParams.set('deviceId', deviceId);
			if (deviceName) url.searchParams.set('deviceName', deviceName);
			url.searchParams.set('action', 'join');

			const ws = new WebSocket(url.toString());

			ws.onopen = () => {
				this.ws = ws;
				this.handleOpen();
				resolve(ws);
			};

			ws.onerror = (error) => {
				this.connectionState = 'error';
				this.connectingPromise = null;
				console.error('WebSocket connection failed', error);
				reject(new Error(`WebSocket connection failed`));
			};

			ws.onmessage = (event) => {
				this.handleMessage(event.data);
			};

			ws.onclose = (event) => {
				this.handleClose(event);
			};
		});

		return this.connectingPromise;
	}

	private async handleOpen(): Promise<void> {
		this.reconnectAttempts = 0;
		this.connectionState = 'connected';
		this.connectingPromise = null;
		this.resetPingTimer(); // Start ping timer on connection
		this.options.onOpen();
	}

	private async handleMessage(data: string): Promise<void> {
		try {
			// Parse and validate the message using Zod
			const parsedMessage = parseWRPCMessage(data);

			// Reset ping timer on any message received
			this.resetPingTimer();
			// Anything arriving proves the socket is alive, which is what the probe asked.
			this.clearLivenessTimer();

			// Handle different message types
			if (parsedMessage.kind === 'pong') {
				// Pong received, just reset the timer (already done above)
				return;
			} else if (parsedMessage.kind === 'ping') {
				// Send pong back
				if (this.ws && this.ws.readyState === WebSocket.OPEN) {
					const pong: WRPCPong = { kind: 'pong' };
					this.ws.send(JSON.stringify(pong));
				}
				return;
			} else if (parsedMessage.kind === 'response') {
				// Handle responses to our requests
				this.handleResponse(parsedMessage);
				return;
			} else {
				// Handle requests from server
				const ctx = await this.options.onContext(parsedMessage);
				await this.handleServerRequest(parsedMessage, ctx);
			}
		} catch (error) {
			console.error('Error parsing or validating WebSocket message:', error);
		}
	}

	private handleResponse(response: WRPCResponse): void {
		const pendingRequest = this.pendingRequests.get(response.id);
		if (!pendingRequest) {
			console.warn('Received response for unknown request:', response.id);
			return;
		}

		this.pendingRequests.delete(response.id);

		if (response.result.type === 'error') {
			const error = new Error(response.result.error.message);
			(error as Error & { code?: string }).code = response.result.error.code;
			pendingRequest.reject(error);
		} else if (response.result.type === 'data') {
			pendingRequest.resolve(response.result.data);
		}
	}

	private async handleServerRequest(request: WRPCRequest, ctx: InferRouterContext<TClientRouter>): Promise<void> {
		const ws = this.ws;
		if (!ws || ws.readyState !== WebSocket.OPEN) {
			console.error('WebSocket not connected when handling server request');
			return;
		}

		try {
			// Find the procedure in our client router
			const procedure = this.getProcedureAtPath(this.clientRouter, request.path);

			if (!procedure) {
				throw new Error(`No procedure found at path: ${request.path}`);
			}

			const session = createClientSideSession(
				this,
				this.options.roomId,
				this.currentClientId,
				this.options.deviceId,
				this.options.deviceName || 'unknown'
			);

			// Call the procedure (it will handle input validation internally)
			const result = await this.callProcedure(procedure, request.input, session, ctx);

			// Send response back to server
			const response: WRPCResponse = {
				kind: 'response',
				id: request.id,
				result: {
					type: 'data',
					data: result
				}
			};

			ws.send(JSON.stringify(response));
		} catch (error) {
			// Send error response
			const response: WRPCResponse = {
				kind: 'response',
				id: request.id,
				result: {
					type: 'error',
					error: {
						message: error instanceof Error ? error.message : 'Unknown error',
						code: 'CLIENT_ERROR'
					}
				}
			};

			ws.send(JSON.stringify(response));
		}
	}

	private getProcedureAtPath(router: AnyRouter, path: string): AnyProcedure | null {
		const parts = path.split('.');
		let current: unknown = router;

		for (const part of parts) {
			if (!current || typeof current !== 'object') {
				return null;
			}
			current = (current as Record<string, unknown>)[part];
		}

		// Check if it's a valid procedure
		if (typeof current === 'function') {
			const fn = current as unknown as AnyProcedure;
			if (typeof fn._def === 'object' && fn._def && fn._def.procedure === true) {
				return fn;
			}
		}

		return null;
	}

	private async callProcedure(procedure: AnyProcedure, input: unknown, session: Session<AnyRouter>, ctx: object): Promise<unknown> {
		const procedureFn = procedure as unknown as ProcedureResolver<unknown, unknown, unknown, object, AnyRouter>;
		return procedureFn({ input, session, ctx });
	}

	private async handleClose(event: CloseEvent): Promise<void> {
		this.ws = null;
		this.clearPingTimer(); // Clear ping timer on close
		this.clearLivenessTimer();
		this.connectingPromise = null;

		// Reject all pending requests
		for (const [id, request] of this.pendingRequests) {
			request.reject(new Error('WebSocket connection closed'));
		}
		this.pendingRequests.clear();

		if (event.code === ConnectionCloseCode.NORMAL) {
			this.connectionState = 'offline';
		} else if (event.code === ConnectionCloseCode.KICKED) {
			this.connectionState = 'offline';
		} else if (event.code === ConnectionCloseCode.ROOM_DESTROYED) {
			this.connectionState = 'offline';
		} else if (!this.stopped) {
			// SUPERSEDED lands here deliberately, with the other recoverable closes: the
			// socket is gone, the session is not, and the right response is to come back.
			// Retries continue for as long as the page is open. The delay grows to a
			// ceiling rather than the attempt count running out, because the condition that
			// ends this is the network coming back, and nothing here can predict when.
			this.connectionState = 'reconnecting';
			const delay = Math.min(this.reconnectDelay * Math.pow(2, this.reconnectAttempts), this.maxReconnectDelay);
			this.reconnectTimer = setTimeout(() => {
				this.reconnectTimer = null;
				this.reconnectAttempts++;
				this.connect().catch(() => {
					// onclose/onerror schedules the next attempt; this only prevents an
					// unhandled rejection.
				});
			}, delay);
		}
		this.options.onClosed(event.code, event.reason);
	}

	private async sendRequest(request: WRPCRequest): Promise<unknown> {
		const ws = await this.connect();

		return new Promise((resolve, reject) => {
			this.pendingRequests.set(request.id, {
				resolve,
				reject
			});
			ws.send(JSON.stringify(request));
			// Reset ping timer on outgoing message
			this.resetPingTimer();

			// Set timeout for request
			setTimeout(() => {
				if (this.pendingRequests.has(request.id)) {
					this.pendingRequests.delete(request.id);
					reject(new Error('Request timeout'));
				}
			}, 30000); // 30 seconds timeout
		});
	}

	/**
	 * Call a query procedure on the server
	 */
	query(path: string, input: unknown): Promise<unknown> {
		const request: WRPCRequest = {
			kind: 'request',
			id: this.generateRequestId(),
			type: 'query',
			path,
			input
		};
		return this.sendRequest(request);
	}

	/**
	 * Call a mutation procedure on the server
	 */
	mutation(path: string, input: unknown): Promise<unknown> {
		const request: WRPCRequest = {
			kind: 'request',
			id: this.generateRequestId(),
			type: 'mutation',
			path,
			input
		};
		return this.sendRequest(request);
	}

	/**
	 * Disconnect the WebSocket
	 */
	disconnect(): void {
		// Set before closing: without it the wake listeners would treat a deliberate
		// disconnect as something to recover from, and reconnect the moment the tab was
		// focused again.
		this.stopped = true;
		this.clearPingTimer(); // Clear ping timer on disconnect
		this.clearLivenessTimer();
		if (this.reconnectTimer !== null) {
			clearTimeout(this.reconnectTimer);
			this.reconnectTimer = null;
		}
		this.detachLifecycleListeners?.();
		this.detachLifecycleListeners = null;
		if (this.ws) {
			this.ws.close(ConnectionCloseCode.NORMAL, 'Client disconnected peacefully');
			this.ws = null;
		}
		this.connectionState = 'offline';
	}

	/**
	 * Check if the WebSocket is connected
	 */
	isConnected(): this is { ws: WebSocket } {
		return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
	}

	/**
	 * Get the current connection state
	 */
	getConnectionState(): ConnectionState {
		return this.connectionState;
	}
}
