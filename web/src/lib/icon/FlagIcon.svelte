<script lang="ts">
	/** A flag, for referee notes. */
	interface Props {
		class?: string;
	}

	let { class: className = 'h-4 w-4' }: Props = $props();
</script>

<svg
	class={className}
	fill="none"
	stroke="currentColor"
	stroke-width="48"
	stroke-linecap="round"
	stroke-linejoin="round"
	xmlns="http://www.w3.org/2000/svg"
	viewBox="0 0 640 640"
	aria-hidden="true"
>
	<path d="M144 576V80" />
	<path d="M144 112h336l-64 112 64 112H144" />
</svg>
