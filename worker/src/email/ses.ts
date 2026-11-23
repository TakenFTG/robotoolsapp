import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import nodemailer, { type Transporter } from 'nodemailer';
import { createNodemailerSender } from './smtp';
import type { EmailSender } from './types';

export interface SesConfig {
	region: string;
	from: string;
	/** Optional SES configuration set, e.g. one that publishes bounces to SNS. */
	configurationSet: string | null;
}

/**
 * Amazon SES sender, over the SES v2 HTTPS API rather than its SMTP interface.
 *
 * The API matters, not just the provider. A relay that is handed a message over SMTP
 * records the connecting server's IP in a `Received:` header, and some receivers score
 * every hop in that chain — so a VPS on a residential or poorly-reputed cloud range drags
 * down mail that SES itself delivered. Over the API the message is built inside AWS and
 * the chain starts there.
 *
 * nodemailer still assembles the MIME (sent to SES as Raw content), so the message a judge
 * receives is the same one the SMTP path would have produced.
 *
 * Credentials are not configured here: the SDK's default chain reads AWS_ACCESS_KEY_ID and
 * AWS_SECRET_ACCESS_KEY from the environment, or an instance role, or a profile.
 */
export function createSesSender(config: SesConfig): EmailSender {
	let transporter: Transporter | null = null;

	function transport(): Transporter {
		// Built on first use, like the SMTP transport, so a credential problem surfaces as a
		// send failure the Judge Advisor sees rather than a server that will not boot.
		transporter ??= nodemailer.createTransport(
			{
				SES: {
					sesClient: new SESv2Client({
						region: config.region,
						// A judge waiting on a page should not wait on a hung API call.
						requestHandler: { connectionTimeout: 10_000, requestTimeout: 20_000 }
					}),
					SendEmailCommand
				}
			},
			// Message defaults: the transport reads `ses` off each message, not off itself.
			config.configurationSet ? { ses: { ConfigurationSetName: config.configurationSet } } : {}
		);
		return transporter;
	}

	return createNodemailerSender(config.from, transport);
}
