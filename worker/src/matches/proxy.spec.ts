import { describe, it, expect, vi } from 'vitest';
import { VexEventsProxy, isAllowedOrigin, resolveUpstreamUrl } from './proxy';

describe('resolveUpstreamUrl', () => {
	it('forwards API paths and their query to events.vex.com', () => {
		expect(resolveUpstreamUrl('/vex-events/api/v2/events/59999/teams', '?page=1&per_page=250')).toBe(
			'https://events.vex.com/api/v2/events/59999/teams?page=1&per_page=250'
		);
	});

	it('refuses anything that could leave the API', () => {
		expect(resolveUpstreamUrl('/vex-events/api/v2/../../admin', '')).toBeNull();
		expect(resolveUpstreamUrl('/vex-events/api/v2/events/%2e%2e', '')).toBeNull();
		expect(resolveUpstreamUrl('/vex-events/api/v2/', '')).toBeNull();
		expect(resolveUpstreamUrl('/vex-events/api/v2/events//x', '')).toBeNull();
		expect(resolveUpstreamUrl('/other', '')).toBeNull();
	});
});

describe('isAllowedOrigin', () => {
	it('allows the server itself and localhost only', () => {
		expect(isAllowedOrigin('https://judging.example.com', 'judging.example.com')).toBe(true);
		expect(isAllowedOrigin('http://localhost:5173', 'localhost:8787')).toBe(true);
		expect(isAllowedOrigin('https://evil.example', 'judging.example.com')).toBe(false);
		expect(isAllowedOrigin('not a url', 'judging.example.com')).toBe(false);
	});
});

describe('VexEventsProxy', () => {
	const URL_A = 'https://events.vex.com/api/v2/events/1';

	function ok(body = '{"id":1}') {
		return new Response(body, { status: 200, headers: { 'content-type': 'application/json' } });
	}

	it('adds the key server-side and caches successes for a minute', async () => {
		let now = 0;
		const fetcher = vi.fn(async () => ok());
		const proxy = new VexEventsProxy(
			fetcher,
			() => now,
			() => 'secret'
		);

		await proxy.get(URL_A);
		await proxy.get(URL_A);
		expect(fetcher).toHaveBeenCalledTimes(1);
		const init = (fetcher.mock.calls as unknown as [string, RequestInit][])[0]?.[1];
		expect(init?.headers).toMatchObject({ Authorization: 'Bearer secret' });

		now = 61_000;
		await proxy.get(URL_A);
		expect(fetcher).toHaveBeenCalledTimes(2);
	});

	it('does not cache errors', async () => {
		const fetcher = vi.fn(async () => new Response('{}', { status: 500 }));
		const proxy = new VexEventsProxy(
			fetcher,
			() => 0,
			() => 'secret'
		);

		expect((await proxy.get(URL_A)).status).toBe(500);
		await proxy.get(URL_A);
		expect(fetcher).toHaveBeenCalledTimes(2);
	});

	it('caps upstream calls per minute', async () => {
		const fetcher = vi.fn(async () => ok());
		const proxy = new VexEventsProxy(
			fetcher,
			() => 0,
			() => 'secret'
		);

		const statuses: number[] = [];
		for (let i = 0; i < 125; i++) {
			statuses.push((await proxy.get(`${URL_A}?n=${i}`)).status);
		}
		expect(statuses.filter((s) => s === 429)).toHaveLength(5);
		expect(fetcher).toHaveBeenCalledTimes(120);
	});

	it('says what to set when there is no key', async () => {
		const fetcher = vi.fn(async () => ok());
		const proxy = new VexEventsProxy(
			fetcher,
			() => 0,
			() => null
		);

		const result = await proxy.get(URL_A);
		expect(result.status).toBe(503);
		expect(result.body).toContain('ROBOTEVENTS_TOKEN');
		expect(fetcher).not.toHaveBeenCalled();
	});
});
