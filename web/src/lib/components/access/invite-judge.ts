import { app, dialogs } from '$lib/index.svelte';
import AccessLinkDialog from './AccessLinkDialog.svelte';
import AddJudgeDialog from './AddJudgeDialog.svelte';

type AddedJudge = Awaited<ReturnType<typeof app.addJudge>>;

/**
 * Add a judge, then go straight to their QR code, link and email button.
 *
 * Returns whether a judge was added, so a list on screen knows to reload.
 */
export async function addAndInviteJudge(groupId?: string): Promise<boolean> {
	const added = (await dialogs.showCustom(AddJudgeDialog, { props: { groupId } })) as AddedJudge | undefined;
	if (!added) return false;

	const { judge, authToken, emailEnabled } = added;
	await dialogs.showCustom(AccessLinkDialog, {
		props: {
			link: app.getJudgesRoomUrl(authToken),
			name: judge.name,
			emailTo: emailEnabled && judge.email ? { judgeId: judge.id, address: judge.email } : undefined
		},
		maxWidth: 'max-w-xl'
	});
	return true;
}
