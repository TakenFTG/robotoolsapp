<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import { groupClass, qaUrlFor, type Rule, type Ruleset } from '$lib/ref/rules';
	import { formatRule } from '$lib/ref/incidents';
	import Dialog from '$lib/components/dialog/Dialog.svelte';
	import Button from '$lib/components/m3/Button.svelte';

	interface Props {
		rule: Rule;
		ruleset: Ruleset;
		onClose: () => void;
		onLog: (code: string) => void;
	}

	let { rule, ruleset, onClose, onLog }: Props = $props();
</script>

<Dialog open={true} {onClose} innerContainerClass="max-w-md">
	<div class="flex flex-col gap-4">
		<div class="flex flex-col gap-2">
			<span class={['self-start rounded-md px-2 py-0.5 font-mono text-title-medium', groupClass(rule.group)]}>{formatRule(rule.code)}</span>
			<h2 id="dialog-title" class="text-headline-small text-on-surface">{rule.title}</h2>
			<p class="text-body-medium text-on-surface-variant">{rule.group}</p>
		</div>
		<p class="text-body-small text-on-surface-variant">{m.ref_rules_manual_note()}</p>
		<div class="flex flex-col gap-2">
			<!-- eslint-disable svelte/no-navigation-without-resolve -- The manual and Q&A are VEX's sites; resolve() takes an app route. -->
			<a class="primary-link" href={rule.url} target="_blank" rel="noopener noreferrer">{m.ref_rules_view_in_manual()}</a>
			<a class="primary-link" href={qaUrlFor(ruleset, rule.code)} target="_blank" rel="noopener noreferrer">{m.ref_rules_search_qa()}</a>
			<!-- eslint-enable svelte/no-navigation-without-resolve -->
		</div>
		<div class="flex justify-between gap-2">
			<Button variant="text" onclick={onClose}>{m.ref_close()}</Button>
			<Button onclick={() => onLog(rule.code)}>{m.ref_rules_log_with()}</Button>
		</div>
	</div>
</Dialog>

<style lang="postcss">
	@reference '../../../app.css';

	.primary-link {
		@apply state-layer inline-flex h-10 items-center justify-center rounded-full border border-outline px-6 text-label-large text-primary;
	}
</style>
