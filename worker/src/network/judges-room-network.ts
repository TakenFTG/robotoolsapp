import {
	type ClientAuthentication,
	uncontrolledAuthentication,
	clientAuthenticationsEqual,
	ConnectAuthCloseReason,
	type ConnectAuthCloseReason as ConnectAuthCloseReasonValue
} from '@robotools.app/protocol/src/access';
import type { Network } from '@robotools.app/wrpc/server/types';
import type { AppDatabase } from '../runtime/storage';
import { metadata, offlineDevices } from '../db/schema';
import { resolveClientAuthentication } from '../access/tokens';
import { getRoomGroupId, noEventGroupGateway, type EventGroupGateway } from '../group/gateway';
import { groupScopedAdvisorId } from '@robotools.app/protocol/src/group';
import { eq, inArray, ne } from 'drizzle-orm';
import type { MatchesSnapshot } from '@robotools.app/protocol/src/matches';

export type ConnectAuthDenial = {
	allowed: false;
	reason: ConnectAuthCloseReasonValue;
};

export type WsAttachment = {
	roomId: string;
	clientId: string;
	deviceId: string;
	deviceName: string;
	authentication: ClientAuthentication;
};

export type ClientAuthenticationEntry = {
	clientId: string;
	deviceId: string;
	authentication: ClientAuthentication;
};

/**
 * A WebSocket accepted by a Durable Object via hibernation, which gains the
 * `serializeAttachment`/`deserializeAttachment` pair. Declared locally so this
 * module also type-checks in consumers that only have DOM lib (e.g. the web
 * workspace, which type-imports the server router).
 */
export type HibernatableWebSocket = WebSocket & {
	serializeAttachment(value: unknown): void;
	deserializeAttachment(): unknown;
};

export type JudgesRoomNetworkOptions = {
	inner: Network;
	db: AppDatabase;
	getWebSockets: () => readonly HibernatableWebSocket[];
	/**
	 * How this room reaches the EventGroup it belongs to, if any. Defaults to a gateway
	 * that admits nobody, so a room without a group behaves exactly as it did before
	 * groups existed.
	 */
	group?: EventGroupGateway;
	/** The room's match schedule cache, so routes reach it without a Room reference. */
	matches: (force: boolean) => Promise<MatchesSnapshot>;
};

/**
 * Room-scoped network: wraps the WRPC connection manager with DO websocket + DB access.
 */
export class JudgesRoomNetwork implements Network {
	constructor(private readonly opts: JudgesRoomNetworkOptions) {}

	sendToClient(...args: Parameters<Network['sendToClient']>): ReturnType<Network['sendToClient']> {
		return this.opts.inner.sendToClient(...args);
	}

	broadcast(...args: Parameters<Network['broadcast']>): ReturnType<Network['broadcast']> {
		return this.opts.inner.broadcast(...args);
	}

	notifyClient(...args: Parameters<Network['notifyClient']>): ReturnType<Network['notifyClient']> {
		return this.opts.inner.notifyClient(...args);
	}

	notifyAll(...args: Parameters<Network['notifyAll']>): ReturnType<Network['notifyAll']> {
		return this.opts.inner.notifyAll(...args);
	}

	/** The room's match schedule cache. Injected so routes need no reference to the Room. */
	matches(force: boolean): Promise<MatchesSnapshot> {
		return this.opts.matches(force);
	}

	getConnectedClients(): Readonly<string[]> {
		return this.opts.inner.getConnectedClients();
	}

	isClientConnected(clientId: string): boolean {
		return this.opts.inner.isClientConnected(clientId);
	}

	isDeviceConnected(deviceId: string): boolean {
		return this.opts.inner.isDeviceConnected(deviceId);
	}

	getAllClientData() {
		return this.opts.inner.getAllClientData();
	}

	getClientData(clientId: string) {
		return this.opts.inner.getClientData(clientId);
	}

	async kickClient(clientId: string): Promise<void> {
		const client = this.getClientData(clientId);
		await this.opts.inner.kickClient(clientId);
		if (client && !this.isDeviceConnected(client.deviceId)) {
			await this.opts.db.delete(offlineDevices).where(eq(offlineDevices.deviceId, client.deviceId));
		}
	}

	async kickOtherClients(exceptClientId: string): Promise<void> {
		const except = this.getClientData(exceptClientId);
		for (const client of this.getAllClientData()) {
			if (client.clientId !== exceptClientId) {
				await this.opts.inner.kickClient(client.clientId);
			}
		}
		if (except) {
			await this.opts.db.delete(offlineDevices).where(ne(offlineDevices.deviceId, except.deviceId));
		} else {
			await this.opts.db.delete(offlineDevices);
		}
	}

	async kickDevice(deviceId: string): Promise<void> {
		if (this.isDeviceConnected(deviceId)) {
			for (const client of this.getAllClientData()) {
				if (client.deviceId === deviceId) {
					await this.opts.inner.kickClient(client.clientId);
				}
			}
		}
		await this.opts.db.delete(offlineDevices).where(eq(offlineDevices.deviceId, deviceId));
	}

	/**
	 * Disconnect every device signed in as one particular Judge Advisor.
	 *
	 * `exceptDeviceId` is for the advisor rotating their own link: the device that asked
	 * keeps working, every other one is cut off. That is the point of rotating.
	 */
	async kickJudgeAdvisor(judgeAdvisorId: string, exceptDeviceId: string | null = null): Promise<void> {
		const kickingDevices = new Set<string>();
		for (const ca of this.getAllClientAuthentications()) {
			if (
				ca.authentication.isAccessControlled &&
				ca.authentication.role === 'judge_advisor' &&
				ca.authentication.judgeAdvisorId === judgeAdvisorId &&
				ca.deviceId !== exceptDeviceId
			) {
				kickingDevices.add(ca.deviceId);
				await this.opts.inner.kickClient(ca.clientId);
			}
		}
		if (kickingDevices.size === 0) {
			return;
		}
		await this.opts.db.delete(offlineDevices).where(inArray(offlineDevices.deviceId, Array.from(kickingDevices)));
	}

	async kickJudge(judgeId: string): Promise<void> {
		const kickingDevices = new Set<string>();
		for (const ca of this.getAllClientAuthentications()) {
			if (ca.authentication.isAccessControlled && ca.authentication.role === 'judge' && ca.authentication.judgeId === judgeId) {
				kickingDevices.add(ca.deviceId);
				await this.opts.inner.kickClient(ca.clientId);
			}
		}
		if (kickingDevices.size === 0) {
			return;
		}
		await this.opts.db.delete(offlineDevices).where(inArray(offlineDevices.deviceId, Array.from(kickingDevices)));
	}

	destroy(): Promise<void> {
		return this.opts.inner.destroy();
	}

	async isAccessControlEnabled(): Promise<boolean> {
		const rows = await this.opts.db.select({ accessControlEnabled: metadata.accessControlEnabled }).from(metadata).limit(1);
		return rows[0]?.accessControlEnabled ?? false;
	}

	/**
	 * Gate WebSocket accept and return the attachment authentication to persist.
	 * Empty room (create path) and AC-off always allow with uncontrolled auth.
	 * When AC is on, auth must resolve to a controlled ClientAuthentication.
	 *
	 * Together with kicking all other clients when AC is toggled (essential.ts), this is
	 * what guarantees no uncontrolled socket exists while AC is on — mutation handlers
	 * rely on that and do not re-check requireAuthenticated.
	 */
	get group(): EventGroupGateway {
		return this.opts.group ?? noEventGroupGateway;
	}

	/**
	 * Ask this room's EventGroup, live, whether a token it does not recognise may open it.
	 *
	 * This is the whole of the cross-room trust model. There is no shared key to
	 * distribute, no signed assertion to expire, and correspondingly nothing bespoke to
	 * get wrong: the group is asked on every connect, so removing an advisor from the
	 * group, or removing this room from the group, is felt on the very next one. It costs
	 * a single Durable Object hop, and only on connect.
	 */
	private async resolveGroupAuthentication(
		deviceId: string,
		auth: string,
		roomId: string | undefined
	): Promise<Extract<ClientAuthentication, { isAccessControlled: true }> | null> {
		if (!roomId) {
			return null;
		}

		const groupId = await getRoomGroupId(this.opts.db);
		if (!groupId) {
			return null;
		}

		const validation = await this.group.validateSession(groupId, { authToken: auth, roomId });
		if (!validation.valid) {
			return null;
		}

		return {
			isAccessControlled: true,
			authToken: auth,
			role: 'judge_advisor',
			// Prefixed so a group advisor can never share an id with one of the room's own,
			// and so everything downstream that keys off judgeAdvisorId stays unambiguous.
			judgeAdvisorId: groupScopedAdvisorId(validation.groupAdvisorId),
			groupOrigin: {
				groupId: validation.groupId,
				groupAdvisorId: validation.groupAdvisorId,
				name: validation.name
			}
		};
	}

	async authorizeConnect(
		deviceId: string,
		auth: string | null,
		roomId?: string
	): Promise<{ allowed: true; authentication: ClientAuthentication } | ConnectAuthDenial> {
		// Empty room (create path): no Metadata yet — allow connect; createJudgesRoom mints JA auth.
		if (!(await this.isAccessControlEnabled())) {
			return { allowed: true, authentication: uncontrolledAuthentication };
		}
		if (!auth) {
			return { allowed: false, reason: ConnectAuthCloseReason.ACCESS_LINK_REQUIRED };
		}
		// A room's own advisors and judges are resolved first, so a room that belongs to no
		// group — or whose group is unreachable — behaves exactly as it always has.
		const authentication =
			(await resolveClientAuthentication(this.opts.db, auth)) ?? (await this.resolveGroupAuthentication(deviceId, auth, roomId));
		if (!authentication) {
			return { allowed: false, reason: ConnectAuthCloseReason.INVALID_ACCESS_LINK };
		}
		const existingAuthentication = this.getClientAuthenticationByDeviceId(deviceId);
		if (existingAuthentication && !clientAuthenticationsEqual(existingAuthentication, authentication)) {
			return { allowed: false, reason: ConnectAuthCloseReason.DEVICE_AUTH_CONFLICT };
		}

		return { allowed: true, authentication };
	}

	getClientAuthenticationByDeviceId(deviceId: string): ClientAuthentication | null {
		for (const entry of this.getAllClientAuthentications()) {
			if (entry.deviceId === deviceId) {
				return entry.authentication;
			}
		}
		return null;
	}

	getAllClientAuthentications(): readonly ClientAuthenticationEntry[] {
		const entries: ClientAuthenticationEntry[] = [];
		for (const ws of this.opts.getWebSockets()) {
			const attachment = ws.deserializeAttachment() as WsAttachment | null;
			if (!attachment) continue;
			entries.push({
				clientId: attachment.clientId,
				deviceId: attachment.deviceId,
				authentication: attachment.authentication ?? uncontrolledAuthentication
			});
		}
		return entries;
	}
}
