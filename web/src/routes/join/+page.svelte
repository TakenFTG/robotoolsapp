<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';

	onMount(() => {
		const params = new URLSearchParams(window.location.search);
		const roomId = params.get('roomId');
		// An event group link carries groupId where a room link carries roomId. Both land
		// on /app, which decides what to do with whichever it was given.
		const groupId = params.get('groupId');
		const auth = params.get('auth');

		// Built as a plain string rather than a URLSearchParams: this runs once, the result
		// is handed straight to goto, and nothing reads it again. That also sidesteps
		// svelte/prefer-svelte-reactivity, which cannot tell a throwaway from held state.
		const carry: [string, string][] = [];
		if (roomId) {
			carry.push(['roomId', roomId]);
		} else if (groupId) {
			carry.push(['groupId', groupId]);
		}
		if (carry.length > 0 && auth) {
			carry.push(['auth', auth]);
		}

		// resolve() takes a route, so the query is appended after resolving rather than
		// being handed to it.
		const query = carry.map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join('&');
		const target = resolve('/app');
		// The route is resolved above; the rule only recognises resolve() called inline, and
		// resolve() itself takes a route rather than a route plus a query string.
		// eslint-disable-next-line svelte/no-navigation-without-resolve
		goto(query ? `${target}?${query}` : target, { replaceState: true });
	});
</script>

<svelte:head>
	<title>Join the Judges' Room</title>
</svelte:head>
