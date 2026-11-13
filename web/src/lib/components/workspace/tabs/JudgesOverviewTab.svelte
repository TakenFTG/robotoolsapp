<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import { app, dialogs } from '$lib/index.svelte';
	import type { JudgesOverviewTab } from '$lib/tab.svelte';
	import type { Judge, JudgeGroup } from '@robotools.app/protocol/src/judging';
	import type { TeamInfoAndData } from '$lib/team.svelte';
	import { dndzone } from 'svelte-dnd-action';
	import { flip } from 'svelte/animate';
	import { assignTeamsLevellingGroups } from '$lib/judging.svelte';
	import TeamPlate from '$lib/components/event-setup/TeamPlate.svelte';
	import UserIcon from '$lib/icon/UserIcon.svelte';
	import UsersIcon from '$lib/icon/UsersIcon.svelte';
	import XmarkIcon from '$lib/icon/XmarkIcon.svelte';

	interface Props {
		tab: JudgesOverviewTab;
	}

	let { tab }: Props = $props();

	/** Sentinel zone id for teams that belong to no judge group. */
	const UNASSIGNED = '__unassigned__';
	const flipDurationMs = 200;

	// Every dndzone shares one namespace unless given a type, which would let a team be
	// dropped into a judges list (and vice versa). Keep the two kinds strictly separate.
	const TEAM_ZONE = 'judges-overview-teams';
	const JUDGE_ZONE = 'judges-overview-judges';

	const judgeGroups = $derived(app.getAllJudgeGroups());
	const judges = $derived(app.getAllJudges());
	const teamsById = $derived(app.getAllTeamInfoAndData());
	const isOffline = $derived(app.getConnectionState() !== 'connected');

	type TeamZone = { id: string; name: string; teams: TeamInfoAndData[] };
	type JudgeZone = { id: string; members: Judge[] };

	// Drag-and-drop needs local, mutable arrays it can reorder during a drag, but the
	// server is the source of truth. These mirrors are rebuilt from server state whenever
	// it changes — except mid-drag, when overwriting them would yank the card out from
	// under the pointer.
	let teamZones = $state<TeamZone[]>([]);
	let judgeZones = $state<JudgeZone[]>([]);
	let dragging = $state(false);
	let busy = $state(false);
	/** Non-zero while a write is in flight. */
	let pending = $state(0);
	/** Bumped to force a rebuild from server state after a rejected write. */
	let resyncNonce = $state(0);

	// Dragging while disconnected would queue writes that cannot land. Declared here rather
	// than beside the markup because the handlers below read it too.
	const dragDisabled = $derived(busy || isOffline);

	$effect(() => {
		const groups = judgeGroups;
		const teams = teamsById;
		const roster = judges;
		// Read purely to register the dependency, so bumping the nonce forces a rebuild.
		// Assigned to a void rather than left as a bare expression, which reads like a
		// mistake and is one the linter is right to flag.
		void resyncNonce;

		// Rebuilding mid-drag yanks the card out from under the pointer; rebuilding while a
		// write is in flight would briefly snap the item back to where it came from, because
		// the server broadcast has not landed yet.
		if (dragging || pending > 0) return;

		const assigned = new Set(groups.flatMap((group) => group.assignedTeams));

		teamZones = [
			...groups.map((group) => ({
				id: group.id,
				name: group.name,
				teams: group.assignedTeams.map((teamId) => teams[teamId]).filter((team): team is TeamInfoAndData => !!team)
			})),
			{
				id: UNASSIGNED,
				name: m.unassigned_teams(),
				teams: Object.values(teams).filter((team) => !assigned.has(team.id))
			}
		];

		judgeZones = groups.map((group) => ({
			id: group.id,
			members: roster.filter((judge) => judge.groupId === group.id)
		}));
	});

	const unassignedZone = $derived(teamZones.find((zone) => zone.id === UNASSIGNED));
	const groupZones = $derived(teamZones.filter((zone) => zone.id !== UNASSIGNED));

	function judgeZoneFor(groupId: string): Judge[] {
		return judgeZones.find((zone) => zone.id === groupId)?.members ?? [];
	}

	/** Every edit goes through here so failures surface once, consistently. */
	async function run(action: () => Promise<unknown>) {
		if (busy) return;
		busy = true;
		pending += 1;
		try {
			await action();
		} catch (error) {
			dialogs.showAlert({
				title: m.failed(),
				message: error instanceof Error ? error.message : 'Unknown error',
				confirmButtonClass: 'primary'
			});
			// The mirrors now show a move the server refused. Force a rebuild from server
			// state so the rejected drop visibly snaps back instead of lingering as a lie.
			resyncNonce += 1;
		} finally {
			busy = false;
			pending -= 1;
		}
	}

	// --- Teams -------------------------------------------------------------

	function setTeamZone(zoneId: string, items: TeamInfoAndData[]) {
		const zone = teamZones.find((candidate) => candidate.id === zoneId);
		if (zone) zone.teams = items;
	}

	function considerTeams(zoneId: string, event: CustomEvent<{ items: TeamInfoAndData[] }>) {
		dragging = true;
		setTeamZone(zoneId, event.detail.items);
	}

	function finalizeTeams(zoneId: string, event: CustomEvent<{ items: TeamInfoAndData[] }>) {
		setTeamZone(zoneId, event.detail.items);
		dragging = false;

		// One write covers the whole board: the drop already moved the team out of its old
		// zone, so rebuilding every group's list from the mirrors keeps them consistent.
		// Teams left in the unassigned zone are simply absent from all groups. The filter is
		// belt-and-braces against a non-team item reaching a team zone.
		const next: JudgeGroup[] = groupZones.map((zone) => ({
			id: zone.id,
			name: zone.name,
			assignedTeams: zone.teams.map((team) => team.id).filter((teamId) => !!teamsById[teamId])
		}));

		return run(() => app.updateJudgeGroups(next));
	}

	/**
	 * Deal the unassigned pile out across the groups, without disturbing what is already
	 * assigned.
	 *
	 * Deliberately not the same thing as the event setup step's "Randomly Assign Teams",
	 * which clears every group first. By the time this tab is open the board has usually
	 * been arranged by hand, and reshuffling all of it to place a handful of late arrivals
	 * would throw away work — hence a button that only touches what is sitting unassigned.
	 *
	 * Teams marked absent go in with the rest. They are shown in the unassigned pile, so
	 * skipping them would leave cards behind with no explanation, and a team that turns up
	 * after all is then already covered by a group.
	 */
	async function assignUnassignedTeams() {
		const pile = unassignedZone?.teams ?? [];
		if (pile.length === 0 || groupZones.length === 0 || dragDisabled) return;

		const confirmed = await dialogs.showConfirmation({
			title: m.randomly_assign_unassigned_teams(),
			message: m.randomly_assign_unassigned_teams_confirmation({ count: pile.length, groups: groupZones.length }),
			confirmText: m.assign(),
			confirmButtonClass: 'primary'
		});
		if (!confirmed) return;

		// Same shape of write as a drop: the whole board in one mutation, filtered to teams
		// the room actually knows about.
		const next: JudgeGroup[] = assignTeamsLevellingGroups(
			groupZones.map((zone) => ({
				id: zone.id,
				name: zone.name,
				assignedTeams: zone.teams.map((team) => team.id).filter((teamId) => !!teamsById[teamId])
			})),
			pile.map((team) => team.id).filter((teamId) => !!teamsById[teamId])
		);

		await run(() => app.updateJudgeGroups(next));
	}

	// --- Judges ------------------------------------------------------------

	function setJudgeZone(zoneId: string, items: Judge[]) {
		const zone = judgeZones.find((candidate) => candidate.id === zoneId);
		if (zone) zone.members = items;
	}

	function considerJudges(zoneId: string, event: CustomEvent<{ items: Judge[] }>) {
		dragging = true;
		setJudgeZone(zoneId, event.detail.items);
	}

	function finalizeJudges(zoneId: string, event: CustomEvent<{ items: Judge[] }>) {
		setJudgeZone(zoneId, event.detail.items);
		dragging = false;

		// Only judges that exist in the roster, and only those whose group actually changed.
		// The roster check matters: without it, a non-judge item landing here would be spread
		// into updateJudge and could pass JudgeSchema, creating a bogus judge.
		const knownJudgeIds = new Set(judges.map((judge) => judge.id));
		const moved = judgeZones.flatMap((zone) =>
			zone.members.filter((judge) => knownJudgeIds.has(judge.id) && judge.groupId !== zone.id).map((judge) => ({ judge, zone }))
		);

		if (moved.length === 0) return;

		return run(async () => {
			for (const { judge, zone } of moved) {
				await app.updateJudge({ ...judge, groupId: zone.id });
			}
		});
	}

	async function addJudge(groupId: string) {
		const name = await dialogs.showPrompt({
			title: m.add_judge(),
			message: m.judge_name_colon(),
			confirmText: m.add_judge()
		});
		const trimmed = typeof name === 'string' ? name.trim() : '';
		if (!trimmed) return;
		await run(() => app.addJudge(trimmed, groupId));
	}

	async function renameJudge(judge: Judge) {
		const name = await dialogs.showPrompt({
			title: m.judge_name_colon(),
			message: m.judge_name_colon(),
			defaultValue: judge.name
		});
		const trimmed = typeof name === 'string' ? name.trim() : '';
		if (!trimmed || trimmed === judge.name) return;
		await run(() => app.updateJudge({ ...judge, name: trimmed }));
	}

	async function removeJudge(judge: Judge) {
		const confirmed = await dialogs.showConfirmation({
			title: m.remove(),
			message: m.remove_judge_confirmation({ name: judge.name }),
			confirmButtonClass: 'danger'
		});
		if (!confirmed) return;
		await run(() => app.removeJudge(judge.id));
	}

	// --- Groups ------------------------------------------------------------

	async function addGroup() {
		const name = await dialogs.showPrompt({
			title: m.add_judge_group(),
			message: m.judge_group_name_colon(),
			defaultValue: `Group ${judgeGroups.length + 1}`
		});
		const trimmed = typeof name === 'string' ? name.trim() : '';
		if (!trimmed) return;
		await run(() => app.addJudgeGroup(trimmed));
	}

	async function renameGroup(group: { id: string; name: string }) {
		const name = await dialogs.showPrompt({
			title: m.judge_group_name_colon(),
			message: m.judge_group_name_colon(),
			defaultValue: group.name
		});
		const trimmed = typeof name === 'string' ? name.trim() : '';
		if (!trimmed || trimmed === group.name) return;
		await run(() => app.renameJudgeGroup(group.id, trimmed));
	}

	async function removeGroup(group: { id: string; name: string }) {
		const confirmed = await dialogs.showConfirmation({
			title: m.remove(),
			message: m.remove_judge_group_confirmation({ name: group.name }),
			confirmButtonClass: 'danger'
		});
		if (!confirmed) return;
		await run(() => app.removeJudgeGroup(group.id));
	}
</script>

<div class="h-full overflow-auto p-2 md:p-6">
	<div class="mx-auto max-w-6xl space-y-4 md:space-y-6">
		<div class="rounded-lg bg-white p-6 shadow-sm">
			<div class="flex flex-wrap items-center justify-between gap-2">
				<div>
					<h2 class="text-xl font-semibold text-gray-900">{m.judges_overview_tab_title()}</h2>
					<p class="mt-1 text-sm text-gray-600">{m.judges_overview_description()}</p>
				</div>
				<button class="primary" onclick={addGroup} disabled={dragDisabled}>{m.add_judge_group()}</button>
			</div>

			{#if isOffline}
				<p class="mt-3 rounded bg-amber-50 p-2 text-sm text-amber-800">{m.reconnecting()}</p>
			{/if}
		</div>

		<!-- Unassigned teams: also the place to drag a team to when it should cover nobody. -->
		{#if unassignedZone}
			<div
				class="rounded-lg border p-4 transition-colors"
				class:border-amber-300={unassignedZone.teams.length > 0}
				class:bg-amber-50={unassignedZone.teams.length > 0}
				class:border-gray-200={unassignedZone.teams.length === 0}
				class:bg-white={unassignedZone.teams.length === 0}
			>
				<div class="flex flex-wrap items-center justify-between gap-2">
					<h3 class="text-sm font-semibold" class:text-amber-900={unassignedZone.teams.length > 0}>
						{m.unassigned_teams()} ({unassignedZone.teams.length})
					</h3>
					{#if unassignedZone.teams.length > 0}
						<button class="lightweight tiny" onclick={assignUnassignedTeams} disabled={dragDisabled || groupZones.length === 0}>
							{m.randomly_assign_unassigned_teams()}
						</button>
					{/if}
				</div>
				<div
					class="mt-2 grid min-h-[80px] grid-cols-2 gap-2 rounded border-2 border-dashed border-gray-300 p-2 sm:grid-cols-4 lg:grid-cols-6"
					use:dndzone={{
						items: unassignedZone.teams,
						type: TEAM_ZONE,
						flipDurationMs,
						dragDisabled,
						dropTargetStyle: { outline: '1px solid #EEE' }
					}}
					onconsider={(event) => considerTeams(UNASSIGNED, event)}
					onfinalize={(event) => finalizeTeams(UNASSIGNED, event)}
				>
					{#each unassignedZone.teams as team (team.id)}
						<div animate:flip={{ duration: flipDurationMs }}>
							<TeamPlate {team} showGrade={false} />
						</div>
					{/each}
				</div>
				{#if unassignedZone.teams.length === 0}
					<p class="mt-2 text-xs text-gray-500">{m.drop_teams_here()}</p>
				{/if}
			</div>
		{/if}

		{#each groupZones as zone (zone.id)}
			<div class="space-y-4 rounded-lg bg-white p-6 shadow-sm">
				<div class="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 pb-3">
					<h3 class="flex items-center gap-2 text-lg font-semibold text-gray-900">
						<UsersIcon size={18} />
						{zone.name}
					</h3>
					<div class="flex gap-2">
						<button class="lightweight tiny" onclick={() => renameGroup(zone)} disabled={dragDisabled}>{m.rename()}</button>
						<button class="lightweight tiny" onclick={() => addJudge(zone.id)} disabled={dragDisabled}>{m.add_judge()}</button>
						<button
							class="danger tiny"
							onclick={() => removeGroup(zone)}
							disabled={dragDisabled || groupZones.length <= 1}
							title={groupZones.length <= 1 ? m.at_least_one_judge_group() : undefined}
						>
							{m.remove()}
						</button>
					</div>
				</div>

				<!-- Judges: draggable between groups, same as the event setup step -->
				<div>
					<h4 class="mb-2 text-sm font-medium text-gray-700">{m.judges({ count: judgeZoneFor(zone.id).length })}</h4>
					<div
						class="grid min-h-[64px] grid-cols-1 gap-2 rounded border-2 border-dashed border-gray-200 bg-gray-50 p-2 sm:grid-cols-2 lg:grid-cols-3"
						use:dndzone={{
							items: judgeZoneFor(zone.id),
							type: JUDGE_ZONE,
							flipDurationMs,
							dragDisabled,
							dropTargetStyle: { outline: '1px solid #EEE' }
						}}
						onconsider={(event) => considerJudges(zone.id, event)}
						onfinalize={(event) => finalizeJudges(zone.id, event)}
					>
						{#each judgeZoneFor(zone.id) as judge (judge.id)}
							<div
								animate:flip={{ duration: flipDurationMs }}
								class="flex cursor-move items-center justify-between gap-2 rounded bg-white p-2 shadow-sm"
							>
								<span class="flex min-w-0 items-center gap-2 text-sm text-gray-900">
									<UserIcon />
									<span class="truncate">{judge.name}</span>
								</span>
								<span class="flex shrink-0 gap-1">
									<button class="lightweight tiny" onclick={() => renameJudge(judge)} disabled={dragDisabled}>{m.rename()}</button>
									<button class="danger tiny" onclick={() => removeJudge(judge)} disabled={dragDisabled} aria-label={m.remove()}>
										<XmarkIcon />
									</button>
								</span>
							</div>
						{/each}
					</div>
					{#if judgeZoneFor(zone.id).length === 0}
						<p class="mt-1 text-xs text-gray-500">{m.no_judges_in_group()} {m.drop_judges_here()}</p>
					{/if}
				</div>

				<!-- Teams covered by this group -->
				<div>
					<h4 class="mb-2 text-sm font-medium text-gray-700">{m.assigned_teams({ count: zone.teams.length })}</h4>
					<div
						class="grid min-h-[96px] grid-cols-2 gap-2 rounded border-2 border-dashed border-gray-200 bg-gray-50 p-2 sm:grid-cols-4 lg:grid-cols-6"
						use:dndzone={{
							items: zone.teams,
							type: TEAM_ZONE,
							flipDurationMs,
							dragDisabled,
							dropTargetStyle: { outline: '1px solid #EEE' }
						}}
						onconsider={(event) => considerTeams(zone.id, event)}
						onfinalize={(event) => finalizeTeams(zone.id, event)}
					>
						{#each zone.teams as team (team.id)}
							<div animate:flip={{ duration: flipDurationMs }}>
								<TeamPlate {team} showGrade={false} />
							</div>
						{/each}
					</div>
					{#if zone.teams.length === 0}
						<p class="mt-1 text-xs text-gray-500">{m.drop_teams_here()}</p>
					{/if}
				</div>
			</div>
		{/each}
	</div>
</div>
