import nodemailer, { type Transporter } from 'nodemailer';
import type { EmailMessage, EmailSender } from './types';

export interface SmtpConfig {
	host: string;
	port: number;
	/** STARTTLS on 587 (secure: false) versus implicit TLS on 465 (secure: true). */
	secure: boolean;
	user: string | null;
	pass: string | null;
	from: string;
	/**
	 * The name this client announces in EHLO.
	 *
	 * Defaults, in nodemailer, to the machine's hostname — which inside a container is a
	 * Docker ID, and is meaningless to a receiving server. Most relays do not care. Google
	 * Workspace's SMTP relay does: it requires the sender to be identified either by SMTP
	 * AUTH or by presenting one of the domain's own names in EHLO, and when neither holds
	 * it closes the connection with `421 4.7.0 Try again later ... (EHLO)` — a message
	 * that names the stage but not the cause, and reads like throttling.
	 */
	ehloName: string | null;
}

/**
 * SMTP sender.
 *
 * One long-lived pooled transport rather than a connection per message: a send-all to a
 * panel of twenty is twenty messages, and most providers rate-limit new connections far
 * more aggressively than messages on an open one.
 */
export function createSmtpSender(config: SmtpConfig): EmailSender {
	let transporter: Transporter | null = null;

	function transport(): Transporter {
		// Built on first use. Constructing it at boot would mean a mail server that happens
		// to be down at start time takes the judging server down with it.
		transporter ??= nodemailer.createTransport({
			host: config.host,
			port: config.port,
			secure: config.secure,
			auth: config.user && config.pass ? { user: config.user, pass: config.pass } : undefined,
			...(config.ehloName ? { name: config.ehloName } : {}),
			pool: true,
			// Matches SEND_CONCURRENCY in routes/access.ts. Fewer connections than there are
			// concurrent sends silently serialises them behind the pool instead.
			maxConnections: 4,
			// A judge waiting on a page should not wait on a hung mail server.
			connectionTimeout: 10_000,
			greetingTimeout: 10_000,
			socketTimeout: 20_000
		});
		return transporter;
	}

	return {
		enabled: true,
		fromAddress: config.from,
		async send(message: EmailMessage): Promise<void> {
			const info = await transport().sendMail({
				from: config.from,
				to: message.to,
				subject: message.subject,
				text: message.text,
				html: message.html
			});

			// sendMail resolves when *any* recipient was accepted, so a rejected address on
			// a multi-recipient message would otherwise look like a success. Every message
			// here goes to one judge, which makes a non-empty `rejected` unambiguous.
			if (info.rejected.length > 0) {
				throw new Error(`The mail server rejected ${info.rejected.length} recipient(s): ${info.response}`);
			}

			// Record the handoff. Without this an accepted-then-dropped message is
			// indistinguishable from a delivered one, and the Judge Advisor is left with a
			// UI that said "sent" and a judge who has nothing. `response` carries the
			// server's queue id — for Google that is what Email Log Search searches on, so
			// this line is the thread from "we sent it" to "here is what happened next".
			console.log(`Email accepted for ${maskAddress(message.to)}: id=${info.messageId} response=${info.response}`);
		}
	};
}

/**
 * `judge@example.com` -> `j***@example.com`.
 *
 * The domain and first character are enough to tell one recipient from another when
 * someone reports a missing link, and the container log is not a place a judge's address
 * should sit in full — the room database deletes it when the event is destroyed, and a
 * rotating log makes no such promise.
 */
function maskAddress(address: string): string {
	const at = address.lastIndexOf('@');
	if (at <= 0) return '***';
	return `${address[0]}***${address.slice(at)}`;
}

/**
 * Turn whatever nodemailer threw into one line fit to show a Judge Advisor.
 *
 * The raw error can carry the full SMTP conversation, and the conversation contains the
 * message — which contains the access token. Only the code and the server's own response
 * text are kept, and the result is length-capped before it reaches the client.
 */
export function describeSmtpFailure(error: unknown): string {
	if (typeof error !== 'object' || error === null) {
		return 'Send failed';
	}

	const err = error as { code?: unknown; responseCode?: unknown; response?: unknown; message?: unknown };
	const parts: string[] = [];

	if (typeof err.code === 'string') {
		parts.push(err.code);
	}
	if (typeof err.responseCode === 'number') {
		parts.push(String(err.responseCode));
	}

	// `response` is the mail server's reply line; `message` is nodemailer's own wording.
	// Neither echoes the body, which is what makes them safe to forward.
	const detail = typeof err.response === 'string' ? err.response : typeof err.message === 'string' ? err.message : '';
	if (detail) {
		parts.push(detail);
	}

	const summary = parts.join(' ').replace(/\s+/g, ' ').trim();
	return summary ? summary.slice(0, 300) : 'Send failed';
}
