<script lang="ts">
	import Dialog from '$lib/components/dialog/Dialog.svelte';
	import { generateQrCodeDataUrl } from '$lib/qrcode';
	import { dialogs } from '$lib/index.svelte';
	import CloseIcon from '$lib/icon/CloseIcon.svelte';

	interface Props {
		link: string;
	}

	let { link }: Props = $props();

	let qrCodeDataUrl = $state('');

	$effect(() => {
		if (link) {
			(async () => {
				qrCodeDataUrl = await generateQrCodeDataUrl(link, { width: 20, margin: 0 });
			})();
		}
	});

	function handleClose() {
		dialogs.closeDialog();
	}
</script>

<Dialog open={true} onClose={handleClose} innerContainerClass="max-w-64 p-4!">
	<div class="flex flex-col overflow-auto p-2">
		<div class="mb-4 flex items-center justify-between">
			<h3 id="dialog-title" class="text-lg font-medium text-gray-900">QR Code</h3>
			<button onclick={handleClose} class="rounded-full p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600" aria-label="Close dialog">
				<CloseIcon size={24} />
			</button>
		</div>

		<!-- Kept light: a QR code is dark modules on a light field, and a dark backing makes
		     it unreadable to a camera. -->
		<div class="jr-force-light mb-2 flex justify-center rounded-md p-2">
			<img src={qrCodeDataUrl} alt="QR Code for Judges' Room link" class="w-full" />
		</div>
		<div>
			<!-- eslint-disable svelte/no-navigation-without-resolve -- An absolute access link built at runtime, not a route this app can resolve. -->
			<a
				href={link}
				target="_blank"
				class="block overflow-hidden text-xs text-blue-600 underline hover:text-blue-800 active:text-blue-900"
				title={link}
			>
				{link}
			</a>
			<!-- eslint-enable svelte/no-navigation-without-resolve -->
		</div>
	</div>
</Dialog>
