import { z } from 'zod';

export const MAX_PHOTO_BYTES = 3 * 1024 * 1024; // 3 MB
export const MAX_PHOTOS_PER_TEAM = 10;
export const MAX_PHOTOS_PER_ROOM = 500;
export const PHOTO_MAX_LONG_EDGE = 1600;
export const PHOTO_JPEG_QUALITY = 0.8;

export const ALLOWED_PHOTO_CONTENT_TYPES = ['image/jpeg', 'image/webp', 'image/png'] as const;

export const PhotoContentTypeSchema = z.enum(ALLOWED_PHOTO_CONTENT_TYPES);

export type PhotoContentType = z.infer<typeof PhotoContentTypeSchema>;

/**
 * Leading bytes that identify each accepted format.
 *
 * JPEG's is the SOI marker plus the first byte of the next one; PNG's is its full
 * eight-byte header. WebP is a RIFF container, so the tag it needs sits past the
 * four-byte chunk size at offset 8 rather than at the start.
 */
const PHOTO_SIGNATURES: { contentType: PhotoContentType; offset: number; bytes: number[] }[] = [
	{ contentType: 'image/jpeg', offset: 0, bytes: [0xff, 0xd8, 0xff] },
	{ contentType: 'image/png', offset: 0, bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
	// RIFF, four bytes of length, then WEBP.
	{ contentType: 'image/webp', offset: 0, bytes: [0x52, 0x49, 0x46, 0x46] },
	{ contentType: 'image/webp', offset: 8, bytes: [0x57, 0x45, 0x42, 0x50] }
];

function hasSignature(bytes: Uint8Array, signature: number[], offset: number): boolean {
	if (bytes.length < offset + signature.length) {
		return false;
	}
	for (let i = 0; i < signature.length; i++) {
		if (bytes[offset + i] !== signature[i]) {
			return false;
		}
	}
	return true;
}

/**
 * What a byte sequence actually is, as far as its header claims.
 *
 * Not a decode — it does not prove the file is a *valid* image, and it is not meant to.
 * What it establishes is that the bytes lead with a recognised image header, which is
 * enough to rule out the thing that matters: a file whose start looks like a document to
 * a browser willing to guess. HTML sniffing keys off `<` at the beginning, and nothing
 * can begin with both that and an SOI marker.
 *
 * Returns null for anything unrecognised, including a buffer too short to tell.
 */
export function detectPhotoContentType(bytes: Uint8Array): PhotoContentType | null {
	for (const contentType of ALLOWED_PHOTO_CONTENT_TYPES) {
		const required = PHOTO_SIGNATURES.filter((signature) => signature.contentType === contentType);
		if (required.every((signature) => hasSignature(bytes, signature.bytes, signature.offset))) {
			return contentType;
		}
	}
	return null;
}

/**
 * How many bytes of a photo need reading before its dimensions are known.
 *
 * PNG and WebP put them in the first few dozen bytes. JPEG does not: the frame header sits
 * after however many application segments the camera wrote, and a phone's EXIF block —
 * thumbnail included — routinely runs past 64 KB. 512 KB covers every camera JPEG tested
 * without pulling a multi-megabyte file into memory to read a number out of it.
 */
export const IMAGE_HEADER_BYTES = 512 * 1024;

export interface ImageHeader {
	/** Pixel dimensions as stored, before any EXIF rotation is applied. */
	width: number;
	height: number;
	/**
	 * EXIF orientation, 1–8, or null when the file does not say.
	 *
	 * Only 5–8 matter to a caller: those quarter-turn the image, so the displayed width is
	 * the stored height. Getting that backwards squashes the photo.
	 */
	orientation: number | null;
}

/** True for the EXIF orientations that rotate a quarter turn, swapping width and height. */
export function orientationSwapsAxes(orientation: number | null): boolean {
	return orientation !== null && orientation >= 5 && orientation <= 8;
}

/** JPEG markers that introduce a frame, and therefore carry the image's dimensions. */
function isStartOfFrame(marker: number): boolean {
	// SOF0–SOF15, except the three in that range that are not frames: DHT (0xC4),
	// JPG (0xC8) and DAC (0xCC).
	return marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
}

/**
 * EXIF orientation out of an APP1 segment, or null if it is not there.
 *
 * The segment holds a TIFF header, which decides its own endianness, then an IFD whose
 * entries are 12 bytes each. Orientation is tag 0x0112. Anything malformed returns null
 * rather than throwing: this is a hint for choosing a decode size, not a parse the upload
 * depends on.
 */
function readExifOrientation(view: DataView, start: number, end: number): number | null {
	// 'Exif\0\0' then the TIFF header.
	if (end - start < 14) return null;
	if (view.getUint32(start) !== 0x45786966 || view.getUint16(start + 4) !== 0) return null;

	const tiff = start + 6;
	const byteOrder = view.getUint16(tiff);
	if (byteOrder !== 0x4949 && byteOrder !== 0x4d4d) return null;
	const little = byteOrder === 0x4949;

	if (view.getUint16(tiff + 2, little) !== 42) return null;

	const ifdOffset = view.getUint32(tiff + 4, little);
	const ifd = tiff + ifdOffset;
	if (ifd + 2 > end) return null;

	const entries = view.getUint16(ifd, little);
	for (let i = 0; i < entries; i++) {
		const entry = ifd + 2 + i * 12;
		if (entry + 12 > end) return null;
		if (view.getUint16(entry, little) === 0x0112) {
			const value = view.getUint16(entry + 8, little);
			return value >= 1 && value <= 8 ? value : null;
		}
	}
	return null;
}

/**
 * Pixel dimensions from an image's header, without decoding it.
 *
 * This exists so a photo can be decoded straight to the size it is wanted at. A phone
 * camera hands over 50 megapixels or more, and decoding that to a full-resolution bitmap
 * costs width × height × 4 bytes — over 200 MB before any resizing happens, which is enough
 * to have the tab killed on a mid-range Android. Knowing the dimensions up front means
 * asking the decoder for a small bitmap instead, and never allocating the large one.
 *
 * Returns null when the bytes are unrecognised, truncated before the dimensions, or claim
 * a nonsensical size. Null means "decode it the ordinary way", never "reject it".
 */
export function readImageHeader(bytes: Uint8Array): ImageHeader | null {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const contentType = detectPhotoContentType(bytes);

	const sane = (width: number, height: number, orientation: number | null): ImageHeader | null =>
		Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0 ? { width, height, orientation } : null;

	if (contentType === 'image/png') {
		// Eight-byte signature, then a chunk header, then IHDR: width and height first.
		if (bytes.length < 24) return null;
		return sane(view.getUint32(16), view.getUint32(20), null);
	}

	if (contentType === 'image/webp') {
		// RIFF header is 12 bytes, then a chunk id and size, then the format's own header.
		if (bytes.length < 30) return null;
		const chunk = String.fromCharCode(bytes[12]!, bytes[13]!, bytes[14]!, bytes[15]!);

		if (chunk === 'VP8X') {
			// Canvas size is stored minus one, in three bytes each, little-endian.
			const width = 1 + (bytes[24]! | (bytes[25]! << 8) | (bytes[26]! << 16));
			const height = 1 + (bytes[27]! | (bytes[28]! << 8) | (bytes[29]! << 16));
			return sane(width, height, null);
		}
		if (chunk === 'VP8 ') {
			// Lossy: a three-byte frame tag, the three-byte sync code, then the sizes, each
			// 14 bits with two bits of scale above them.
			if (bytes.length < 30) return null;
			return sane(view.getUint16(26, true) & 0x3fff, view.getUint16(28, true) & 0x3fff, null);
		}
		if (chunk === 'VP8L') {
			// Lossless: a one-byte signature, then 14 bits of width and 14 of height, each
			// stored minus one, packed little-endian across four bytes.
			const bits = view.getUint32(21, true);
			return sane(1 + (bits & 0x3fff), 1 + ((bits >> 14) & 0x3fff), null);
		}
		return null;
	}

	if (contentType !== 'image/jpeg') return null;

	// Walk the segment chain from just after the SOI marker. Each segment is a 0xFF byte, a
	// marker, and a two-byte length that counts itself.
	let offset = 2;
	let orientation: number | null = null;

	while (offset + 4 <= bytes.length) {
		if (bytes[offset] !== 0xff) {
			// Not on a marker boundary. Fill bytes are legal between segments; anything else
			// means this is not a chain we can follow, and guessing would be worse than
			// falling back to a plain decode.
			offset += 1;
			continue;
		}

		const marker = bytes[offset + 1]!;
		if (marker === 0xff) {
			offset += 1; // Fill byte.
			continue;
		}
		// Standalone markers, which carry no length: SOI, EOI, RSTn and TEM.
		if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
			offset += 2;
			continue;
		}
		// Start of scan: entropy-coded data from here on, and no header left to find.
		if (marker === 0xda || marker === 0xd9) return null;

		const length = view.getUint16(offset + 2);
		if (length < 2) return null;
		const segment = offset + 4;
		const end = offset + 2 + length;
		if (end > bytes.length) return null;

		if (marker === 0xe1 && orientation === null) {
			orientation = readExifOrientation(view, segment, end);
		}

		if (isStartOfFrame(marker)) {
			// Precision byte, then height, then width.
			if (segment + 5 > bytes.length) return null;
			return sane(view.getUint16(segment + 3), view.getUint16(segment + 1), orientation);
		}

		offset = end;
	}

	return null;
}

/**
 * The size to decode a photo at, or null when it is already small enough.
 *
 * Expressed in displayed pixels, meaning after any EXIF rotation, because that is the
 * orientation a decoder hands back and therefore the one a resize request is measured in.
 * Asking in stored order for a quarter-turned photo squashes it.
 */
export function photoDecodeTarget(header: ImageHeader): { width: number; height: number } | null {
	const swapped = orientationSwapsAxes(header.orientation);
	const width = swapped ? header.height : header.width;
	const height = swapped ? header.width : header.height;

	const longEdge = Math.max(width, height);
	if (longEdge <= PHOTO_MAX_LONG_EDGE) return null;

	const scale = PHOTO_MAX_LONG_EDGE / longEdge;
	return {
		width: Math.max(1, Math.round(width * scale)),
		height: Math.max(1, Math.round(height * scale))
	};
}

export const TeamPhotoSchema = z.object({
	id: z.uuidv4(),
	teamId: z.uuidv4(),
	contentType: PhotoContentTypeSchema,
	byteSize: z.number().int().positive().max(MAX_PHOTO_BYTES),
	createdAt: z.number().int(), // unix ms
	createdByDeviceId: z.uuidv4(),
	createdByJudgeId: z.uuidv4().nullable(),
	/** Unguessable capability secret embedded in the stable media URL */
	viewSecret: z.string().min(1)
});

export type TeamPhoto = z.infer<typeof TeamPhotoSchema>;

export const CreatePhotoUploadInputSchema = z.object({
	teamId: z.uuidv4(),
	contentType: PhotoContentTypeSchema,
	byteSize: z.number().int().positive().max(MAX_PHOTO_BYTES),
	judgeId: z.uuidv4().nullable()
});

export type CreatePhotoUploadInput = z.infer<typeof CreatePhotoUploadInputSchema>;

export const CreatePhotoUploadResultSchema = z.object({
	photoId: z.uuidv4(),
	uploadToken: z.string().min(1),
	uploadUrl: z.string().min(1)
});

export type CreatePhotoUploadResult = z.infer<typeof CreatePhotoUploadResultSchema>;

export const TeamPhotoUpdateSchema = z.discriminatedUnion('action', [
	z.object({
		action: z.literal('added'),
		photo: TeamPhotoSchema
	}),
	z.object({
		action: z.literal('deleted'),
		photoId: z.uuidv4(),
		teamId: z.uuidv4()
	})
]);

export type TeamPhotoUpdate = z.infer<typeof TeamPhotoUpdateSchema>;

/** Stable, cacheable photo URL path (roomId/photoId/viewSecret are the capability). */
export function buildPhotoViewPath(roomId: string, photoId: string, viewSecret: string): string {
	return `/media/photo?roomId=${encodeURIComponent(roomId)}&photoId=${encodeURIComponent(photoId)}&secret=${encodeURIComponent(viewSecret)}`;
}
