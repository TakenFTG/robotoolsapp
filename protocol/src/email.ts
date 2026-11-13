import { z } from 'zod';

/**
 * Emailing judges their access links.
 *
 * The thing being posted is a credential: the link in the message admits its holder to the
 * room as that judge. Three consequences run through this file.
 *
 * First, sending is never automatic. A Judge Advisor presses a button; nothing leaves the
 * server because a record changed. A typo in an address that sends on save is a working
 * access link delivered to a stranger, discovered only when it is too late to matter.
 *
 * Second, the origin of the link is server configuration, not a client parameter. A
 * caller who could choose the origin could have the server mail a real token pointed at a
 * host they control.
 *
 * Third, failures are reported per recipient. A send-all that stops at the first bad
 * address leaves the Judge Advisor with no idea which half of the panel got their link.
 */

/**
 * Where a judge's access link is emailed.
 *
 * Zod's email check is deliberately the only validation. Anything stricter rejects
 * addresses that are perfectly deliverable, and the authoritative test — whether the mail
 * server accepts it — happens at send time anyway.
 */
export const JudgeEmailSchema = z.email().max(254);
export type JudgeEmail = z.infer<typeof JudgeEmailSchema>;

/** Per-recipient outcome of a send. */
export const EmailSendOutcomeSchema = z.enum([
	/** Handed to the mail server, which accepted it. */
	'sent',
	/** No address recorded for this judge, so nothing was attempted. */
	'no_address',
	/** The mail server rejected it, or could not be reached. */
	'failed'
]);
export type EmailSendOutcome = z.infer<typeof EmailSendOutcomeSchema>;

export const EmailSendResultSchema = z.object({
	judgeId: z.uuidv4(),
	name: z.string(),
	email: JudgeEmailSchema.nullable(),
	outcome: EmailSendOutcomeSchema,
	/**
	 * Present only when the outcome is 'failed'. Carries the mail server's complaint —
	 * "mailbox unavailable", "relay denied" — because the fix is nearly always something
	 * only the operator can act on, and hiding it turns a five-minute DNS problem into an
	 * afternoon. Never contains the access token.
	 */
	error: z.string().max(300).optional()
});
export type EmailSendResult = z.infer<typeof EmailSendResultSchema>;

export const SendAccessLinkEmailsResultSchema = z.object({
	results: z.array(EmailSendResultSchema)
});
export type SendAccessLinkEmailsResult = z.infer<typeof SendAccessLinkEmailsResultSchema>;

/**
 * Whether the server can send at all, so the UI can explain itself rather than offering a
 * button that always fails. Sending is off unless the operator configured SMTP.
 */
export const EmailCapabilitySchema = z.object({
	enabled: z.boolean(),
	/** The From address, shown so a Judge Advisor knows what judges will see. */
	fromAddress: z.string().nullable()
});
export type EmailCapability = z.infer<typeof EmailCapabilitySchema>;

/**
 * Ceiling on one send-all.
 *
 * Free mail tiers are metered per day — 100/day on Resend, 300/day on Brevo — and a room
 * with more judges than this has other problems. The cap exists so a stuck client cannot
 * quietly consume the whole quota before an event has started.
 */
export const MAX_ACCESS_LINK_EMAILS_PER_SEND = 60;

/**
 * Cooling-off charged per message sent, and the ceiling on it.
 *
 * Proportional rather than flat: correcting one address and sending again is the common
 * case and earns a one-second pause, while mailing a whole panel earns a longer one. A
 * flat delay long enough to matter for a send-all would make single sends tedious, and one
 * short enough for single sends would not slow a runaway client down at all.
 */
export const ACCESS_LINK_EMAIL_COOLDOWN_MS = 1000;
export const MAX_ACCESS_LINK_EMAIL_COOLDOWN_MS = 60 * 1000;
