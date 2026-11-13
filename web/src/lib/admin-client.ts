import { ADMIN_RPC_PATH, AdminResponseSchema, type AdminAction, type AdminResponse } from '@robotools.app/protocol/src/admin';

/**
 * Talking to the operator admin surface.
 *
 * Deliberately separate from everything the app does: it holds no permit, joins no room,
 * and its session is a bearer token kept in memory for the tab's lifetime rather than in
 * localStorage. An admin session sees across every event, so leaving it lying around in
 * storage where any script on the origin could read it is not a trade worth making — the
 * cost is signing in again after a reload.
 */
export class AdminRpcError extends Error {
	constructor(
		readonly status: number,
		message: string,
		readonly retryAfterMs: number | null = null
	) {
		super(message);
		this.name = 'AdminRpcError';
	}

	/** The session is missing, expired, or the credentials were wrong. */
	get isUnauthorized(): boolean {
		return this.status === 401;
	}

	/** No admin credentials are configured on this deployment. */
	get isDisabled(): boolean {
		return this.status === 404;
	}
}

export async function callAdminRpc(origin: string, token: string | null, action: AdminAction): Promise<AdminResponse> {
	let response: Response;
	try {
		response = await fetch(`${origin}${ADMIN_RPC_PATH}`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ token, action })
		});
	} catch (error) {
		throw new AdminRpcError(0, error instanceof Error ? error.message : 'Could not reach the server');
	}

	if (!response.ok) {
		const body = (await response.json().catch(() => null)) as { error?: string; retryAfterMs?: number } | null;
		throw new AdminRpcError(response.status, body?.error ?? 'Request failed', body?.retryAfterMs ?? null);
	}

	return AdminResponseSchema.parse(await response.json());
}
