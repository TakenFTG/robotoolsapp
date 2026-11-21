import type { WRPCRootObject } from '@robotools.app/wrpc/server';
import { AuditLogPageSchema, AuditLogQuerySchema } from '@robotools.app/protocol/src/audit';
import type { ServerContext } from '../server-router';
import { assertAuthenticatedJudgeAdvisor } from '../access/tokens';
import { AUDIT_LOG_TOPIC, getAuditLog } from '../audit/log';
import { subscribeTopic, unsubscribeTopic } from './subscriptions';

/**
 * Judge Advisors only, when the room can tell who that is.
 *
 * With access control off anyone may work as the Judge Advisor, and the log says as much
 * about every entry, so there is nothing to keep from them that the rest of the room is
 * not already open about.
 */
async function assertCanReadAuditLog(ctx: ServerContext): Promise<void> {
	if (await ctx.network.isAccessControlEnabled()) {
		assertAuthenticatedJudgeAdvisor(ctx.auth);
	}
}

export function buildAuditRoute(w: WRPCRootObject<object, ServerContext, Record<string, never>>) {
	return {
		getAuditLog: w.procedure
			.input(AuditLogQuerySchema)
			.output(AuditLogPageSchema)
			.query(async ({ ctx, input }) => {
				await assertCanReadAuditLog(ctx);
				return getAuditLog(ctx.db, input);
			}),

		/** Start receiving new entries as they are written. */
		subscribeAuditLog: w.procedure.mutation(async ({ ctx, session }) => {
			await assertCanReadAuditLog(ctx);
			await subscribeTopic(ctx.db, session.currentClient.clientId, AUDIT_LOG_TOPIC);
		}),

		unsubscribeAuditLog: w.procedure.mutation(async ({ ctx, session }) => {
			await unsubscribeTopic(ctx.db, session.currentClient.clientId, AUDIT_LOG_TOPIC);
		})
	};
}
