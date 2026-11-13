import type { EmailMessage } from './types';

export interface AccessLinkEmailInput {
	judgeName: string;
	eventName: string;
	link: string;
	to: string;
}

/** Minimal escaping for the four characters that can break out of HTML text or an attribute. */
function escapeHtml(value: string): string {
	return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Strip anything that could inject a header.
 *
 * The event name is operator-supplied and lands in the Subject line. A newline there
 * splits the header block and lets the rest of the value become headers of its own — a Bcc
 * to somewhere else, most usefully for an attacker. Nodemailer guards against this too;
 * this is the belt to its braces, and it also stops a pasted multi-line event name from
 * producing a mangled subject.
 */
function singleLine(value: string): string {
	return value.replace(/[\r\n]+/g, ' ').trim();
}

/**
 * The message a judge receives.
 *
 * Written to survive being read on a phone in a noisy sports hall thirty seconds before
 * the first interview. No branding, no preamble, the link high up, and an explicit warning
 * that the link is personal — judges forward things to each other by default, and a
 * forwarded link means two people submitting rubrics as the same judge.
 *
 * Both parts are built together rather than letting a client render the HTML, because a
 * text/plain alternative is what stops the message reading as blank in a client with
 * images and HTML disabled, which describes a good number of volunteer laptops.
 */
export function buildAccessLinkEmail(input: AccessLinkEmailInput): EmailMessage {
	const eventName = singleLine(input.eventName);
	const judgeName = singleLine(input.judgeName);

	const subject = `Your judging access link — ${eventName}`;

	const text = [
		`Hello ${judgeName},`,
		'',
		`You have been added as a judge for ${eventName}.`,
		'',
		'Open this link to join the judging room:',
		input.link,
		'',
		'This link is personal to you. It signs you in as yourself, so please do not',
		'forward it — anyone who has it can submit rubrics and nominations under your',
		'name. If you lose it, ask the Judge Advisor to send it again.',
		'',
		'You do not need a password or an account. The link is all you need.'
	].join('\n');

	const html = `<!doctype html>
<html>
	<body style="margin:0;padding:24px;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0f172a;">
		<div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:8px;padding:28px;">
			<p style="margin:0 0 16px;font-size:16px;">Hello ${escapeHtml(judgeName)},</p>
			<p style="margin:0 0 24px;font-size:16px;">
				You have been added as a judge for <strong>${escapeHtml(eventName)}</strong>.
			</p>
			<p style="margin:0 0 24px;">
				<a
					href="${escapeHtml(input.link)}"
					style="display:inline-block;background:#1e293b;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:6px;font-size:16px;font-weight:500;"
					>Open the judging room</a
				>
			</p>
			<!-- The bare URL is repeated because some clients strip the button, and because a
			     judge who wants to check where a link goes before tapping it should be able to. -->
			<p style="margin:0 0 24px;font-size:13px;color:#475569;word-break:break-all;">
				Or paste this into your browser:<br />${escapeHtml(input.link)}
			</p>
			<p style="margin:0 0 16px;font-size:14px;color:#475569;">
				This link is personal to you. It signs you in as yourself, so please do not forward it — anyone who has it can
				submit rubrics and nominations under your name. If you lose it, ask the Judge Advisor to send it again.
			</p>
			<p style="margin:0;font-size:14px;color:#475569;">
				You do not need a password or an account. The link is all you need.
			</p>
		</div>
	</body>
</html>`;

	return { to: input.to, subject, text, html };
}

export interface AdvisorAccessLinkEmailInput {
	advisorName: string;
	/** The event, or the event group when the link admits to a whole group. */
	contextName: string;
	link: string;
	to: string;
	/** True when the link is administered by an event group rather than one room. */
	forGroup: boolean;
}

/**
 * The message a Judge Advisor receives.
 *
 * Deliberately different from the judge's, in two ways that matter.
 *
 * It is explicit that the link *is* the credential and must not be forwarded, which is the
 * thing that makes emailing it defensible at all. A group link says so more strongly,
 * because it opens every division at once.
 *
 * It also says to keep the message. The whole reason this send exists is the Judge Advisor
 * who closes the tab and has no way back into their own event.
 */
export function buildAdvisorAccessLinkEmail(input: AdvisorAccessLinkEmailInput): EmailMessage {
	const contextName = singleLine(input.contextName);
	const advisorName = singleLine(input.advisorName);
	const what = input.forGroup ? 'event group' : 'event';

	const subject = `Your Judge Advisor access link — ${contextName}`;

	const scope = input.forGroup ? 'every division in the group' : 'the room';
	const replaceFrom = input.forGroup ? 'the event group' : 'Users in the menu';

	const credentialLineText = [
		'This link is your credential. It identifies you personally, so anyone who has it enters',
		`${scope} as you — do not forward it. If it goes astray, issue yourself a new one from`,
		`${replaceFrom}, which signs out every device using the old link.`
	];

	const text = [
		`Hello ${advisorName},`,
		'',
		`You are the Judge Advisor for the ${what} ${contextName}.`,
		'',
		'Open this link to join:',
		input.link,
		'',
		...credentialLineText,
		'',
		'Keep this email. This link is how you get back in if you close the app or change',
		'device, and it cannot be recovered from inside the room.'
	].join('\n');

	const credentialLineHtml = `<strong>This link is your credential.</strong> It identifies you personally, so anyone who
			   has it enters ${scope} as you — do not forward it. If it goes astray, issue yourself a new one from
			   ${replaceFrom}, which signs out every device using the old link.`;

	const html = `<!doctype html>
<html>
	<body style="margin:0;padding:24px;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0f172a;">
		<div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:8px;padding:28px;">
			<p style="margin:0 0 16px;font-size:16px;">Hello ${escapeHtml(advisorName)},</p>
			<p style="margin:0 0 24px;font-size:16px;">
				You are the Judge Advisor for the ${what} <strong>${escapeHtml(contextName)}</strong>.
			</p>
			<p style="margin:0 0 24px;">
				<a
					href="${escapeHtml(input.link)}"
					style="display:inline-block;background:#1e293b;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:6px;font-size:16px;font-weight:500;"
					>Open the judging room</a
				>
			</p>
			<p style="margin:0 0 24px;font-size:13px;color:#475569;word-break:break-all;">
				Or paste this into your browser:<br />${escapeHtml(input.link)}
			</p>
			<p style="margin:0 0 16px;font-size:14px;color:#475569;">${credentialLineHtml}</p>
			<p style="margin:0;font-size:14px;color:#475569;">
				<strong>Keep this email.</strong> This link is how you get back in if you close the app or change device, and it
				cannot be recovered from inside the room.
			</p>
		</div>
	</body>
</html>`;

	return { to: input.to, subject, text, html };
}

export interface RetentionWarningEmailInput {
	advisorName: string;
	eventName: string;
	link: string;
	to: string;
	/** Whole days left before the event is deleted. */
	daysRemaining: number;
}

/**
 * The last notice a Judge Advisor gets before an event is deleted.
 *
 * Written around one instruction — export the results — because that is the only action
 * that cannot be taken afterwards. The window is short by design, so the message leads
 * with the deadline rather than burying it, and says plainly that deletion is permanent.
 *
 * It does not treat deletion as a problem. Destroying the event is the correct end state
 * for confidential judging material, and this exists so it happens on a schedule rather
 * than only when someone remembers.
 */
export function buildRetentionWarningEmail(input: RetentionWarningEmailInput): EmailMessage {
	const eventName = singleLine(input.eventName);
	const advisorName = singleLine(input.advisorName);
	const days = input.daysRemaining === 1 ? 'tomorrow' : `in ${input.daysRemaining} days`;

	const subject = `Action needed: ${eventName} will be deleted ${days}`;

	const text = [
		`Hello ${advisorName},`,
		'',
		`${eventName} has been inactive for a while and will be permanently deleted ${days}.`,
		'',
		'If you need a record of the results, export it first — this is the only step that',
		'cannot be undone afterwards. Open the event, then use Export results to save the',
		'award winners, nominations and final rankings as a PDF.',
		'',
		input.link,
		'',
		'Deleting is deliberate: judging material is confidential, and an event that is over',
		'should not sit on a server indefinitely. Everything goes at once — rubrics, notes,',
		'photos and access links — and none of it can be recovered.',
		'',
		'If the event is still in use, simply opening it resets the clock.'
	].join('\n');

	const html = `<!doctype html>
<html>
	<body style="margin:0;padding:24px;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0f172a;">
		<div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:8px;padding:28px;">
			<p style="margin:0 0 16px;font-size:16px;">Hello ${escapeHtml(advisorName)},</p>
			<p style="margin:0 0 24px;font-size:16px;">
				<strong>${escapeHtml(eventName)}</strong> has been inactive for a while and will be permanently deleted
				${escapeHtml(days)}.
			</p>
			<p style="margin:0 0 24px;font-size:15px;">
				If you need a record of the results, <strong>export it first</strong> — this is the only step that cannot be
				undone afterwards. Open the event, then use <em>Export results</em> to save the award winners, nominations and
				final rankings as a PDF.
			</p>
			<p style="margin:0 0 24px;">
				<a
					href="${escapeHtml(input.link)}"
					style="display:inline-block;background:#1e293b;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:6px;font-size:16px;font-weight:500;"
					>Open the event</a
				>
			</p>
			<p style="margin:0 0 16px;font-size:14px;color:#475569;">
				Deleting is deliberate: judging material is confidential, and an event that is over should not sit on a server
				indefinitely. Everything goes at once — rubrics, notes, photos and access links — and none of it can be
				recovered.
			</p>
			<p style="margin:0;font-size:14px;color:#475569;">If the event is still in use, simply opening it resets the clock.</p>
		</div>
	</body>
</html>`;

	return { to: input.to, subject, text, html };
}

export interface RefAccessLinkEmailInput {
	refereeName: string;
	eventName: string;
	link: string;
	to: string;
	/** Head Refs are told what extra their link can do. */
	headReferee: boolean;
}

/**
 * The message a referee receives with their link.
 *
 * Same shape as a judge's: link high up, readable on a phone at the field, and plain that
 * the link is personal. A forwarded ref link means incidents logged under someone else's
 * name, which matters when a note is later used to explain a decision.
 */
export function buildRefAccessLinkEmail(input: RefAccessLinkEmailInput): EmailMessage {
	const eventName = singleLine(input.eventName);
	const refereeName = singleLine(input.refereeName);
	const role = input.headReferee ? 'a Head Referee' : 'a referee';

	const subject = `Your referee link — ${eventName}`;

	const text = [
		`Hello ${refereeName},`,
		'',
		`You have been added as ${role} for ${eventName}.`,
		'',
		'Open this link to log and see incident notes:',
		input.link,
		'',
		'This link is personal to you. It signs you in as yourself, so please do not',
		'forward it — anyone who has it can log notes under your name. If you lose it,',
		'ask the Head Referee to send it again.',
		'',
		'You do not need a password or an account. The link is all you need.'
	].join('\n');

	const html = `<!doctype html>
<html>
	<body style="margin:0;padding:24px;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0f172a;">
		<div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:8px;padding:28px;">
			<p style="margin:0 0 16px;font-size:16px;">Hello ${escapeHtml(refereeName)},</p>
			<p style="margin:0 0 24px;font-size:16px;">
				You have been added as ${role} for <strong>${escapeHtml(eventName)}</strong>.
			</p>
			<p style="margin:0 0 24px;">
				<a
					href="${escapeHtml(input.link)}"
					style="display:inline-block;background:#1e293b;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:6px;font-size:16px;font-weight:500;"
					>Open the referee app</a
				>
			</p>
			<p style="margin:0 0 24px;font-size:13px;color:#475569;word-break:break-all;">
				Or paste this into your browser:<br />${escapeHtml(input.link)}
			</p>
			<p style="margin:0 0 16px;font-size:14px;color:#475569;">
				This link is personal to you. It signs you in as yourself, so please do not forward it — anyone who has it can log
				notes under your name. If you lose it, ask the Head Referee to send it again.
			</p>
			<p style="margin:0;font-size:14px;color:#475569;">
				You do not need a password or an account. The link is all you need.
			</p>
		</div>
	</body>
</html>`;

	return { to: input.to, subject, text, html };
}

export interface RefRetentionWarningEmailInput {
	to: string;
	refereeName: string;
	eventName: string;
	link: string;
	daysRemaining: number;
}

/** The notice a Head Ref gets before an idle ref room is deleted. */
export function buildRefRetentionWarningEmail(input: RefRetentionWarningEmailInput): EmailMessage {
	const eventName = singleLine(input.eventName);
	const refereeName = singleLine(input.refereeName);
	const days = input.daysRemaining === 1 ? 'tomorrow' : `in ${input.daysRemaining} days`;

	const subject = `Action needed: referee notes for ${eventName} will be deleted ${days}`;

	const text = [
		`Hello ${refereeName},`,
		'',
		`The referee notes for ${eventName} have not been used for a while and will be`,
		`permanently deleted ${days}.`,
		'',
		'If you need a record, open the referee app and use Export CSV first. Deleting',
		'cannot be undone.',
		'',
		input.link,
		'',
		'If the event is still in use, simply opening it resets the clock.'
	].join('\n');

	const html = `<!doctype html>
<html>
	<body style="margin:0;padding:24px;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0f172a;">
		<div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:8px;padding:28px;">
			<p style="margin:0 0 16px;font-size:16px;">Hello ${escapeHtml(refereeName)},</p>
			<p style="margin:0 0 24px;font-size:16px;">
				The referee notes for <strong>${escapeHtml(eventName)}</strong> have not been used for a while and will be
				permanently deleted ${escapeHtml(days)}.
			</p>
			<p style="margin:0 0 24px;font-size:15px;">
				If you need a record, open the referee app and use <strong>Export CSV</strong> first. Deleting cannot be undone.
			</p>
			<p style="margin:0 0 24px;">
				<a
					href="${escapeHtml(input.link)}"
					style="display:inline-block;background:#1e293b;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:6px;font-size:16px;font-weight:500;"
					>Open the referee app</a
				>
			</p>
			<p style="margin:0;font-size:14px;color:#475569;">If the event is still in use, simply opening it resets the clock.</p>
		</div>
	</body>
</html>`;

	return { to: input.to, subject, text, html };
}
