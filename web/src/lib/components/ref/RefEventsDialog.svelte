<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import { refApp } from '$lib/ref/ref-app.svelte';
	import Dialog from '$lib/components/dialog/Dialog.svelte';
	import Button from '$lib/components/m3/Button.svelte';
	import TextField from '$lib/components/m3/TextField.svelte';
	import RefEventList from './RefEventList.svelte';

	interface Props {
		onClose: () => void;
	}

	let { onClose }: Props = $props();

	let link = $state('');
	let error = $state('');
	let opening = $state(false);

	async function openLink() {
		error = '';
		opening = true;
		try {
			await refApp.joinWithLink(link);
			onClose();
		} catch (cause) {
			error = cause instanceof Error ? cause.message : String(cause);
		} finally {
			opening = false;
		}
	}

	function open(roomId: string) {
		onClose();
		void refApp.switchTo(roomId);
	}

	function setUp() {
		onClose();
		refApp.openSetup();
	}
</script>

<Dialog open={true} {onClose} innerContainerClass="max-w-lg">
	<div class="flex h-full flex-col gap-4 md:max-h-[80vh]">
		<div>
			<h2 id="dialog-title" class="text-headline-small text-on-surface">{m.ref_your_events()}</h2>
			<p class="mt-1 text-body-medium text-on-surface-variant">{m.ref_your_events_description()}</p>
		</div>

		<div class="flex-1 overflow-y-auto">
			<RefEventList events={refApp.savedEvents} currentRoomId={refApp.roomId} onOpen={open} />
		</div>

		<form
			class="flex items-start gap-2"
			onsubmit={(event) => {
				event.preventDefault();
				void openLink();
			}}
		>
			<TextField class="flex-1" label={m.ref_open_another_link()} bind:value={link} {error} autocomplete="off" />
			<Button type="submit" variant="tonal" disabled={opening || !link.trim()}>{m.ref_open()}</Button>
		</form>

		<div class="flex flex-wrap justify-between gap-2">
			<Button variant="text" onclick={setUp}>{m.ref_set_up_new_event()}</Button>
			<Button variant="text" onclick={onClose}>{m.ref_close()}</Button>
		</div>
	</div>
</Dialog>
