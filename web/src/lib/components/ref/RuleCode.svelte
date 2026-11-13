<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import type { Program } from '@robotools.app/protocol/src/award';
	import { refApp } from '$lib/ref/ref-app.svelte';
	import { findRule, groupClass, qaUrlFor, rulesetFor } from '$lib/ref/rules';
	import { formatRule } from '$lib/ref/incidents';

	/**
	 * A rule code as a chip, coloured by its section.
	 *
	 * On its own (not `withTitle`) it opens a small card with the rule's headline, section and
	 * links to the manual: on hover with a mouse, and on tap, which is how it is used on an
	 * iPad at the field. The rule text itself stays in the manual; see $lib/ref/rules.
	 */
	interface Props {
		code: string;
		/** Show the headline beside the code instead of on hover. */
		withTitle?: boolean;
		/** Which game's rules. Defaults to the ref room's event; the Judges' Room passes its own. */
		program?: Program | null;
	}

	let { code, withTitle = false, program = null }: Props = $props();

	const ruleset = $derived.by(() => {
		const active = program ?? refApp.event?.program ?? null;
		return active ? rulesetFor(active) : null;
	});
	const rule = $derived(ruleset ? findRule(ruleset, code) : null);

	const cardId = $props.id();
	let root = $state<HTMLElement>();
	let open = $state(false);
	/** Opened by a tap or click, so it stays until dismissed rather than closing on mouse-out. */
	let pinned = $state(false);
	/** Near the right edge, the card lines up with the chip's right side so it stays on screen. */
	let alignRight = $state(false);
	let closeTimer: ReturnType<typeof setTimeout> | undefined;

	function show() {
		clearTimeout(closeTimer);
		if (root) {
			alignRight = root.getBoundingClientRect().left + 288 > window.innerWidth;
		}
		open = true;
	}

	function close() {
		clearTimeout(closeTimer);
		open = false;
		pinned = false;
	}

	/** A short delay, so the pointer can cross the gap from the chip to the card. */
	function closeSoon() {
		if (!pinned) {
			clearTimeout(closeTimer);
			closeTimer = setTimeout(() => (open = false), 150);
		}
	}

	function toggle() {
		if (pinned) {
			close();
		} else {
			pinned = true;
			show();
		}
	}
</script>

<svelte:window
	onpointerdown={(event) => open && root && !root.contains(event.target as Node) && close()}
	onkeydown={(event) => open && event.key === 'Escape' && close()}
/>

{#if withTitle || !rule || !ruleset}
	<span
		class={[
			'inline-flex max-w-full items-center gap-1.5 rounded-md px-1.5 text-label-medium',
			rule ? groupClass(rule.group) : 'bg-surface-container-high text-on-surface'
		]}
		title={rule?.title}
	>
		<span class="font-mono">{formatRule(code)}</span>
		{#if withTitle && rule}
			<span class="truncate">{rule.title}</span>
		{/if}
	</span>
{:else}
	<span
		bind:this={root}
		class="relative inline-flex"
		role="presentation"
		onpointerenter={(event) => event.pointerType === 'mouse' && show()}
		onpointerleave={(event) => event.pointerType === 'mouse' && closeSoon()}
	>
		<button
			type="button"
			class={['inline-flex items-center rounded-md px-1.5 font-mono text-label-medium outline-offset-2', groupClass(rule.group)]}
			aria-expanded={open}
			aria-controls={cardId}
			aria-label={`${formatRule(code)} ${rule.title}`}
			onclick={toggle}
		>
			{formatRule(code)}
		</button>
		{#if open}
			<div
				id={cardId}
				role="dialog"
				aria-label={formatRule(code)}
				class={[
					'absolute top-full z-30 mt-1 flex w-72 max-w-[calc(100vw-2rem)] flex-col gap-2 rounded-xl border border-outline-variant bg-surface-container-high p-3 text-left shadow-lg',
					alignRight ? 'right-0' : 'left-0'
				]}
			>
				<div class="flex flex-col gap-1">
					<span class={['self-start rounded-md px-1.5 font-mono text-label-medium', groupClass(rule.group)]}>{formatRule(rule.code)}</span>
					<p class="text-body-medium text-on-surface">{rule.title}</p>
					<p class="text-body-small text-on-surface-variant">{rule.group}</p>
				</div>
				<div class="flex flex-wrap gap-x-4 gap-y-1">
					<!-- eslint-disable svelte/no-navigation-without-resolve -- The manual and Q&A are VEX's sites; resolve() takes an app route. -->
					<a
						class="text-label-large text-primary underline-offset-2 hover:underline"
						href={rule.url}
						target="_blank"
						rel="noopener noreferrer">{m.ref_rules_view_in_manual()}</a
					>
					<a
						class="text-label-large text-primary underline-offset-2 hover:underline"
						href={qaUrlFor(ruleset, rule.code)}
						target="_blank"
						rel="noopener noreferrer">{m.ref_rules_search_qa()}</a
					>
					<!-- eslint-enable svelte/no-navigation-without-resolve -->
				</div>
			</div>
		{/if}
	</span>
{/if}
