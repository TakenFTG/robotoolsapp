import { buildClientRouter } from './client-router-def';
import { app, subscriptions } from './index.svelte';
import { refNotes } from './ref-notes.svelte';

export type { ClientRouter } from './client-router-def';

/**
 * Client router handlers — server can invoke these on this client.
 * Procedure shape lives in client-router-def.ts (shared with worker types).
 */
export const clientRouter = buildClientRouter({
	onEventSetupUpdate: (input) => {
		console.log(`📊 Event setup updated:`, input);
		app.handleEventSetupUpdate(input);
	},

	onDeviceListUpdate: (input) => {
		console.log(`📊 Device list updated:`, input);
		app.handleDeviceListUpdate(input);
	},

	onClientAuthenticationChange: (input) => {
		console.log(`🔐 Client authentication changed:`, input);
		app.handleClientAuthenticationChange(input);
	},

	onAllTeamDataUpdate: (input) => {
		console.log(`📊 Team data updated:`, input);
		app.handleAllTeamDataUpdate(input);
	},

	onTeamDataUpdate: (input) => {
		console.log(`📊 Team data updated:`, input);
		app.handleTeamDataUpdate(input);
	},

	onAllJudgesUpdate: (input) => {
		console.log(`📊 Judges updated:`, input);
		app.handleAllJudgesUpdate(input);
	},

	onAwardRankingsUpdate: (input) => {
		console.log(`📊 Award rankings partial updated:`, input);

		const awardRankings = subscriptions.allJudgeGroupsAwardRankings[input.judgeGroupId];

		if (input.judgeGroupId !== awardRankings?.judgeGroupId) {
			throw new Error('CRITICAL: Award rankings update for wrong judge group');
		}

		const index = awardRankings.judgedAwards.indexOf(input.awardName);
		if (index === -1) {
			throw new Error('CRITICAL: Award not found');
		}

		if (!awardRankings.rankings[input.teamId]) {
			awardRankings.rankings[input.teamId] = [];
		}

		awardRankings.rankings[input.teamId][index] = input.ranking;
	},

	onReviewedTeamsUpdate: (input) => {
		console.log(`📊 Reviewed teams updated:`, input);

		const reviewedTeams = subscriptions.allJudgeGroupsReviewedTeams[input.judgeGroupId];

		if (!reviewedTeams) {
			throw new Error('CRITICAL: This judge group is not subscribed to');
		}

		reviewedTeams.push(input.teamId);
	},

	onSubmissionCacheUpdate: (input) => {
		console.log(`📊 Submission cache updated:`, input);
		const uuid = input.tiId || input.enrId || input.tnId || 'null';
		subscriptions.allSubmissionCaches[uuid] = input;
	},

	onSubmissionRemoved: (input) => {
		console.log(`🗑️ Submission removed:`, input);
		// Keyed exactly as onSubmissionCacheUpdate files them, so the id the server sends is
		// the key to drop regardless of which of the three kinds it was.
		delete subscriptions.allSubmissionCaches[input.submissionId];
	},

	onReviewedTeamRemoved: (input) => {
		console.log(`📊 Reviewed team removed:`, input);

		const reviewedTeams = subscriptions.allJudgeGroupsReviewedTeams[input.judgeGroupId];
		// Unlike onReviewedTeamsUpdate this does not throw on an unsubscribed group. Arriving
		// late for a group this device no longer follows means there is nothing to remove,
		// which is the desired end state rather than an error.
		if (!reviewedTeams) {
			return;
		}

		const index = reviewedTeams.indexOf(input.teamId);
		if (index !== -1) {
			reviewedTeams.splice(index, 1);
		}
	},

	onFinalAwardNominationsUpdate: (input) => {
		console.log(`📊 Final award nominations updated:`, input);
		app.handleFinalAwardNominationsUpdate(input.awardName, input.nominations);
	},

	onAwardDeliberationStarted: () => {
		console.log(`🏆 Award deliberation started - opening award nomination tab`);

		const essData = app.getEssentialData();
		if (!essData) {
			throw new Error('CRITICAL: Essential data not found');
		}

		app.handleEssentialDataUpdate({ ...essData, judgingStep: 'award_deliberations' });
	},

	onTeamPhotoUpdate: (input) => {
		console.log(`📷 Team photo updated:`, input);
		if (input.action === 'added') {
			subscriptions.allTeamPhotos[input.photo.id] = input.photo;
		} else {
			delete subscriptions.allTeamPhotos[input.photoId];
		}
	},

	onRefNotesChanged: () => {
		refNotes.signal();
	}
});
