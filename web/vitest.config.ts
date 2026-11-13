import { defineConfig } from 'vitest/config';

/*
 * One project, run in Node.
 *
 * There used to be a second, "client", running component tests in a real Chromium through
 * Vitest's browser mode — SvelteKit scaffolding that never acquired a single test file. It
 * pulled in Playwright, @vitest/browser and vitest-browser-svelte, downloaded a browser in
 * CI, and tested nothing. Vitest 4 reworked the browser provider API, at which point the
 * choice was to migrate config for something unused or delete it.
 *
 * If component tests are wanted later, add them back against the v4 API: a `browser.provider`
 * now takes a factory from @vitest/browser-playwright rather than the string 'playwright'.
 *
 * `extends` is load-bearing. Vitest does not merge vite.config.ts automatically when a
 * vitest.config.ts exists, and without it $lib and the SvelteKit aliases do not resolve.
 */
export default defineConfig({
	test: {
		projects: [
			{
				extends: './vite.config.ts',

				test: {
					name: 'server',
					environment: 'node',
					include: ['src/**/*.{test,spec}.{js,ts}']
				}
			}
		]
	}
});
