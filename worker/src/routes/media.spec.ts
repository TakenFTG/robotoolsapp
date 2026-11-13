import { JUDGE_ADVISOR_SINGLETON_ID } from '@robotools.app/protocol/src/access';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { serverRouter } from '../server-router';
import { createTestServerContext, seedTestDatabase, sampleTeamInfoAndData } from '../test-utils';
import type { ServerContext } from '../server-router';
import type { Session } from '@robotools.app/wrpc/server/session';
import type { AnyRouter } from '@robotools.app/wrpc/server/router';
import { judges, metadata, pendingPhotoUploads, teamPhotos } from '../db/schema';
import { completePhotoUpload, getPhotoObject, listUploads, photoResponseHeaders } from './media';
import { ALLOWED_PHOTO_CONTENT_TYPES, detectPhotoContentType, type PhotoContentType } from '@robotools.app/protocol/src/media';
import { PHOTO_CACHE_MAX_AGE_SECONDS } from '../media/constants';
import { uuidv4 } from '@robotools.app/protocol/src/utils';
import { Authentication } from '../access/authentication';
import { generateAuthToken } from '../access/tokens';

describe('media routes', () => {
	let context: ServerContext & { cleanup: () => void };
	let session: Session<AnyRouter>;
	let photoUpdates: unknown[];

	const teamId = sampleTeamInfoAndData[0]!.id;
	const deviceId = '550e8400-e29b-41d4-a716-446655440099';
	const roomId = '550e8400-e29b-41d4-a716-446655440010';

	beforeEach(async () => {
		context = createTestServerContext();
		await seedTestDatabase(context);
		photoUpdates = [];

		session = {
			getClient: () => ({}) as never,
			broadcast: () =>
				({
					onTeamPhotoUpdate: {
						mutation: async (input: unknown) => {
							photoUpdates.push(input);
							return [];
						}
					}
				}) as never,
			getServer: () => {
				throw new Error('getServer() cannot be called from server-side session');
			},
			roomId,
			currentClient: {
				clientId: '550e8400-e29b-41d4-a716-446655440011',
				deviceId,
				deviceName: 'Test Device'
			}
		};
	});

	afterEach(async () => {
		await new Promise((resolve) => setTimeout(resolve, 10));
		context.cleanup();
	});

	async function createAuthorizedUpload(byteSize = 16, contentType: PhotoContentType = 'image/jpeg') {
		const resolver = serverRouter.media.createUpload._def._resolver!;
		return resolver({
			input: {
				teamId,
				contentType,
				byteSize,
				judgeId: null
			},
			session,
			ctx: context
		});
	}

	/**
	 * A payload of `byteSize` bytes carrying a real image header.
	 *
	 * Uploads are checked against the format's signature, so a buffer of zeroes is no
	 * longer a stand-in for a photo — and should not be, since accepting one was the hole.
	 */
	function imageBytes(contentType: PhotoContentType, byteSize: number): ArrayBuffer {
		const headers: Record<PhotoContentType, number[]> = {
			'image/jpeg': [0xff, 0xd8, 0xff],
			'image/png': [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
			// RIFF, four bytes standing in for the chunk size, then WEBP.
			'image/webp': [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]
		};
		const header = headers[contentType];
		if (byteSize < header.length) {
			throw new Error(`${contentType} needs at least ${header.length} bytes`);
		}
		const buffer = new Uint8Array(byteSize);
		buffer.set(header);
		return buffer.buffer;
	}

	const jpeg = (byteSize: number) => imageBytes('image/jpeg', byteSize);

	describe('createUpload', () => {
		it('creates a pending upload token and url', async () => {
			const result = await createAuthorizedUpload(32);

			expect(result.photoId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
			expect(result.uploadToken.length).toBeGreaterThan(0);
			expect(result.uploadUrl).toBe(`/media/upload?roomId=${encodeURIComponent(roomId)}`);

			const pending = await context.db.select().from(pendingPhotoUploads).where(eq(pendingPhotoUploads.token, result.uploadToken));
			expect(pending).toHaveLength(1);
			expect(pending[0]?.photoId).toBe(result.photoId);
			expect(pending[0]?.byteSize).toBe(32);
		});

		it('rejects unknown teams', async () => {
			const resolver = serverRouter.media.createUpload._def._resolver!;
			await expect(
				resolver({
					input: {
						teamId: '550e8400-e29b-41d4-a716-446655440999',
						contentType: 'image/jpeg',
						byteSize: 16,
						judgeId: null
					},
					session,
					ctx: context
				})
			).rejects.toThrow('Team not found');
		});

		it('rejects judgeId spoofing when bound as a different judge', async () => {
			await context.db.update(metadata).set({ accessControlEnabled: true });
			const boundJudgeId = uuidv4();
			const otherJudgeId = uuidv4();
			const resolver = serverRouter.media.createUpload._def._resolver!;

			await expect(
				resolver({
					input: {
						teamId,
						contentType: 'image/jpeg',
						byteSize: 16,
						judgeId: otherJudgeId
					},
					session,
					ctx: {
						...context,
						auth: Authentication.withFixture({
							isAccessControlled: true,
							authToken: generateAuthToken(),
							role: 'judge',
							judgeId: boundJudgeId
						})
					}
				})
			).rejects.toThrow('The authenticated identity does not match the submission judge');
		});

		it('allows upload as the bound judge when access control is on', async () => {
			await context.db.update(metadata).set({ accessControlEnabled: true });
			const boundJudgeId = uuidv4();
			await context.db.insert(judges).values({
				id: boundJudgeId,
				name: 'Bound',
				groupId: 'group-1',
				authToken: generateAuthToken()
			});
			const resolver = serverRouter.media.createUpload._def._resolver!;

			const result = await resolver({
				input: {
					teamId,
					contentType: 'image/jpeg',
					byteSize: 16,
					judgeId: boundJudgeId
				},
				session,
				ctx: {
					...context,
					auth: Authentication.withFixture({
						isAccessControlled: true,
						authToken: generateAuthToken(),
						role: 'judge',
						judgeId: boundJudgeId
					})
				}
			});

			expect(result.photoId).toBeTruthy();
			const pending = await context.db.select().from(pendingPhotoUploads).where(eq(pendingPhotoUploads.token, result.uploadToken));
			expect(pending[0]?.createdByJudgeId).toBe(boundJudgeId);
		});

		it('allows judge advisor uploads when access control is on', async () => {
			await context.db.update(metadata).set({ accessControlEnabled: true });
			const resolver = serverRouter.media.createUpload._def._resolver!;

			const result = await resolver({
				input: {
					teamId,
					contentType: 'image/jpeg',
					byteSize: 16,
					judgeId: null
				},
				session,
				ctx: {
					...context,
					auth: Authentication.withFixture({
						isAccessControlled: true,
						authToken: generateAuthToken(),
						role: 'judge_advisor',
						judgeAdvisorId: JUDGE_ADVISOR_SINGLETON_ID
					})
				}
			});

			expect(result.photoId).toBeTruthy();
		});
	});

	describe('completePhotoUpload', () => {
		it('stores the object, creates TeamPhotos row, and clears pending token', async () => {
			const auth = await createAuthorizedUpload(8);
			const body = jpeg(8);

			const photo = await completePhotoUpload(context, auth.uploadToken, body, 'image/jpeg');

			expect(photo.id).toBe(auth.photoId);
			expect(photo.teamId).toBe(teamId);
			expect(photo.contentType).toBe('image/jpeg');
			expect(photo.byteSize).toBe(8);
			expect(photo.viewSecret.length).toBeGreaterThan(0);
			expect(photo.createdByDeviceId).toBe(deviceId);

			const stored = await context.photos.get(photo.id);
			expect(stored).not.toBeNull();

			const pending = await context.db.select().from(pendingPhotoUploads).where(eq(pendingPhotoUploads.token, auth.uploadToken));
			expect(pending).toHaveLength(0);

			const rows = await context.db.select().from(teamPhotos).where(eq(teamPhotos.id, photo.id));
			expect(rows).toHaveLength(1);
		});

		it('rejects invalid tokens', async () => {
			await expect(completePhotoUpload(context, uuidv4(), new ArrayBuffer(1), 'image/jpeg')).rejects.toThrow(
				'Invalid or expired upload token'
			);
		});

		it('rejects expired tokens (cleaned up before completion)', async () => {
			const auth = await createAuthorizedUpload(4);
			await context.db
				.update(pendingPhotoUploads)
				.set({ expiresAt: new Date(Date.now() - 1000) })
				.where(eq(pendingPhotoUploads.token, auth.uploadToken));

			// cleanupExpiredUploadTokens runs first and removes the row
			await expect(completePhotoUpload(context, auth.uploadToken, jpeg(4), 'image/jpeg')).rejects.toThrow(
				'Invalid or expired upload token'
			);
		});

		it('rejects size mismatches', async () => {
			const auth = await createAuthorizedUpload(8);
			await expect(completePhotoUpload(context, auth.uploadToken, jpeg(4), 'image/jpeg')).rejects.toThrow(/does not match authorized size/);
		});

		it('rejects content-type mismatches', async () => {
			const auth = await createAuthorizedUpload(8);
			await expect(completePhotoUpload(context, auth.uploadToken, jpeg(8), 'image/png')).rejects.toThrow(
				'Content-Type does not match authorized upload'
			);
		});

		// The check that makes the stored Content-Type true. Everything above it is the
		// uploader agreeing with themselves: a token requested for image/jpeg, then a header
		// saying image/jpeg. Only this looks at the payload.
		it('rejects bytes that are not the declared format', async () => {
			const auth = await createAuthorizedUpload(64);
			const html = new TextEncoder().encode('<html><script>alert(1)</script></html>'.padEnd(64, ' '));

			await expect(completePhotoUpload(context, auth.uploadToken, html.buffer, 'image/jpeg')).rejects.toThrow(
				/Uploaded bytes are not image\/jpeg/
			);
			expect(await context.photos.get(auth.photoId)).toBeNull();
			const rows = await context.db.select().from(teamPhotos).where(eq(teamPhotos.id, auth.photoId));
			expect(rows).toHaveLength(0);
		});

		it('rejects an image of the wrong declared format', async () => {
			// Real PNG bytes, but the token authorised a JPEG. Storing it would put a type on
			// the response that the file does not match.
			const auth = await createAuthorizedUpload(16);

			await expect(completePhotoUpload(context, auth.uploadToken, imageBytes('image/png', 16), 'image/jpeg')).rejects.toThrow(
				/Uploaded bytes are not image\/jpeg/
			);
		});

		it('accepts every format the allow-list permits', async () => {
			for (const contentType of ALLOWED_PHOTO_CONTENT_TYPES) {
				const auth = await createAuthorizedUpload(32, contentType);
				const photo = await completePhotoUpload(context, auth.uploadToken, imageBytes(contentType, 32), contentType);
				expect(photo.contentType).toBe(contentType);
			}
		});

		it('removes the R2 object if DB insert fails after put', async () => {
			const auth = await createAuthorizedUpload(4);
			await context.db.insert(teamPhotos).values({
				id: auth.photoId,
				teamId,
				contentType: 'image/jpeg',
				byteSize: 4,
				createdAt: new Date(),
				createdByDeviceId: deviceId,
				createdByJudgeId: null,
				viewSecret: 'preexisting-secret'
			});

			await expect(completePhotoUpload(context, auth.uploadToken, jpeg(4), 'image/jpeg')).rejects.toThrow();
			expect(await context.photos.get(auth.photoId)).toBeNull();
		});
	});

	describe('getPhotoObject', () => {
		it('returns body and response headers for a valid secret', async () => {
			const auth = await createAuthorizedUpload(4);
			const photo = await completePhotoUpload(context, auth.uploadToken, jpeg(4), 'image/jpeg');

			const result = await getPhotoObject(context, photo.id, photo.viewSecret);
			expect(result.headers['Content-Type']).toBe('image/jpeg');
			expect(result.headers['Content-Length']).toBe('4');
			expect(result.headers['Cache-Control']).toBe(`public, max-age=${PHOTO_CACHE_MAX_AGE_SECONDS}`);
			expect(result.body.bytes).toBeInstanceOf(Uint8Array);
		});

		it('rejects wrong secrets', async () => {
			const auth = await createAuthorizedUpload(4);
			const photo = await completePhotoUpload(context, auth.uploadToken, jpeg(4), 'image/jpeg');

			await expect(getPhotoObject(context, photo.id, 'wrong-secret')).rejects.toThrow('Photo not found');
		});

		// The photo bytes are whatever a device uploaded, served from the origin that holds
		// every judge's session. These headers are what keeps a mislabelled upload from
		// being interpreted as anything but an image.
		it('serves photos with sniffing defences', async () => {
			const auth = await createAuthorizedUpload(4);
			const photo = await completePhotoUpload(context, auth.uploadToken, jpeg(4), 'image/jpeg');

			const { headers } = await getPhotoObject(context, photo.id, photo.viewSecret);
			expect(headers['X-Content-Type-Options']).toBe('nosniff');
			expect(headers['Content-Disposition']).toBe(`inline; filename="photo-${photo.id}.jpg"`);
			expect(headers['Content-Security-Policy']).toBe("default-src 'none'; sandbox");
			expect(headers['Cross-Origin-Resource-Policy']).toBe('same-site');
		});
	});

	describe('detectPhotoContentType', () => {
		it('identifies each allowed format from its header', () => {
			for (const contentType of ALLOWED_PHOTO_CONTENT_TYPES) {
				expect(detectPhotoContentType(new Uint8Array(imageBytes(contentType, 32)))).toBe(contentType);
			}
		});

		it('returns null for anything else', () => {
			const cases: Record<string, number[]> = {
				html: [...new TextEncoder().encode('<html>')],
				svg: [...new TextEncoder().encode('<svg xmlns=')],
				// A BOM then HTML — the classic way past a naive "starts with <" check.
				bomHtml: [0xef, 0xbb, 0xbf, ...new TextEncoder().encode('<html>')],
				zeroes: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
				empty: [],
				truncatedJpeg: [0xff, 0xd8],
				truncatedPng: [0x89, 0x50, 0x4e, 0x47],
				// RIFF without the WEBP tag is some other RIFF container, e.g. a WAV.
				riffNotWebp: [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45]
			};
			for (const [label, bytes] of Object.entries(cases)) {
				expect([label, detectPhotoContentType(new Uint8Array(bytes))]).toEqual([label, null]);
			}
		});
	});

	describe('photoResponseHeaders', () => {
		it('names the extension for every allowed type', () => {
			expect(photoResponseHeaders('id', 'image/jpeg', 1)['Content-Disposition']).toContain('.jpg"');
			expect(photoResponseHeaders('id', 'image/png', 1)['Content-Disposition']).toContain('.png"');
			expect(photoResponseHeaders('id', 'image/webp', 1)['Content-Disposition']).toContain('.webp"');
			for (const contentType of ALLOWED_PHOTO_CONTENT_TYPES) {
				expect(photoResponseHeaders('id', contentType, 1)['Content-Type']).toBe(contentType);
			}
		});

		// The column is written through PhotoContentTypeSchema, so this should be
		// unreachable — which is the point. If a row ever does hold something else, it must
		// not get to name its own Content-Type on a response carrying uploaded bytes.
		it('refuses to echo a type outside the allow-list', () => {
			for (const stored of ['text/html', 'image/svg+xml', 'application/javascript', '']) {
				const headers = photoResponseHeaders('id', stored, 1);
				expect(headers['Content-Type']).toBe('application/octet-stream');
				expect(headers['Content-Disposition']).toBe('inline; filename="photo-id.bin"');
				expect(headers['X-Content-Type-Options']).toBe('nosniff');
			}
		});
	});

	describe('deletePhoto', () => {
		it('removes storage + db row and broadcasts deletion', async () => {
			const auth = await createAuthorizedUpload(4);
			const photo = await completePhotoUpload(context, auth.uploadToken, jpeg(4), 'image/jpeg');
			const deleteSpy = vi.spyOn(context.photos, 'delete');

			const resolver = serverRouter.media.deletePhoto._def._resolver!;
			const result = await resolver({
				input: { photoId: photo.id },
				session,
				ctx: context
			});

			expect(result).toEqual({ success: true });
			expect(deleteSpy).toHaveBeenCalledWith(photo.id);
			expect(await context.photos.get(photo.id)).toBeNull();

			const rows = await context.db.select().from(teamPhotos).where(eq(teamPhotos.id, photo.id));
			expect(rows).toHaveLength(0);

			expect(photoUpdates).toEqual([
				{
					action: 'deleted',
					photoId: photo.id,
					teamId
				}
			]);
		});
	});

	describe('listUploads', () => {
		it('includes stored and pending photo ids', async () => {
			const storedAuth = await createAuthorizedUpload(4);
			const stored = await completePhotoUpload(context, storedAuth.uploadToken, jpeg(4), 'image/jpeg');
			const pendingAuth = await createAuthorizedUpload(4);

			const ids = await listUploads(context.db);
			expect(ids.has(stored.id)).toBe(true);
			expect(ids.has(pendingAuth.photoId)).toBe(true);
		});
	});
});
