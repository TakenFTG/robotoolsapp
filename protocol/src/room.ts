import { z } from 'zod';
import { AwardNameSchema } from './award';
import { ClientAuthenticationSchema, JudgeAdvisorNameSchema } from './access';
import { JudgeEmailSchema } from './email';
import { EssentialDataSchema } from './event';
import { JudgeSchema } from './judging';
import { AwardNominationSchema } from './rubric';
import { TeamDataSchema } from './team';

export const StarterKitSchema = z.object({
	essentialData: EssentialDataSchema,
	teamData: z.array(TeamDataSchema),
	judges: z.array(JudgeSchema),
	/**
	 * Who the Judge Advisor is.
	 *
	 * Both optional so a client running older code can still create a room; the name
	 * then falls back to the generic 'Judge Advisor' the column defaults to.
	 *
	 * An address here causes exactly one message to be sent, to the person who typed it,
	 * as the event is created. That is the one automatic send in the system, and it
	 * exists because a Judge Advisor who loses their link may have no way back into
	 * their own event — unlike a judge, who can simply ask the Judge Advisor.
	 */
	judgeAdvisorName: JudgeAdvisorNameSchema.optional(),
	judgeAdvisorEmail: JudgeEmailSchema.nullable().optional()
});

export type StarterKit = z.infer<typeof StarterKitSchema>;

export const RoomStateSchema = z.object({
	essentialData: EssentialDataSchema,
	teamData: z.array(TeamDataSchema),
	judges: z.array(JudgeSchema),
	finalAwardNominations: z.record(AwardNameSchema, z.array(AwardNominationSchema))
});

export type RoomState = z.infer<typeof RoomStateSchema>;

export const JoiningKitSchema = RoomStateSchema.extend({
	authentication: ClientAuthenticationSchema
});

export type JoiningKit = z.infer<typeof JoiningKitSchema>;
