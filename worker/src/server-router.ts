import { initWRPC } from '@robotools.app/wrpc/server';
import type { AppDatabase } from './runtime/storage';
import type { Authentication } from './access/authentication';
import type { JudgesRoomNetwork } from './network/judges-room-network';
import { buildHandshakeRoute } from './routes/handshake';
import { buildTeamRoute } from './routes/team';
import { buildJudgeRoute } from './routes/judge';
import { buildJudgingRoute } from './routes/judging';
import { buildEssentialRoute } from './routes/essential';
import { buildDeviceRoute } from './routes/device';
import { buildMediaRoute } from './routes/media';
import { buildAccessRoute } from './routes/access';
import { buildGroupRoute } from './routes/group';
import { buildMatchesRoute } from './routes/matches';
import { buildMetaRoute } from './routes/meta';
import type { PhotosBucket } from './media/types';
import type { AdminRegistryGateway } from './admin/gateway';
import type { EmailSender } from './email/types';
import type { RefLinkGateway } from './ref/link-gateway';
import { buildRefLinkRoute } from './routes/ref-link';

export interface ServerContext {
	db: AppDatabase;
	network: JudgesRoomNetwork;
	photos: PhotosBucket;
	auth: Authentication;
	/**
	 * This room's own id. A Durable Object is addressed by name rather than knowing it,
	 * so the id arrives with the connection — and group membership is expressed in terms
	 * of room ids, so anything talking to the group needs it.
	 */
	roomId: string | null;
	/**
	 * How this room announces itself to the admin registry. Durable Objects cannot be
	 * enumerated, so a room that is not registered is invisible to the operator — but a
	 * registry that is missing or unreachable must never stop a room from working.
	 */
	registry: AdminRegistryGateway;
	/**
	 * Sending judges their access links, and the origin those links point at.
	 *
	 * Both are server configuration rather than per-request values — see
	 * email/config.ts for why the origin in particular cannot come from the caller.
	 * `sender.enabled` is false on a server with no SMTP configured, which is the
	 * default.
	 */
	email: EmailContext;
	/** How this room reaches ref rooms. Fire-and-forget only; see ref/link-gateway.ts. */
	refLink: RefLinkGateway;
}

export interface EmailContext {
	sender: EmailSender;
	publicOrigin: string;
}

export type Transaction = Parameters<Parameters<AppDatabase['transaction']>[0]>[0];
export type DatabaseOrTransaction = AppDatabase | Transaction;

// Initialize WRPC server
export const w = initWRPC.createServer<ServerContext>();

/**
 * Server router defines procedures that clients can call
 * These are the API endpoints available to connected clients
 */
const serverRouter = w.router({
	handshake: buildHandshakeRoute(w),
	essential: buildEssentialRoute(w),
	team: buildTeamRoute(w),
	judge: buildJudgeRoute(w),
	judging: buildJudgingRoute(w),
	device: buildDeviceRoute(w),
	media: buildMediaRoute(w),
	access: buildAccessRoute(w),
	group: buildGroupRoute(w),
	matches: buildMatchesRoute(w),
	meta: buildMetaRoute(w),
	refLink: buildRefLinkRoute(w)
});

export { serverRouter };

/**
 * Type definition for the server router
 * Used by client-side code to get type-safe server procedure calls
 */
export type ServerRouter = typeof serverRouter;
