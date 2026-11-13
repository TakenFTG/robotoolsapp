/**
 * The seam between "decide what to send" and "actually send it".
 *
 * Kept deliberately narrow — one method, no templating, no queue — so the room routes can
 * be tested against a fake and the operator can point the server at any mail provider
 * without a code change. SMTP was chosen over a vendor HTTP API for exactly that reason:
 * Brevo, SMTP2GO, Resend, Google Workspace and a relay on the LAN all speak it.
 */

export interface EmailMessage {
	to: string;
	subject: string;
	text: string;
	html: string;
}

export interface EmailSender {
	/** True when the server is configured to send. False makes every route refuse early. */
	readonly enabled: boolean;
	/** The From address, so the UI can show a Judge Advisor what judges will see. */
	readonly fromAddress: string | null;
	/**
	 * Resolves when the mail server has accepted the message, rejects otherwise.
	 *
	 * "Accepted" is as far as this goes. A message can be accepted and still bounce later;
	 * treating handoff as delivery is the honest limit of sending without webhooks, and
	 * the UI says "sent" rather than "delivered" for that reason.
	 */
	send(message: EmailMessage): Promise<void>;
}

/**
 * The sender used when SMTP is not configured.
 *
 * Refusing loudly beats a silent no-op: a Judge Advisor who presses Send and sees nothing
 * happen will assume the mail is on its way.
 */
export const disabledEmailSender: EmailSender = {
	enabled: false,
	fromAddress: null,
	send(): Promise<void> {
		return Promise.reject(new Error('Email is not configured on this server'));
	}
};
