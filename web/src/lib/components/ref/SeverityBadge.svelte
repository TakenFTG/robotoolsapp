<script lang="ts">
	import type { IncidentSeverity } from '@robotools.app/protocol/src/ref';
	import { severityClass, severityLabel } from '$lib/ref/incidents';

	/** One severity. For a team's set of incidents, use SeveritySummary. */
	interface Props {
		severity: IncidentSeverity;
	}

	let { severity }: Props = $props();
</script>

<span class={['inline-flex h-6 items-center rounded-md px-2 text-label-medium whitespace-nowrap', severityClass(severity)]}>
	{severityLabel(severity)}
</span>
