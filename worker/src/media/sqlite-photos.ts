import { inArray, eq } from 'drizzle-orm';
import { teamPhotoBlobs } from '../db/schema';
import type { AppDatabase } from '../runtime/storage';
import type { PhotosBucket } from './types';

/**
 * Team photos, stored in the room's own database.
 *
 * A photo is capped at MAX_PHOTO_BYTES and a room holds a few hundred at most, which is
 * comfortably inside what SQLite handles well. The reason to keep them here rather than
 * in a separate store is not size but lifetime: the bytes are created, isolated and
 * destroyed with the room, in the same file, with no second system to fall out of step.
 */
export function createSqlitePhotosBucket(db: AppDatabase): PhotosBucket {
	return {
		async put(photoId, bytes, contentType) {
			await db
				.insert(teamPhotoBlobs)
				.values({ photoId, contentType, bytes: Buffer.from(bytes) })
				.onConflictDoUpdate({
					target: [teamPhotoBlobs.photoId],
					set: { contentType, bytes: Buffer.from(bytes) }
				});
		},

		async get(photoId) {
			const [row] = await db
				.select({ bytes: teamPhotoBlobs.bytes, contentType: teamPhotoBlobs.contentType })
				.from(teamPhotoBlobs)
				.where(eq(teamPhotoBlobs.photoId, photoId))
				.limit(1);

			return row ? { bytes: new Uint8Array(row.bytes as Buffer), contentType: row.contentType } : null;
		},

		async delete(photoId) {
			const photoIds = Array.isArray(photoId) ? photoId : [photoId];
			if (photoIds.length === 0) {
				return;
			}
			await db.delete(teamPhotoBlobs).where(inArray(teamPhotoBlobs.photoId, photoIds));
		}
	};
}
