import {
	buildPhotoViewPath,
	IMAGE_HEADER_BYTES,
	MAX_PHOTO_BYTES,
	PHOTO_JPEG_QUALITY,
	PHOTO_MAX_LONG_EDGE,
	photoDecodeTarget,
	readImageHeader,
	type ImageHeader,
	type PhotoContentType,
	type TeamPhoto
} from '@robotools.app/protocol/src/media';
import { app } from './index.svelte';

export function getMediaBaseUrl(): string {
	return app.getMediaOrigin();
}

export function getPhotoObjectUrl(photo: TeamPhoto): string {
	const roomId = app.getPermit()?.roomId;
	if (!roomId) {
		throw new Error("No Judges' Room permit");
	}
	return `${getMediaBaseUrl()}${buildPhotoViewPath(roomId, photo.id, photo.viewSecret)}`;
}

/** The leading bytes of a photo, parsed for its dimensions. Null if they cannot be read. */
async function readPhotoHeader(file: Blob): Promise<ImageHeader | null> {
	try {
		const head = new Uint8Array(await file.slice(0, IMAGE_HEADER_BYTES).arrayBuffer());
		return readImageHeader(head);
	} catch {
		// A blob that cannot even be read this far is the decoder's problem to report, not
		// this function's. Null means "decode it the ordinary way".
		return null;
	}
}

/**
 * Ask the decoder for a bitmap no larger than it needs to be.
 *
 * The obvious `createImageBitmap(file)` decodes at full resolution first and shrinks
 * afterwards, and a phone camera photo is enormous: a 50 MP Samsung shot is 200 MB of RGBA
 * before a single pixel is resized. On Android that is enough for the browser to kill the
 * tab — which reads, to a judge who has just taken a photo, as the app reloading itself and
 * throwing them back to the start screen with no photo saved.
 *
 * So the header is read first (a few hundred KB, no pixels) and the decode is asked for the
 * final size directly. Every branch here falls back to the plain decode rather than
 * failing: this is an optimisation, and a photo that cannot be shrunk cleverly should still
 * upload.
 */
async function decodeScaledBitmap(file: Blob): Promise<ImageBitmap> {
	const header = await readPhotoHeader(file);

	if (!header) return createImageBitmap(file);

	// Measured in displayed pixels, since that is the orientation the decoder hands back.
	const target = photoDecodeTarget(header);
	if (!target) return createImageBitmap(file, { imageOrientation: 'from-image' });

	try {
		return await createImageBitmap(file, {
			resizeWidth: target.width,
			resizeHeight: target.height,
			resizeQuality: 'high',
			imageOrientation: 'from-image'
		});
	} catch {
		// An older engine that rejects the options, or a decoder that cannot resize this
		// particular file. Full-size decode is worse, but it is not wrong.
		return createImageBitmap(file);
	}
}

export async function compressImageForUpload(file: Blob): Promise<{ blob: Blob; contentType: PhotoContentType }> {
	const bitmap = await decodeScaledBitmap(file);
	try {
		// Usually 1 now, because the decode already did the shrinking. Kept for the fallback
		// paths above, which hand back a full-size bitmap.
		const scale = Math.min(1, PHOTO_MAX_LONG_EDGE / Math.max(bitmap.width, bitmap.height));
		const width = Math.max(1, Math.round(bitmap.width * scale));
		const height = Math.max(1, Math.round(bitmap.height * scale));

		const canvas = document.createElement('canvas');
		canvas.width = width;
		canvas.height = height;
		const ctx = canvas.getContext('2d');
		if (!ctx) {
			throw new Error('Unable to process image');
		}
		ctx.drawImage(bitmap, 0, 0, width, height);

		const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', PHOTO_JPEG_QUALITY));
		if (!blob) {
			throw new Error('Unable to compress image');
		}
		if (blob.size > MAX_PHOTO_BYTES) {
			throw new Error(`Compressed photo still exceeds ${Math.round(MAX_PHOTO_BYTES / (1024 * 1024))} MB limit`);
		}
		return { blob, contentType: 'image/jpeg' };
	} finally {
		bitmap.close();
	}
}

export async function uploadTeamPhoto(teamId: string, file: Blob, judgeId: string | null): Promise<TeamPhoto> {
	const { blob, contentType } = await compressImageForUpload(file);
	const authorization = await app.wrpcClient.media.createUpload.mutation({
		teamId,
		contentType,
		byteSize: blob.size,
		judgeId
	});

	const response = await fetch(`${getMediaBaseUrl()}${authorization.uploadUrl}`, {
		method: 'PUT',
		headers: {
			Authorization: `Bearer ${authorization.uploadToken}`,
			'Content-Type': contentType
		},
		body: blob
	});

	if (!response.ok) {
		const message = await response.text();
		throw new Error(message || 'Photo upload failed');
	}

	return (await response.json()) as TeamPhoto;
}

export async function deleteTeamPhoto(photoId: string): Promise<void> {
	await app.wrpcClient.media.deletePhoto.mutation({ photoId });
}
