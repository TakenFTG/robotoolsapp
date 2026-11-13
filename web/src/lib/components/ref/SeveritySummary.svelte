<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import type { IncidentSeverity } from '@robotools.app/protocol/src/ref';
	import { compareSeverity, severityClass, severityLabel, worstSeverity } from '$lib/ref/incidents';

	/**
	 * A team's incidents at a glance: the worst severity, how many of those, and how many
	 * others.
	 *
	 * "Warning ×2" only ever means two warnings. One warning and one note reads "Warning +1",
	 * so a ref never mistakes a note for a second warning. The full breakdown is in the
	 * tooltip and the accessible name.
	 */
	interface Props {
		items: readonly { severity: IncidentSeverity }[];
		size?: 'small' | 'normal';
	}

	let { items, size = 'normal' }: Props = $props();

	const worst = $derived(worstSeverity(items));
	const worstCount = $derived(worst ? items.filter((item) => item.severity === worst).length : 0);
	const others = $derived(items.length - worstCount);

	const breakdown = $derived.by(() => {
		const counts: Partial<Record<IncidentSeverity, number>> = {};
		for (const item of items) {
			counts[item.severity] = (counts[item.severity] ?? 0) + 1;
		}
		return (Object.entries(counts) as [IncidentSeverity, number][])
			.sort((a, b) => compareSeverity(b[0], a[0]))
			.map(([severity, count]) => `${count} ${severityLabel(severity)}`)
			.join(', ');
	});
</script>

{#if worst}
	<span
		class="inline-flex items-center gap-1 whitespace-nowrap"
		title={m.ref_incident_breakdown({ count: items.length, breakdown })}
		aria-label={m.ref_incident_breakdown({ count: items.length, breakdown })}
	>
		<span
			class={[
				'inline-flex items-center rounded-md',
				size === 'small' ? 'h-5 px-1.5 text-label-small' : 'h-6 px-2 text-label-medium',
				severityClass(worst)
			]}
		>
			{severityLabel(worst)}{worstCount > 1 ? ` ×${worstCount}` : ''}
		</span>
		{#if others > 0}
			<span class={['text-on-surface-variant', size === 'small' ? 'text-label-small' : 'text-label-medium']}>+{others}</span>
		{/if}
	</span>
{/if}
