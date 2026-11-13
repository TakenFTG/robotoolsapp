if (typeof window !== 'undefined') {
	async function resolveDemoData(resource: object) {
		await new Promise((resolve) => setTimeout(resolve, 250));
		return new Response(JSON.stringify(resource), { headers: { 'Content-Type': 'application/json' } });
	}

	const origin = window.fetch;
	window.fetch = async (input, init) => {
		const url = typeof input === 'object' && 'url' in input ? input.url : null;
		// VEX Events calls now go through this app's server; match on the API path either way.
		const apiPath = url?.match(/(?:events\.vex\.com|\/vex-events)\/api\/v2(\/.*)$/)?.[1] ?? null;
		switch (apiPath ? `https://events.vex.com/api/v2${apiPath}` : url) {
			case 'https://events.vex.com/api/v2/events?sku[]=RE-VIQRC-24-9999':
				return resolveDemoData(await import('$lib/demo-data/roboteventsFetchEvents.json'));
			case 'https://events.vex.com/api/v2/events/59999':
				return resolveDemoData((await import('$lib/demo-data/roboteventsFetchEvents.json')).data[0]);
			case 'https://events.vex.com/api/v2/events/59999/teams?page=1&per_page=250':
				return resolveDemoData(await import('$lib/demo-data/roboteventsFetchTeams.json'));
			case 'https://events.vex.com/api/v2/events/59999/awards?page=1&per_page=250':
				return resolveDemoData(await import('$lib/demo-data/roboteventsFetchAwards.json'));
			case 'https://events.vex.com/api/v2/events/59999/divisions/1/rankings?page=1&per_page=250':
				return resolveDemoData(await import('$lib/demo-data/roboteventsFetchRanking.json'));
			case 'https://events.vex.com/api/v2/events/59999/skills?page=1&per_page=250':
				return resolveDemoData(await import('$lib/demo-data/roboteventsFetchSkills.json'));
			default:
				return origin(input, init);
		}
	};
}
