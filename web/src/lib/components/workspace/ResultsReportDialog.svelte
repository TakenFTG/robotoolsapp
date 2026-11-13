<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import { app, dialogs } from '$lib/index.svelte';
	import Dialog from '$lib/components/dialog/Dialog.svelte';
	import XmarkIcon from '$lib/icon/XmarkIcon.svelte';
	import { getJudgedAwardWinners } from '$lib/award.svelte';

	/**
	 * The record that outlives the event.
	 *
	 * Destroying a Judges' Room deletes its database outright, which is the right end
	 * state for confidential material — but the Event Partner still needs to know who won
	 * what, and a dispute weeks later is answered by who was nominated and in what order.
	 * Without this the only two options were "keep the event forever" or "lose the result".
	 *
	 * Printed rather than generated server-side. The browser's Save as PDF produces a
	 * fixed document from a page the app already knows how to render, with no PDF library
	 * on the server and no second implementation of the same tables to drift out of step.
	 *
	 * Deliberately excludes rubric scores and judge notes. Those are the most sensitive
	 * material in the room and the thing destroying it is most meant to remove; a record
	 * of the outcome does not need them, and a PDF of them would quietly undo the point.
	 */
	const essentialData = $derived(app.getEssentialData());
	const allAwards = $derived(app.getAllAwards());
	const teams = $derived(app.getAllTeamInfoAndData());
	const judgeGroups = $derived(app.getAllJudgeGroupsInMap());
	const nominations = $derived(app.getAllFinalAwardNominations());

	const judgedAwards = $derived(allAwards.filter((award) => award.type === 'judged'));
	const winnersByAward = $derived(getJudgedAwardWinners(judgedAwards, nominations));

	const generatedAt = new Date();

	function teamLabel(teamId: string): string {
		const team = teams[teamId];
		return team ? `${team.number} — ${team.name}` : teamId;
	}

	function judgeGroupLabel(judgeGroupId: string | null): string {
		if (!judgeGroupId) return '';
		return judgeGroups[judgeGroupId]?.name ?? '';
	}

	function print() {
		window.print();
	}
</script>

<Dialog open={true} onClose={() => dialogs.closeDialog()} innerContainerClass="max-w-3xl p-4!">
	<div class="flex max-h-[85vh] flex-col overflow-hidden p-2">
		<!-- Screen-only chrome. The printed page starts at the report itself. -->
		<div class="mb-4 flex shrink-0 items-start justify-between gap-3 print:hidden">
			<div>
				<h3 class="text-lg font-medium text-gray-900">{m.results_report_title()}</h3>
				<p class="mt-1 text-sm text-gray-600">{m.results_report_description()}</p>
			</div>
			<div class="flex shrink-0 items-center gap-2">
				<button type="button" class="primary tiny" onclick={print}>{m.results_report_save()}</button>
				<button
					onclick={() => dialogs.closeDialog()}
					class="rounded-full p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
					aria-label={m.close_dialog_text()}
				>
					<XmarkIcon size={18} />
				</button>
			</div>
		</div>

		<div class="min-h-0 flex-1 overflow-auto pr-1 print:overflow-visible">
			<div class="jr-print-root jr-force-light space-y-6 text-gray-900">
				<header class="border-b border-gray-300 pb-3">
					<h1 class="text-2xl font-bold">{essentialData?.eventName ?? ''}</h1>
					<p class="text-sm text-gray-600">
						{essentialData?.program ?? ''} · {essentialData?.eventGradeLevel ?? ''}
					</p>
					<p class="mt-1 text-xs text-gray-500">
						{m.results_report_generated({ timestamp: generatedAt.toLocaleString() })}
					</p>
				</header>

				<section>
					<h2 class="mb-2 text-lg font-semibold">{m.results_report_winners()}</h2>
					{#if judgedAwards.length === 0}
						<p class="text-sm text-gray-500">{m.results_report_empty()}</p>
					{:else}
						<table class="w-full border-collapse text-sm">
							<thead>
								<tr class="border-b border-gray-300 text-left">
									<th class="py-1 pr-3 font-semibold">{m.award_name()}</th>
									<th class="py-1 font-semibold">{m.results_report_winner()}</th>
								</tr>
							</thead>
							<tbody>
								{#each judgedAwards as award (award.name)}
									{@const winners = winnersByAward[award.name] ?? []}
									<tr class="border-b border-gray-200 align-top">
										<td class="py-1 pr-3">{award.name}</td>
										<td class="py-1">
											{#if winners.length === 0}
												<span class="text-gray-500">{m.results_report_no_winner()}</span>
											{:else}
												{#each winners as teamId (teamId)}
													<div>{teamLabel(teamId)}</div>
												{/each}
											{/if}
										</td>
									</tr>
								{/each}
							</tbody>
						</table>
					{/if}
				</section>

				<!-- The deliberation record: the ordered nominations each award was decided from.
				     This is what answers "why did this team win" once the room is gone. -->
				<section class="break-before-auto">
					<h2 class="mb-2 text-lg font-semibold">{m.results_report_deliberations()}</h2>
					{#each judgedAwards as award (award.name)}
						{@const ranked = nominations[award.name] ?? []}
						<div class="mb-4 break-inside-avoid">
							<h3 class="text-sm font-semibold">{award.name}</h3>
							{#if ranked.length === 0}
								<p class="text-sm text-gray-500">{m.results_report_no_nominations()}</p>
							{:else}
								<ol class="mt-1 list-inside list-decimal text-sm">
									{#each ranked as nomination, index (nomination.teamId)}
										<li>
											{teamLabel(nomination.teamId)}
											{#if judgeGroupLabel(nomination.judgeGroupId)}
												<span class="text-gray-500">({judgeGroupLabel(nomination.judgeGroupId)})</span>
											{/if}
											{#if index < (winnersByAward[award.name] ?? []).length}
												<span class="font-semibold">{m.results_report_awarded()}</span>
											{/if}
										</li>
									{/each}
								</ol>
							{/if}
						</div>
					{/each}
				</section>

				<footer class="border-t border-gray-300 pt-3 text-xs text-gray-500">
					{m.results_report_footer()}
				</footer>
			</div>
		</div>
	</div>
</Dialog>

<style>
	/*
	 * Print the report, not the app around it.
	 *
	 * `display: none` on everything else does not work here: the report sits deep inside
	 * the dialog, which sits inside the workspace, and a hidden ancestor hides its
	 * descendants no matter what they ask for. Hiding by *visibility* is the technique that
	 * survives that — it inherits, but a descendant can override it, so the report reappears
	 * while everything around it stays blank.
	 *
	 * Positioning it at the top of the page then stops it printing wherever the scrolled
	 * dialog happened to leave it, and dropping the height limits lets it run to as many
	 * pages as it needs instead of being clipped to the panel.
	 */
	@media print {
		:global(body) {
			visibility: hidden;
			overflow: visible !important;
		}

		:global(.jr-print-root),
		:global(.jr-print-root *) {
			visibility: visible;
		}

		:global(.jr-print-root) {
			position: absolute;
			inset: 0 auto auto 0;
			width: 100%;
			max-height: none;
			overflow: visible;
		}
	}
</style>
