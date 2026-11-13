import { getEssentialData, hasEssentialData, updateEssentialData } from './essential';
import type { WRPCRootObject } from '@robotools.app/wrpc/server';
import { getTeamData, updateTeamData } from './team';
import { getJudges, upsertJudge } from './judge';
import { broadcastDeviceListUpdate } from './device';
import type { ServerContext } from '../server-router';
import { offlineDevices } from '../db/schema';
import { transaction } from '../utils';
import { WRPCError } from '@robotools.app/wrpc/server/types';
import { getFinalAwardNominations } from './judging';
import {
	ClientAuthenticationSchema,
	JUDGE_ADVISOR_SINGLETON_ID,
	buildJudgesRoomJoinUrl,
	generateAuthToken,
	uncontrolledAuthentication
} from '@robotools.app/protocol/src/access';
import { JoiningKitSchema, StarterKitSchema, type JoiningKit, type RoomState, type StarterKit } from '@robotools.app/protocol/src/room';
import { assertAuthenticatedJudgeAdvisor, upsertJudgeAdvisorAuthToken } from '../access/tokens';
import { syncRoomRegistration } from '../admin/register';
import { buildAdvisorAccessLinkEmail } from '../email/template';
import { describeSmtpFailure } from '../email/smtp';

export { JoiningKitSchema, StarterKitSchema, type JoiningKit, type RoomState, type StarterKit };
export { RoomStateSchema } from '@robotools.app/protocol/src/room';

/**
 * Send the Judge Advisor their own link as the room is created.
 *
 * The one automatic send in the system, and narrowly scoped: one message, to an address
 * the recipient typed themselves moments earlier. It exists because a Judge Advisor who
 * closes the tab without saving the link may have no route back into their own event.
 *
 * Everything here is best-effort and swallowed. The event has already been created and
 * committed by this point; a mail server that is down, misconfigured or slow must not turn
 * a successful setup into an error the person cannot act on. They can resend from the
 * Users dialog, and the failure is in the server log for the operator.
 */
async function emailAdvisorTheirLink(ctx: ServerContext, input: StarterKit, authToken: string): Promise<void> {
	const email = input.judgeAdvisorEmail?.trim().toLowerCase();
	if (!email || !ctx.email.sender.enabled || !ctx.roomId) {
		return;
	}

	try {
		await ctx.email.sender.send(
			buildAdvisorAccessLinkEmail({
				to: email,
				advisorName: input.judgeAdvisorName ?? 'Judge Advisor',
				contextName: input.essentialData.eventName,
				link: buildJudgesRoomJoinUrl(ctx.email.publicOrigin, ctx.roomId, authToken),
				forGroup: false
			})
		);
	} catch (error) {
		console.error('Failed to email the Judge Advisor their access link:', describeSmtpFailure(error));
	}
}

export function buildHandshakeRoute(w: WRPCRootObject<object, ServerContext, Record<string, never>>) {
	return {
		joinJudgesRoom: w.procedure.output(JoiningKitSchema).mutation(async ({ ctx, session }) => {
			// Ask whether the room exists before reading it.
			//
			// getEssentialData throws a bare Error when there is no Metadata row, and wrpc
			// turns anything that is not a WRPCError into "Internal server error" with the
			// cause hidden. The old check here could never fire — getEssentialData throws
			// rather than returning null — so joining a room that does not exist looked like
			// a server fault, and the client kept a dead permit and retried it forever
			// instead of dropping it.
			if (!(await hasEssentialData(ctx.db))) {
				throw new WRPCError("Judges' Room not found");
			}

			const offlineDevice = {
				deviceId: session.currentClient.deviceId,
				deviceName: session.currentClient.deviceName,
				connectedAt: new Date()
			};

			// insert or update
			await ctx.db
				.insert(offlineDevices)
				.values(offlineDevice)
				.onConflictDoUpdate({
					target: [offlineDevices.deviceId],
					set: offlineDevice
				});

			// Broadcast client list update to all clients
			// Do not wait for the broadcast to complete
			broadcastDeviceListUpdate(ctx, session);

			return transaction(ctx.db, async (tx) => {
				return {
					essentialData: await getEssentialData(tx),
					teamData: await getTeamData(tx),
					judges: await getJudges(tx),
					finalAwardNominations: await getFinalAwardNominations(tx),
					authentication: ctx.auth.authentication
				};
			});
		}),

		createJudgesRoom: w.procedure
			.input(StarterKitSchema)
			.output(ClientAuthenticationSchema)
			.mutation(async ({ ctx, input, session }) => {
				const hasExistingEssentialData = await hasEssentialData(ctx.db);
				if (hasExistingEssentialData) {
					throw new WRPCError("Judges' Room already exists");
				}

				const judgeAdvisorAuthToken = generateAuthToken();

				const offlineDevice = {
					deviceId: session.currentClient.deviceId,
					deviceName: session.currentClient.deviceName,
					connectedAt: new Date()
				};

				// insert or update
				await ctx.db
					.insert(offlineDevices)
					.values(offlineDevice)
					.onConflictDoUpdate({
						target: [offlineDevices.deviceId],
						set: offlineDevice
					});

				// No need to broadcast device list update since it is a new Judges\' Room

				return transaction(ctx.db, async (tx) => {
					await updateEssentialData(tx, input.essentialData);

					await Promise.all(input.teamData.map((team) => updateTeamData(tx, team)));

					await Promise.all(input.judges.map((judge) => upsertJudge(tx, judge)));

					await upsertJudgeAdvisorAuthToken(
						tx,
						judgeAdvisorAuthToken,
						JUDGE_ADVISOR_SINGLETON_ID,
						input.judgeAdvisorName ?? 'Judge Advisor',
						input.judgeAdvisorEmail?.trim().toLowerCase() || null
					);

					const authentication = input.essentialData.accessControlEnabled
						? ({
								isAccessControlled: true,
								authToken: judgeAdvisorAuthToken,
								role: 'judge_advisor',
								judgeAdvisorId: JUDGE_ADVISOR_SINGLETON_ID
							} as const)
						: uncontrolledAuthentication;

					ctx.auth.setAuthentication(authentication);

					return authentication;
				}).then(async (authentication) => {
					// Announce the room to the operator's registry. Durable Objects cannot be
					// enumerated, so a room that never registers is one nobody can find. Done
					// after the transaction, and best-effort, so a registry problem can never
					// cost someone the event they just set up.
					await syncRoomRegistration(ctx);
					// Not awaited: it is best-effort and swallows its own failures, and waiting on
					// the mail server here held the new room's lock and delayed the Judge Advisor's
					// first screen by however long SMTP took.
					void emailAdvisorTheirLink(ctx, input, judgeAdvisorAuthToken);
					// A new event gets its own referee notes straight away, so its Judge Advisors can
					// write down what the refs tell them whether or not the refs use the app. Left to
					// run on its own: it takes this room's lock to record the link, and this request
					// holds it.
					if (ctx.roomId) {
						const roomId = ctx.roomId;
						void ctx.refLink
							.createUnclaimedRefRoom(roomId)
							.then((result) => {
								if (!result.ok) {
									console.warn('Could not create referee notes for a new event', roomId, result.error);
								}
							})
							.catch((error) => console.error('Failed to create referee notes for a new event', roomId, error));
					}
					return authentication;
				});
			}),

		leaveJudgesRoom: w.procedure.mutation(async ({ ctx, session }) => {
			// Same as kickDevice for this device: close every socket (including the leaver) and
			// forget OfflineDevices. leaveJudgesRoom is the self-service path (no JA check).
			await ctx.network.kickDevice(session.currentClient.deviceId);
			broadcastDeviceListUpdate(ctx, session);
		}),

		destroyJudgesRoom: w.procedure.mutation(async ({ ctx }) => {
			if (await ctx.network.isAccessControlEnabled()) {
				assertAuthenticatedJudgeAdvisor(ctx.auth);
			}

			await ctx.network.destroy();

			return { success: true, message: "Judges' Room destroyed" };
		})
	};
}
