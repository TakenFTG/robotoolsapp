<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import { app, dialogs } from '$lib/index.svelte';
	import FlagIcon from '$lib/icon/FlagIcon.svelte';
	import TeamScreeningDialog from './TeamScreeningDialog.svelte';

	interface Props {
		teamId: string;
		teamNumber: string;
	}

	let { teamId, teamNumber }: Props = $props();

	const screening = $derived(app.getTeamScreening(teamId));
	const label = $derived(
		screening ? m.team_screening_flagged({ team: teamNumber, note: screening.note }) : m.team_screening_flag_team({ team: teamNumber })
	);

	function open() {
		void dialogs.showCustom(TeamScreeningDialog, { props: { teamId, teamNumber } });
	}
</script>

<button
	type="button"
	onclick={open}
	title={label}
	aria-label={label}
	aria-pressed={!!screening}
	class="shrink-0 rounded p-1 hover:bg-gray-200 {screening ? 'text-amber-700' : 'text-gray-400'}"
>
	<FlagIcon class={screening ? 'h-4 w-4 fill-amber-400' : 'h-4 w-4'} />
</button>
