import type { DatabaseOrTransaction, ServerContext } from '../server-router';
import z from 'zod';
import {
	AwardNominationSchema,
	AwardRankingsFullUpdateSchema,
	EngineeringNotebookRubricSchema,
	SubmissionCacheSchema,
	TeamInterviewNoteSchema,
	TeamInterviewRubricSchema,
	sumRubricScores
} from '@robotools.app/protocol/src/rubric';
import type {
	AwardNomination,
	AwardRankingsFullUpdate,
	EngineeringNotebookRubric,
	SubmissionCache,
	TeamInterviewNote,
	TeamInterviewRubric
} from '@robotools.app/protocol/src/rubric';
import { eq, desc, and, asc } from 'drizzle-orm';
import {
	awardRankings,
	engineeringNotebookRubrics,
	finalAwardNominations,
	judgeGroupsReviewedTeams,
	judgeGroupsSubmissionsCache,
	teamInterviewNotes,
	teamInterviewRubrics,
	metadata
} from '../db/schema';
import { assertAuthenticatedJudgeAdvisor, assertAuthorship } from '../access/tokens';
import { WRPCError } from '@robotools.app/wrpc/server/types';
import { AwardNameSchema, isExcellenceAward } from '@robotools.app/protocol/src/award';
import { RankSchema } from '@robotools.app/protocol/src/rubric';
import type { RouterBroadcastProxy, WRPCRootObject } from '@robotools.app/wrpc/server';
import { broadcastJudgeGroupTopic, subscribeJudgeGroupTopic, unsubscribeTopic, type ClientSource } from './subscriptions';
import { transaction } from '../utils';
import { getAwards } from './essential';
import type { ClientRouter } from '../client-router';

/**
 * Remove one submission, and the team's reviewed mark if that was the last of them.
 *
 * Shared by the notebook and interview deletes, which differ only in the table and the
 * cache column.
 *
 * The cache row is deleted explicitly rather than left to the `onDelete: 'cascade'`
 * reference JudgeGroupsSubmissionsCache holds. The cascade is real in production, where
 * `foreign_keys = ON` is set when a room is opened — but it is not set on the in-memory
 * database the tests use, so relying on it would mean the delete behaved one way under
 * test and another in front of judges. Doing it here costs one statement and removes the
 * difference.
 *
 * The reviewed mark is a judge group's record that it has looked at a team, and it is what
 * the progress counters and the "only show interviewed teams" filter read. Deleting the
 * last submission a group holds for a team therefore has to clear it, or a team with
 * nothing left still reads as done.
 *
 * The remaining-rows check runs inside the transaction, after the delete. Outside it, two
 * advisors deleting the last two submissions at once could each see the other's row and
 * leave the team marked reviewed with nothing behind it.
 *
 * Returns what the caller needs to announce, or null if the id matched nothing — deleting
 * something already deleted is not an error worth raising at someone.
 */
async function deleteSubmission(
	db: DatabaseOrTransaction,
	table: typeof engineeringNotebookRubrics | typeof teamInterviewRubrics,
	submissionId: string
): Promise<{ judgeGroupId: string; teamId: string; teamNoLongerReviewed: boolean } | null> {
	return transaction(db, async (tx) => {
		// Read the cache row first: it is the only place the judge group is recorded, and it
		// is about to be cascaded away.
		const [cached] = await tx
			.select()
			.from(judgeGroupsSubmissionsCache)
			.where(
				table === engineeringNotebookRubrics
					? eq(judgeGroupsSubmissionsCache.enrId, submissionId)
					: eq(judgeGroupsSubmissionsCache.tiId, submissionId)
			)
			.limit(1);

		const deleted = await tx.delete(table).where(eq(table.id, submissionId)).returning();
		if (deleted.length === 0 || !cached) {
			return null;
		}

		await tx
			.delete(judgeGroupsSubmissionsCache)
			.where(
				table === engineeringNotebookRubrics
					? eq(judgeGroupsSubmissionsCache.enrId, submissionId)
					: eq(judgeGroupsSubmissionsCache.tiId, submissionId)
			);

		const remaining = await tx
			.select({ teamId: judgeGroupsSubmissionsCache.teamId })
			.from(judgeGroupsSubmissionsCache)
			.where(and(eq(judgeGroupsSubmissionsCache.judgeGroupId, cached.judgeGroupId), eq(judgeGroupsSubmissionsCache.teamId, cached.teamId)))
			.limit(1);

		const teamNoLongerReviewed = remaining.length === 0;
		if (teamNoLongerReviewed) {
			await tx
				.delete(judgeGroupsReviewedTeams)
				.where(and(eq(judgeGroupsReviewedTeams.judgeGroupId, cached.judgeGroupId), eq(judgeGroupsReviewedTeams.teamId, cached.teamId)));
		}

		return { judgeGroupId: cached.judgeGroupId, teamId: cached.teamId, teamNoLongerReviewed };
	});
}

/**
 * Tell the judge group a submission is gone.
 *
 * Two messages rather than one, on the two topics the removal touches, because a device
 * subscribes to `submissions` and `reviewedTeams` independently — one combined message
 * would hand a device state it does not hold. Neither is awaited, matching the write path:
 * the delete has already committed, and a slow socket must not hold up the reply.
 */
function announceSubmissionRemoval(
	ctx: ServerContext,
	session: ClientSource,
	removed: { judgeGroupId: string; teamId: string; teamNoLongerReviewed: boolean },
	submissionId: string
): void {
	broadcastJudgeGroupTopic(ctx.db, removed.judgeGroupId, 'submissions', session, async (client) =>
		client.onSubmissionRemoved.mutation({ judgeGroupId: removed.judgeGroupId, teamId: removed.teamId, submissionId })
	);

	if (removed.teamNoLongerReviewed) {
		broadcastJudgeGroupTopic(ctx.db, removed.judgeGroupId, 'reviewedTeams', session, async (client) =>
			client.onReviewedTeamRemoved.mutation({ judgeGroupId: removed.judgeGroupId, teamId: removed.teamId })
		);
	}
}

/** Conflict update skipped (setWhere false) → not the same author. */
function requireAuthoredUpsert<T>(row: T | undefined): T {
	if (!row) {
		throw new WRPCError('You can only edit rubrics you authored');
	}
	return row;
}

export async function getAwardRankings(db: DatabaseOrTransaction, judgeGroupId: string): Promise<AwardRankingsFullUpdate> {
	const { judgedAwards, rankingsData } = await transaction(db, async (tx) => {
		const judgedAwards = (await getAwards(tx, 'judged')).map((award) => award.name).filter((award) => !isExcellenceAward(award));
		const rankingsData = await tx.select().from(awardRankings).where(eq(awardRankings.judgeGroupId, judgeGroupId));
		return { judgedAwards, rankingsData };
	});

	const allTeams = rankingsData.map((ranking) => ranking.teamId);

	const rankings = allTeams.reduce(
		(acc, teamId) => {
			acc[teamId] = new Array(judgedAwards.length).fill(0);
			return acc;
		},
		{} as Record<string, number[]>
	);

	for (const ranking of rankingsData) {
		rankings[ranking.teamId][judgedAwards.indexOf(ranking.awardName)] = ranking.ranking;
	}

	const rtn: AwardRankingsFullUpdate = {
		judgeGroupId,
		judgedAwards,
		rankings
	};
	return rtn;
}

export async function getReviewedTeams(db: DatabaseOrTransaction, judgeGroupId: string): Promise<string[]> {
	const result = await db.select().from(judgeGroupsReviewedTeams).where(eq(judgeGroupsReviewedTeams.judgeGroupId, judgeGroupId));
	return result.map((row) => row.teamId);
}

export async function addReviewedTeam(db: DatabaseOrTransaction, judgeGroupId: string, teamId: string): Promise<boolean> {
	const result = await db.insert(judgeGroupsReviewedTeams).values({ judgeGroupId, teamId }).onConflictDoNothing().returning();
	return result.length > 0;
}

export async function getSubmissionCaches(db: DatabaseOrTransaction, judgeGroupId: string): Promise<SubmissionCache[]> {
	const result = await db.select().from(judgeGroupsSubmissionsCache).where(eq(judgeGroupsSubmissionsCache.judgeGroupId, judgeGroupId));
	return result;
}

export async function getFinalAwardNominations(tx: DatabaseOrTransaction): Promise<Record<string, AwardNomination[]>> {
	const result = await tx.select().from(finalAwardNominations);
	const rtn = {} as Record<string, AwardNomination[]>;
	for (const row of result) {
		if (!rtn[row.awardName]) {
			rtn[row.awardName] = [];
		}
		rtn[row.awardName].push({ teamId: row.teamId, judgeGroupId: row.judgeGroupId });
	}
	return rtn;
}

export async function getFinalAwardNominationsForAward(tx: DatabaseOrTransaction, awardName: string): Promise<AwardNomination[]> {
	const result = await tx
		.select({ teamId: finalAwardNominations.teamId, judgeGroupId: finalAwardNominations.judgeGroupId })
		.from(finalAwardNominations)
		.where(eq(finalAwardNominations.awardName, awardName))
		.orderBy(asc(finalAwardNominations.ranking));
	return result;
}

export function broadcastFinalAwardNominationsUpdate(
	tx: DatabaseOrTransaction,
	awardName: string,
	broadcast: RouterBroadcastProxy<ClientRouter>
) {
	getFinalAwardNominationsForAward(tx, awardName).then((nominations) => {
		broadcast.onFinalAwardNominationsUpdate.mutation({ awardName, nominations });
	});
}

export function buildJudgingRoute(w: WRPCRootObject<object, ServerContext, Record<string, never>>) {
	return {
		completeEngineeringNotebookRubric: w.procedure
			.input(
				z.object({
					judgeGroupId: z.uuidv4(),
					submission: EngineeringNotebookRubricSchema
				})
			)
			.mutation(async ({ ctx, input, session }) => {
				assertAuthorship(ctx.auth, input.submission.judgeId);

				// insert or update (setWhere keeps judgeId sticky / blocks foreign overwrite)
				const { submissionCache, isReviewedNewTeam } = await transaction(ctx.db, async (tx) => {
					requireAuthoredUpsert(
						(
							await tx
								.insert(engineeringNotebookRubrics)
								.values(input.submission)
								.onConflictDoUpdate({
									target: [engineeringNotebookRubrics.id],
									setWhere: eq(engineeringNotebookRubrics.judgeId, input.submission.judgeId),
									set: input.submission
								})
								.returning()
						)[0]
					);

					const submissionCache = (
						await tx
							.insert(judgeGroupsSubmissionsCache)
							.values({
								judgeGroupId: input.judgeGroupId,
								teamId: input.submission.teamId,
								judgeId: input.submission.judgeId,
								timestamp: input.submission.timestamp,
								enrId: input.submission.id,
								tiId: null,
								tnId: null,
								score: sumRubricScores(input.submission.rubric)
							})
							.onConflictDoUpdate({
								target: [judgeGroupsSubmissionsCache.enrId, judgeGroupsSubmissionsCache.tiId, judgeGroupsSubmissionsCache.tnId],
								set: {
									judgeGroupId: input.judgeGroupId,
									teamId: input.submission.teamId,
									judgeId: input.submission.judgeId,
									timestamp: input.submission.timestamp,
									score: sumRubricScores(input.submission.rubric)
								}
							})
							.returning()
					)[0];

					const isReviewedNewTeam = await addReviewedTeam(tx, input.judgeGroupId, input.submission.teamId);
					return { submissionCache, isReviewedNewTeam };
				});
				// Do not wait for the broadcast to complete
				broadcastJudgeGroupTopic(ctx.db, input.judgeGroupId, 'submissions', session, async (client) =>
					client.onSubmissionCacheUpdate.mutation(submissionCache)
				);
				if (isReviewedNewTeam) {
					// Do not wait for the broadcast to complete
					broadcastJudgeGroupTopic(ctx.db, input.judgeGroupId, 'reviewedTeams', session, async (client) =>
						client.onReviewedTeamsUpdate.mutation({ judgeGroupId: input.judgeGroupId, teamId: input.submission.teamId })
					);
				}
			}),

		/**
		 * Discard a submitted rubric.
		 *
		 * Judge Advisor only, and deliberately not extended to the judge who wrote it. A
		 * judge who made a mistake can edit their own rubric, which is recoverable; deleting
		 * is not, and it sits with the same person who can destroy the event and export the
		 * record. The `assertAuthorship` used by the write path is the wrong check here —
		 * that one asks "is this yours", and the answer for an advisor is always no.
		 *
		 * Silent about an id that matches nothing. Two advisors clearing the same duplicate
		 * is not a failure, and the end state is what they both wanted.
		 */
		deleteEngineeringNotebookRubric: w.procedure.input(z.object({ id: z.uuidv4() })).mutation(async ({ ctx, input, session }) => {
			assertAuthenticatedJudgeAdvisor(ctx.auth);

			const removed = await deleteSubmission(ctx.db, engineeringNotebookRubrics, input.id);
			if (!removed) {
				return;
			}

			announceSubmissionRemoval(ctx, session, removed, input.id);
		}),

		deleteTeamInterviewRubric: w.procedure.input(z.object({ id: z.uuidv4() })).mutation(async ({ ctx, input, session }) => {
			assertAuthenticatedJudgeAdvisor(ctx.auth);

			const removed = await deleteSubmission(ctx.db, teamInterviewRubrics, input.id);
			if (!removed) {
				return;
			}

			announceSubmissionRemoval(ctx, session, removed, input.id);
		}),

		getEngineeringNotebookRubrics: w.procedure
			.input(z.object({ id: z.uuidv4() }))
			.output(EngineeringNotebookRubricSchema)
			.query(async ({ ctx, input }) => {
				const result = await ctx.db.select().from(engineeringNotebookRubrics).where(eq(engineeringNotebookRubrics.id, input.id));
				return result[0] as EngineeringNotebookRubric;
			}),

		completeTeamInterviewRubric: w.procedure
			.input(
				z.object({
					judgeGroupId: z.uuidv4(),
					submission: TeamInterviewRubricSchema
				})
			)
			.mutation(async ({ ctx, input, session }) => {
				assertAuthorship(ctx.auth, input.submission.judgeId);

				const { submissionCache, isReviewedNewTeam } = await transaction(ctx.db, async (tx) => {
					requireAuthoredUpsert(
						(
							await tx
								.insert(teamInterviewRubrics)
								.values(input.submission)
								.onConflictDoUpdate({
									target: [teamInterviewRubrics.id],
									setWhere: eq(teamInterviewRubrics.judgeId, input.submission.judgeId),
									set: input.submission
								})
								.returning()
						)[0]
					);
					const submissionCache = (
						await tx
							.insert(judgeGroupsSubmissionsCache)
							.values({
								judgeGroupId: input.judgeGroupId,
								teamId: input.submission.teamId,
								judgeId: input.submission.judgeId,
								timestamp: input.submission.timestamp,
								enrId: null,
								tiId: input.submission.id,
								tnId: null,
								score: sumRubricScores(input.submission.rubric)
							})
							.onConflictDoUpdate({
								target: [judgeGroupsSubmissionsCache.enrId, judgeGroupsSubmissionsCache.tiId, judgeGroupsSubmissionsCache.tnId],
								set: {
									judgeGroupId: input.judgeGroupId,
									teamId: input.submission.teamId,
									judgeId: input.submission.judgeId,
									timestamp: input.submission.timestamp,
									score: sumRubricScores(input.submission.rubric)
								}
							})
							.returning()
					)[0];
					const isReviewedNewTeam = await addReviewedTeam(tx, input.judgeGroupId, input.submission.teamId);
					return { submissionCache, isReviewedNewTeam };
				});
				// Do not wait for the broadcast to complete
				broadcastJudgeGroupTopic(ctx.db, input.judgeGroupId, 'submissions', session, async (client) =>
					client.onSubmissionCacheUpdate.mutation(submissionCache)
				);
				if (isReviewedNewTeam) {
					// Do not wait for the broadcast to complete
					broadcastJudgeGroupTopic(ctx.db, input.judgeGroupId, 'reviewedTeams', session, async (client) =>
						client.onReviewedTeamsUpdate.mutation({ judgeGroupId: input.judgeGroupId, teamId: input.submission.teamId })
					);
				}
			}),

		getTeamInterviewRubrics: w.procedure
			.input(z.object({ id: z.uuidv4() }))
			.output(TeamInterviewRubricSchema)
			.query(async ({ ctx, input }) => {
				const result = await ctx.db.select().from(teamInterviewRubrics).where(eq(teamInterviewRubrics.id, input.id));
				return result[0] as TeamInterviewRubric;
			}),

		completeTeamInterviewNote: w.procedure
			.input(
				z.object({
					judgeGroupId: z.uuidv4(),
					submission: TeamInterviewNoteSchema
				})
			)
			.mutation(async ({ ctx, input, session }) => {
				assertAuthorship(ctx.auth, input.submission.judgeId);

				const { submissionCache, isReviewedNewTeam } = await transaction(ctx.db, async (tx) => {
					requireAuthoredUpsert(
						(
							await tx
								.insert(teamInterviewNotes)
								.values(input.submission)
								.onConflictDoUpdate({
									target: [teamInterviewNotes.id],
									setWhere: eq(teamInterviewNotes.judgeId, input.submission.judgeId),
									set: input.submission
								})
								.returning()
						)[0]
					);
					const submissionCache = (
						await tx
							.insert(judgeGroupsSubmissionsCache)
							.values({
								judgeGroupId: input.judgeGroupId,
								teamId: input.submission.teamId,
								judgeId: input.submission.judgeId,
								timestamp: input.submission.timestamp,
								enrId: null,
								tiId: input.submission.id,
								tnId: null,
								score: null
							})
							.onConflictDoUpdate({
								target: [judgeGroupsSubmissionsCache.enrId, judgeGroupsSubmissionsCache.tiId, judgeGroupsSubmissionsCache.tnId],
								set: {
									judgeGroupId: input.judgeGroupId,
									teamId: input.submission.teamId,
									judgeId: input.submission.judgeId,
									timestamp: input.submission.timestamp
								}
							})
							.returning()
					)[0];
					const isReviewedNewTeam = await addReviewedTeam(tx, input.judgeGroupId, input.submission.teamId);
					return { submissionCache, isReviewedNewTeam };
				});
				// Do not wait for the broadcast to complete
				broadcastJudgeGroupTopic(ctx.db, input.judgeGroupId, 'submissions', session, async (client) =>
					client.onSubmissionCacheUpdate.mutation(submissionCache)
				);
				if (isReviewedNewTeam) {
					// Do not wait for the broadcast to complete
					broadcastJudgeGroupTopic(ctx.db, input.judgeGroupId, 'reviewedTeams', session, async (client) =>
						client.onReviewedTeamsUpdate.mutation({ judgeGroupId: input.judgeGroupId, teamId: input.submission.teamId })
					);
				}
			}),

		getTeamInterviewNote: w.procedure
			.input(z.object({ id: z.uuidv4() }))
			.output(TeamInterviewNoteSchema)
			.query(async ({ ctx, input }) => {
				const result = await ctx.db.select().from(teamInterviewNotes).where(eq(teamInterviewNotes.id, input.id));
				return result[0] as TeamInterviewNote;
			}),

		subscribeReviewedTeams: w.procedure
			.input(z.object({ judgeGroupIds: z.array(z.uuidv4()), exclusive: z.boolean() }))
			.output(z.array(z.object({ judgeGroupId: z.uuidv4(), teamIds: z.array(z.uuidv4()) })))
			.mutation(async ({ ctx, input, session }) => {
				return transaction(ctx.db, async (tx) => {
					await subscribeJudgeGroupTopic(tx, session.currentClient.clientId, input.judgeGroupIds, 'reviewedTeams', input.exclusive);
					return Promise.all(
						input.judgeGroupIds.map(async (judgeGroupId) => ({
							judgeGroupId,
							teamIds: await getReviewedTeams(tx, judgeGroupId)
						}))
					);
				});
			}),

		unsubscribeReviewedTeams: w.procedure.mutation(async ({ ctx, session }) => {
			return unsubscribeTopic(ctx.db, session.currentClient.clientId, 'reviewedTeams');
		}),

		updateAwardRanking: w.procedure
			.input(z.object({ judgeGroupId: z.uuidv4(), teamId: z.uuidv4(), awardName: AwardNameSchema, ranking: RankSchema }))
			.mutation(async ({ ctx, input, session }) => {
				// insert or update
				await ctx.db
					.insert(awardRankings)
					.values(input)
					.onConflictDoUpdate({
						target: [awardRankings.judgeGroupId, awardRankings.awardName, awardRankings.teamId],
						set: input
					});

				broadcastJudgeGroupTopic(ctx.db, input.judgeGroupId, 'awardRankings', session, async (client) =>
					client.onAwardRankingsUpdate.mutation(input)
				);
			}),

		subscribeAwardRankings: w.procedure
			.input(z.object({ judgeGroupIds: z.array(z.uuidv4()), exclusive: z.boolean() }))
			.output(z.array(AwardRankingsFullUpdateSchema))
			.mutation(async ({ ctx, input, session }) => {
				return transaction(ctx.db, async (tx) => {
					await subscribeJudgeGroupTopic(tx, session.currentClient.clientId, input.judgeGroupIds, 'awardRankings', input.exclusive);
					return Promise.all(input.judgeGroupIds.map((judgeGroupId) => getAwardRankings(tx, judgeGroupId)));
				});
			}),

		unsubscribeAwardRankings: w.procedure.mutation(async ({ ctx, session }) => {
			return unsubscribeTopic(ctx.db, session.currentClient.clientId, 'awardRankings');
		}),

		subscribeSubmissionCaches: w.procedure
			.input(z.object({ judgeGroupIds: z.array(z.uuidv4()), exclusive: z.boolean() }))
			.output(z.array(SubmissionCacheSchema))
			.mutation(async ({ ctx, input, session }) => {
				return transaction(ctx.db, async (tx) => {
					await subscribeJudgeGroupTopic(tx, session.currentClient.clientId, input.judgeGroupIds, 'submissions', input.exclusive);
					return Promise.all(input.judgeGroupIds.map((judgeGroupId) => getSubmissionCaches(tx, judgeGroupId))).then((submissionCaches) => {
						return submissionCaches.flat();
					});
				});
			}),

		unsubscribeSubmissionCaches: w.procedure.mutation(async ({ ctx, session }) => {
			return unsubscribeTopic(ctx.db, session.currentClient.clientId, 'submissions');
		}),

		nominateFinalAward: w.procedure
			.input(z.object({ awardName: AwardNameSchema, teamId: z.uuidv4(), judgeGroupId: z.uuidv4().nullable() }))
			.mutation(async ({ ctx, input, session }) => {
				await transaction(ctx.db, async (tx) => {
					const lastRanking =
						(
							await tx
								.select({ ranking: finalAwardNominations.ranking })
								.from(finalAwardNominations)
								.where(eq(finalAwardNominations.awardName, input.awardName))
								.orderBy(desc(finalAwardNominations.ranking))
								.limit(1)
						)[0]?.ranking ?? -1;
					await tx
						.insert(finalAwardNominations)
						.values({ ...input, ranking: lastRanking + 1 })
						.onConflictDoNothing();
				});

				// Do not wait for the broadcast to complete
				broadcastFinalAwardNominationsUpdate(ctx.db, input.awardName, session.broadcast<ClientRouter>());
			}),

		removeFromFinalAwardNominations: w.procedure
			.input(z.object({ awardName: AwardNameSchema, teamId: z.uuidv4() }))
			.mutation(async ({ ctx, input, session }) => {
				await transaction(ctx.db, async (tx) => {
					await tx
						.delete(finalAwardNominations)
						.where(and(eq(finalAwardNominations.awardName, input.awardName), eq(finalAwardNominations.teamId, input.teamId)));
				});

				// Do not wait for the broadcast to complete
				broadcastFinalAwardNominationsUpdate(ctx.db, input.awardName, session.broadcast<ClientRouter>());
			}),

		updateFinalRankings: w.procedure
			.input(z.object({ awardName: AwardNameSchema, nominations: z.array(AwardNominationSchema) }))
			.mutation(async ({ ctx, input, session }) => {
				// remove all existing rankings for the award, transactionally
				await transaction(ctx.db, async (tx) => {
					await tx.delete(finalAwardNominations).where(eq(finalAwardNominations.awardName, input.awardName));
					for (let i = 0; i < input.nominations.length; i++) {
						await tx.insert(finalAwardNominations).values({
							awardName: input.awardName,
							ranking: i,
							teamId: input.nominations[i].teamId,
							judgeGroupId: input.nominations[i].judgeGroupId
						});
					}
				});

				// Do not wait for the broadcast to complete
				broadcastFinalAwardNominationsUpdate(ctx.db, input.awardName, session.broadcast<ClientRouter>());
			}),

		startAwardDeliberation: w.procedure.mutation(async ({ ctx, session }) => {
			// Update the judging step to 'award_deliberations' in the event metadata
			await ctx.db.update(metadata).set({ judgingStep: 'award_deliberations' });

			// Do not wait for the broadcast to complete
			session.broadcast<ClientRouter>().onAwardDeliberationStarted.mutation();
		})
	};
}
