<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import { app, dialogs } from '$lib/index.svelte';
	import Dialog from '$lib/components/dialog/Dialog.svelte';
	import Button from '$lib/components/m3/Button.svelte';
	import XmarkIcon from '$lib/icon/XmarkIcon.svelte';
	import { errorToString } from '$lib/utils.svelte';
	import { auditLogFeed } from '$lib/audit-log';
	import {
		AUDIT_ACTION_GROUPS,
		auditActionGroupLabel,
		auditActorLabel,
		auditEntriesToCsv,
		auditEntryExtras,
		describeAuditEntry,
		type AuditActionGroup
	} from '$lib/audit-format';
	import { AUDIT_LOG_PAGE_MAX, matchesAuditQuery, type AuditEntry, type AuditLogQuery } from '@robotools.app/protocol/src/audit';
	import { onDestroy, onMount } from 'svelte';

	/**
	 * Who did what in this event, for the Judge Advisor.
	 *
	 * Filtering happens on the server, because a long weekend writes thousands of entries
	 * and paging through them unfiltered to find one team's would be the slow way round.
	 * Entries written while the dialog is open arrive live and are kept only if they pass
	 * the filters showing.
	 */

	const PAGE_SIZE = 100;

	let entries = $state<AuditEntry[]>([]);
	let hasMore = $state(false);
	let loading = $state(true);
	let loadingMore = $state(false);
	let exporting = $state(false);
	let error = $state('');

	let personFilter = $state('');
	let teamFilter = $state('');
	let typeFilter = $state<AuditActionGroup | ''>('');

	const accessControlEnabled = $derived(app.isAccessControlEnabled());
	const teams = $derived([...app.getAllTeams()].sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true })));

	/**
	 * Judges come from the roster. Judge Advisors are not in it, so they are taken from the
	 * entries themselves, and so is anyone who has since been removed.
	 */
	const people = $derived.by(() => {
		const byId: Record<string, string> = {};
		for (const judge of app.getAllJudges()) {
			byId[judge.id] = judge.name;
		}
		for (const entry of entries) {
			if (entry.actorId && !(entry.actorId in byId)) {
				byId[entry.actorId] = auditActorLabel(entry);
			}
		}
		return Object.entries(byId)
			.map(([id, name]) => ({ id, name }))
			.sort((a, b) => a.name.localeCompare(b.name));
	});

	function currentQuery(): Omit<AuditLogQuery, 'beforeId' | 'limit'> {
		return {
			actorId: personFilter || undefined,
			teamId: teamFilter || undefined,
			actions: typeFilter ? [...AUDIT_ACTION_GROUPS[typeFilter]] : undefined
		};
	}

	let loadGeneration = 0;

	async function reload() {
		const generation = ++loadGeneration;
		loading = true;
		error = '';
		try {
			const page = await app.wrpcClient.audit.getAuditLog.query({ ...currentQuery(), limit: PAGE_SIZE });
			if (generation !== loadGeneration) return;
			entries = page.entries;
			hasMore = page.hasMore;
		} catch (cause) {
			if (generation !== loadGeneration) return;
			error = errorToString(cause);
		} finally {
			if (generation === loadGeneration) loading = false;
		}
	}

	async function loadMore() {
		const oldest = entries.at(-1);
		if (!oldest) return;
		loadingMore = true;
		try {
			const page = await app.wrpcClient.audit.getAuditLog.query({ ...currentQuery(), beforeId: oldest.id, limit: PAGE_SIZE });
			const known = new Set(entries.map((entry) => entry.id));
			entries = [...entries, ...page.entries.filter((entry) => !known.has(entry.id))];
			hasMore = page.hasMore;
		} catch (cause) {
			error = errorToString(cause);
		} finally {
			loadingMore = false;
		}
	}

	/** Every matching entry, not just the ones loaded, so the file is the whole record. */
	async function exportCsv() {
		exporting = true;
		try {
			const all: AuditEntry[] = [];
			let beforeId: number | undefined;
			for (;;) {
				const page = await app.wrpcClient.audit.getAuditLog.query({ ...currentQuery(), beforeId, limit: AUDIT_LOG_PAGE_MAX });
				all.push(...page.entries);
				if (!page.hasMore || page.entries.length === 0) break;
				beforeId = page.entries.at(-1)!.id;
			}
			const blob = new Blob([auditEntriesToCsv(all)], { type: 'text/csv;charset=utf-8' });
			const url = URL.createObjectURL(blob);
			const anchor = document.createElement('a');
			anchor.href = url;
			anchor.download = `${(app.getEventName() ?? 'judging').replace(/[^\w-]+/g, '-')}-activity-log.csv`;
			anchor.click();
			URL.revokeObjectURL(url);
		} catch (cause) {
			error = errorToString(cause);
		} finally {
			exporting = false;
		}
	}

	function setFilter(apply: () => void) {
		apply();
		void reload();
	}

	let unsubscribeFeed: (() => void) | null = null;

	onMount(() => {
		unsubscribeFeed = auditLogFeed.subscribe(({ entry, replacesId }) => {
			let next = replacesId === null ? entries : entries.filter((existing) => existing.id !== replacesId);
			if (matchesAuditQuery(entry, currentQuery()) && !next.some((existing) => existing.id === entry.id)) {
				next = [entry, ...next];
			}
			entries = next;
		});
		void app.wrpcClient.audit.subscribeAuditLog.mutation().catch((cause: unknown) => {
			error = errorToString(cause);
		});
		void reload();
	});

	onDestroy(() => {
		unsubscribeFeed?.();
		void app.wrpcClient.audit.unsubscribeAuditLog.mutation().catch(() => {
			// Dropped with the connection anyway.
		});
	});

	const today = new Date().toDateString();

	function formatWhen(timestamp: number): string {
		const date = new Date(timestamp);
		const time = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' });
		return date.toDateString() === today ? time : `${date.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${time}`;
	}

	const filtered = $derived(!!(personFilter || teamFilter || typeFilter));
</script>

<Dialog open={true} onClose={() => dialogs.closeDialog()} innerContainerClass="max-w-4xl p-4!">
	<div class="flex max-h-[85vh] flex-col gap-3 overflow-hidden p-2">
		<div class="flex shrink-0 items-start justify-between gap-3">
			<div class="min-w-0">
				<h2 id="dialog-title" class="text-headline-small text-on-surface">{m.activity_log()}</h2>
				<p class="mt-1 text-body-medium text-on-surface-variant">{m.activity_log_description()}</p>
			</div>
			<button
				onclick={() => dialogs.closeDialog()}
				class="shrink-0 rounded-full p-1 text-on-surface-variant hover:bg-surface-container-high"
				aria-label={m.close_dialog_text()}
			>
				<XmarkIcon size={18} />
			</button>
		</div>

		{#if !accessControlEnabled}
			<p class="shrink-0 rounded-xl bg-secondary-container p-3 text-body-small text-on-secondary-container">
				{m.activity_log_unverified_notice()}
			</p>
		{/if}

		<div class="flex shrink-0 flex-wrap items-end gap-2">
			<label class="flex min-w-0 flex-col gap-1">
				<span class="text-body-small text-on-surface-variant">{m.activity_filter_person()}</span>
				<select
					class="classic max-w-48"
					value={personFilter}
					onchange={(event) => setFilter(() => (personFilter = event.currentTarget.value))}
				>
					<option value="">{m.activity_filter_everyone()}</option>
					{#each people as person (person.id)}
						<option value={person.id}>{person.name}</option>
					{/each}
				</select>
			</label>
			<label class="flex min-w-0 flex-col gap-1">
				<span class="text-body-small text-on-surface-variant">{m.activity_filter_team()}</span>
				<select class="classic max-w-48" value={teamFilter} onchange={(event) => setFilter(() => (teamFilter = event.currentTarget.value))}>
					<option value="">{m.activity_filter_all_teams()}</option>
					{#each teams as team (team.id)}
						<option value={team.id}>{team.number}</option>
					{/each}
				</select>
			</label>
			<label class="flex min-w-0 flex-col gap-1">
				<span class="text-body-small text-on-surface-variant">{m.activity_filter_type()}</span>
				<select
					class="classic max-w-56"
					value={typeFilter}
					onchange={(event) => setFilter(() => (typeFilter = event.currentTarget.value as AuditActionGroup | ''))}
				>
					<option value="">{m.activity_filter_all_types()}</option>
					{#each Object.keys(AUDIT_ACTION_GROUPS) as AuditActionGroup[] as group (group)}
						<option value={group}>{auditActionGroupLabel(group)}</option>
					{/each}
				</select>
			</label>
			<div class="ml-auto">
				<Button variant="outlined" compact disabled={exporting} onclick={exportCsv}>
					{exporting ? m.activity_exporting() : m.activity_export_csv()}
				</Button>
			</div>
		</div>

		{#if error}
			<p class="shrink-0 rounded-xl bg-error-container p-3 text-body-medium text-on-error-container" role="alert">
				{m.activity_load_failed({ error })}
			</p>
		{/if}

		<div class="min-h-0 flex-1 overflow-auto rounded-xl border border-outline-variant">
			{#if loading && entries.length === 0}
				<p class="p-4 text-body-medium text-on-surface-variant">{m.activity_loading()}</p>
			{:else if entries.length === 0}
				<p class="p-4 text-body-medium text-on-surface-variant">{filtered ? m.activity_empty_filtered() : m.activity_empty()}</p>
			{:else}
				<ol class="divide-y divide-outline-variant" aria-label={m.activity_log()}>
					{#each entries as entry (entry.id)}
						{@const extras = auditEntryExtras(entry)}
						<li class="flex flex-col gap-1 px-3 py-2 sm:flex-row sm:gap-4">
							<time
								class="shrink-0 text-body-small text-on-surface-variant tabular-nums sm:w-32 sm:pt-0.5"
								datetime={new Date(entry.timestamp).toISOString()}
							>
								{formatWhen(entry.timestamp)}
							</time>
							<div class="min-w-0 flex-1">
								<p class="text-body-medium text-on-surface">
									<span class="font-medium">{auditActorLabel(entry)}</span>
									{#if !entry.verified && entry.actorRole}
										<span
											class="ml-1 rounded-sm bg-surface-container-highest px-1 text-label-small text-on-surface-variant"
											title={m.activity_unverified_title()}>{m.activity_unverified_badge()}</span
										>
									{/if}
									<span class="text-on-surface-variant">·</span>
									<span class="break-words">{describeAuditEntry(entry)}</span>
								</p>
								{#if extras.length > 0}
									<p class="text-body-small break-words text-on-surface-variant">{extras.join(' · ')}</p>
								{/if}
							</div>
							<!-- Skipped when the device is already the name shown as who did it. -->
							{#if entry.deviceName && (entry.actorRole || entry.actorName)}
								<span
									class="shrink-0 truncate text-body-small text-on-surface-variant sm:max-w-40 sm:pt-0.5"
									title={m.activity_col_device()}
								>
									{entry.deviceName}
								</span>
							{/if}
						</li>
					{/each}
				</ol>
				{#if hasMore}
					<div class="flex justify-center p-3">
						<Button variant="text" compact disabled={loadingMore} onclick={loadMore}>
							{loadingMore ? m.activity_loading() : m.activity_load_more()}
						</Button>
					</div>
				{/if}
			{/if}
		</div>
	</div>
</Dialog>
