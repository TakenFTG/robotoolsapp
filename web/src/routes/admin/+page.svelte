<script lang="ts">
	import { AdminRpcError, callAdminRpc } from '$lib/admin-client';
	import type { AdminAction, AdminRoomDetail, AdminRoomSummary } from '@robotools.app/protocol/src/admin';
	import { errorToString } from '$lib/utils.svelte';
	import { onMount } from 'svelte';

	/**
	 * The operator admin view.
	 *
	 * Deliberately plain and self-contained: it shares no state with the judging app, holds
	 * no permit, and keeps its session token in memory only — a reload signs you out. It can
	 * see the shape of every event and who is working on it, and no judging content at all.
	 */

	/**
	 * Where the API lives. In dev the server is on its own port; in production it serves
	 * this page too.
	 *
	 * Computed on call rather than at module scope: the app prerenders (`prerender = true`
	 * in the root layout), so anything touching `location` while the module initialises
	 * runs during the build, where there is no `location` to touch.
	 */
	function serverOrigin(): string {
		return import.meta.env.DEV ? `http://${location.hostname}:8787` : location.origin;
	}

	/**
	 * The session token, kept in localStorage.
	 *
	 * It was in memory only, which meant signing in again after every reload. The server
	 * now expires a session after an hour of no use and pushes that back on each request,
	 * so a token sitting in storage is short-lived by construction — and signing out, or
	 * an hour away from the tab, ends it. That is the trade: any script on this origin can
	 * read it, in exchange for not retyping a password all day.
	 */
	const TOKEN_KEY = 'adminSessionToken';

	let token = $state<string | null>(null);
	let username = $state('');
	let password = $state('');

	let rooms = $state<AdminRoomSummary[]>([]);
	let selected = $state<AdminRoomDetail | null>(null);

	let busy = $state(false);
	let errorMessage = $state('');
	let signedOutMessage = $state('');

	function storeToken(next: string | null): void {
		token = next;
		try {
			if (next) {
				localStorage.setItem(TOKEN_KEY, next);
			} else {
				localStorage.removeItem(TOKEN_KEY);
			}
		} catch {
			// Private browsing, or storage disabled. The session still works for this tab.
		}
	}

	async function call(action: AdminAction) {
		return callAdminRpc(serverOrigin(), token, action);
	}

	/**
	 * Resume a stored session, if the server still honours it.
	 *
	 * Listing rooms is the check: a token the server has expired comes back 401 and the
	 * sign-in form appears, which is the same thing that happens to a session that expires
	 * while the tab is open.
	 */
	onMount(() => {
		// Declared without a value: both paths below assign one, so an initialiser here would
		// be a store nothing can ever read.
		let stored: string | null;
		try {
			stored = localStorage.getItem(TOKEN_KEY);
		} catch {
			// Storage unavailable — private browsing, or blocked. No stored session, which is
			// a normal state rather than a failure.
			stored = null;
		}
		if (!stored) {
			return;
		}

		token = stored;
		void run(async () => {
			try {
				await loadRooms();
			} catch (error) {
				if (error instanceof AdminRpcError && error.isUnauthorized) {
					storeToken(null);
					return;
				}
				throw error;
			}
		});
	});

	async function run(work: () => Promise<unknown>) {
		if (busy) return;
		busy = true;
		errorMessage = '';
		try {
			await work();
		} catch (error) {
			// An expired session should drop you back to the sign-in form rather than
			// leaving a dead page showing data you can no longer refresh.
			if (error instanceof AdminRpcError && error.isUnauthorized && token) {
				storeToken(null);
				rooms = [];
				selected = null;
				signedOutMessage = 'Your session expired. Sign in again.';
				return;
			}
			errorMessage = error instanceof AdminRpcError ? error.message : errorToString(error);
		} finally {
			busy = false;
		}
	}

	function signIn() {
		return run(async () => {
			const result = await call({ kind: 'login', username, password });
			if (result.kind !== 'session') return;
			storeToken(result.token);
			password = '';
			signedOutMessage = '';
			await loadRooms();
		});
	}

	function signOut() {
		return run(async () => {
			await call({ kind: 'logout' });
			storeToken(null);
			rooms = [];
			selected = null;
		});
	}

	async function loadRooms() {
		const result = await call({ kind: 'list_rooms' });
		if (result.kind === 'rooms') {
			rooms = result.rooms;
		}
	}

	function openRoom(roomId: string) {
		return run(async () => {
			const result = await call({ kind: 'room_detail', roomId });
			selected = result.kind === 'room' ? result.room : null;
			if (!selected) {
				errorMessage = 'That event no longer exists.';
				await loadRooms();
			}
		});
	}

	function refresh() {
		return run(async () => {
			await loadRooms();
			if (selected) {
				const result = await call({ kind: 'room_detail', roomId: selected.roomId });
				selected = result.kind === 'room' ? result.room : null;
			}
		});
	}

	function destroyRoom(room: AdminRoomDetail) {
		return run(async () => {
			// A confirmation, not a transcription. Event names run to a hundred characters
			// and are often close variants of each other, so retyping one was a test of
			// patience rather than of intent — and the reflex it trains, copy-paste-confirm,
			// is worse than reading a sentence and meaning it.
			const confirmed = window.confirm(
				`Permanently destroy "${room.eventName}"?\n\n` +
					`This deletes the event and everything in it: rubrics, nominations, rankings, team photos and every access link. ` +
					`It cannot be undone.`
			);
			if (!confirmed) {
				return;
			}

			await call({ kind: 'destroy_room', roomId: room.roomId });
			selected = null;
			await loadRooms();
		});
	}

	function addJudge(room: AdminRoomDetail) {
		return run(async () => {
			if (room.judgeGroups.length === 0) {
				errorMessage = 'This event has no judge groups to add a judge to.';
				return;
			}

			const name = window.prompt('Judge name:');
			if (!name?.trim()) return;

			const groupList = room.judgeGroups.map((group, index) => `${index + 1}. ${group.name}`).join('\n');
			const choice = window.prompt(`Which judge group?\n\n${groupList}`, '1');
			const index = Number(choice) - 1;
			const group = room.judgeGroups[index];
			if (!group) {
				errorMessage = 'That is not one of the judge groups.';
				return;
			}

			await call({ kind: 'add_judge', roomId: room.roomId, name: name.trim(), groupId: group.id });
			await refreshSelected(room.roomId);
		});
	}

	function removeJudge(room: AdminRoomDetail, judgeId: string, judgeName: string) {
		return run(async () => {
			if (
				!window.confirm(
					`Remove ${judgeName}? Their access link stops working immediately. Rubrics they already submitted stay in the event.`
				)
			) {
				return;
			}
			await call({ kind: 'remove_judge', roomId: room.roomId, judgeId });
			await refreshSelected(room.roomId);
		});
	}

	/** A link that was just minted, shown once because nothing can show it again. */
	let issuedLink = $state<string | null>(null);

	function addJudgeAdvisor(room: AdminRoomDetail) {
		return run(async () => {
			const name = window.prompt('Judge Advisor name:', 'Judge Advisor');
			if (!name?.trim()) return;

			const result = await call({ kind: 'add_judge_advisor', roomId: room.roomId, name: name.trim() });
			if (result.kind === 'access_link') {
				issuedLink = `${location.origin}/join?roomId=${room.roomId}&auth=${result.authToken}`;
			}
			await refreshSelected(room.roomId);
		});
	}

	function removeJudgeAdvisor(room: AdminRoomDetail, judgeAdvisorId: string, name: string) {
		return run(async () => {
			if (!window.confirm(`Remove ${name} as a Judge Advisor? Their access link stops working immediately.`)) {
				return;
			}
			await call({ kind: 'remove_judge_advisor', roomId: room.roomId, judgeAdvisorId });
			await refreshSelected(room.roomId);
		});
	}

	async function refreshSelected(roomId: string) {
		const result = await call({ kind: 'room_detail', roomId });
		selected = result.kind === 'room' ? result.room : null;
	}

	function formatDate(value: number): string {
		return new Date(value).toLocaleString();
	}

	/**
	 * Last activity, or an honest blank.
	 *
	 * Null means the room has never been connected to and predates the column this is read
	 * from. Printing a date there — the creation time, say — would be the bug this display
	 * was added to fix.
	 */
	function formatActivity(value: number | null): string {
		return value === null ? '—' : formatDate(value);
	}
</script>

<svelte:head>
	<title>Admin | Judges' Room</title>
	<meta name="robots" content="noindex, nofollow" />
</svelte:head>

<div class="min-h-screen bg-slate-100 p-4 md:p-8">
	<div class="mx-auto max-w-5xl space-y-6">
		<div class="flex flex-wrap items-center justify-between gap-3">
			<div>
				<h1 class="text-2xl font-semibold text-gray-900">Judges' Room admin</h1>
				<p class="text-sm text-gray-600">Events and the people running them. No judging data is shown here.</p>
			</div>
			{#if token}
				<div class="flex gap-2">
					<button class="secondary" onclick={refresh} disabled={busy}>Refresh</button>
					<button class="cancel" onclick={signOut} disabled={busy}>Sign out</button>
				</div>
			{/if}
		</div>

		{#if errorMessage}
			<p class="rounded-md bg-red-50 p-3 text-sm text-red-700" role="alert">{errorMessage}</p>
		{/if}

		{#if !token}
			<div class="max-w-sm space-y-4 rounded-2xl bg-white p-6 shadow-sm">
				{#if signedOutMessage}
					<p class="text-sm text-amber-800">{signedOutMessage}</p>
				{/if}
				<div>
					<label for="admin-username" class="mb-1 block text-sm font-medium text-gray-700">Username</label>
					<input id="admin-username" class="classic w-full" bind:value={username} autocomplete="username" />
				</div>
				<div>
					<label for="admin-password" class="mb-1 block text-sm font-medium text-gray-700">Password</label>
					<input
						id="admin-password"
						type="password"
						class="classic w-full"
						bind:value={password}
						autocomplete="current-password"
						onkeydown={(event) => event.key === 'Enter' && signIn()}
					/>
				</div>
				<button class="primary w-full" onclick={signIn} disabled={busy || !username || !password}>
					{busy ? 'Signing in…' : 'Sign in'}
				</button>
			</div>
		{:else if selected}
			{@const room = selected}
			<div class="space-y-5 rounded-2xl bg-white p-6 shadow-sm">
				<div class="flex flex-wrap items-start justify-between gap-3">
					<div>
						<button class="mb-2 text-sm text-slate-600 underline" onclick={() => (selected = null)}>← All events</button>
						<h2 class="text-xl font-semibold text-gray-900">{room.eventName}</h2>
						<p class="text-sm text-gray-600">
							{room.program} · {room.eventGradeLevel}
							{#if room.divisionId !== null}· Division {room.divisionId}{/if}
							{#if room.robotEventsSku}· {room.robotEventsSku}{/if}
						</p>
						<p class="mt-1 font-mono text-xs text-gray-400">{room.roomId}</p>
					</div>
					<button class="danger" onclick={() => destroyRoom(room)} disabled={busy}>Destroy event</button>
				</div>

				<div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
					<div class="rounded-lg bg-slate-50 p-3">
						<div class="text-xs text-gray-500">Teams</div>
						<div class="text-lg font-medium text-gray-900">{room.teamCount}</div>
					</div>
					<div class="rounded-lg bg-slate-50 p-3">
						<div class="text-xs text-gray-500">Judge groups</div>
						<div class="text-lg font-medium text-gray-900">{room.judgeGroups.length}</div>
					</div>
					<div class="rounded-lg bg-slate-50 p-3">
						<div class="text-xs text-gray-500">Judges</div>
						<div class="text-lg font-medium text-gray-900">{room.judges.length}</div>
					</div>
					<div class="rounded-lg bg-slate-50 p-3">
						<div class="text-xs text-gray-500">Devices online</div>
						<div class="text-lg font-medium text-gray-900">{room.onlineDeviceCount}</div>
					</div>
				</div>

				<div>
					<div class="mb-2 flex items-center justify-between">
						<h3 class="text-sm font-medium text-gray-900">Judge Advisors</h3>
						<button class="primary tiny" onclick={() => addJudgeAdvisor(room)} disabled={busy}>Add Judge Advisor</button>
					</div>

					{#if issuedLink}
						<div class="mb-2 rounded-lg border border-green-200 bg-green-50 p-3">
							<p class="mb-1 text-xs font-medium text-green-900">Access link — copy it now, it is not shown again</p>
							<div class="flex items-center gap-2">
								<input
									class="classic w-full font-mono text-xs"
									readonly
									value={issuedLink}
									onfocus={(event) => event.currentTarget.select()}
								/>
								<button class="secondary tiny shrink-0" onclick={() => navigator.clipboard?.writeText(issuedLink ?? '')}>Copy</button>
								<button class="lightweight tiny shrink-0" onclick={() => (issuedLink = null)}>Done</button>
							</div>
						</div>
					{/if}

					<ul class="divide-y divide-gray-100 rounded border border-gray-200">
						{#each room.judgeAdvisors as advisor (advisor.judgeAdvisorId)}
							<li class="flex items-center gap-2 px-3 py-2 text-sm">
								<span class="flex-1 truncate text-gray-900">{advisor.name}</span>
								{#if advisor.origin === 'group'}
									<span class="rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700">Via event group</span>
								{/if}
								{#if advisor.origin !== 'group'}
									<button
										class="shrink-0 rounded-md px-2 py-1 text-xs text-red-600 hover:bg-red-50"
										onclick={() => removeJudgeAdvisor(room, advisor.judgeAdvisorId, advisor.name)}
										disabled={busy}
									>
										Remove
									</button>
								{/if}
							</li>
						{/each}
					</ul>
				</div>

				<div>
					<div class="mb-2 flex items-center justify-between">
						<h3 class="text-sm font-medium text-gray-900">Judges</h3>
						<button class="primary tiny" onclick={() => addJudge(room)} disabled={busy}>Add judge</button>
					</div>
					{#if room.judges.length === 0}
						<p class="text-sm text-gray-500">No judges yet.</p>
					{:else}
						<ul class="divide-y divide-gray-100 rounded border border-gray-200">
							{#each room.judges as judge (judge.judgeId)}
								<li class="flex items-center gap-3 px-3 py-2 text-sm">
									<span class="flex-1 truncate text-gray-900">{judge.name}</span>
									<span class="shrink-0 text-xs text-gray-500">{judge.groupName}</span>
									<button
										class="shrink-0 rounded-md px-2 py-1 text-xs text-red-600 hover:bg-red-50"
										onclick={() => removeJudge(room, judge.judgeId, judge.name)}
										disabled={busy}
									>
										Remove
									</button>
								</li>
							{/each}
						</ul>
					{/if}
				</div>
			</div>
		{:else}
			<div class="rounded-2xl bg-white p-2 shadow-sm">
				{#if rooms.length === 0}
					<p class="p-4 text-sm text-gray-600">
						No events registered. Only events created after the admin registry was deployed appear here — Durable Objects cannot be listed
						retrospectively.
					</p>
				{:else}
					<ul class="divide-y divide-gray-100">
						{#each rooms as room (room.roomId)}
							<li>
								<button
									class="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-gray-50"
									onclick={() => openRoom(room.roomId)}
									disabled={busy}
								>
									<span class="min-w-0">
										<span class="block truncate font-medium text-gray-900">{room.eventName}</span>
										<span class="block truncate text-xs text-gray-500">
											{room.program} · {room.eventGradeLevel}
											{#if room.divisionId !== null}· Division {room.divisionId}{/if}
											{#if room.robotEventsSku}· {room.robotEventsSku}{/if}
											{#if room.groupId}· In an event group{/if}
										</span>
									</span>
									<!--
										Last active first, because it is the question this list is for: which
										events are still in use, and which are heading for retention. "Setup
										changed" is what the old "Updated" line actually meant — the registry
										row is rewritten when an event is renamed or re-scoped, and never by
										judging — so it stayed at the creation time on a room that was set up
										once and then used all weekend.
									-->
									<span class="shrink-0 text-right text-xs text-gray-400">
										<span class="block">Last active {formatActivity(room.lastActivityAt)}</span>
										<span class="block">Created {formatDate(room.createdAt)}</span>
										<span class="block">Setup changed {formatDate(room.updatedAt)}</span>
									</span>
								</button>
							</li>
						{/each}
					</ul>
				{/if}
			</div>
		{/if}
	</div>
</div>
