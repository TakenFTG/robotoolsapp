<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import { refApp } from '$lib/ref/ref-app.svelte';
	import { groupClass, groupsOf, matchesSearch, rulesetFor, type Rule } from '$lib/ref/rules';
	import { formatRule } from '$lib/ref/incidents';
	import Chip from '$lib/components/m3/Chip.svelte';
	import RuleDetailsDialog from './RuleDetailsDialog.svelte';
	import { refBack } from '$lib/ref/back.svelte';

	/** The season's rules for this event's program, searchable, each linking to the manual. */
	interface Props {
		onLog: (code: string) => void;
	}

	let { onLog }: Props = $props();

	let search = $state('');
	let group = $state<string | null>(null);
	let open = $state<Rule | null>(null);

	const ruleset = $derived(rulesetFor(refApp.event?.program ?? 'V5RC'));

	$effect(() => {
		if (open) {
			return refBack.push(() => (open = null));
		}
	});
	const groups = $derived(groupsOf(ruleset));
	const shown = $derived(ruleset.rules.filter((rule) => (group === null || rule.group === group) && matchesSearch(rule, search)));

	/** How often each rule has been logged at this event, so the busy ones stand out. */
	const usage = $derived.by(() => {
		const counts: Record<string, number> = {};
		for (const incident of refApp.incidents) {
			for (const code of incident.ruleCodes) {
				counts[code] = (counts[code] ?? 0) + 1;
			}
		}
		return counts;
	});
</script>

<div class="flex flex-col gap-4">
	<div class="flex flex-wrap items-baseline justify-between gap-2">
		<p class="text-body-medium text-on-surface-variant">
			{m.ref_rules_ruleset({ program: ruleset.program, game: ruleset.game, season: ruleset.season, version: ruleset.version })}
		</p>
		<!-- eslint-disable svelte/no-navigation-without-resolve -- The manual is VEX's site; resolve() takes an app route. -->
		<a
			class="text-label-large text-primary underline-offset-2 hover:underline"
			href={ruleset.manualUrl}
			target="_blank"
			rel="noopener noreferrer"
		>
			{m.ref_rules_open_manual()}
		</a>
		<!-- eslint-enable svelte/no-navigation-without-resolve -->
	</div>

	<input
		class="classic"
		type="text"
		bind:value={search}
		placeholder={m.ref_rules_search()}
		aria-label={m.ref_rules_search()}
		autocomplete="off"
	/>

	<div class="flex gap-2 overflow-x-auto pb-1">
		<Chip variant="filter" selected={group === null} onclick={() => (group = null)}>{m.ref_all()}</Chip>
		{#each groups as name (name)}
			<Chip variant="filter" class="whitespace-nowrap" selected={group === name} onclick={() => (group = group === name ? null : name)}
				>{name}</Chip
			>
		{/each}
	</div>

	<ul class="flex flex-col divide-y divide-outline-variant rounded-xl border border-outline-variant bg-surface-container-lowest">
		{#each shown as rule (rule.code)}
			<li>
				<button type="button" class="state-layer flex w-full items-start gap-3 px-4 py-3 text-left" onclick={() => (open = rule)}>
					<span class={['mt-0.5 w-16 shrink-0 rounded-md px-1.5 text-center font-mono text-label-medium', groupClass(rule.group)]}>
						{formatRule(rule.code)}
					</span>
					<span class="flex min-w-0 flex-1 flex-col">
						<span class="text-body-large text-on-surface">{rule.title}</span>
						<span class="text-body-small text-on-surface-variant">{rule.group}</span>
					</span>
					{#if usage[rule.code]}
						<span class="shrink-0 text-label-medium text-on-surface-variant" title={m.ref_rules_logged_here({ count: usage[rule.code] })}>
							×{usage[rule.code]}
						</span>
					{/if}
				</button>
			</li>
		{:else}
			<li class="px-4 py-10 text-center text-body-medium text-on-surface-variant">{m.ref_rules_none_found()}</li>
		{/each}
	</ul>
</div>

{#if open}
	<RuleDetailsDialog
		rule={open}
		{ruleset}
		onClose={() => (open = null)}
		onLog={(code) => {
			open = null;
			onLog(code);
		}}
	/>
{/if}
