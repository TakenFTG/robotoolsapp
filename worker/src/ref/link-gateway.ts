import type { JudgeRefNote, JudgeRefNoteInput, RefLinkCodeResult, RefTeam } from '@robotools.app/protocol/src/ref';
import type { MatchSummary } from '@robotools.app/protocol/src/matches';

/**
 * The only ways between a Judges' Room and a ref room, held by the hub.
 *
 * Deliberately narrow, the same as the group gateways: a ref room can ask a linked Judges'
 * Room for its team list and schedule, and nothing else. No rubric, nomination, ranking,
 * note or photo is reachable through any of it.
 *
 * Locks only ever wait in one direction. A ref room may wait on a Judges' Room's lock, but a
 * Judges' Room never waits on a ref room's while holding its own: everything it sends that
 * way is fire-and-forget, except createRefRoom, createUnclaimedRefRoom and the note writes,
 * which run from requests that do not hold the room's lock at all.
 *
 * Two rooms each holding their own lock and waiting for the other's is a deadlock, and this
 * rule is what makes one impossible.
 */

/** What a link code opens: one division, or every division of an event group. */
export type RefLinkTarget = { scope: 'room'; roomId: string } | { scope: 'group'; roomId: string; groupId: string };

/** A Judges' Room's way out to ref rooms. Only createRefRoom waits, and never under the room's lock. */
export interface RefLinkGateway {
	createCode(target: RefLinkTarget): RefLinkCodeResult;
	/**
	 * Create a ref room already linked to these divisions, and email its link to the Head Ref.
	 * The one call here that waits: it must run without the calling room's lock held.
	 */
	createRefRoom(
		target: RefLinkTarget,
		headReferee: { name: string; email: string }
	): Promise<{ ok: true; sentTo: string } | { ok: false; error: string }>;
	/**
	 * Make a ref room for this division with no referees in it yet, and link it, so its Judge
	 * Advisors can write down what the refs tell them. Does nothing if the division is already
	 * linked. Waits: must run without the calling room's lock held, or be left to run alone.
	 */
	createUnclaimedRefRoom(judgesRoomId: string): Promise<{ ok: true } | { ok: false; error: string }>;
	/** Whether any ref can open this ref room. A plain read: no lock. */
	refsUsingApp(refRoomId: string): boolean;
	/**
	 * Save a note from this division's judging side in the linked ref room. `createOnly` is for
	 * judges, who may add but never change one. Waits on its lock: never call holding the room's.
	 */
	saveJudgeNote(
		refRoomId: string,
		judgesRoomId: string,
		input: JudgeRefNoteInput,
		authorName: string,
		options?: { createOnly?: boolean }
	): Promise<void>;
	/** Remove one, on the same terms. */
	removeJudgeNote(refRoomId: string, judgesRoomId: string, id: string): Promise<void>;
	/** Whether this server can send email at all. */
	emailEnabled(): boolean;
	/** Whether a ref room still exists. A file check: no lock. */
	refRoomExists(refRoomId: string): boolean;
	/** This division's teams changed; the linked ref room should reload them. */
	teamsChanged(refRoomId: string): void;
	/** This division unlinked itself; the ref room should drop it from its list. */
	divisionUnlinked(refRoomId: string, judgesRoomId: string): void;
	/** This division just joined an event group, which may already be linked. */
	joinedGroup(judgesRoomId: string, groupId: string): void;
	/**
	 * The ref notes this division may see, or null if the ref room no longer lists it.
	 * Waits on no lock: the ref room answers it as a plain read, so a Judges' Room asking
	 * while holding its own lock can never be caught waiting on a ref room.
	 */
	notes(refRoomId: string, judgesRoomId: string, teamNumbers: string[]): Promise<JudgeRefNote[] | null>;
}

export const noRefLinkGateway: RefLinkGateway = {
	createCode() {
		throw new Error('Referee notes are not available on this server');
	},
	createRefRoom: async () => ({ ok: false, error: 'Referee notes are not available on this server' }),
	createUnclaimedRefRoom: async () => ({ ok: false, error: 'Referee notes are not available on this server' }),
	refsUsingApp: () => false,
	saveJudgeNote: async () => {
		throw new Error('Referee notes are not available on this server');
	},
	removeJudgeNote: async () => {
		throw new Error('Referee notes are not available on this server');
	},
	emailEnabled: () => false,
	refRoomExists: () => false,
	teamsChanged: () => {},
	divisionUnlinked: () => {},
	joinedGroup: () => {},
	notes: async () => null
};

export type RedeemedDivision = { judgesRoomId: string; divisionId: number | null; label: string };

export type RedeemResult = { ok: true; divisions: RedeemedDivision[]; groupId: string | null } | { ok: false; error: string };

/** A ref room's way in to the Judges' Rooms linked to it. */
export interface JudgesLinkGateway {
	redeem(code: string, refRoomId: string, refEvent: { eventName: string; robotEventsEventId: number | null }): Promise<RedeemResult>;
	/** The division's teams, or null if it is gone or no longer linked to this ref room. */
	teams(judgesRoomId: string, refRoomId: string): Promise<RefTeam[] | null>;
	/** The division's schedule, or null as above. */
	matches(judgesRoomId: string, refRoomId: string): Promise<MatchSummary[] | null>;
	unlink(judgesRoomId: string, refRoomId: string): Promise<void>;
	/** Ref notes changed; tell this division's Judge Advisors to fetch them again. Fire-and-forget. */
	notesChanged(judgesRoomId: string, refRoomId: string): void;
}

export const noJudgesLinkGateway: JudgesLinkGateway = {
	redeem: async () => ({ ok: false, error: "Linking to Judges' Rooms is not available on this server" }),
	teams: async () => null,
	matches: async () => null,
	unlink: async () => {},
	notesChanged: () => {}
};
