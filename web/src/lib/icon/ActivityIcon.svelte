<script lang="ts">
	/** A clipboard with lines, for the activity log. */
	interface Props {
		class?: string;
	}

	let { class: className = 'h-4 w-4' }: Props = $props();
</script>

<svg
	class={className}
	fill="none"
	stroke="currentColor"
	stroke-width="2"
	stroke-linecap="round"
	stroke-linejoin="round"
	xmlns="http://www.w3.org/2000/svg"
	viewBox="0 0 24 24"
	aria-hidden="true"
>
	<rect x="5" y="4" width="14" height="17" rx="2" />
	<path d="M9 4V3h6v1" />
	<path d="M9 10h6M9 14h6M9 18h3" />
</svg>
