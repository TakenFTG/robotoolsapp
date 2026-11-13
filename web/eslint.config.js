import prettier from 'eslint-config-prettier';
import { includeIgnoreFile } from '@eslint/compat';
import js from '@eslint/js';
import svelte from 'eslint-plugin-svelte';
import globals from 'globals';
import { fileURLToPath } from 'node:url';
import ts from 'typescript-eslint';
import svelteConfig from './svelte.config.js';

const gitignorePath = fileURLToPath(new URL('./.gitignore', import.meta.url));

export default ts.config(
	includeIgnoreFile(gitignorePath),
	js.configs.recommended,
	...ts.configs.recommended,
	...svelte.configs.recommended,
	prettier,
	...svelte.configs.prettier,
	{
		languageOptions: {
			globals: { ...globals.browser, ...globals.node }
		},
		rules: {
			// typescript-eslint strongly recommend that you do not use the no-undef lint rule on TypeScript projects.
			// see: https://typescript-eslint.io/troubleshooting/faqs/eslint/#i-get-errors-from-the-no-undef-rule-about-global-variables-not-being-defined-even-though-there-are-no-typescript-errors
			'no-undef': 'off',
			'@typescript-eslint/no-unused-vars': 'off',
			// The app uses runes, not svelte/store, so this rule has nothing to find, yet it
			// spins up the type checker per component and was ~97% of lint time in CI.
			// Turn it back on if svelte/store is ever imported.
			'svelte/require-store-reactive-access': 'off'
		}
	},
	{
		/*
		 * {@html} and the sanitizer.
		 *
		 * Rubric directions, award descriptions and similar translated strings carry a
		 * little inline markup — <b>, <br>, and the custom <green>/<red>/<slate> emphasis
		 * tags. Rendering those means {@html}, which svelte/no-at-html-tags flags on sight
		 * because it cannot see that every one of them goes through sanitizeHTMLMessage:
		 * that helper HTML-escapes every interpolated value first, then runs DOMPurify with
		 * an allowlist of exactly those tags and no attributes at all.
		 *
		 * Turning the rule off on its own would trade a false positive for a blind spot, so
		 * it is replaced with a rule that enforces the invariant the original was reaching
		 * for: a raw mustache must be a call to sanitizeHTMLMessage, and nothing else. That
		 * is stricter than the status quo — the old rule could be silenced per site with a
		 * comment; this one cannot be satisfied by unsanitized markup at all.
		 */
		files: ['**/*.svelte'],
		rules: {
			'svelte/no-at-html-tags': 'off',
			'no-restricted-syntax': [
				'error',
				{
					selector: "SvelteMustacheTag[kind='raw'] > *:not(CallExpression)",
					message: '{@html} must render sanitizeHTMLMessage(...) — see src/lib/i18n.ts.'
				},
				{
					selector: "SvelteMustacheTag[kind='raw'] > CallExpression[callee.name!='sanitizeHTMLMessage']",
					message: '{@html} must render sanitizeHTMLMessage(...) — see src/lib/i18n.ts.'
				}
			]
		}
	},
	{
		files: ['**/*.svelte', '**/*.svelte.ts', '**/*.svelte.js'],
		languageOptions: {
			parserOptions: {
				projectService: true,
				extraFileExtensions: ['.svelte'],
				parser: ts.parser,
				svelteConfig,
				tsconfigRootDir: fileURLToPath(new URL('.', import.meta.url))
			}
		}
	}
);
