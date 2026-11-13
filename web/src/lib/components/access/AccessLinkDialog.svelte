<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import Dialog from '$lib/components/dialog/Dialog.svelte';
	import { dialogs } from '$lib/index.svelte';
	import { canUseClipboard } from '$lib/utils.svelte';
	import { generateQrCodeDataUrl } from '$lib/qrcode';
	import XmarkIcon from '$lib/icon/XmarkIcon.svelte';

	/**
	 * Show one person's access link so it can actually be handed over.
	 *
	 * Copying to the clipboard needs a secure context, which a self-hosted server on plain
	 * HTTP is not — so a copy button on its own meant that on exactly those deployments
	 * there was no way to get a judge's link at all. The link is therefore always shown as
	 * selectable text, with the clipboard and a QR code as conveniences on top rather than
	 * as the only route.
	 *
	 * The QR code is usually the fastest of the three at an event: judges arrive with
	 * phones, and pointing a camera beats reading a token aloud.
	 */
	interface Props {
		link: string;
		/**
		 * Whose link this is, which is the only thing that differs between the two uses.
		 *
		 * Callers pass this as `audience: 'self' as const`, and the assertion is doing real
		 * work rather than being noise. `dialogs.showCustom` infers its generic from the
		 * props object as well as from the component, so a bare `'self'` in an object
		 * literal widens to `string` and then fails to match this union. The check runs
		 * backwards from what you would expect — the component is tested against the props
		 * rather than the props against the component.
		 *
		 * `handover` — somebody else's, shown so it can be passed to them. The warning that
		 * matters is that whoever holds it becomes that person.
		 *
		 * `self` — the reader's own. The warning that matters is not to lose it, and not to
		 * hand it to a judge.
		 */
		audience?: 'handover' | 'self';
		/** Whose it is. Required for `handover`, where the whole message is who it belongs to. */
		name?: string;
	}

	let { link, audience = 'handover', name }: Props = $props();

	const heading = $derived(audience === 'self' ? m.save_your_access_link() : m.access_link_for({ name: name ?? '' }));
	const description = $derived(
		audience === 'self' ? m.save_your_access_link_warning() : m.access_link_dialog_description({ name: name ?? '' })
	);
	const qrAlt = $derived(audience === 'self' || !name ? m.access_link_qr_alt_own() : m.access_link_qr_alt({ name }));

	const clipboardAvailable = canUseClipboard();
	let copyLabel = $state(m.copy());
	let qrCodeDataUrl = $state('');
	let linkInput: HTMLInputElement | null = $state(null);

	$effect(() => {
		if (link) {
			void generateQrCodeDataUrl(link, { width: 20, margin: 0 }).then((url) => {
				qrCodeDataUrl = url;
			});
		}
	});

	async function copy() {
		try {
			await navigator.clipboard.writeText(link);
			copyLabel = m.copied();
		} catch {
			copyLabel = m.failed();
		}
		setTimeout(() => {
			copyLabel = m.copy();
		}, 2000);
	}

	function selectAll() {
		linkInput?.select();
	}
</script>

<Dialog open={true} onClose={() => dialogs.closeDialog()} innerContainerClass="max-w-xl p-4!">
	<div class="space-y-4 p-2">
		<div class="flex items-start justify-between gap-3">
			<div>
				<h3 class="text-lg font-medium text-gray-900">{heading}</h3>
				<p class="mt-1 text-sm text-gray-600">{description}</p>
			</div>
			<button
				onclick={() => dialogs.closeDialog()}
				class="rounded-full p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
				aria-label={m.close_dialog_text()}
			>
				<XmarkIcon size={18} />
			</button>
		</div>

		{#if qrCodeDataUrl}
			<div class="jr-force-light flex justify-center rounded-lg bg-white p-4">
				<img src={qrCodeDataUrl} alt={qrAlt} class="h-48 w-48" />
			</div>
		{/if}

		<div>
			<label for="access-link" class="mb-2 block text-sm font-medium text-gray-700">{m.access_link()}</label>
			<div class="flex items-center gap-2">
				<!-- Always selectable, so the link is reachable even with no clipboard access. -->
				<input
					id="access-link"
					bind:this={linkInput}
					type="text"
					value={link}
					readonly
					onfocus={selectAll}
					onclick={selectAll}
					class="classic flex-1 font-mono text-xs"
				/>
				{#if clipboardAvailable}
					<button onclick={copy} class="primary tiny shrink-0">{copyLabel}</button>
				{/if}
			</div>
			{#if !clipboardAvailable}
				<p class="mt-2 text-xs text-gray-500">{m.access_link_no_clipboard()}</p>
			{/if}
		</div>
	</div>
</Dialog>
