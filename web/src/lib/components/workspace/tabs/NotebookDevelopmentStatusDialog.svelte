<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import Dialog from '$lib/components/dialog/Dialog.svelte';
	import { dialogs } from '$lib/index.svelte';
	import {
		formatRubricScore,
		NOTEBOOK_FULLY_DEVELOPED_BENCHMARK,
		NOTEBOOK_RUBRIC_CRITERIA_COUNT,
		NOTEBOOK_RUBRIC_MAX_SCORE
	} from '@robotools.app/protocol/src/rubric';
	import type { NotebookDevelopmentStatus } from '@robotools.app/protocol/src/team';

	/**
	 * Asked once, immediately after a notebook rubric is saved for a team nobody has sorted.
	 *
	 * A digital notebook arrives as a link and is read by opening it, so the sorting pass that
	 * used to produce this answer never happens. The judge has just finished scoring and is
	 * the only person who knows, which makes this the moment to ask rather than leaving the
	 * team unsorted and quietly ineligible for three awards.
	 *
	 * The score and the benchmark are shown because the judge should not have to remember
	 * either. Neither picks the button: GRSF offers 48 as a guide, not a threshold, and a
	 * number applied automatically would be this application deciding award eligibility.
	 */
	interface Props {
		teamNumber: string;
		score: number;
	}

	let { teamNumber, score }: Props = $props();

	function choose(status: NotebookDevelopmentStatus | null) {
		dialogs.closeDialog(status);
	}
</script>

<Dialog open={true} onClose={() => choose(null)} innerContainerClass="max-w-lg">
	<h3 id="dialog-title" class="mb-4 text-lg font-semibold text-gray-900">{m.notebook_development_status_title()}</h3>

	<div class="space-y-3">
		<p class="text-sm text-gray-900">
			{m.notebook_development_status_score({
				teamNumber,
				score: formatRubricScore(score),
				maxScore: NOTEBOOK_RUBRIC_MAX_SCORE
			})}
		</p>

		<p class="rounded-lg bg-gray-50 p-3 text-sm text-gray-600">
			{m.notebook_development_status_benchmark({
				benchmark: NOTEBOOK_FULLY_DEVELOPED_BENCHMARK,
				criteriaCount: NOTEBOOK_RUBRIC_CRITERIA_COUNT
			})}
		</p>

		<p class="text-sm text-gray-600">{m.notebook_development_status_why()}</p>
	</div>

	<div class="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
		<button onclick={() => choose(null)} class="cancel sm:mr-auto">{m.notebook_development_status_decide_later()}</button>
		<button onclick={() => choose('developing')} class="secondary">{m.developing_notebook_status()}</button>
		<button onclick={() => choose('fully_developed')} class="primary">{m.fully_developed_notebook_status()}</button>
	</div>
</Dialog>
