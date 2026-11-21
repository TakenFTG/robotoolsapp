import type { TeamData, TeamScreening } from '@robotools.app/protocol/src/team';
import { TEAM_SCREENING_NOTE_MAX_LENGTH, TeamDataSchema, TeamScreeningSchema } from '@robotools.app/protocol/src/team';
import { WRPCError } from '@robotools.app/wrpc/server/types';
import type { WRPCRootObject } from '@robotools.app/wrpc/server';
import { teamScreenings, teams } from '../db/schema';
import type { DatabaseOrTransaction, ServerContext } from '../server-router';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { ClientRouter } from '../client-router';
import { transaction } from '../utils';
import type { AuditLogUpdate, AuditTeamField } from '@robotools.app/protocol/src/audit';
import { announceAudit, recordAudit, resolveAuditActor, sessionDevice, writeAudit, type AuditSession } from '../audit/log';
import type { Authentication } from '../access/authentication';
import type { Transaction } from '../server-router';

export async function getTeamData(db: DatabaseOrTransaction): Promise<TeamData[]> {
	return db
		.select({
			id: teams.id,
			notebookLink: teams.notebookLink,
			hasInnovateAwardSubmissionForm: teams.hasInnovateAwardSubmissionForm,
			notebookDevelopmentStatus: teams.notebookDevelopmentStatus,
			hasSeasonSummary: teams.hasSeasonSummary,
			absent: teams.absent
		})
		.from(teams) as Promise<TeamData[]>;
}

export async function updateTeamData(db: DatabaseOrTransaction, teamData: TeamData): Promise<void> {
	await db.update(teams).set(teamData).where(eq(teams.id, teamData.id));
}

export async function getTeamScreenings(db: DatabaseOrTransaction): Promise<TeamScreening[]> {
	return db.select().from(teamScreenings);
}

const AUDITED_TEAM_FIELDS: readonly AuditTeamField[] = [
	'hasSeasonSummary',
	'notebookDevelopmentStatus',
	'notebookLink',
	'hasInnovateAwardSubmissionForm',
	'absent'
];

/**
 * Write team data and record each field that actually changed.
 *
 * A client always sends the whole record, so ticking Season Summary arrives looking the
 * same as editing the notebook link. Comparing against what is stored is the only way to
 * say which one happened, and it keeps a save that changed nothing out of the log.
 */
async function updateTeamDataWithAudit(
	tx: Transaction,
	auth: Authentication,
	session: AuditSession,
	updates: readonly TeamData[]
): Promise<AuditLogUpdate[]> {
	if (updates.length === 0) {
		return [];
	}

	const ids = updates.map((teamData) => teamData.id);
	const current = new Map((await getTeamData(tx)).filter((team) => ids.includes(team.id)).map((team) => [team.id, team]));
	const actor = await resolveAuditActor(tx, auth);
	const device = sessionDevice(session);
	const audits: AuditLogUpdate[] = [];

	for (const teamData of updates) {
		const before = current.get(teamData.id);
		await tx.update(teams).set(teamData).where(eq(teams.id, teamData.id));
		if (!before) {
			continue;
		}
		for (const field of AUDITED_TEAM_FIELDS) {
			if (before[field] !== teamData[field]) {
				audits.push(
					await writeAudit(tx, actor, device, {
						action: 'team_data_changed',
						teamId: teamData.id,
						details: { field, before: before[field], after: teamData[field] },
						// Typing a notebook link is one change, not one per keystroke saved.
						coalesceKey: field === 'notebookLink' ? `team:${teamData.id}:notebookLink` : undefined
					})
				);
			}
		}
	}

	return audits;
}

export function buildTeamRoute(w: WRPCRootObject<object, ServerContext, Record<string, never>>) {
	return {
		getTeamData: w.procedure.output(z.array(TeamDataSchema)).query(async ({ ctx }) => {
			return getTeamData(ctx.db);
		}),
		updateTeamData: w.procedure.input(TeamDataSchema).mutation(async ({ ctx, input, session }) => {
			const audits = await transaction(ctx.db, (tx) => updateTeamDataWithAudit(tx, ctx.auth, session, [input]));
			announceAudit(ctx.db, session, audits);
			// Do not wait for the broadcast to complete
			session.broadcast<ClientRouter>().onTeamDataUpdate.mutation(input);
		}),
		updateAllTeamData: w.procedure.input(z.array(TeamDataSchema)).mutation(async ({ ctx, input, session }) => {
			const audits = await transaction(ctx.db, (tx) => updateTeamDataWithAudit(tx, ctx.auth, session, input));
			announceAudit(ctx.db, session, audits);
			// Do not wait for the broadcast to complete
			getTeamData(ctx.db).then((teamData) => {
				session.broadcast<ClientRouter>().onAllTeamDataUpdate.mutation(teamData);
			});
		}),

		getTeamScreenings: w.procedure.output(z.array(TeamScreeningSchema)).query(async ({ ctx }) => {
			return getTeamScreenings(ctx.db);
		}),

		/** Flag a team for a second interview or further discussion, or change the reason. */
		flagTeamForScreening: w.procedure
			.input(z.object({ teamId: z.uuidv4(), note: z.string().max(TEAM_SCREENING_NOTE_MAX_LENGTH) }))
			.mutation(async ({ ctx, input, session }) => {
				const [team] = await ctx.db.select({ id: teams.id }).from(teams).where(eq(teams.id, input.teamId)).limit(1);
				if (!team) {
					throw new WRPCError('CRITICAL: Team not found');
				}

				const screening = { teamId: input.teamId, note: input.note.trim(), updatedAt: Date.now() };
				const audit = await transaction(ctx.db, async (tx) => {
					await tx
						.insert(teamScreenings)
						.values(screening)
						.onConflictDoUpdate({ target: [teamScreenings.teamId], set: { note: screening.note, updatedAt: screening.updatedAt } });
					return recordAudit(tx, ctx.auth, session, { action: 'team_flagged', teamId: input.teamId, details: { note: screening.note } });
				});
				announceAudit(ctx.db, session, [audit]);

				// Do not wait for the broadcast to complete
				session.broadcast<ClientRouter>().onTeamScreeningUpdate.mutation({ teamId: input.teamId, screening });
			}),

		clearTeamScreening: w.procedure.input(z.object({ teamId: z.uuidv4() })).mutation(async ({ ctx, input, session }) => {
			const audit = await transaction(ctx.db, async (tx) => {
				const deleted = await tx.delete(teamScreenings).where(eq(teamScreenings.teamId, input.teamId)).returning();
				return deleted.length > 0 ? recordAudit(tx, ctx.auth, session, { action: 'team_unflagged', teamId: input.teamId }) : null;
			});
			if (audit) {
				announceAudit(ctx.db, session, [audit]);
			}

			// Do not wait for the broadcast to complete
			session.broadcast<ClientRouter>().onTeamScreeningUpdate.mutation({ teamId: input.teamId, screening: null });
		})
	};
}
