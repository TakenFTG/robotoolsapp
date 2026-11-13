import { describe, it, expect } from 'vitest';
import { orientationSwapsAxes, photoDecodeTarget, readImageHeader, PHOTO_MAX_LONG_EDGE, type ImageHeader } from './media';

/**
 * Minimal but real encoded headers.
 *
 * Written by hand rather than checked in as image files, so what each byte is for stays
 * visible: these tests are about parsing a header, and a binary fixture would hide the
 * thing under test. The parser was separately checked against JPEG, PNG and WebP files
 * produced by an actual encoder at known sizes, including all eight EXIF orientations.
 */

function jpeg(options: { width: number; height: number; orientation?: number; marker?: number }): Uint8Array {
	const bytes: number[] = [0xff, 0xd8];

	if (options.orientation !== undefined) {
		// APP1: 'Exif\0\0', a little-endian TIFF header, then a one-entry IFD holding
		// orientation as a SHORT.
		const payload = [
			0x45,
			0x78,
			0x69,
			0x66,
			0x00,
			0x00, // Exif\0\0
			0x49,
			0x49,
			0x2a,
			0x00, // little-endian, magic 42
			0x08,
			0x00,
			0x00,
			0x00, // first IFD at offset 8
			0x01,
			0x00, // one entry
			0x12,
			0x01, // tag 0x0112, orientation
			0x03,
			0x00, // type SHORT
			0x01,
			0x00,
			0x00,
			0x00, // one value
			options.orientation & 0xff,
			0x00,
			0x00,
			0x00
		];
		const length = payload.length + 2;
		bytes.push(0xff, 0xe1, (length >> 8) & 0xff, length & 0xff, ...payload);
	}

	// A comment segment, so the frame header is not the first thing found.
	bytes.push(0xff, 0xfe, 0x00, 0x04, 0x41, 0x42);

	// SOF: length, precision, height, width, one component.
	bytes.push(
		0xff,
		options.marker ?? 0xc0,
		0x00,
		0x0b,
		0x08,
		(options.height >> 8) & 0xff,
		options.height & 0xff,
		(options.width >> 8) & 0xff,
		options.width & 0xff,
		0x01,
		0x01,
		0x11,
		0x00
	);

	return new Uint8Array(bytes);
}

function png(width: number, height: number): Uint8Array {
	const bytes = new Uint8Array(24);
	bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
	const view = new DataView(bytes.buffer);
	view.setUint32(8, 13);
	bytes.set([0x49, 0x48, 0x44, 0x52], 12); // IHDR
	view.setUint32(16, width);
	view.setUint32(20, height);
	return bytes;
}

function webpLossy(width: number, height: number): Uint8Array {
	const bytes = new Uint8Array(32);
	bytes.set([0x52, 0x49, 0x46, 0x46]); // RIFF
	bytes.set([0x57, 0x45, 0x42, 0x50], 8); // WEBP
	bytes.set([0x56, 0x50, 0x38, 0x20], 12); // 'VP8 '
	const view = new DataView(bytes.buffer);
	view.setUint16(26, width, true);
	view.setUint16(28, height, true);
	return bytes;
}

describe('readImageHeader', () => {
	it('reads JPEG dimensions from the frame header', () => {
		expect(readImageHeader(jpeg({ width: 4000, height: 3000 }))).toEqual({ width: 4000, height: 3000, orientation: null });
	});

	it('reads dimensions from a progressive frame marker too', () => {
		expect(readImageHeader(jpeg({ width: 800, height: 600, marker: 0xc2 }))).toEqual({ width: 800, height: 600, orientation: null });
	});

	it('reads EXIF orientation when the camera set one', () => {
		expect(readImageHeader(jpeg({ width: 2000, height: 1500, orientation: 6 }))).toEqual({
			width: 2000,
			height: 1500,
			orientation: 6
		});
	});

	it('reads PNG dimensions', () => {
		expect(readImageHeader(png(1024, 768))).toEqual({ width: 1024, height: 768, orientation: null });
	});

	it('reads lossy WebP dimensions', () => {
		expect(readImageHeader(webpLossy(640, 480))).toEqual({ width: 640, height: 480, orientation: null });
	});

	it('returns null rather than throwing on anything it cannot read', () => {
		const hostile: [string, Uint8Array][] = [
			['empty', new Uint8Array(0)],
			['html', new TextEncoder().encode('<!doctype html><script>alert(1)</script>')],
			['SOI only', new Uint8Array([0xff, 0xd8])],
			['zero-length segment', new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x00])],
			['segment length past the end', new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x7f, 0xff, 0x00])],
			['PNG claiming no pixels', png(0, 0)],
			['RIFF that is not WebP', new TextEncoder().encode('RIFF____NOPEsomethingsomething')],
			['all 0xff', new Uint8Array(64).fill(0xff)]
		];

		for (const [label, bytes] of hostile) {
			expect([label, readImageHeader(bytes)]).toEqual([label, null]);
		}
	});

	it('stops at the start of scan instead of reading compressed data as a header', () => {
		// A frame marker appearing inside entropy-coded data is not a frame header.
		const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0x00, 0x02, 0xff, 0xc0, 0x00, 0x11, 8, 1, 2, 3, 4]);
		expect(readImageHeader(bytes)).toBeNull();
	});

	it('never reports wrong dimensions for a truncated file', () => {
		const full = jpeg({ width: 2000, height: 1500, orientation: 6 });
		for (let length = 0; length <= full.length; length++) {
			const header = readImageHeader(full.subarray(0, length));
			if (header) {
				expect([length, header.width, header.height]).toEqual([length, 2000, 1500]);
			}
		}
	});
});

describe('photoDecodeTarget', () => {
	const header = (width: number, height: number, orientation: number | null = null): ImageHeader => ({
		width,
		height,
		orientation
	});

	it('leaves an image that is already small enough alone', () => {
		expect(photoDecodeTarget(header(PHOTO_MAX_LONG_EDGE, 400))).toBeNull();
	});

	it('shrinks the long edge to the limit', () => {
		const target = photoDecodeTarget(header(8000, 6000));

		expect(target).toEqual({ width: PHOTO_MAX_LONG_EDGE, height: (PHOTO_MAX_LONG_EDGE * 6000) / 8000 });
	});

	it('keeps the aspect ratio for a portrait photo', () => {
		const target = photoDecodeTarget(header(3000, 4000))!;

		expect(target.height).toBe(PHOTO_MAX_LONG_EDGE);
		expect(target.width / target.height).toBeCloseTo(3000 / 4000, 2);
	});

	it('measures a quarter-turned photo in the orientation it will be decoded to', () => {
		// Stored landscape, displayed portrait. Asking in stored order would squash it.
		const target = photoDecodeTarget(header(4000, 3000, 6))!;

		expect(target.height).toBeGreaterThan(target.width);
		expect(target.width / target.height).toBeCloseTo(3000 / 4000, 2);
	});

	it('does not swap for orientations that only flip', () => {
		expect(photoDecodeTarget(header(4000, 3000, 2))).toEqual(photoDecodeTarget(header(4000, 3000, 1)));
	});

	it('never asks for a zero-pixel bitmap', () => {
		const target = photoDecodeTarget(header(20000, 1))!;

		expect(target.height).toBeGreaterThanOrEqual(1);
	});
});

describe('orientationSwapsAxes', () => {
	it('is true only for the quarter turns', () => {
		expect([1, 2, 3, 4].map(orientationSwapsAxes)).toEqual([false, false, false, false]);
		expect([5, 6, 7, 8].map(orientationSwapsAxes)).toEqual([true, true, true, true]);
		expect(orientationSwapsAxes(null)).toBe(false);
	});
});
