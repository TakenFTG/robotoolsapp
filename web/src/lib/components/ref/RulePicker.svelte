<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import { groupClass, groupsOf, matchesSearch, type Ruleset } from '$lib/ref/rules';
	import { formatRule } from '$lib/ref/incidents';
	import Button from '$lib/components/m3/Button.svelte';
	import Chip from '$lib/components/m3/Chip.svelte';

	/**
	 * Choose one or more rules from the season's list.
	 *
	 * Shown in place of the log form rather than as a second dialog on top of it, so there is
	 * one thing on screen and one Back, which is what works on a phone at the field.
	 */
	interface Props {
		ruleset: Ruleset;
		selected: string[];
		onDone: (codes: string[]) => void;
	}

	let { ruleset, selected, onDone }: Props = $props();

	let chosen = $state<string[]>([...(() => selected)()]);
	let search = $state('');
	let group = $state<string | null>(null);

	const groups = $derived(groupsOf(ruleset));
	const shown = $derived(ruleset.rules.filter((rule) => (group === null || rule.group === group) && matchesSearch(rule, search)));

	function toggle(code: string) {
		chosen = chosen.includes(code) ? chosen.filter((item) => item !== code) : [...chosen, code];
	}
</script>

<div class="flex h-full flex-col gap-3 md:max-h-[80vh]">
	<div class="flex items-center justify-between gap-2">
		<h2 id="dialog-title" class="text-headline-small text-on-surface">{m.ref_rules_choose()}</h2>
		<div class="flex gap-1">
			{#if chosen.length > 0}
				<Button variant="text" compact onclick={() => (chosen = [])}>{m.ref_rules_clear()}</Button>
			{/if}
			<Button compact onclick={() => onDone(chosen)}>{m.ref_rules_done({ count: chosen.length })}</Button>
		</div>
	</div>

	<input
		class="classic"
		type="text"
		bind:value={search}
		placeholder={m.ref_rules_search()}
		aria-label={m.ref_rules_search()}
		autocomplete="off"
	/>

	<div class="flex shrink-0 gap-2 overflow-x-auto pb-1">
		<Chip variant="filter" class="shrink-0" selected={group === null} onclick={() => (group = null)}>{m.ref_all()}</Chip>
		{#each groups as name (name)}
			<Chip
				variant="filter"
				class="shrink-0 whitespace-nowrap"
				selected={group === name}
				onclick={() => (group = group === name ? null : name)}>{name}</Chip
			>
		{/each}
	</div>

	<ul class="flex min-h-40 flex-1 flex-col divide-y divide-outline-variant overflow-y-auto rounded-xl border border-outline-variant">
		{#each shown as rule (rule.code)}
			{@const isChosen = chosen.includes(rule.code)}
			<li>
				<label class="state-layer flex cursor-pointer items-start gap-3 px-3 py-2.5">
					<input type="checkbox" class="mt-1 size-5 shrink-0" checked={isChosen} onchange={() => toggle(rule.code)} />
					<span class={['shrink-0 rounded-md px-1.5 font-mono text-label-medium', groupClass(rule.group)]}>{formatRule(rule.code)}</span>
					<span class="text-body-medium text-on-surface">{rule.title}</span>
				</label>
			</li>
		{:else}
			<li class="px-4 py-8 text-center text-body-medium text-on-surface-variant">{m.ref_rules_none_found()}</li>
		{/each}
	</ul>
</div>
