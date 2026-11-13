<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import { resolve } from '$app/paths';
</script>

<svelte:head>
	<title>{m.home()} | {m.product_name()}</title>
</svelte:head>

<div class="relative min-h-screen bg-surface">
	<!-- Hero -->
	<!-- Fixed dark navy in both themes: the logo's white and blue parts need a dark backing. -->
	<div class="bg-[#0b1422] text-[#fbfbff]">
		<div class="mx-auto max-w-6xl px-6 pt-6 pb-16 md:pt-14 md:pb-24">
			<div class="text-center">
				<h1 class="mb-6">
					<img src="/robotools-logo.webp" alt={m.product_name()} class="mx-auto h-auto w-56 md:w-72" width="1254" height="1254" />
				</h1>
				<p class="mb-8 text-title-large md:text-headline-small">{m.home_hero_subtitle()}</p>
				<p class="mx-auto mb-10 max-w-3xl text-body-large opacity-90">
					{m.home_hero_description()}
				</p>
				<div class="flex flex-col justify-center gap-4 sm:flex-row">
					<a href={resolve('/app')}>
						<button class="primary w-full sm:w-auto">{m.home_access_judging()}</button>
					</a>
					<a href={resolve('/ref')}>
						<button class="primary w-full sm:w-auto">{m.home_access_referee()}</button>
					</a>
				</div>
			</div>
		</div>
	</div>

	<!-- What it does -->
	<div class="mx-auto max-w-6xl px-6 py-16">
		<div class="mb-12 text-center">
			<h2 class="mb-4 text-headline-large text-on-surface md:text-display-small">{m.home_features_title()}</h2>
			<p class="mx-auto max-w-2xl text-body-large text-on-surface-variant">{m.home_features_description()}</p>
		</div>

		<div class="grid gap-8 md:grid-cols-3">
			<div class="rounded-lg bg-surface-container-low p-6 shadow-elev-1">
				<div class="mb-4 text-primary">
					<svg class="h-12 w-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
						></path>
					</svg>
				</div>
				<h3 class="mb-2 text-title-large text-on-surface">{m.home_feature_rubrics()}</h3>
				<p class="text-body-medium text-on-surface-variant">{m.home_feature_rubrics_description()}</p>
			</div>

			<div class="rounded-lg bg-surface-container-low p-6 shadow-elev-1">
				<div class="mb-4 text-primary">
					<svg class="h-12 w-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
						></path>
					</svg>
				</div>
				<h3 class="mb-2 text-title-large text-on-surface">{m.home_feature_collaboration()}</h3>
				<p class="text-body-medium text-on-surface-variant">{m.home_feature_collaboration_description()}</p>
			</div>

			<div class="rounded-lg bg-surface-container-low p-6 shadow-elev-1">
				<div class="mb-4 text-primary">
					<svg class="h-12 w-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
						></path>
					</svg>
				</div>
				<h3 class="mb-2 text-title-large text-on-surface">{m.home_feature_confidentiality()}</h3>
				<p class="text-body-medium text-on-surface-variant">{m.home_feature_confidentiality_description()}</p>
			</div>
		</div>
	</div>

	<!-- Call to action -->
	<div class="bg-surface-container py-16 text-on-surface">
		<div class="mx-auto max-w-4xl px-6 text-center">
			<h2 class="mb-4 text-headline-large md:text-display-small">{m.home_cta_title()}</h2>
			<p class="mb-8 text-body-large text-on-surface-variant">{m.home_cta_description()}</p>
			<div class="flex flex-col justify-center gap-4 sm:flex-row">
				<a href={resolve('/app')}>
					<button class="primary w-full sm:w-auto">{m.home_access_judging()}</button>
				</a>
				<a href={resolve('/ref')}>
					<button class="primary w-full sm:w-auto">{m.home_access_referee()}</button>
				</a>
				<a href={resolve('/help')}>
					<button class="lightweight w-full sm:w-auto">{m.help_and_instructions()}</button>
				</a>
				<a href={resolve('/privacy')}>
					<button class="lightweight w-full sm:w-auto">{m.home_privacy_security()}</button>
				</a>
			</div>
		</div>
	</div>

	<!-- Footer -->
	<div class="bg-surface-container-highest py-10 text-on-surface-variant">
		<div class="mx-auto max-w-6xl space-y-4 px-6">
			<div class="flex flex-wrap items-center justify-center gap-4 text-center text-body-medium">
				<span>{m.product_name()}</span>
				<span aria-hidden="true">·</span>
				<a href={resolve('/help')} class="underline transition-colors hover:text-on-surface">{m.help_and_instructions()}</a>
				<span aria-hidden="true">·</span>
				<a href={resolve('/privacy')} class="underline transition-colors hover:text-on-surface">{m.data_protection_and_privacy()}</a>
			</div>

			<!--
				Attribution. This is a derivative of a GPL-3.0 project, and saying so plainly
				is both the licence's spirit and simple honesty about whose work this began as.
			-->
			<p class="text-center text-body-small text-on-surface-variant">
				{m.attribution_modified_from()}
				<a
					href="https://github.com/Jerrylum/judgesroom.com"
					target="_blank"
					rel="noopener noreferrer"
					class="underline transition-colors hover:text-on-surface">judgesroom.com</a
				>{m.attribution_used_under()}
				<a
					href="https://www.gnu.org/licenses/gpl-3.0.html"
					target="_blank"
					rel="noopener noreferrer"
					class="underline transition-colors hover:text-on-surface">GNU General Public License v3.0</a
				>{m.attribution_end()}
				<a
					href="https://github.com/TakenFTG/robotoolsapp"
					target="_blank"
					rel="noopener noreferrer"
					class="underline transition-colors hover:text-on-surface">{m.attribution_source_code()}</a
				>
				<br />{m.attribution_legal_notice()}
			</p>
		</div>
	</div>
</div>

<style lang="postcss">
	@reference '../app.css';

	:global {
		body {
			@apply bg-surface;
		}
	}
</style>
