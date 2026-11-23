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

/**
 * A short name the Judge Advisor gives the event, shown to every judge in the event switcher.
 *
 * Official names run long — "VEX Robotics 2026-2027 Australian National Championships VEX V5
 * Robotics Competition - Override™ (Middle School)" — and the part that tells divisions apart
 * is at the end, where a list truncates it.
 *
 * In an event group, the division label is the nickname, so the two share a length limit.
 */
export const EVENT_NICKNAME_MAX_LENGTH = 100;

export const EventNicknameSchema = z
	.string()
	.nonempty()
	.max(EVENT_NICKNAME_MAX_LENGTH)
	.regex(/^\S.*\S$|^\S$/, { message: 'Event nickname must not have leading or trailing whitespace' });

export const EssentialDataSchema = z.object({
	robotEventsSku: RobotEventsSkuSchema.nullable(),
	robotEventsEventId: RobotEventsEventIdSchema.nullable(),
	divisionId: DivisionIdSchema.nullable(),
	eventName: EventNameSchema,
	/**
	 * Set only through its own call, never by event setup: setup sends the whole of this
	 * object back, and a form that does not show the nickname must not be able to clear it.
	 * Optional so setup, and clients from before nicknames, need not send it at all.
	 */
	eventNickname: EventNicknameSchema.nullable().optional(),
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
