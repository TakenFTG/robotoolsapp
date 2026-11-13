<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import Dialog from '$lib/components/dialog/Dialog.svelte';
	import { dialogs } from '$lib/index.svelte';
	import { generateQrCodeDataUrl } from '$lib/qrcode';
	import XmarkIcon from '$lib/icon/XmarkIcon.svelte';
	import { onMount } from 'svelte';

	/**
	 * Printable passes, one per person, each carrying their access link as a QR code.
	 *
	 * For events where links cannot reach judges or referees any other way — some
	 * organisations filter out emailed links — so they can be printed and handed over in
	 * person. Used for judges from the Judges' Room and for referees from the ref app.
	 *
	 * Printed through the browser's Save as PDF, like the results report, rather than built
	 * with a PDF library.
	 */
	interface Props {
		kind: 'judge' | 'referee';
		people: { name: string; link: string }[];
		/** Defaults to closing the dialog stack, which the ref app does not use. */
		onClose?: () => void;
	}

	let { kind, people, onClose = () => dialogs.closeDialog() }: Props = $props();

	const text = $derived(
		kind === 'judge'
			? {
					title: m.judge_passes_title(),
					description: m.judge_passes_description(),
					none: m.judge_passes_none(),
					accessHere: m.judge_pass_access_here()
				}
			: {
					title: m.ref_passes_title(),
					description: m.ref_passes_description(),
					none: m.ref_passes_none(),
					accessHere: m.ref_pass_access_here()
				}
	);

	/** Six passes to an A4 sheet: two across, three down. */
	const PASSES_PER_SHEET = 6;

	let qrCodes = $state<Record<string, string>>({});

	$effect(() => {
		const links = people.map((person) => person.link);
		void Promise.all(
			links.map(async (link) => [link, await generateQrCodeDataUrl(link, { width: 480, margin: 0, errorCorrectionLevel: 'M' })] as const)
		).then((entries) => {
			qrCodes = Object.fromEntries(entries);
		});
	});

	const sheets = $derived.by(() => {
		const result: { name: string; link: string }[][] = [];
		for (let i = 0; i < people.length; i += PASSES_PER_SHEET) {
			result.push(people.slice(i, i + PASSES_PER_SHEET));
		}
		return result;
	});

	const ready = $derived(people.every((person) => qrCodes[person.link]));

	/**
	 * Move the print copy to be a direct child of <body>.
	 *
	 * Printed from inside the dialog, the passes sit in a fixed overlay: the browser clips
	 * them to one page and ignores the A4 page size. As ordinary page content they flow
	 * onto as many A4 sheets as they need.
	 */
	function moveToBody(node: HTMLElement) {
		document.body.appendChild(node);
		return { destroy: () => node.remove() };
	}

	/** Scopes the print rules to while this dialog is open, so other printouts are unaffected. */
	onMount(() => {
		document.body.classList.add('jr-printing-passes');
		return () => document.body.classList.remove('jr-printing-passes');
	});
</script>

{#snippet passSheets()}
	{#each sheets as sheet, sheetIndex (sheetIndex)}
		<div class="jr-pass-sheet">
			{#each sheet as person (person.link)}
				<div class="jr-pass">
					<!-- A print variant of the logo with its white parts turned navy, since the usual
					     one is drawn for a dark background. -->
					<div class="jr-pass-header">
						<img src="/robotools-logo-print.webp" alt={m.product_name()} width="572" height="534" />
					</div>
					<div class="jr-pass-body">
						<p class="jr-pass-welcome">{m.pass_welcome({ name: person.name })}</p>
						<p class="jr-pass-instruction">{text.accessHere}</p>
						{#if qrCodes[person.link]}
							<img class="jr-pass-qr" src={qrCodes[person.link]} alt={m.access_link_qr_alt({ name: person.name })} />
						{:else}
							<div class="jr-pass-qr"></div>
						{/if}
						<p class="jr-pass-note">{m.pass_personal_note()}</p>
					</div>
				</div>
			{/each}
		</div>
	{/each}
{/snippet}

<Dialog open={true} {onClose} innerContainerClass="max-w-3xl p-4!">
	<div class="flex max-h-[85vh] flex-col overflow-hidden p-2">
		<div class="mb-4 flex shrink-0 items-start justify-between gap-3">
			<div>
				<h3 class="text-lg font-medium text-gray-900">{text.title}</h3>
				<p class="mt-1 text-sm text-gray-600">{text.description}</p>
			</div>
			<div class="flex shrink-0 items-center gap-2">
				<button type="button" class="primary tiny" onclick={() => window.print()} disabled={!ready || people.length === 0}>
					{m.results_report_save()}
				</button>
				<button
					onclick={onClose}
					class="rounded-full p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
					aria-label={m.close_dialog_text()}
				>
					<XmarkIcon size={18} />
				</button>
			</div>
		</div>

		{#if people.length === 0}
			<p class="text-sm text-gray-500">{text.none}</p>
		{:else}
			<!-- On-screen preview. -->
			<div class="min-h-0 flex-1 overflow-auto pr-1">
				<div class="jr-passes-preview jr-force-light">
					{@render passSheets()}
				</div>
			</div>
		{/if}
	</div>
</Dialog>

<!-- Print copy, hidden on screen. The outer div stays where Svelte put it and only the inner
     one moves: Svelte uses a component's outermost nodes to find what to remove when it
     closes, and moving one of those made it remove everything after the dialog too,
     blanking the rest of the page. -->
<div hidden>
	<div class="jr-passes-print" use:moveToBody>
		{@render passSheets()}
	</div>
</div>

<style>
	/*
	 * Sized in millimetres so the screen preview matches the printed sheet. A4 with 10mm
	 * margins leaves 190 × 277mm, split into a 2 × 3 grid of passes.
	 */
	@page judge-passes {
		size: A4 portrait;
		margin: 10mm;
	}

	.jr-passes-preview {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 8mm;
	}

	.jr-passes-print {
		display: none;
	}

	.jr-pass-sheet {
		page: judge-passes;
		display: grid;
		grid-template-columns: repeat(2, 95mm);
		grid-auto-rows: 92mm;
		width: 190mm;
		background: #ffffff;
		color: #111827;
		outline: 1px solid #e5e7eb;
	}

	/* Dashed edges double as cutting guides. */
	.jr-pass {
		display: flex;
		flex-direction: column;
		overflow: hidden;
		border: 0.3mm dashed #9ca3af;
		box-sizing: border-box;
		break-inside: avoid;
	}

	.jr-pass-header {
		display: flex;
		justify-content: center;
		align-items: center;
		padding-top: 4mm;
	}

	.jr-pass-header img {
		height: 22mm;
		width: auto;
	}

	.jr-pass-body {
		display: flex;
		flex: 1;
		flex-direction: column;
		align-items: center;
		justify-content: space-between;
		padding: 3mm 5mm 3mm;
		text-align: center;
	}

	.jr-pass-welcome {
		font-size: 13pt;
		font-weight: 600;
		line-height: 1.2;
		overflow-wrap: anywhere;
	}

	.jr-pass-instruction {
		font-size: 9.5pt;
		color: #374151;
	}

	.jr-pass-qr {
		width: 38mm;
		height: 38mm;
		image-rendering: pixelated;
	}

	.jr-pass-note {
		font-size: 7.5pt;
		font-style: italic;
		color: #4b5563;
		line-height: 1.25;
	}

	/* Print only the passes: every other child of <body>, the app included, is dropped. */
	@media print {
		:global(body.jr-printing-passes) {
			visibility: visible !important;
			overflow: visible !important;
			height: auto !important;
			background: #ffffff !important;
		}

		:global(body.jr-printing-passes > *:not(.jr-passes-print)) {
			display: none !important;
		}

		.jr-passes-print {
			display: block;
		}

		.jr-passes-print,
		.jr-passes-print :global(*) {
			visibility: visible;
		}

		.jr-pass-sheet {
			outline: none;
			break-after: page;
		}

		.jr-pass-sheet:last-child {
			break-after: auto;
		}
	}
</style>
