import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { WebSocketServer } from 'ws';
import { AuthTokenSchema } from '@robotools.app/protocol/src/access';
import { GROUP_RPC_PATH, GroupRequestSchema } from '@robotools.app/protocol/src/group';
import { ADMIN_RPC_PATH, AdminRequestSchema, type AdminResponse } from '@robotools.app/protocol/src/admin';
import { MAX_PHOTO_BYTES } from '@robotools.app/protocol/src/media';
import {
	REF_RPC_PATH,
	REF_WS_PATH,
	RefCloseReason,
	RefRequestSchema,
	buildRefRoomJoinUrl,
	type CreateRefRoomResponse
} from '@robotools.app/protocol/src/ref';
import { ConnectionCloseCode } from '@robotools.app/wrpc/client';
import { buildRefAccessLinkEmail } from './email/template';
import { describeSmtpFailure } from './email/smtp';
import { Hub } from './runtime/hub';

/** How often the retention sweep runs. */
const RETENTION_SWEEP_INTERVAL_MS = 60 * 60 * 1000;
import { assertWebSocketGlobals } from './runtime/socket';
import { assertMigrationsAvailable } from './runtime/storage';
import type { EmailContext } from './server-router';
import type { RetentionPolicy } from './runtime/hub';
import { MATCH_POLL_INTERVAL_MS } from '@robotools.app/protocol/src/matches';
import { VEX_EVENTS_PROXY_PREFIX, VexEventsProxy, isAllowedOrigin, resolveUpstreamUrl } from './matches/proxy';

/**
 * The self-hosted Judges' Room server.
 *
 * A single Node process: HTTP for the app and its APIs, WebSockets for the rooms, and a
 * directory of SQLite files for storage. It replaces a Worker plus three Durable Object
 * namespaces, and the trade is deliberate — one machine, no vendor, and a backup that is
 * a copy of one folder.
 */

const IntentionSchema = z.object({
	roomId: z.uuidv4(),
	clientId: z.uuidv4(),
	deviceId: z.uuidv4(),
	deviceName: z.string().min(1).max(20),
	action: z.enum(['create', 'join', 'rejoin']),
	auth: AuthTokenSchema.nullable()
});

export type ServerOptions = {
	port: number;
	host: string;
	dataDir: string;
	/** The built SvelteKit output. Absent means API-only, which is useful behind a CDN. */
	staticDir: string | null;
	adminUsername: string | null;
	adminPassword: string | null;
	/** Mail transport and the origin emailed links point at. Sending is off by default. */
	email: EmailContext;
	retention: RetentionPolicy;
};

const MIME_TYPES: Record<string, string> = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.json': 'application/json; charset=utf-8',
	'.svg': 'image/svg+xml',
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.webp': 'image/webp',
	'.ico': 'image/x-icon',
	'.woff': 'font/woff',
	'.woff2': 'font/woff2',
	'.txt': 'text/plain; charset=utf-8',
	'.pdf': 'application/pdf',
	'.webmanifest': 'application/manifest+json'
};

function sendJson(res: http.ServerResponse, status: number, payload: unknown): void {
	const body = JSON.stringify(payload);
	res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
	res.end(body);
}

function sendText(res: http.ServerResponse, status: number, text: string): void {
	res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Length': Buffer.byteLength(text) });
	res.end(text);
}

/**
 * Read a request body with a hard ceiling.
 *
 * The limit is enforced as bytes arrive rather than after the fact, so an oversized
 * upload costs the memory it has already sent and no more.
 */
function readBody(req: http.IncomingMessage, limit: number): Promise<Buffer> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		let total = 0;

		req.on('data', (chunk: Buffer) => {
			total += chunk.length;
			if (total > limit) {
				reject(new Error('Request body too large'));
				req.destroy();
				return;
			}
			chunks.push(chunk);
		});
		req.on('end', () => resolve(Buffer.concat(chunks)));
		req.on('error', reject);
	});
}

/** Same-origin in production; the dev web server is on another port, hence CORS at all. */
function applyCors(req: http.IncomingMessage, res: http.ServerResponse, methods: string): void {
	const origin = req.headers.origin;
	if (!origin) {
		return;
	}
	res.setHeader('Access-Control-Allow-Origin', origin);
	res.setHeader('Access-Control-Allow-Methods', methods);
	res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
	res.setHeader('Vary', 'Origin');
}

export function createServer(options: ServerOptions): { server: http.Server; hub: Hub } {
	assertWebSocketGlobals();
	assertMigrationsAvailable();

	const hub = new Hub({
		dataDir: options.dataDir,
		adminUsername: options.adminUsername,
		adminPassword: options.adminPassword,
		email: options.email,
		retention: options.retention
	});

	// Retention runs on a timer rather than on a request, because the whole point is that
	// it happens without anyone remembering to ask. Hourly is far more often than a daily
	// boundary needs, which means a server that is restarted often still sweeps.
	const retentionTimer = options.retention.enabled
		? setInterval(() => {
				void hub.sweepRetention().catch((error: unknown) => {
					console.error('Retention sweep failed:', error);
				});
			}, RETENTION_SWEEP_INTERVAL_MS)
		: null;
	retentionTimer?.unref();

	// One poll per room in use, rather than one per judge watching. See sweepMatches.
	const matchTimer = setInterval(() => {
		void hub.sweepMatches().catch((error: unknown) => {
			console.error('Match sweep failed:', error);
		});
	}, MATCH_POLL_INTERVAL_MS);
	matchTimer.unref();

	// VEX Events calls from the browser come through here so the API key stays server-side.
	const vexEvents = new VexEventsProxy();

	const server = http.createServer((req, res) => {
		void handleRequest(req, res).catch((error) => {
			console.error('Unhandled request error:', error);
			if (!res.headersSent) {
				sendText(res, 500, 'Internal error');
			} else {
				res.end();
			}
		});
	});

	async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
		const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

		if (url.pathname === ADMIN_RPC_PATH) {
			applyCors(req, res, 'POST, OPTIONS');
			if (req.method === 'OPTIONS') {
				res.writeHead(204).end();
				return;
			}
			return handleAdminRpc(req, res);
		}

		if (url.pathname === REF_RPC_PATH) {
			applyCors(req, res, 'POST, OPTIONS');
			if (req.method === 'OPTIONS') {
				res.writeHead(204).end();
				return;
			}
			return handleRefRpc(req, res);
		}

		if (url.pathname === GROUP_RPC_PATH) {
			applyCors(req, res, 'POST, OPTIONS');
			if (req.method === 'OPTIONS') {
				res.writeHead(204).end();
				return;
			}
			return handleGroupRpc(req, res);
		}

		if (url.pathname.startsWith('/media/')) {
			applyCors(req, res, 'GET, PUT, OPTIONS');
			if (req.method === 'OPTIONS') {
				res.writeHead(204).end();
				return;
			}
			return handleMedia(req, res, url);
		}

		if (url.pathname.startsWith(VEX_EVENTS_PROXY_PREFIX)) {
			return handleVexEvents(req, res, url);
		}

		if (url.pathname === '/health') {
			sendText(res, 200, 'ok');
			return;
		}

		return handleStatic(req, res, url);
	}

	// ========================================================================
	// VEX Events pass-through (see matches/proxy.ts)
	// ========================================================================

	async function handleVexEvents(req: http.IncomingMessage, res: http.ServerResponse, url: URL): Promise<void> {
		const origin = req.headers.origin;
		if (origin && isAllowedOrigin(origin, req.headers.host)) {
			applyCors(req, res, 'GET, OPTIONS');
		}
		if (req.method === 'OPTIONS') {
			res.writeHead(204).end();
			return;
		}
		if (req.method !== 'GET') {
			sendText(res, 405, 'Method not allowed');
			return;
		}

		const upstreamUrl = resolveUpstreamUrl(url.pathname, url.search);
		if (!upstreamUrl) {
			sendText(res, 404, 'Not found');
			return;
		}

		const result = await vexEvents.get(upstreamUrl);
		res.writeHead(result.status, {
			'Content-Type': result.contentType,
			'Cache-Control': 'private, max-age=60'
		});
		res.end(result.body);
	}

	// ========================================================================
	// Group RPC
	// ========================================================================

	async function handleGroupRpc(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
		if (req.method !== 'POST') {
			sendText(res, 405, 'Method not allowed');
			return;
		}

		const parsed = GroupRequestSchema.safeParse(await readJson(req, res));
		if (!parsed.success) {
			sendJson(res, 400, { error: 'Invalid request' });
			return;
		}

		// Groups are created from inside a room, never here, so a missing one is simply not found.
		const result = await hub.onExistingGroup(parsed.data.groupId, (group) => group.handleGroupRequest(parsed.data));
		if (!result) {
			sendJson(res, 404, { error: 'Event group not found' });
			return;
		}
		if (!result.ok) {
			sendJson(res, result.status, { error: result.error });
			return;
		}
		sendJson(res, 200, result.response);
	}

	// ========================================================================
	// Ref RPC
	// ========================================================================

	/**
	 * Create a ref room.
	 *
	 * Plain HTTP rather than the socket, because nobody holds a link yet: this is the call
	 * that makes the first one. The room id is chosen here, not by the caller, so a request
	 * cannot aim at an existing room.
	 */
	async function handleRefRpc(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
		if (req.method !== 'POST') {
			sendText(res, 405, 'Method not allowed');
			return;
		}

		const parsed = RefRequestSchema.safeParse(await readJson(req, res));
		if (!parsed.success) {
			sendJson(res, 400, { error: 'Invalid request' });
			return;
		}

		const request = parsed.data;
		const roomId = crypto.randomUUID();
		const room = hub.refRoom(roomId, { create: true });
		if (!room) {
			sendJson(res, 500, { error: 'Could not create the ref room' });
			return;
		}

		let authToken: string;
		try {
			({ authToken } = await room.mutex.run(() => room.create(request)));
		} catch (error) {
			console.error('Failed to create ref room:', error);
			hub.forgetRefRoom(roomId);
			sendJson(res, 500, { error: 'Could not create the ref room' });
			return;
		}

		// The Head Ref's own link, to an address they typed moments ago. Best effort: the
		// room exists either way, and the page shows the link as well.
		const email = request.headReferee.email?.trim().toLowerCase();
		if (email && options.email.sender.enabled) {
			try {
				await options.email.sender.send(
					buildRefAccessLinkEmail({
						to: email,
						refereeName: request.headReferee.name,
						eventName: request.event.eventName,
						link: buildRefRoomJoinUrl(options.email.publicOrigin, roomId, authToken),
						headReferee: true
					})
				);
			} catch (error) {
				console.error('Failed to email the Head Referee their link:', describeSmtpFailure(error));
			}
		}

		sendJson(res, 200, { roomId, authToken } satisfies CreateRefRoomResponse);
	}

	// ========================================================================
	// Admin RPC
	// ========================================================================

	async function handleAdminRpc(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
		if (req.method !== 'POST') {
			sendText(res, 405, 'Method not allowed');
			return;
		}

		// Not configured is not the same as forbidden, but it must not be distinguishable
		// in a way that helps: a deployment with no admin credentials simply has no admin.
		if (!hub.adminEnabled) {
			sendJson(res, 404, { error: 'Not found' });
			return;
		}

		const parsed = AdminRequestSchema.safeParse(await readJson(req, res));
		if (!parsed.success) {
			sendJson(res, 400, { error: 'Invalid request' });
			return;
		}

		const { token, action } = parsed.data;

		if (action.kind === 'login') {
			const result = await hub.onRegistry((registry) => registry.login(action.username, action.password));
			if (!result.ok) {
				if (result.reason === 'throttled') {
					sendJson(res, 429, { error: 'Too many failed sign-in attempts — try again shortly', retryAfterMs: result.retryAfterMs });
					return;
				}
				// Deliberately the same message whether the username or the password was wrong.
				sendJson(res, 401, { error: 'Incorrect username or password' });
				return;
			}
			sendJson(res, 200, { kind: 'session', token: result.token, expiresAt: result.expiresAt } satisfies AdminResponse);
			return;
		}

		if (!token || !(await hub.onRegistry((registry) => registry.validateSession(token)))) {
			sendJson(res, 401, { error: 'Sign in to continue' });
			return;
		}

		switch (action.kind) {
			case 'logout': {
				await hub.onRegistry((registry) => registry.logout(token));
				sendJson(res, 200, { kind: 'ok' } satisfies AdminResponse);
				return;
			}
			case 'list_rooms': {
				// Read the truth off disk before answering. Rooms register themselves, but
				// that only covers rooms created since the registry existed, and a
				// registration can fail — the files are what actually exist.
				await hub.reconcileRegistry();
				const registrations = await hub.onRegistry((registry) => registry.listRooms());
				// Activity comes from the rooms, not from here. The registry records what an
				// event *is* and is rewritten only when that changes, so it cannot answer
				// "when was this last used" — which is the question the list is actually for.
				const activity = await hub.lastActivityByRoom(registrations.map((registration) => registration.roomId));
				const rooms = registrations.map((registration) => ({
					...registration,
					lastActivityAt: activity.get(registration.roomId) ?? null
				}));
				sendJson(res, 200, { kind: 'rooms', rooms } satisfies AdminResponse);
				return;
			}
			case 'room_detail': {
				// createdAt and updatedAt belong to the registry, which is the only thing that
				// knows them — a room has no record of when it was created. The room reports
				// what it owns and nothing else, rather than inventing dates to satisfy the
				// shape of the response.
				const registration = await hub.onRegistry((registry) => registry.getRoom(action.roomId));
				if (!registration) {
					sendJson(res, 404, { error: 'Room not found' });
					return;
				}
				const room = hub.room(action.roomId);
				const detail = await room.mutex.run(() => room.adminRoomDetail());
				if (!detail) {
					sendJson(res, 404, { error: 'Room not found' });
					return;
				}
				const activity = await hub.lastActivityByRoom([action.roomId]);
				sendJson(res, 200, {
					kind: 'room',
					room: { ...registration, ...detail, lastActivityAt: activity.get(action.roomId) ?? null }
				} satisfies AdminResponse);
				return;
			}
			case 'destroy_room': {
				const room = hub.room(action.roomId);
				await room.mutex.run(() => room.destroy());
				// The room deregisters itself as it goes, but say so here too: a room that
				// failed to would otherwise linger in the list with nothing behind it.
				await hub.onRegistry((registry) => registry.deregisterRoom(action.roomId));
				sendJson(res, 200, { kind: 'ok' } satisfies AdminResponse);
				return;
			}
			case 'add_judge': {
				const room = hub.room(action.roomId);
				await room.mutex.run(() => room.adminAddJudge(action.name, action.groupId));
				sendJson(res, 200, { kind: 'ok' } satisfies AdminResponse);
				return;
			}
			case 'remove_judge': {
				const room = hub.room(action.roomId);
				await room.mutex.run(() => room.adminRemoveJudge(action.judgeId));
				sendJson(res, 200, { kind: 'ok' } satisfies AdminResponse);
				return;
			}
			case 'add_judge_advisor': {
				const room = hub.room(action.roomId);
				const authToken = await room.mutex.run(() => room.adminAddJudgeAdvisor(action.name));
				// Returned once. The room keeps the token; nothing here can show it again.
				sendJson(res, 200, { kind: 'access_link', authToken } satisfies AdminResponse);
				return;
			}
			case 'remove_judge_advisor': {
				const room = hub.room(action.roomId);
				try {
					await room.mutex.run(() => room.adminRemoveJudgeAdvisor(action.judgeAdvisorId));
				} catch (error) {
					// These refusals are the operator's to see — "keep at least one Judge
					// Advisor" is an answer, not a fault.
					sendJson(res, 400, { error: error instanceof Error ? error.message : 'Could not remove that Judge Advisor' });
					return;
				}
				sendJson(res, 200, { kind: 'ok' } satisfies AdminResponse);
				return;
			}
		}
	}

	// ========================================================================
	// Media
	// ========================================================================

	async function handleMedia(req: http.IncomingMessage, res: http.ServerResponse, url: URL): Promise<void> {
		const roomId = url.searchParams.get('roomId');
		if (!roomId) {
			sendText(res, 400, 'Missing roomId');
			return;
		}

		// Never room(): this is reachable without credentials, and opening a missing room
		// creates its file. Every media request needs a room that already holds the photo or
		// the upload token, so a missing one has nothing to offer anyway.
		const room = hub.existingRoom(roomId);
		if (!room) {
			sendText(res, 404, 'Not found');
			return;
		}

		if (url.pathname === '/media/upload' && req.method === 'PUT') {
			const token = req.headers.authorization?.replace(/^Bearer\s+/i, '') ?? url.searchParams.get('token');
			if (!token) {
				sendText(res, 401, 'Missing upload token');
				return;
			}

			let body: Buffer;
			try {
				body = await readBody(req, MAX_PHOTO_BYTES);
			} catch {
				sendText(res, 413, 'Photo too large');
				return;
			}

			try {
				const result = await room.mutex.run(() =>
					room.completeUpload(
						token,
						body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer,
						req.headers['content-type'] ?? null
					)
				);
				sendJson(res, result.status, result.payload);
			} catch (error) {
				sendMediaError(res, error);
			}
			return;
		}

		if (url.pathname === '/media/photo' && req.method === 'GET') {
			const photoId = url.searchParams.get('photoId');
			const secret = url.searchParams.get('secret');
			if (!photoId || !secret) {
				sendText(res, 400, 'Missing photoId or secret');
				return;
			}

			try {
				// Headers come from the media route rather than being assembled here: they are
				// what stops an uploaded file being interpreted as something other than an
				// image, so they belong with the code that knows what an image is allowed to
				// be. See photoResponseHeaders.
				const { body, headers } = await room.mutex.run(() => room.readPhoto(photoId, secret));
				res.writeHead(200, headers);
				res.end(Buffer.from(body.bytes));
			} catch (error) {
				sendMediaError(res, error);
			}
			return;
		}

		sendText(res, 404, 'Not found');
	}

	function sendMediaError(res: http.ServerResponse, error: unknown): void {
		const message = error instanceof Error ? error.message : 'Media request failed';
		const status =
			message.includes('Invalid') || message.includes('expired') || message.includes('Unauthorized')
				? 401
				: message.includes('not found') || message.includes('missing')
					? 404
					: message.includes('size') || message.includes('Content-Type') || message.includes('Maximum')
						? 400
						: 500;
		sendText(res, status, message);
	}

	async function readJson(req: http.IncomingMessage, res: http.ServerResponse): Promise<unknown> {
		try {
			const body = await readBody(req, 1024 * 1024);
			return JSON.parse(body.toString('utf8'));
		} catch {
			void res;
			return null;
		}
	}

	// ========================================================================
	// Static assets and the join preview
	// ========================================================================

	async function handleStatic(req: http.IncomingMessage, res: http.ServerResponse, url: URL): Promise<void> {
		if (!options.staticDir) {
			sendText(res, 404, 'Not found');
			return;
		}

		if (url.pathname === '/join') {
			return handleJoinPreview(res, url);
		}

		const filePath = resolveStatic(options.staticDir, url.pathname);
		if (!filePath) {
			// SvelteKit builds a static shell; unknown paths fall back to it so client-side
			// routing works on a hard refresh.
			const fallback = path.join(options.staticDir, 'index.html');
			if (fs.existsSync(fallback)) {
				sendFile(res, fallback);
				return;
			}
			sendText(res, 404, 'Not found');
			return;
		}

		sendFile(res, filePath);
	}

	/**
	 * Rewrite the meta description on a share link.
	 *
	 * Workers had HTMLRewriter for this. The page is a build artefact whose description
	 * tag we control, so a targeted string replacement does the same job without pulling
	 * in an HTML parser — and if the tag ever changes shape, the page still serves.
	 */
	async function handleJoinPreview(res: http.ServerResponse, url: URL): Promise<void> {
		const indexPath = path.join(options.staticDir!, 'join.html');
		const file = fs.existsSync(indexPath) ? indexPath : path.join(options.staticDir!, 'index.html');
		if (!fs.existsSync(file)) {
			sendText(res, 404, 'Not found');
			return;
		}

		const roomId = url.searchParams.get('roomId');
		const groupId = url.searchParams.get('groupId');
		let description: string | null = null;

		try {
			if (roomId) {
				// Share links are public. A link to a room that is not there gets the plain page.
				const room = hub.existingRoom(roomId);
				const row = room ? await room.mutex.run(() => room.metadataRow()) : null;
				if (row) {
					description = `You have been invited to ${row.eventName}. Division: ${row.divisionId}`;
					if (row.robotEventsSku) {
						description += `. Event Code: ${row.robotEventsSku}`;
					}
				}
			} else if (groupId) {
				const summary = await hub.onExistingGroup(groupId, (group) => group.getPublicSummary());
				if (summary) {
					description =
						summary.divisionCount === 1
							? `You have been invited to ${summary.name}. 1 division`
							: `You have been invited to ${summary.name}. ${summary.divisionCount} divisions`;
				}
			}
		} catch (error) {
			// A preview is a nicety. Serve the page regardless.
			console.error('Failed to build join preview:', error);
		}

		let html = fs.readFileSync(file, 'utf8');
		if (description) {
			html = html.replace(/(<meta\s+name=["']description["']\s+content=)["'][^"']*["']/i, `$1"${description.replace(/"/g, '&quot;')}"`);
		}

		res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': Buffer.byteLength(html) });
		res.end(html);
	}

	function sendFile(res: http.ServerResponse, filePath: string): void {
		const ext = path.extname(filePath).toLowerCase();
		const immutable = filePath.includes(`${path.sep}_app${path.sep}immutable${path.sep}`);

		res.writeHead(200, {
			'Content-Type': MIME_TYPES[ext] ?? 'application/octet-stream',
			// SvelteKit fingerprints everything under _app/immutable, so those can be cached
			// forever; anything else must be revalidated or a deploy would not take effect.
			'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache'
		});
		fs.createReadStream(filePath).pipe(res);
	}

	/**
	 * Resolve a URL path to a file inside the static directory, or null.
	 *
	 * The resolved path is checked to still be inside the root, so a crafted path cannot
	 * walk out of it and serve something else on the disk.
	 */
	function resolveStatic(root: string, pathname: string): string | null {
		const decoded = decodeURIComponent(pathname);
		const candidates = [decoded, `${decoded}.html`, path.join(decoded, 'index.html')];

		for (const candidate of candidates) {
			const resolved = path.resolve(root, `.${path.posix.normalize(candidate)}`);
			if (!resolved.startsWith(path.resolve(root))) {
				return null;
			}
			if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
				return resolved;
			}
		}
		return null;
	}

	// ========================================================================
	// WebSockets
	// ========================================================================

	const wss = new WebSocketServer({ noServer: true });

	server.on('upgrade', (req, socket, head) => {
		const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

		const intention = IntentionSchema.safeParse({
			roomId: url.searchParams.get('roomId'),
			clientId: url.searchParams.get('clientId'),
			deviceId: url.searchParams.get('deviceId'),
			deviceName: url.searchParams.get('deviceName'),
			action: url.searchParams.get('action'),
			auth: url.searchParams.get('auth')
		});

		if (url.pathname === REF_WS_PATH && intention.success) {
			handleRefUpgrade(req, socket, head, intention.data);
			return;
		}

		if (url.pathname !== '/ws' || !intention.success) {
			// A browser cannot read a status code from a failed upgrade, so without this log
			// a rejected connection is invisible on both sides. Say why, on the one side that
			// can.
			console.warn(
				'Rejected WebSocket upgrade:',
				url.pathname !== '/ws' && url.pathname !== REF_WS_PATH
					? `unexpected path ${url.pathname}`
					: (intention.error?.issues ?? []).map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')
			);
			socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
			socket.destroy();
			return;
		}

		wss.handleUpgrade(req, socket, head, (ws: import('ws').WebSocket) => {
			// Opening a room touches the filesystem and runs migrations. A failure there is
			// this connection's problem, not the whole server's — before this was wrapped, a
			// single bad open took the process down and every other room with it.
			try {
				const room = hub.room(intention.data.roomId);
				void room.mutex
					.run(() =>
						room.attach(ws, {
							clientId: intention.data.clientId,
							deviceId: intention.data.deviceId,
							deviceName: intention.data.deviceName,
							auth: intention.data.auth
						})
					)
					.catch((error) => {
						console.error('Failed to attach WebSocket:', error);
						ws.close();
					});
			} catch (error) {
				console.error('Failed to open room', intention.data.roomId, error);
				ws.close();
			}
		});
	});

	function handleRefUpgrade(
		req: http.IncomingMessage,
		socket: import('node:stream').Duplex,
		head: Buffer,
		intention: z.infer<typeof IntentionSchema>
	): void {
		wss.handleUpgrade(req, socket, head, (ws: import('ws').WebSocket) => {
			try {
				const room = hub.refRoom(intention.roomId);
				if (!room) {
					// Accepted and closed with a reason, so the client can tell "this room is gone"
					// apart from a network failure and stop retrying.
					ws.close(ConnectionCloseCode.KICKED, RefCloseReason.ROOM_NOT_FOUND);
					return;
				}
				void room.mutex
					.run(() =>
						room.attach(ws, {
							clientId: intention.clientId,
							deviceId: intention.deviceId,
							deviceName: intention.deviceName,
							auth: intention.auth
						})
					)
					.catch((error) => {
						console.error('Failed to attach ref WebSocket:', error);
						ws.close();
					});
			} catch (error) {
				console.error('Failed to open ref room', intention.roomId, error);
				ws.close();
			}
		});
	}

	return { server, hub };
}
