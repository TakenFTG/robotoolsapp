import { createSmtpSender } from './smtp';
import { disabledEmailSender, type EmailSender } from './types';

/**
 * Extends the index signature so `process.env` can be passed directly. Without it TS
 * rejects the call outright: every named property is optional, which makes this a "weak"
 * type that nothing structurally matches.
 */
export interface EmailEnv extends Record<string, string | undefined> {
	SMTP_HOST?: string;
	SMTP_PORT?: string;
	SMTP_USER?: string;
	SMTP_PASSWORD?: string;
	SMTP_FROM?: string;
	SMTP_SECURE?: string;
	SMTP_EHLO_NAME?: string;
	PUBLIC_ORIGIN?: string;
}

export interface EmailConfiguration {
	sender: EmailSender;
	/**
	 * Absolute origin the emailed links point at, e.g. https://judge.vexaus.live.
	 *
	 * Configuration, never a request parameter. Links built in the browser can safely use
	 * `window.location.origin` because the browser already trusts where it is; a server
	 * building a link for someone else has no such anchor, and accepting one from the
	 * caller would let an authenticated Judge Advisor — or anything that had taken over
	 * their session — have the server mail working tokens pointed at a host they own.
	 */
	publicOrigin: string;
}

function parsePort(raw: string | undefined): number {
	if (!raw) {
		// 587 with STARTTLS is what every provider in this class documents first.
		return 587;
	}
	const port = Number(raw);
	if (!Number.isInteger(port) || port <= 0 || port > 65535) {
		throw new Error(`SMTP_PORT must be a port number, got ${JSON.stringify(raw)}`);
	}
	return port;
}

function parseOrigin(raw: string): string {
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		throw new Error(`PUBLIC_ORIGIN must be an absolute URL, e.g. https://judge.example.com — got ${JSON.stringify(raw)}`);
	}
	if (url.protocol !== 'http:' && url.protocol !== 'https:') {
		throw new Error(`PUBLIC_ORIGIN must be http or https, got ${url.protocol}`);
	}
	// Normalised so a trailing slash or a stray path cannot produce /judge//join.
	return url.origin;
}

/**
 * Read the mail configuration, or decide that sending is off.
 *
 * Half-configured is treated the same way as the admin credentials are: refuse to start.
 * The alternative is a server that looks like it can send and fails at the one moment
 * someone depends on it, which at an event is the middle of judge check-in.
 */
export function readEmailConfiguration(env: EmailEnv): EmailConfiguration {
	const host = env.SMTP_HOST?.trim() || null;
	const from = env.SMTP_FROM?.trim() || null;
	const origin = env.PUBLIC_ORIGIN?.trim() || null;

	if (!host && !from) {
		if (env.SMTP_USER?.trim() || env.SMTP_PASSWORD?.trim()) {
			throw new Error('SMTP_USER/SMTP_PASSWORD are set but SMTP_HOST and SMTP_FROM are not. Set all of them, or none.');
		}
		return { sender: disabledEmailSender, publicOrigin: origin ? parseOrigin(origin) : '' };
	}

	if (!host || !from) {
		throw new Error('Set both SMTP_HOST and SMTP_FROM to enable email, or neither to disable it.');
	}

	// Without this the server would build links against a host it cannot know, and mail
	// every judge a URL that goes nowhere. Better to refuse than to send 30 broken links.
	if (!origin) {
		throw new Error('PUBLIC_ORIGIN is required when SMTP is configured — it is the address emailed links point at.');
	}

	const port = parsePort(env.SMTP_PORT);

	return {
		sender: createSmtpSender({
			host,
			port,
			// 465 is implicit TLS; everything else is assumed to be STARTTLS on a plain
			// socket. Overridable because a relay on the LAN may do neither.
			secure: env.SMTP_SECURE ? env.SMTP_SECURE.trim() === 'true' : port === 465,
			user: env.SMTP_USER?.trim() || null,
			pass: env.SMTP_PASSWORD || null,
			// Falls back to the public origin's hostname, which is already a name in the
			// operator's own domain — exactly what a relay authenticating by IP wants to
			// see, and one fewer setting to get wrong. Overridable for the case where the
			// service is reached on a name the mail side does not recognise.
			ehloName: env.SMTP_EHLO_NAME?.trim() || new URL(parseOrigin(origin)).hostname,
			from
		}),
		publicOrigin: parseOrigin(origin)
	};
}
