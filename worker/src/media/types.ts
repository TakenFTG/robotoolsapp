/**
 * Photo storage, as the media routes see it.
 *
 * Kept as an interface even though there is now only one implementation: the routes are
 * shared with the web workspace's typecheck and have no business knowing where bytes
 * live. Bytes rather than a stream, because they come out of a SQLite blob whole and
 * wrapping that in a stream only to read it straight back adds nothing.
 */
export interface PhotosObjectBody {
	bytes: Uint8Array;
	contentType: string;
}

export interface PhotosBucket {
	put(photoId: string, bytes: Uint8Array, contentType: string): Promise<void>;
	get(photoId: string): Promise<PhotosObjectBody | null>;
	delete(photoId: string | string[]): Promise<void>;
}
