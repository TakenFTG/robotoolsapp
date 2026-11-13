import { z } from 'zod';
import { initWRPC } from '@robotools.app/wrpc/client';
import { IncidentSchema, LinkedDivisionSchema, RefereeSchema, RefTeamSchema } from '@robotools.app/protocol/src/ref';

/**
 * What a ref room can push to a ref's device.
 *
 * Handlers are wired in ref-app.svelte.ts; the worker imports only the type. Keep this free
 * of Svelte imports so the worker's `tsc` does not pull in the web graph.
 */
export type RefClientRouterHandlers = {
	onIncidentSaved: (input: z.infer<typeof IncidentSchema>) => void | Promise<void>;
	onIncidentRemoved: (input: { id: string }) => void | Promise<void>;
	onRefereesUpdate: (input: z.infer<typeof RefereeSchema>[]) => void | Promise<void>;
	onTeamsUpdate: (input: z.infer<typeof RefTeamSchema>[]) => void | Promise<void>;
	onLinkedDivisionsUpdate: (input: z.infer<typeof LinkedDivisionSchema>[]) => void | Promise<void>;
};

export function buildRefClientRouter(handlers: RefClientRouterHandlers) {
	const w = initWRPC.createClient();
	return w.router({
		onIncidentSaved: w.procedure.input(IncidentSchema).mutation(async ({ input }) => {
			await handlers.onIncidentSaved(input);
		}),
		onIncidentRemoved: w.procedure.input(z.object({ id: z.string() })).mutation(async ({ input }) => {
			await handlers.onIncidentRemoved(input);
		}),
		onRefereesUpdate: w.procedure.input(z.array(RefereeSchema)).mutation(async ({ input }) => {
			await handlers.onRefereesUpdate(input);
		}),
		onTeamsUpdate: w.procedure.input(z.array(RefTeamSchema)).mutation(async ({ input }) => {
			await handlers.onTeamsUpdate(input);
		}),
		onLinkedDivisionsUpdate: w.procedure.input(z.array(LinkedDivisionSchema)).mutation(async ({ input }) => {
			await handlers.onLinkedDivisionsUpdate(input);
		})
	});
}

export type RefClientRouter = ReturnType<typeof buildRefClientRouter>;
