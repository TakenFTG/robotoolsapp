import {
	CreatePhotoUploadInputSchema,
	CreatePhotoUploadResultSchema,
	MAX_PHOTO_BYTES,
	MAX_PHOTOS_PER_ROOM,
	MAX_PHOTOS_PER_TEAM,
	PhotoContentTypeSchema,
	TeamPhotoSchema,
	detectPhotoContentType,
	type PhotoContentType,
	type TeamPhoto
} from '@robotools.app/protocol/src/media';
import type { WRPCRootObject } from '@robotools.app/wrpc/server';
import { count, eq, lt } from 'drizzle-orm';
import { z } from 'zod';
import type { ClientRouter } from '../client-router';
import { assertAuthorship } from '../access/tokens';
import { pendingPhotoUploads, teamPhotos, teams } from '../db/schema';
import { PHOTO_CACHE_MAX_AGE_SECONDS, timingSafeEqualString, UPLOAD_TOKEN_TTL_MS } from '../media/constants';
import type { PhotosObjectBody } from '../media/types';
import type { DatabaseOrTransaction, ServerContext } from '../server-router';
import { uuidv4 } from '@robotools.app/protocol/src/utils';

function toTeamPhoto(row: {
	id: string;
	teamId: string;
	contentType: string;
	byteSize: number;
	createdAt: Date;
	createdByDeviceId: string;
	createdByJudgeId: string | null;
	viewSecret: string;
}): TeamPhoto {
	return {
		id: row.id,
		teamId: row.teamId,
		contentType: row.contentType as TeamPhoto['contentType'],
		byteSize: row.byteSize,
		createdAt: row.createdAt.getTime(),
		createdByDeviceId: row.createdByDeviceId,
		createdByJudgeId: row.createdByJudgeId,
		viewSecret: row.viewSecret
	};
}

export async function listUploads(db: DatabaseOrTransaction): Promise<Set<string>> {
	const [stored, pending] = await Promise.all([
		db.select({ id: teamPhotos.id }).from(teamPhotos),
		db.select({ photoId: pendingPhotoUploads.photoId }).from(pendingPhotoUploads)
	]);
	return new Set([...stored.map((row) => row.id), ...pending.map((row) => row.photoId)]);
}

export async function listAllTeamPhotos(db: DatabaseOrTransaction): Promise<TeamPhoto[]> {
	const rows = await db.select().from(teamPhotos);
	return rows.map(toTeamPhoto);
}

export async function listTeamPhotos(db: DatabaseOrTransaction, teamId: string): Promise<TeamPhoto[]> {
	const rows = await db.select().from(teamPhotos).where(eq(teamPhotos.teamId, teamId));
	return rows.map(toTeamPhoto);
}

async function cleanupExpiredUploadTokens(db: DatabaseOrTransaction): Promise<void> {
	const now = new Date();
	await db.delete(pendingPhotoUploads).where(lt(pendingPhotoUploads.expiresAt, now));
}

export function buildMediaRoute(w: WRPCRootObject<object, ServerContext, Record<string, never>>) {
	return {
		listAllTeamPhotos: w.procedure.output(z.array(TeamPhotoSchema)).query(async ({ ctx }) => {
			return listAllTeamPhotos(ctx.db);
		}),

		listTeamPhotos: w.procedure
			.input(z.object({ teamId: z.uuidv4() }))
			.output(z.array(TeamPhotoSchema))
			.query(async ({ ctx, input }) => {
				return listTeamPhotos(ctx.db, input.teamId);
			}),

		createUpload: w.procedure
			.input(CreatePhotoUploadInputSchema)
			.output(CreatePhotoUploadResultSchema)
			.mutation(async ({ ctx, input, session }) => {
				await cleanupExpiredUploadTokens(ctx.db);
				// AC-on auth is guaranteed by authorizeConnect + kick-on-AC-toggle (see essential.ts).
				assertAuthorship(ctx.auth, input.judgeId);

				if (input.byteSize > MAX_PHOTO_BYTES) {
					throw new Error(`Photo exceeds maximum size of ${MAX_PHOTO_BYTES} bytes`);
				}

				const team = await ctx.db.select({ id: teams.id }).from(teams).where(eq(teams.id, input.teamId)).limit(1);
				if (team.length === 0) {
					throw new Error('Team not found');
				}

				const [teamCountRow] = await ctx.db.select({ value: count() }).from(teamPhotos).where(eq(teamPhotos.teamId, input.teamId));
				if ((teamCountRow?.value ?? 0) >= MAX_PHOTOS_PER_TEAM) {
					throw new Error(`Maximum of ${MAX_PHOTOS_PER_TEAM} photos per team reached`);
				}

				const [roomCountRow] = await ctx.db.select({ value: count() }).from(teamPhotos);
				if ((roomCountRow?.value ?? 0) >= MAX_PHOTOS_PER_ROOM) {
					throw new Error(`Maximum of ${MAX_PHOTOS_PER_ROOM} photos per Judges' Room reached`);
				}

				const photoId = uuidv4();
				const uploadToken = uuidv4();
				const expiresAt = new Date(Date.now() + UPLOAD_TOKEN_TTL_MS);

				await ctx.db.insert(pendingPhotoUploads).values({
					token: uploadToken,
					photoId,
					teamId: input.teamId,
					contentType: input.contentType,
					byteSize: input.byteSize,
					createdByDeviceId: session.currentClient.deviceId,
					createdByJudgeId: input.judgeId,
					expiresAt
				});

				return {
					photoId,
					uploadToken,
					uploadUrl: `/media/upload?roomId=${encodeURIComponent(session.roomId)}`
				};
			}),

		deletePhoto: w.procedure.input(z.object({ photoId: z.uuidv4() })).mutation(async ({ ctx, input, session }) => {
			const rows = await ctx.db.select().from(teamPhotos).where(eq(teamPhotos.id, input.photoId)).limit(1);
			const photo = rows[0];
			if (!photo) {
				throw new Error('Photo not found');
			}

			// Drop the DB row first so clients stop listing the photo even if R2/purge fails.
			await ctx.db.delete(teamPhotos).where(eq(teamPhotos.id, input.photoId));
			await ctx.photos.delete(photo.id);

			session.broadcast<ClientRouter>().onTeamPhotoUpdate.mutation({
				action: 'deleted',
				photoId: photo.id,
				teamId: photo.teamId
			});

			return { success: true };
		})
	};
}

export async function completePhotoUpload(
	ctx: ServerContext,
	token: string,
	body: ArrayBuffer,
	contentTypeHeader: string | null
): Promise<TeamPhoto> {
	await cleanupExpiredUploadTokens(ctx.db);

	const pendingRows = await ctx.db.select().from(pendingPhotoUploads).where(eq(pendingPhotoUploads.token, token)).limit(1);
	const pending = pendingRows[0];
	if (!pending) {
		throw new Error('Invalid or expired upload token');
	}

	if (pending.expiresAt.getTime() < Date.now()) {
		await ctx.db.delete(pendingPhotoUploads).where(eq(pendingPhotoUploads.token, token));
		throw new Error('Upload token expired');
	}

	if (body.byteLength !== pending.byteSize) {
		throw new Error(`Uploaded size ${body.byteLength} does not match authorized size ${pending.byteSize}`);
	}

	if (body.byteLength > MAX_PHOTO_BYTES) {
		throw new Error(`Photo exceeds maximum size of ${MAX_PHOTO_BYTES} bytes`);
	}

	if (contentTypeHeader && contentTypeHeader !== pending.contentType) {
		throw new Error('Content-Type does not match authorized upload');
	}

	// What the bytes are, not what the request says they are.
	//
	// Everything above this point is the uploader agreeing with themselves: they asked for
	// a token for an image/jpeg and then sent a header saying image/jpeg. Nothing so far
	// has looked at the payload, so a crafted request could store a document under an image
	// type — which then comes back from this origin, alongside every judge's session, with
	// that type on it. The response headers are built to survive that (see
	// photoResponseHeaders), but the honest fix is for the declared type to be true.
	//
	// A header check rather than a decode. It does not prove the file renders, and does not
	// need to: browsers sniff HTML from a leading `<`, and a payload cannot begin with both
	// that and a JPEG SOI marker.
	const detected = detectPhotoContentType(new Uint8Array(body));
	if (detected !== pending.contentType) {
		// Phrased to carry "Content-Type", which is how sendMediaError knows this is a 400
		// and not a server fault.
		throw new Error(`Uploaded bytes are not ${pending.contentType}; the declared Content-Type does not match the file`);
	}

	const [teamCountRow] = await ctx.db.select({ value: count() }).from(teamPhotos).where(eq(teamPhotos.teamId, pending.teamId));
	if ((teamCountRow?.value ?? 0) >= MAX_PHOTOS_PER_TEAM) {
		await ctx.db.delete(pendingPhotoUploads).where(eq(pendingPhotoUploads.token, token));
		throw new Error(`Maximum of ${MAX_PHOTOS_PER_TEAM} photos per team reached`);
	}

	await ctx.photos.put(pending.photoId, new Uint8Array(body), pending.contentType);

	const createdAt = new Date();
	const viewSecret = uuidv4();
	try {
		await ctx.db.insert(teamPhotos).values({
			id: pending.photoId,
			teamId: pending.teamId,
			contentType: pending.contentType,
			byteSize: pending.byteSize,
			createdAt,
			createdByDeviceId: pending.createdByDeviceId,
			createdByJudgeId: pending.createdByJudgeId,
			viewSecret
		});
		await ctx.db.delete(pendingPhotoUploads).where(eq(pendingPhotoUploads.token, token));
	} catch (error) {
		// Avoid orphaning the stored bytes if the metadata writes fail after put.
		await ctx.photos.delete(pending.photoId).catch(() => {});
		throw error;
	}

	return toTeamPhoto({
		id: pending.photoId,
		teamId: pending.teamId,
		contentType: pending.contentType,
		byteSize: pending.byteSize,
		createdAt,
		createdByDeviceId: pending.createdByDeviceId,
		createdByJudgeId: pending.createdByJudgeId,
		viewSecret
	});
}

/** Filename suffix per allowed type, and something inert for anything else. */
const PHOTO_EXTENSIONS: Record<PhotoContentType, string> = {
	'image/jpeg': 'jpg',
	'image/png': 'png',
	'image/webp': 'webp'
};

/**
 * Response headers for a stored photo.
 *
 * The bytes here were uploaded by a device in the judging room and are served back from
 * the same origin as the application — the one holding every judge's session. Nothing
 * inspects the bytes on the way in, so the only thing making them an image is the
 * uploader's word, and a response that lets a browser second-guess the declared type is a
 * path from "a judge uploaded a file" to "a script ran on the judging origin".
 *
 * Four defences, deliberately overlapping, because the cost is a few headers and the
 * failure they guard against is stored XSS against confidential judging material:
 *
 * - The Content-Type is taken from the allow-list rather than from the row. It is written
 *   through PhotoContentTypeSchema and should only ever be one of three image types, but
 *   this is the value that becomes a header, so a row holding something else — a bad
 *   migration, a hand-edited database — must not get to name its own type.
 * - `nosniff` stops the browser ignoring that type and guessing from the content, which is
 *   the specific behaviour that turns a mislabelled upload into a document.
 * - `Content-Disposition: inline` with a filename we chose means a browser navigating
 *   straight to the URL has no filename of the uploader's to infer a type from.
 * - The CSP applies if something is nonetheless treated as a document: no subresources of
 *   any kind, and sandboxed, so it cannot script, submit a form, or reach the session it
 *   would be running alongside. Ignored for an `<img>`, which is the normal path.
 *
 * CORP is same-site rather than same-origin because development serves the app from Vite
 * and the media from this server on another port. In production both are the same origin.
 */
export function photoResponseHeaders(photoId: string, storedContentType: string, byteLength: number): Record<string, string> {
	const parsed = PhotoContentTypeSchema.safeParse(storedContentType);
	const contentType = parsed.success ? parsed.data : 'application/octet-stream';
	const extension = parsed.success ? PHOTO_EXTENSIONS[parsed.data] : 'bin';

	return {
		'Content-Type': contentType,
		'Content-Length': String(byteLength),
		// The URL carries an unguessable per-photo secret, so the response is safe to cache
		// privately for as long as the client will hold it.
		'Cache-Control': `public, max-age=${PHOTO_CACHE_MAX_AGE_SECONDS}`,
		'X-Content-Type-Options': 'nosniff',
		// photoId is a UUID, so it cannot break out of the quoted filename.
		'Content-Disposition': `inline; filename="photo-${photoId}.${extension}"`,
		'Content-Security-Policy': "default-src 'none'; sandbox",
		'Cross-Origin-Resource-Policy': 'same-site'
	};
}

export async function getPhotoObject(
	ctx: ServerContext,
	photoId: string,
	viewSecret: string
): Promise<{ body: PhotosObjectBody; headers: Record<string, string> }> {
	const photoRows = await ctx.db.select().from(teamPhotos).where(eq(teamPhotos.id, photoId)).limit(1);
	const photo = photoRows[0];
	if (!photo || !timingSafeEqualString(photo.viewSecret, viewSecret)) {
		throw new Error('Photo not found');
	}

	const object = await ctx.photos.get(photo.id);
	if (!object) {
		throw new Error('Photo object missing from storage');
	}

	return {
		body: object,
		// Built from the row rather than from the stored object: the object's own
		// contentType came from the same upload and has no more authority than the row,
		// and one of the two has to be the answer.
		headers: photoResponseHeaders(photo.id, photo.contentType, object.bytes.byteLength)
	};
}
