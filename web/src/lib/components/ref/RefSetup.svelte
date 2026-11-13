<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import { refApp } from '$lib/ref/ref-app.svelte';
	import { getRobotEventsClient, importFromRobotEvents } from '$lib/robotevents-source';
	import { JudgeEmailSchema } from '@robotools.app/protocol/src/email';
	import { RefereeNameSchema, type RefEvent, type RefTeam } from '@robotools.app/protocol/src/ref';
	import type { Program } from '@robotools.app/protocol/src/award';
	import Button from '$lib/components/m3/Button.svelte';
	import TextField from '$lib/components/m3/TextField.svelte';
	import { dialogs } from '$lib/index.svelte';

	type Mode = 'vex_events' | 'manual';

	let mode = $state<Mode>('vex_events');
	let sku = $state('');
	let looking = $state(false);
	let lookupError = $state('');
	let imported = $state<{ event: RefEvent; teams: RefTeam[] } | null>(null);

	let manualName = $state('');
	let manualProgram = $state<Program>('V5RC');

	/**
	 * Set up from inside an event the person runs: they are likely the Head Ref of this one
	 * too, often with the same crew, so their details are filled in and the crew can be
	 * brought across. Taken once on arrival; the open event does not change under this screen.
	 */
	const fromEvent = refApp.isHeadReferee && refApp.self && refApp.event ? refApp.event.eventName : null;
	const me = refApp.referees.find((referee) => referee.id === refApp.self?.refereeId) ?? null;
	const crew = fromEvent ? refApp.referees.filter((referee) => referee.id !== refApp.self?.refereeId) : [];

	let headName = $state(fromEvent ? (refApp.self?.name ?? '') : '');
	let headEmail = $state(fromEvent ? (me?.email ?? '') : '');
	let copyCrew = $state(false);
	let creating = $state(false);
	let createError = $state('');

	const nameError = $derived(headName.trim() && !RefereeNameSchema.safeParse(headName.trim()).success ? m.ref_name_invalid() : '');
	const emailError = $derived(headEmail.trim() && !JudgeEmailSchema.safeParse(headEmail.trim()).success ? m.ref_email_invalid() : '');

	const event: RefEvent | null = $derived(
		mode === 'vex_events'
			? (imported?.event ?? null)
			: manualName.trim()
				? { eventName: manualName.trim(), program: manualProgram, robotEventsSku: null, robotEventsEventId: null, divisions: [] }
				: null
	);
	const canCreate = $derived(!!event && !!headName.trim() && !nameError && !emailError && !creating);

	async function lookUp() {
		lookupError = '';
		imported = null;
		looking = true;
		try {
			const data = await importFromRobotEvents(getRobotEventsClient(), sku.trim().toUpperCase());
			imported = {
				event: {
					eventName: data.eventName,
					program: data.program,
					robotEventsSku: data.robotEventsSku,
					robotEventsEventId: data.robotEventsEventId,
					divisions: data.divisionInfos.map((division) => ({ id: division.id, name: division.name }))
				},
				teams: data.teamInfos.map((team) => ({ number: team.number, name: team.name.slice(0, 200), school: team.school.slice(0, 200) }))
			};
		} catch (error) {
			lookupError = error instanceof Error ? error.message : String(error);
		} finally {
			looking = false;
		}
	}

	async function create() {
		if (!event) {
			return;
		}
		createError = '';
		creating = true;
		const bringing = copyCrew ? crew : [];
		try {
			await refApp.createRoom({
				kind: 'create',
				event,
				teams: mode === 'vex_events' ? (imported?.teams ?? []) : [],
				headReferee: { name: headName.trim(), email: headEmail.trim() ? headEmail.trim() : null }
			});
		} catch (error) {
			createError = error instanceof Error ? error.message : String(error);
			creating = false;
			return;
		}
		creating = false;
		if (bringing.length > 0 && refApp.phase === 'workspace') {
			await addCrew(bringing);
		}
	}

	/** Add the copied refs to the new event. Their links are new, and not sent until asked. */
	async function addCrew(referees: typeof crew) {
		const failed: string[] = [];
		for (const referee of referees) {
			try {
				await refApp.addReferee({ name: referee.name, role: referee.role, email: referee.email });
			} catch (error) {
				console.error('Failed to copy ref:', error);
				failed.push(referee.name);
			}
		}
		const added = referees.length - failed.length;
		await dialogs.showAlert({
			title: m.ref_copy_refs_done_title(),
			message:
				failed.length === 0
					? m.ref_copy_refs_done_message({ count: added })
					: m.ref_copy_refs_partial_message({ count: added, failed: failed.join(', ') })
		});
	}
</script>

<div class="flex min-h-screen flex-col items-center bg-surface px-4 py-8">
	<div class="flex w-full max-w-lg flex-col gap-6">
		<div>
			<Button variant="text" compact onclick={() => refApp.closeSetup()}>← {m.ref_back()}</Button>
			<h1 class="mt-2 text-headline-medium text-on-surface">{m.ref_set_up_new_event()}</h1>
			<p class="mt-1 text-body-medium text-on-surface-variant">{m.ref_setup_description()}</p>
		</div>

		<section class="flex flex-col gap-4 rounded-2xl bg-surface-container-low p-4 shadow-elev-1 sm:p-6">
			<h2 class="text-title-large text-on-surface">{m.ref_the_event()}</h2>

			<div class="flex gap-2" role="radiogroup" aria-label={m.ref_the_event()}>
				<Button
					variant={mode === 'vex_events' ? 'tonal' : 'outlined'}
					compact
					role="radio"
					aria-checked={mode === 'vex_events'}
					onclick={() => (mode = 'vex_events')}
				>
					{m.ref_from_vex_events()}
				</Button>
				<Button
					variant={mode === 'manual' ? 'tonal' : 'outlined'}
					compact
					role="radio"
					aria-checked={mode === 'manual'}
					onclick={() => (mode = 'manual')}
				>
					{m.ref_enter_manually()}
				</Button>
			</div>

			{#if mode === 'vex_events'}
				<form
					class="flex items-end gap-2"
					onsubmit={(submitEvent) => {
						submitEvent.preventDefault();
						void lookUp();
					}}
				>
					<TextField
						class="flex-1"
						label={m.ref_event_code()}
						placeholder="RE-V5RC-26-1234"
						bind:value={sku}
						error={lookupError}
						autocomplete="off"
					/>
					<Button type="submit" variant="tonal" disabled={looking || !sku.trim()}>{looking ? m.ref_looking() : m.ref_find()}</Button>
				</form>

				{#if imported}
					<div class="rounded-xl bg-surface-container p-4">
						<p class="text-title-medium text-on-surface">{imported.event.eventName}</p>
						<p class="mt-1 text-body-medium text-on-surface-variant">
							{imported.event.program} · {m.ref_division_count({ count: imported.event.divisions.length })} · {m.ref_team_count({
								count: imported.teams.length
							})}
						</p>
					</div>
				{/if}
			{:else}
				<TextField label={m.ref_event_name()} bind:value={manualName} maxlength={200} />
				<label class="flex flex-col gap-1">
					<span class="text-body-small text-on-surface-variant">{m.ref_program()}</span>
					<select class="classic" bind:value={manualProgram}>
						<option value="V5RC">V5RC</option>
						<option value="VIQRC">VIQRC</option>
						<option value="VURC">VEX U</option>
					</select>
				</label>
				<p class="text-body-small text-on-surface-variant">{m.ref_manual_note()}</p>
			{/if}
		</section>

		<section class="flex flex-col gap-4 rounded-2xl bg-surface-container-low p-4 shadow-elev-1 sm:p-6">
			<h2 class="text-title-large text-on-surface">{m.ref_you_head_referee()}</h2>
			<TextField label={m.ref_your_name()} bind:value={headName} error={nameError} maxlength={100} autocomplete="name" />
			<TextField
				label={m.ref_your_email_optional()}
				bind:value={headEmail}
				error={emailError}
				supportingText={m.ref_your_email_supporting()}
				inputmode="email"
				autocomplete="email"
			/>
		</section>

		{#if crew.length > 0}
			<section class="flex flex-col gap-4 rounded-2xl bg-surface-container-low p-4 shadow-elev-1 sm:p-6">
				<label class="flex items-start gap-3">
					<input type="checkbox" class="mt-1 size-5" bind:checked={copyCrew} />
					<span class="flex flex-col">
						<span class="text-body-large text-on-surface">{m.ref_copy_refs({ count: crew.length, name: fromEvent ?? '' })}</span>
						<span class="text-body-small text-on-surface-variant">{m.ref_copy_refs_description()}</span>
					</span>
				</label>
			</section>
		{/if}

		{#if createError}
			<p role="alert" class="text-body-medium text-error">{createError}</p>
		{/if}

		<Button disabled={!canCreate} onclick={create}>{creating ? m.ref_creating() : m.ref_create_event()}</Button>
	</div>
</div>
