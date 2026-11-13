<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import { dialogs } from '$lib/index.svelte';
	import { refApp } from '$lib/ref/ref-app.svelte';
	import type { SavedRefEvent } from '$lib/ref/saved-events';
	import Button from '$lib/components/m3/Button.svelte';

	interface Props {
		events: SavedRefEvent[];
		/** The event open now, shown as such and not offered to switch to. */
		currentRoomId?: string | null;
		onOpen: (roomId: string) => void;
	}

	let { events, currentRoomId = null, onOpen }: Props = $props();

	function who(event: SavedRefEvent): string | null {
		if (!event.refName) {
			return null;
		}
		const role = event.role === 'head_referee' ? m.ref_role_head_referee() : event.role === 'referee' ? m.ref_role_referee() : null;
		return role ? `${event.refName} (${role})` : event.refName;
	}

	async function forget(event: SavedRefEvent) {
		const current = event.roomId === currentRoomId;
		const confirmed = await dialogs.showConfirmation({
			title: current ? m.ref_sign_out_title() : m.ref_forget_event_title(),
			message: current ? m.ref_sign_out_message() : m.ref_forget_event_message({ name: event.eventName ?? m.ref_event_unnamed() }),
			confirmText: current ? m.ref_sign_out() : m.ref_forget_event()
		});
		if (confirmed) {
			refApp.forgetEvent(event.roomId);
		}
	}
</script>

<ul class="flex flex-col gap-2">
	{#each events as event (event.roomId)}
		{@const current = event.roomId === currentRoomId}
		{@const person = who(event)}
		<li
			class={[
				'flex items-center gap-2 rounded-xl p-1 pl-2',
				current ? 'bg-secondary-container text-on-secondary-container' : 'bg-surface-container'
			]}
		>
			<button
				type="button"
				class="state-layer min-w-0 flex-1 rounded-lg px-2 py-2 text-left disabled:cursor-default"
				disabled={current}
				aria-current={current ? 'true' : undefined}
				onclick={() => onOpen(event.roomId)}
			>
				<span class="block truncate text-title-medium">{event.eventName ?? m.ref_event_unnamed()}</span>
				<span class="block truncate text-body-small opacity-80">
					{[current ? m.ref_event_open_now() : null, person].filter(Boolean).join(' · ')}
				</span>
			</button>
			<Button variant="text" compact onclick={() => forget(event)}>
				{current ? m.ref_sign_out() : m.ref_forget_event()}
			</Button>
		</li>
	{/each}
</ul>
