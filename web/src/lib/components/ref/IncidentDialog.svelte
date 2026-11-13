<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import { refApp } from '$lib/ref/ref-app.svelte';
	import { canModify, formatRule, severityClass, severityLabel, type IncidentPreset } from '$lib/ref/incidents';
	import {
		INCIDENT_SEVERITIES,
		normalizeRuleCode,
		type Incident,
		type IncidentContext,
		type IncidentSeverity,
		type SkillsRunType
	} from '@robotools.app/protocol/src/ref';
	import type { MatchSummary } from '@robotools.app/protocol/src/matches';
	import { generateUUID } from '$lib/utils.svelte';
	import { dialogs } from '$lib/index.svelte';
	import Dialog from '$lib/components/dialog/Dialog.svelte';
	import Button from '$lib/components/m3/Button.svelte';
	import Chip from '$lib/components/m3/Chip.svelte';
	import RulePicker from './RulePicker.svelte';
	import RuleCode from './RuleCode.svelte';
	import { rulesetFor } from '$lib/ref/rules';
	import { refBack } from '$lib/ref/back.svelte';

	interface Props {
		/** The incident being edited, or null to log a new one. */
		incident: Incident | null;
		preset?: IncidentPreset;
		onClose: () => void;
	}

	let { incident, preset = {}, onClose }: Props = $props();

	// Seeded once from the props: the form is the user's from here on.
	const initial = (() => incident)();
	const initialPreset = (() => preset)();

	let context = $state<IncidentContext>(initial?.context ?? initialPreset.context ?? 'match');
	let teamNumber = $state(initial?.teamNumber ?? initialPreset.teamNumber ?? '');
	let matchId = $state<number | null>(initial?.matchId ?? initialPreset.matchId ?? null);
	let matchName = $state(initial?.matchName ?? initialPreset.matchName ?? '');
	let skillsRunType = $state<SkillsRunType>(initial?.skillsRunType ?? 'driver');
	let ruleCodes = $state<string[]>([...(initial?.ruleCodes ?? initialPreset.ruleCodes ?? [])]);
	/** Choosing from the rule list, shown in place of the form. */
	let picking = $state(false);
	const ruleset = $derived(rulesetFor(refApp.event?.program ?? 'V5RC'));

	// Back from the rule list returns to the form, keeping what was typed.
	$effect(() => {
		if (picking) {
			return refBack.push(() => (picking = false));
		}
	});
	let ruleInput = $state('');
	let severity = $state<IncidentSeverity>(initial?.severity ?? 'warning');
	let note = $state(initial?.note ?? '');
	let isPrivate = $state(initial?.private ?? false);
	let saving = $state(false);
	let error = $state('');

	const editing = initial !== null;
	const canDelete = $derived(!!initial && canModify(initial, refApp.self));

	const normalizedTeam = $derived(teamNumber.trim().toUpperCase());
	const knownTeam = $derived(refApp.teams.find((team) => team.number.toUpperCase() === normalizedTeam) ?? null);
	const unknownTeam = $derived(refApp.teams.length > 0 && !!normalizedTeam && !knownTeam);

	/** Every scheduled match this team plays in, across divisions, in order. */
	const teamMatches: MatchSummary[] = $derived.by(() => {
		if (!normalizedTeam || !refApp.matches) {
			return [];
		}
		return refApp.matches.divisions
			.flatMap((division) => division.matches)
			.filter((match) => [...match.red.teamNumbers, ...match.blue.teamNumbers].some((number) => number.toUpperCase() === normalizedTeam));
	});

	// When the team changes and nothing is picked yet, default to its next unplayed match.
	$effect(() => {
		if (context !== 'match' || matchId !== null || matchName) {
			return;
		}
		const next = teamMatches.find((match) => !match.scored) ?? teamMatches[teamMatches.length - 1];
		if (next) {
			matchId = next.id;
			matchName = next.name;
		}
	});

	/** Codes this event uses most, so the common ones are one tap. */
	const suggestedCodes = $derived.by(() => {
		const counts: Record<string, number> = {};
		for (const item of refApp.incidents) {
			for (const code of item.ruleCodes) {
				counts[code] = (counts[code] ?? 0) + 1;
			}
		}
		return Object.entries(counts)
			.sort((a, b) => b[1] - a[1])
			.map(([code]) => code)
			.filter((code) => !ruleCodes.includes(code))
			.slice(0, 8);
	});

	function addRule(raw: string) {
		for (const part of raw.split(/[,\s]+/)) {
			const code = normalizeRuleCode(part);
			if (code && /^[A-Z0-9.-]{1,12}$/.test(code) && !ruleCodes.includes(code) && ruleCodes.length < 10) {
				ruleCodes = [...ruleCodes, code];
			}
		}
		ruleInput = '';
	}

	function selectMatch(value: string) {
		const match = teamMatches.find((item) => String(item.id) === value);
		matchId = match?.id ?? null;
		matchName = match?.name ?? '';
	}

	async function save() {
		error = '';
		if (!normalizedTeam) {
			error = m.ref_team_required();
			return;
		}
		if (ruleInput.trim()) {
			addRule(ruleInput);
		}
		saving = true;
		try {
			await refApp.saveIncident({
				id: initial?.id ?? generateUUID(),
				context,
				teamNumber: knownTeam?.number ?? normalizedTeam,
				matchId: context === 'match' ? matchId : null,
				matchName: context === 'match' ? matchName.trim() || null : null,
				skillsRunType: context === 'skills' ? skillsRunType : null,
				ruleCodes,
				severity,
				note,
				private: isPrivate
			});
			onClose();
		} catch (cause) {
			// What was typed stays in the form, so a dropped connection costs a tap, not a retype.
			error = cause instanceof Error ? cause.message : String(cause);
		} finally {
			saving = false;
		}
	}

	async function remove() {
		if (!initial) {
			return;
		}
		const confirmed = await dialogs.showConfirmation({
			title: m.ref_delete_incident_title(),
			message: m.ref_delete_incident_message({ team: initial.teamNumber }),
			confirmText: m.ref_delete(),
			confirmButtonClass: 'danger'
		});
		if (!confirmed) {
			return;
		}
		try {
			await refApp.removeIncident(initial.id);
			onClose();
		} catch (cause) {
			error = cause instanceof Error ? cause.message : String(cause);
		}
	}
</script>

<!-- Escape while choosing rules goes back to the form rather than throwing it away. -->
<Dialog open={true} onClose={() => (picking ? (picking = false) : onClose())} innerContainerClass="max-w-lg">
	{#if picking}
		<RulePicker
			{ruleset}
			selected={ruleCodes}
			onDone={(codes) => {
				ruleCodes = codes.slice(0, 10);
				picking = false;
			}}
		/>
	{:else}
		<form
			class="flex min-h-full flex-col gap-4"
			onsubmit={(event) => {
				event.preventDefault();
				void save();
			}}
		>
			<h2 id="dialog-title" class="text-headline-small text-on-surface">{editing ? m.ref_edit_incident() : m.ref_log_incident()}</h2>

			<div class="flex gap-2" role="radiogroup" aria-label={m.ref_where()}>
				<Chip
					variant="filter"
					selected={context === 'match'}
					role="radio"
					aria-checked={context === 'match'}
					onclick={() => (context = 'match')}
				>
					{m.ref_match()}
				</Chip>
				<Chip
					variant="filter"
					selected={context === 'skills'}
					role="radio"
					aria-checked={context === 'skills'}
					onclick={() => (context = 'skills')}
				>
					{m.ref_skills()}
				</Chip>
			</div>

			<label class="flex flex-col gap-1">
				<span class="text-body-small text-on-surface-variant">{m.ref_team()}</span>
				<input
					class="classic"
					type="text"
					list="ref-team-options"
					bind:value={teamNumber}
					oninput={() => {
						matchId = null;
						matchName = '';
					}}
					autocapitalize="characters"
					autocomplete="off"
					placeholder="1234A"
				/>
				<datalist id="ref-team-options">
					{#each refApp.teams as team (team.number)}
						<option value={team.number}>{team.name}</option>
					{/each}
				</datalist>
				{#if knownTeam}
					<span class="px-4 text-body-small text-on-surface-variant">{knownTeam.name} · {knownTeam.school}</span>
				{:else if unknownTeam}
					<span class="px-4 text-body-small text-on-surface-variant">{m.ref_team_not_on_list()}</span>
				{/if}
			</label>

			{#if context === 'match'}
				{#if teamMatches.length > 0}
					<label class="flex flex-col gap-1">
						<span class="text-body-small text-on-surface-variant">{m.ref_match()}</span>
						<select
							class="classic"
							value={matchId === null ? '' : String(matchId)}
							onchange={(event) => selectMatch(event.currentTarget.value)}
						>
							<option value="">{m.ref_match_unspecified()}</option>
							{#each teamMatches as match (match.id)}
								<option value={String(match.id)}
									>{match.name}{match.field ? ` · ${match.field}` : ''}{match.scored ? ` · ${m.ref_played()}` : ''}</option
								>
							{/each}
						</select>
					</label>
				{:else}
					<label class="flex flex-col gap-1">
						<span class="text-body-small text-on-surface-variant">{m.ref_match_optional()}</span>
						<input
							class="classic"
							type="text"
							bind:value={matchName}
							oninput={() => (matchId = null)}
							maxlength={50}
							placeholder="Q 12"
							autocomplete="off"
						/>
					</label>
				{/if}
			{:else}
				<div class="flex gap-2" role="radiogroup" aria-label={m.ref_skills_run()}>
					<Chip
						variant="filter"
						selected={skillsRunType === 'driver'}
						role="radio"
						aria-checked={skillsRunType === 'driver'}
						onclick={() => (skillsRunType = 'driver')}
					>
						{m.ref_driver()}
					</Chip>
					<Chip
						variant="filter"
						selected={skillsRunType === 'programming'}
						role="radio"
						aria-checked={skillsRunType === 'programming'}
						onclick={() => (skillsRunType = 'programming')}
					>
						{m.ref_programming()}
					</Chip>
				</div>
			{/if}

			<div class="flex flex-col gap-2">
				<span class="text-body-small text-on-surface-variant">{m.ref_severity()}</span>
				<div class="flex flex-wrap gap-2" role="radiogroup" aria-label={m.ref_severity()}>
					{#each INCIDENT_SEVERITIES as option (option)}
						<button
							type="button"
							role="radio"
							aria-checked={severity === option}
							class={[
								'h-8 rounded-lg px-3 text-label-large outline-offset-2',
								severity === option ? severityClass(option) : 'border border-outline-variant text-on-surface-variant',
								severity === option && 'outline-2 outline-primary'
							]}
							onclick={() => (severity = option)}
						>
							{severityLabel(option)}
						</button>
					{/each}
				</div>
			</div>

			<div class="flex flex-col gap-2">
				<div class="flex items-center justify-between gap-2">
					<label for="ref-rule-input" class="text-body-small text-on-surface-variant">{m.ref_rules()}</label>
					<Button variant="outlined" compact onclick={() => (picking = true)}>{m.ref_rules_browse()}</Button>
				</div>
				{#if ruleCodes.length > 0}
					<ul class="flex flex-col gap-1">
						{#each ruleCodes as code (code)}
							<li class="flex items-center justify-between gap-2">
								<span class="min-w-0"><RuleCode {code} withTitle /></span>
								<button
									type="button"
									class="state-layer shrink-0 rounded-full px-2 text-label-large text-on-surface-variant"
									aria-label={m.ref_remove_rule({ rule: formatRule(code) })}
									onclick={() => (ruleCodes = ruleCodes.filter((item) => item !== code))}
								>
									✕
								</button>
							</li>
						{/each}
					</ul>
				{/if}
				<input
					id="ref-rule-input"
					class="classic"
					type="text"
					bind:value={ruleInput}
					placeholder={m.ref_rules_placeholder()}
					autocapitalize="characters"
					autocomplete="off"
					onkeydown={(event) => {
						if (event.key === 'Enter' || event.key === ',') {
							event.preventDefault();
							addRule(ruleInput);
						}
					}}
					onblur={() => ruleInput.trim() && addRule(ruleInput)}
				/>
				{#if suggestedCodes.length > 0}
					<div class="flex flex-wrap gap-2">
						{#each suggestedCodes as code (code)}
							<Chip onclick={() => addRule(code)}>+ {formatRule(code)}</Chip>
						{/each}
					</div>
				{/if}
			</div>

			<label class="flex flex-col gap-1">
				<span class="text-body-small text-on-surface-variant">{m.ref_note()}</span>
				<textarea class="classic min-h-24" bind:value={note} maxlength={2000} placeholder={m.ref_note_placeholder()}></textarea>
			</label>

			<label class="flex items-start gap-3">
				<input type="checkbox" class="mt-1 size-5" bind:checked={isPrivate} />
				<span class="flex flex-col">
					<span class="text-body-large text-on-surface">{m.ref_private()}</span>
					<span class="text-body-small text-on-surface-variant">{m.ref_private_description()}</span>
				</span>
			</label>

			{#if error}
				<p role="alert" class="text-body-medium text-error">{error}</p>
			{/if}

			<!-- Pinned to the bottom, so Save is always in reach however many rules are chosen. -->
			<div
				class="sticky -bottom-4 -mx-4 mt-auto -mb-4 flex flex-wrap items-center justify-between gap-2 border-t border-outline-variant bg-surface-container-high px-4 py-3 md:-bottom-6 md:-mx-6 md:-mb-6 md:px-6"
			>
				<div>
					{#if canDelete}
						<Button variant="text" danger onclick={remove}>{m.ref_delete()}</Button>
					{/if}
				</div>
				<div class="flex gap-2">
					<Button variant="text" onclick={onClose}>{m.ref_cancel()}</Button>
					<Button type="submit" disabled={saving}>{saving ? m.ref_saving() : m.ref_save()}</Button>
				</div>
			</div>
		</form>
	{/if}
</Dialog>
