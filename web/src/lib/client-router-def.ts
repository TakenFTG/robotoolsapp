import { z } from 'zod';
import { initWRPC } from '@robotools.app/wrpc/client';
import { ClientAuthenticationSchema } from '@robotools.app/protocol/src/access';
import { DeviceInfoSchema } from '@robotools.app/protocol/src/client';
import { TeamDataSchema } from '@robotools.app/protocol/src/team';
import { JudgeSchema } from '@robotools.app/protocol/src/judging';
import {
	AwardNominationSchema,
	AwardRankingsPartialUpdateSchema,
	SubmissionCacheSchema,
	SubmissionRemovalSchema
} from '@robotools.app/protocol/src/rubric';
import { AwardNameSchema } from '@robotools.app/protocol/src/award';
import { TeamPhotoUpdateSchema } from '@robotools.app/protocol/src/media';
import { RoomStateSchema } from '@robotools.app/protocol/src/room';

/**
 * Single client-router shape (procedure names + inputs).
 * Handlers are wired in client-router.ts; the worker imports only the type.
 * Keep this free of Svelte app imports so worker `tsc` does not pull in the web graph.
 */
export type ClientRouterHandlers = {
	onEventSetupUpdate: (input: z.infer<typeof RoomStateSchema>) => void | Promise<void>;
	onDeviceListUpdate: (input: z.infer<typeof DeviceInfoSchema>[]) => void | Promise<void>;
	onClientAuthenticationChange: (input: z.infer<typeof ClientAuthenticationSchema>) => void | Promise<void>;
	onAllTeamDataUpdate: (input: z.infer<typeof TeamDataSchema>[]) => void | Promise<void>;
	onTeamDataUpdate: (input: z.infer<typeof TeamDataSchema>) => void | Promise<void>;
	onAllJudgesUpdate: (input: z.infer<typeof JudgeSchema>[]) => void | Promise<void>;
	onAwardRankingsUpdate: (input: z.infer<typeof AwardRankingsPartialUpdateSchema>) => void | Promise<void>;
	onReviewedTeamsUpdate: (input: { judgeGroupId: string; teamId: string }) => void | Promise<void>;
	onSubmissionCacheUpdate: (input: z.infer<typeof SubmissionCacheSchema>) => void | Promise<void>;
	onSubmissionRemoved: (input: z.infer<typeof SubmissionRemovalSchema>) => void | Promise<void>;
	/** The counterpart to onReviewedTeamsUpdate: this group has nothing left for the team. */
	onReviewedTeamRemoved: (input: { judgeGroupId: string; teamId: string }) => void | Promise<void>;
	onFinalAwardNominationsUpdate: (input: {
		awardName: z.infer<typeof AwardNameSchema>;
		nominations: z.infer<typeof AwardNominationSchema>[];
	}) => void | Promise<void>;
	onAwardDeliberationStarted: () => void | Promise<void>;
	onTeamPhotoUpdate: (input: z.infer<typeof TeamPhotoUpdateSchema>) => void | Promise<void>;
	/** Ref notes for this division changed. Sent to Judge Advisors only, with no data. */
	onRefNotesChanged: () => void | Promise<void>;
};

export function buildClientRouter(handlers: ClientRouterHandlers) {
	const w = initWRPC.createClient();
	return w.router({
		onEventSetupUpdate: w.procedure.input(RoomStateSchema).mutation(async ({ input }) => {
			await handlers.onEventSetupUpdate(input);
		}),
		onDeviceListUpdate: w.procedure.input(z.array(DeviceInfoSchema)).mutation(async ({ input }) => {
			await handlers.onDeviceListUpdate(input);
		}),
		onClientAuthenticationChange: w.procedure.input(ClientAuthenticationSchema).mutation(async ({ input }) => {
			await handlers.onClientAuthenticationChange(input);
		}),
		onAllTeamDataUpdate: w.procedure.input(z.array(TeamDataSchema)).mutation(async ({ input }) => {
			await handlers.onAllTeamDataUpdate(input);
		}),
		onTeamDataUpdate: w.procedure.input(TeamDataSchema).mutation(async ({ input }) => {
			await handlers.onTeamDataUpdate(input);
		}),
		onAllJudgesUpdate: w.procedure.input(z.array(JudgeSchema)).mutation(async ({ input }) => {
			await handlers.onAllJudgesUpdate(input);
		}),
		onAwardRankingsUpdate: w.procedure.input(AwardRankingsPartialUpdateSchema).mutation(async ({ input }) => {
			await handlers.onAwardRankingsUpdate(input);
		}),
		onReviewedTeamsUpdate: w.procedure.input(z.object({ judgeGroupId: z.string(), teamId: z.string() })).mutation(async ({ input }) => {
			await handlers.onReviewedTeamsUpdate(input);
		}),
		onSubmissionCacheUpdate: w.procedure.input(SubmissionCacheSchema).mutation(async ({ input }) => {
			await handlers.onSubmissionCacheUpdate(input);
		}),
		onSubmissionRemoved: w.procedure.input(SubmissionRemovalSchema).mutation(async ({ input }) => {
			await handlers.onSubmissionRemoved(input);
		}),
		onReviewedTeamRemoved: w.procedure.input(z.object({ judgeGroupId: z.string(), teamId: z.string() })).mutation(async ({ input }) => {
			await handlers.onReviewedTeamRemoved(input);
		}),
		onFinalAwardNominationsUpdate: w.procedure
			.input(z.object({ awardName: AwardNameSchema, nominations: z.array(AwardNominationSchema) }))
			.mutation(async ({ input }) => {
				await handlers.onFinalAwardNominationsUpdate(input);
			}),
		onAwardDeliberationStarted: w.procedure.mutation(async () => {
			await handlers.onAwardDeliberationStarted();
		}),
		onTeamPhotoUpdate: w.procedure.input(TeamPhotoUpdateSchema).mutation(async ({ input }) => {
			await handlers.onTeamPhotoUpdate(input);
		}),
		onRefNotesChanged: w.procedure.mutation(async () => {
			await handlers.onRefNotesChanged();
		})
	});
}

export type ClientRouter = ReturnType<typeof buildClientRouter>;
