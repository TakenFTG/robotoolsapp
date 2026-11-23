import { describe, expect, it } from 'vitest';
import { readEmailConfiguration } from './config';
import { describeSmtpFailure } from './smtp';

const origin = 'https://judge.example.com';

describe('readEmailConfiguration', () => {
	it('is disabled when nothing is set', () => {
		expect(readEmailConfiguration({}).sender.enabled).toBe(false);
	});

	it('uses SES when SES_REGION and SES_FROM are set', () => {
		const config = readEmailConfiguration({
			SES_REGION: 'ap-southeast-2',
			SES_FROM: 'Judging <judging@example.com>',
			PUBLIC_ORIGIN: `${origin}/`
		});
		expect(config.sender.enabled).toBe(true);
		expect(config.sender.fromAddress).toBe('Judging <judging@example.com>');
		expect(config.publicOrigin).toBe(origin);
	});

	it('refuses SES and SMTP together', () => {
		expect(() =>
			readEmailConfiguration({
				SES_REGION: 'ap-southeast-2',
				SES_FROM: 'judging@example.com',
				SMTP_HOST: 'smtp.example.com',
				PUBLIC_ORIGIN: origin
			})
		).toThrow(/one mail provider/);
	});

	it('refuses half an SES configuration', () => {
		expect(() => readEmailConfiguration({ SES_REGION: 'ap-southeast-2', PUBLIC_ORIGIN: origin })).toThrow(/SES_FROM/);
		expect(() => readEmailConfiguration({ SES_FROM: 'judging@example.com', PUBLIC_ORIGIN: origin })).toThrow(/SES_REGION/);
	});

	it('refuses a malformed region', () => {
		expect(() => readEmailConfiguration({ SES_REGION: 'sydney', SES_FROM: 'judging@example.com', PUBLIC_ORIGIN: origin })).toThrow(
			/AWS region/
		);
	});

	it('requires PUBLIC_ORIGIN for SES', () => {
		expect(() => readEmailConfiguration({ SES_REGION: 'ap-southeast-2', SES_FROM: 'judging@example.com' })).toThrow(/PUBLIC_ORIGIN/);
	});

	it('refuses half an AWS key pair', () => {
		expect(() =>
			readEmailConfiguration({
				SES_REGION: 'ap-southeast-2',
				SES_FROM: 'judging@example.com',
				PUBLIC_ORIGIN: origin,
				AWS_ACCESS_KEY_ID: 'AKIAEXAMPLE'
			})
		).toThrow(/AWS_SECRET_ACCESS_KEY/);
	});
});

describe('describeSmtpFailure', () => {
	it('names the AWS error kind rather than the generic ESES code', () => {
		const error = Object.assign(new Error('Email address is not verified.'), { name: 'MessageRejected', code: 'ESES' });
		expect(describeSmtpFailure(error)).toBe('MessageRejected Email address is not verified.');
	});

	it('keeps the SMTP code and response', () => {
		const error = Object.assign(new Error('x'), { code: 'EENVELOPE', responseCode: 550, response: '550 no such user' });
		expect(describeSmtpFailure(error)).toBe('EENVELOPE 550 550 no such user');
	});
});
