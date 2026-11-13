import { z } from 'zod';
import { AwardSchema } from './award';
import { ProgramSchema } from './award';
import { TeamInfoSchema } from './team';
import { JudgingMethodSchema, JudgingStepSchema } from './judging';
import { JudgeGroupSchema } from './judging';

export const RobotEventsSkuSchema = z
	.string()
	.min(12)
	.max(20)
	.regex(/^[a-zA-Z0-9-]+$/, {
		message: 'VEX Events SKU must only contain English letters, numbers, and hyphens'
	});
export const RobotEventsEventIdSchema = z.number();

export const DivisionIdSchema = z.number();

export const EventGradeLevelSchema = z.enum(['ES Only', 'MS Only', 'HS Only', 'Blended', 'College Only']);
export type EventGradeLevel = z.infer<typeof EventGradeLevelSchema>;

/**
 * How long an event name may be.
 *
 * Exported so the setup form can enforce the same number rather than its own. They had
 * drifted — the form capped at 100 while this allowed 200 — and because a name imported
 * from RobotEvents is not editable, an event whose real name ran past 100 characters
 * could not be created at all and there was nothing the operator could do about it.
 */
export const EVENT_NAME_MAX_LENGTH = 200;

export const EventNameSchema = z
	.string()
	.nonempty()
	.max(EVENT_NAME_MAX_LENGTH)
	.regex(/^\S.*\S$|^\S$/, { message: 'Event name must not have leading or trailing whitespace' });

export const EssentialDataSchema = z.object({
	robotEventsSku: RobotEventsSkuSchema.nullable(),
	robotEventsEventId: RobotEventsEventIdSchema.nullable(),
	divisionId: DivisionIdSchema.nullable(),
	eventName: EventNameSchema,
	program: ProgramSchema,
	eventGradeLevel: EventGradeLevelSchema,
	judgingMethod: JudgingMethodSchema,
	judgingStep: JudgingStepSchema,
	accessControlEnabled: z.boolean(),
	teamInfos: z.array(TeamInfoSchema),
	judgeGroups: z.array(JudgeGroupSchema).min(1),
	awards: z.array(AwardSchema)
});

export type EssentialData = z.infer<typeof EssentialDataSchema>;
