<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import { resolve } from '$app/paths';
	import { app, AppUI, dialogs } from '$lib/index.svelte';

	let judgesRoomUrl = $state('');

	async function handleStartNewEvent() {
		AppUI.appPhase = 'event_setup';
	}

	async function handleJoinJudgesRoom() {
		if (!judgesRoomUrl.trim()) {
			dialogs.showAlert({
				title: m.white_these_swan_attend(),
				message: m.knotty_brave_nils_ascend()
			});
			return;
		}

		try {
			// Stay in joining state - App will request sync automatically when connected
			// UI will update via reactive app.hasAppData() when sync completes
			AppUI.appPhase = 'joining_judges_room';
			await app.leaveJudgesRoom();
			await app.joinJudgesRoomFromUrl(judgesRoomUrl);
		} catch (error) {
			console.error("Error joining Judges' Room:", error);
			AppUI.appPhase = 'begin';
			dialogs.showAlert({
				title: m.nimble_fine_sheep_bubble(),
				message: m.fine_game_firefox_spin({ error: error + '' })
			});
		}
	}
</script>

<svelte:head>
	<title>{m.begin()} | Judges' Room</title>
</svelte:head>

<div class="relative flex h-screen flex-col bg-surface">
	<div class="flex flex-1 flex-col items-center justify-center p-8">
		<div class="flex w-full max-w-3xl flex-col items-center gap-6">
			<div class="flex flex-col items-center justify-center gap-2">
				<h2 class="text-display-small text-on-surface">{m.product_name()}</h2>

				<p class="text-center text-body-large text-on-surface-variant">
					{m.quaint_stock_seahorse_fetch()}
				</p>
			</div>

			<div class="max-w-lg rounded-2xl bg-surface-container-low p-4 shadow-elev-1 sm:p-6">
				<h3 class="text-headline-small text-on-surface">{m.minor_early_hedgehog_amuse()}</h3>
				<p class="mt-4 mb-4 text-body-medium text-on-surface-variant">
					{m.still_honest_koala_dance()}
				</p>
				<div class="mb-6 space-y-4">
					<input type="text" bind:value={judgesRoomUrl} placeholder={m.direct_brave_pug_boil()} class="classic w-full" />
					<button onclick={handleJoinJudgesRoom} class="primary w-full">{m.mean_icy_albatross_drip()}</button>
				</div>
				<div class="mt-4 flex justify-center">
					<button class="cancel" onclick={handleStartNewEvent}>
						{m.round_heavy_turtle_explore()}
					</button>
				</div>
			</div>
		</div>
		<!-- <a class="mt-4 text-sm text-gray-500 hover:text-gray-800 active:text-gray-900" href="./privacy" target="_blank"
			>See how your data and judging materials are managed...</a
		> -->
		<div class="mt-4 flex max-w-2xl flex-row flex-wrap justify-center gap-2 text-body-medium text-on-surface-variant">
			<a href={resolve('/help')} target="_blank">{m.help_and_instructions()}</a>
			<span aria-hidden="true">·</span>
			<a href={resolve('/privacy')} target="_blank">{m.data_protection_and_privacy()}</a>
		</div>

		<!-- Attribution: a derivative of a GPL-3.0 project, said plainly. -->
		<p class="mt-2 max-w-2xl text-center text-body-small text-on-surface-variant">
			{m.attribution_modified_from()}
			<a href="https://github.com/Jerrylum/judgesroom.com" target="_blank" rel="noopener noreferrer">judgesroom.com</a
			>{m.attribution_used_under()}
			<a href="https://www.gnu.org/licenses/gpl-3.0.html" target="_blank" rel="noopener noreferrer">GNU General Public License v3.0</a
			>{m.attribution_end()}
			<a href="https://github.com/TakenFTG/robotoolsapp" target="_blank" rel="noopener noreferrer">{m.attribution_source_code()}</a>
			<br />{m.attribution_legal_notice()}
		</p>
	</div>
</div>

<style lang="postcss">
	@reference '../../../app.css';

	a {
		@apply text-on-surface-variant underline hover:text-on-surface;
	}
</style>
