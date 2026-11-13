<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import { app, dialogs } from '$lib/index.svelte';
	import { refNotes } from '$lib/ref-notes.svelte';
	import {
		INCIDENT_SEVERITIES,
		normalizeRuleCode,
		type IncidentContext,
		type IncidentSeverity,
		type JudgeRefNote,
		type SkillsRunType
	} from '@robotools.app/protocol/src/ref';
	import { formatRule, severityClass, severityLabel } from '$lib/ref/incidents';
	import { rulesetFor } from '$lib/ref/rules';
	import { errorToString, generateUUID } from '$lib/utils.svelte';
	import Dialog from '$lib/components/dialog/Dialog.svelte';
	import Button from '$lib/components/m3/Button.svelte';
	import Chip from '$lib/components/m3/Chip.svelte';
	import RulePicker from '$lib/components/ref/RulePicker.svelte';
	import RuleCode from '$lib/components/ref/RuleCode.svelte';

	/**
	 * A note for the refs' record, written from the judging side. The same fields a ref logs,
	 * less "refs only": these are for the judges.
	 *
	 * A Judge Advisor writes down what the refs told them, and can correct it later. A judge
	 * (`asJudge`) can only send one, about one of their own teams, and never sees it again:
	 * judges are not shown ref notes.
	 */
	interface Props {
		/** The note being corrected, or null for a new one. Always null for a judge. */
		note: JudgeRefNote | null;
		/** Start with this team chosen, when opened from a team. */
		teamNumber?: string;
		asJudge?: boolean;
	}

	let { note, teamNumber: presetTeam, asJudge = false }: Props = $props();

	// Seeded once from the props: the form is the user's from here on.
	const initial = (() => note)();
	const initialTeam = (() => presetTeam)();

	let context = $state<IncidentContext>(initial?.context ?? 'match');
	let teamNumber = $state(initial?.teamNumber ?? initialTeam ?? '');
	let matchName = $state(initial?.matchName ?? '');
	let skillsRunType = $state<SkillsRunType>(initial?.skillsRunType ?? 'driver');
	let ruleCodes = $state<string[]>([...(initial?.ruleCodes ?? [])]);
	let ruleInput = $state('');
	let severity = $state<IncidentSeverity>(initial?.severity ?? 'warning');
	let text = $state(initial?.note ?? '');
	let picking = $state(false);
	let confirmingDelete = $state(false);
	let saving = $state(false);
	let error = $state('');
	/** Made once, so pressing Save again after a dropped connection resends the same note. */
	const noteId = generateUUID();

	const ruleset = $derived(rulesetFor(app.getEssentialData()?.program ?? 'V5RC'));
	/** A judge's own teams: their group's assignments, or every team with walk-in judging. */
	const teams = $derived.by(() => {
		let list = [...app.getAllTeams()];
		if (asJudge && app.getEssentialData()?.judgingMethod === 'assigned') {
			const assigned = new Set(app.getCurrentUserJudgeGroup()?.assignedTeams ?? []);
			list = list.filter((team) => assigned.has(team.id));
		}
		return list.sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true }));
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

	async function save() {
		error = '';
		if (!teamNumber) {
			error = m.ref_notes_choose_team();
			return;
		}
		if (ruleInput.trim()) {
			addRule(ruleInput);
		}
		saving = true;
		try {
			const input = {
				id: initial?.id ?? noteId,
				context,
				teamNumber,
				matchName: context === 'match' ? matchName.trim() || null : null,
				skillsRunType: context === 'skills' ? skillsRunType : null,
				ruleCodes,
				severity,
				note: text
			};
			if (asJudge) {
				await app.wrpcClient.refLink.submitNote.mutation(input);
				app.addNotice(m.ref_notes_judge_sent({ team: teamNumber }), 'success');
			} else {
				await app.wrpcClient.refLink.saveNote.mutation(input);
				refNotes.signal();
			}
			close();
		} catch (cause) {
			// What was typed stays in the form, so a dropped connection costs a tap, not a retype.
			error = errorToString(cause);
		} finally {
			saving = false;
		}
	}

	async function remove() {
		if (!initial) {
			return;
		}
		saving = true;
		try {
			await app.wrpcClient.refLink.removeNote.mutation({ id: initial.id });
			refNotes.signal();
			close();
		} catch (cause) {
			error = errorToString(cause);
		} finally {
			saving = false;
		}
	}

	function close() {
		dialogs.closeDialog();
	}
</script>

<!-- Escape while choosing rules goes back to the form rather than throwing it away. -->
<Dialog open={true} onClose={() => (picking ? (picking = false) : close())} innerContainerClass="max-w-lg">
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
			<div>
				<h2 id="dialog-title" class="text-headline-small text-on-surface">
					{initial ? m.ref_notes_edit_title() : m.ref_notes_add_title()}
				</h2>
				<p class="text-body-medium text-on-surface-variant">{asJudge ? m.ref_notes_judge_description() : m.ref_notes_add_description()}</p>
			</div>

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
				<select class="classic" bind:value={teamNumber}>
					<option value="" disabled>{m.ref_notes_choose_team()}</option>
					{#each teams as team (team.id)}
						<option value={team.number}>{team.number}{team.name ? ` · ${team.name}` : ''}</option>
					{/each}
				</select>
			</label>

			{#if context === 'match'}
				<label class="flex flex-col gap-1">
					<span class="text-body-small text-on-surface-variant">{m.ref_match_optional()}</span>
					<input class="classic" type="text" bind:value={matchName} maxlength={50} placeholder="Q 12" autocomplete="off" />
				</label>
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
					<label for="ja-rule-input" class="text-body-small text-on-surface-variant">{m.ref_rules()}</label>
					<Button variant="outlined" compact onclick={() => (picking = true)}>{m.ref_rules_browse()}</Button>
				</div>
				{#if ruleCodes.length > 0}
					<ul class="flex flex-col gap-1">
						{#each ruleCodes as code (code)}
							<li class="flex items-center justify-between gap-2">
								<span class="min-w-0"><RuleCode {code} withTitle program={ruleset.program} /></span>
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
					id="ja-rule-input"
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
			</div>

			<label class="flex flex-col gap-1">
				<span class="text-body-small text-on-surface-variant">{m.ref_note()}</span>
				<textarea class="classic min-h-24" bind:value={text} maxlength={2000} placeholder={m.ref_note_placeholder()}></textarea>
			</label>

			{#if error}
				<p role="alert" class="text-body-medium text-error">{error}</p>
			{/if}

			{#if confirmingDelete}
				<!-- Asked here rather than in a second dialog: the stack shows one dialog at a time. -->
				<div class="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-error-container p-3 text-on-error-container">
					<span class="text-body-medium">{m.ref_notes_delete_message({ team: initial?.teamNumber ?? '' })}</span>
					<div class="flex gap-2">
						<Button variant="text" disabled={saving} onclick={() => (confirmingDelete = false)}>{m.ref_cancel()}</Button>
						<Button danger disabled={saving} onclick={remove}>{m.ref_delete()}</Button>
					</div>
				</div>
			{/if}

			<div class="mt-auto flex flex-wrap items-center justify-between gap-2">
				<div>
					{#if initial && !confirmingDelete}
						<Button variant="text" danger onclick={() => (confirmingDelete = true)}>{m.ref_delete()}</Button>
					{/if}
				</div>
				<div class="flex gap-2">
					<Button variant="text" onclick={close}>{m.ref_cancel()}</Button>
					<Button type="submit" disabled={saving}>{saving ? m.ref_saving() : m.ref_save()}</Button>
				</div>
			</div>
		</form>
	{/if}
</Dialog>
