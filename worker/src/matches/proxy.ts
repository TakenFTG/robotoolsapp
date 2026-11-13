import { getRobotEventsToken } from './source';

/**
 * A read-only pass-through to the VEX Events API, so the API key stays on the server.
 *
 * The browser's events.vex client is pointed at `/vex-events/api/v2/…` here instead of at
 * events.vex.com, and this adds the key and forwards the request. It cannot ask for any
 * other host: the upstream origin is fixed and only the path and query come from the
 * request.
 *
 * Event setup runs before anyone holds an access link, so this cannot require one. What
 * stops it being a free API key for anyone who finds it:
 *
 *   - answers are cached for a minute, so twenty judges refreshing the same event cost
 *     one upstream call, not twenty;
 *   - upstream calls are capped per minute across the whole server, so a loop or a
 *     scraper hits 429 here long before the key is throttled for real events;
 *   - cross-origin browser use is only allowed from this server's own host and localhost
 *     (see isAllowedOrigin).
 */

export const VEX_EVENTS_PROXY_PREFIX = '/vex-events/api/v2/';

const UPSTREAM_BASE = 'https://events.vex.com/api/v2/';
const CACHE_TTL_MS = 60_000;
const CACHE_MAX_ENTRIES = 500;
const UPSTREAM_LIMIT_PER_MINUTE = 120;
const UPSTREAM_TIMEOUT_MS = 15_000;

/** Path segments are letters, digits, `_` and `-` only: no dots, so no `..`, and no encoded tricks. */
const SAFE_PATH = /^[A-Za-z0-9_-]+(\/[A-Za-z0-9_-]+)*$/;

/**
 * The upstream URL for a proxied request, or null if the path is not one we forward.
 * Exported for tests.
 */
export function resolveUpstreamUrl(pathname: string, search: string): string | null {
	if (!pathname.startsWith(VEX_EVENTS_PROXY_PREFIX)) {
		return null;
	}
	const rest = pathname.slice(VEX_EVENTS_PROXY_PREFIX.length);
	if (!SAFE_PATH.test(rest)) {
		return null;
	}
	return `${UPSTREAM_BASE}${rest}${search}`;
}

/**
 * Whether a browser on `origin` may read responses cross-origin. Production is same-origin
 * (no Origin header reaches the CORS check at all for simple GETs); the allowance for
 * localhost is the dev web server on its own port. Exported for tests.
 */
export function isAllowedOrigin(origin: string, host: string | undefined): boolean {
	try {
		const { hostname, host: originHost } = new URL(origin);
		return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || originHost === host;
	} catch {
		return false;
	}
}

export interface ProxyResponse {
	status: number;
	contentType: string;
	body: string;
}

type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

export class VexEventsProxy {
	private readonly cache = new Map<string, { expires: number; response: ProxyResponse }>();
	private windowStart = 0;
	private callsInWindow = 0;

	constructor(
		private readonly fetcher: Fetcher = fetch,
		private readonly now: () => number = Date.now,
		private readonly getToken: () => string | null = getRobotEventsToken
	) {}

	async get(upstreamUrl: string): Promise<ProxyResponse> {
		const token = this.getToken();
		if (!token) {
			return jsonError(503, 'No VEX Events API key is configured on the server. Set ROBOTEVENTS_TOKEN in judging.env and restart it.');
		}

		const now = this.now();
		const cached = this.cache.get(upstreamUrl);
		if (cached && cached.expires > now) {
			return cached.response;
		}

		if (now - this.windowStart >= 60_000) {
			this.windowStart = now;
			this.callsInWindow = 0;
		}
		if (this.callsInWindow >= UPSTREAM_LIMIT_PER_MINUTE) {
			return jsonError(429, 'Too many VEX Events requests through this server. Try again in a minute.');
		}
		this.callsInWindow++;

		let upstream: Response;
		try {
			upstream = await this.fetcher(upstreamUrl, {
				headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
				signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)
			});
		} catch (error) {
			console.warn('VEX Events request failed:', upstreamUrl, error);
			return jsonError(502, 'Could not reach VEX Events.');
		}

		const response: ProxyResponse = {
			status: upstream.status,
			contentType: upstream.headers.get('content-type') ?? 'application/json',
			body: await upstream.text()
		};

		// Only successes are cached: an error should be retried, not remembered.
		if (upstream.ok) {
			if (this.cache.size >= CACHE_MAX_ENTRIES) {
				this.evictExpired(now);
				if (this.cache.size >= CACHE_MAX_ENTRIES) {
					// Still full of live entries: drop the oldest, which Map keeps first.
					const oldest = this.cache.keys().next().value;
					if (oldest !== undefined) this.cache.delete(oldest);
				}
			}
			this.cache.set(upstreamUrl, { expires: now + CACHE_TTL_MS, response });
		}

		return response;
	}

	private evictExpired(now: number): void {
		for (const [key, entry] of this.cache) {
			if (entry.expires <= now) this.cache.delete(key);
		}
	}
}

function jsonError(status: number, message: string): ProxyResponse {
	return { status, contentType: 'application/json', body: JSON.stringify({ code: status, message }) };
}
