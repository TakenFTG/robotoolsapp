import { z } from 'zod';
import { JudgeEmailSchema } from './email';

export const JudgingMethodSchema = z.enum(['walk_in', 'assigned']);
export type JudgingMethod = z.infer<typeof JudgingMethodSchema>;

export const JudgingStepSchema = z.enum(['beginning', 'award_deliberations']);
export type JudgingStep = z.infer<typeof JudgingStepSchema>;

export const JudgeNameSchema = z
	.string()
	.nonempty()
	.max(100)
	.regex(/^\S.*\S$|^\S$/, { message: 'Judge name must not have leading or trailing whitespace' });

export const JudgeGroupNameSchema = z
	.string()
	.nonempty()
	.max(100)
	.regex(/^\S.*\S$|^\S$/, {
		message: 'Judge group name must not have leading or trailing whitespace'
	});

export const JudgeSchema = z.object({
	id: z.uuidv4(),
	name: JudgeNameSchema,
	groupId: z.uuidv4(),
	/**
	 * Where to email this judge their access link. Write-only through this schema.
	 *
	 * Three states, and the difference between two of them matters:
	 *
	 *   undefined — not mentioned; leave whatever is stored alone
	 *   null      — clear the stored address
	 *   a string  — set it
	 *
	 * `getJudges` deliberately does not select this column, so the judge list broadcast to
	 * every connected device carries no addresses. That is what makes `undefined` the
	 * common case: a client that read the list and sends it back must not wipe addresses
	 * it was never shown. Reading them back is Judge Advisor-only, via
	 * `access.listAccessLinks`.
	 */
	email: JudgeEmailSchema.nullable().optional()
});

export type Judge = z.infer<typeof JudgeSchema>;

export const JudgeGroupSchema = z.object({
	id: z.uuidv4(),
	name: JudgeGroupNameSchema,
	assignedTeams: z.array(z.uuidv4()) // Team IDs
});
export type JudgeGroup = z.infer<typeof JudgeGroupSchema>;
