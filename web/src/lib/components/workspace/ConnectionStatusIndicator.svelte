<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import { app } from '$lib/index.svelte';
	import type { ConnectionState } from '@robotools.app/wrpc/client';

	let connectionState: ConnectionState = $derived(app.getConnectionState());
	let isJudgesRoomJoined = $derived(app.isJudgesRoomJoined());

	function getStatusColor(state: ConnectionState): string {
		switch (state) {
			case 'connected':
				return 'bg-success';
			case 'connecting':
			case 'reconnecting':
				return 'bg-warning';
			case 'error':
				return 'bg-error';
			case 'offline':
				return 'bg-outline';
			default:
				return 'bg-outline';
		}
	}

	function getStatusText(state: ConnectionState): string {
		if (!isJudgesRoomJoined) {
			return 'Offline Mode';
		}

		switch (state) {
			case 'connected':
				return m.connected();
			case 'connecting':
				return m.connecting();
			case 'reconnecting':
				return m.reconnecting();
			case 'error':
				return m.connection_error();
			case 'offline':
				return m.offline();
			default:
				return m.unknown();
		}
	}
</script>

<!-- Connection status as an M3 assist-chip. On phones only the dot shows, so the event name keeps its room; the label stays for screen readers and as a tooltip. -->
<div
	class="inline-flex h-8 items-center gap-2 rounded-md border border-outline-variant px-3 text-label-large text-on-surface-variant max-sm:px-2.5"
	title={getStatusText(connectionState)}
>
	<div class="h-2 w-2 rounded-full {getStatusColor(connectionState)}"></div>
	<span class="max-sm:sr-only">{getStatusText(connectionState)}</span>
</div>
