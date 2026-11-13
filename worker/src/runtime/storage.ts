import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import fs from 'node:fs';
import path from 'node:path';
import { Mutex } from './mutex';

/**
 * On-disk storage, one SQLite file per thing that used to be a Durable Object.
 *
 * The isolation the design depends on — a room's data being reachable only through that
 * room — was previously a property of the platform. Here it is a property of the
 * filesystem: each room is its own file, destroying a room deletes that file, and no
 * query can reach across one. Backing the service up is copying a directory.
 */

export type AppDatabase = BetterSQLite3Database;

export type OpenDatabase = {
	db: AppDatabase;
	sqlite: Database.Database;
	/** Serializes every entry point that touches this database. See ./mutex.ts. */
	mutex: Mutex;
	close(): void;
};

/**
 * Raw handles, keyed by the drizzle instance the rest of the code passes around.
 *
 * `transaction()` needs the underlying connection to issue BEGIN/COMMIT, but every
 * function signature in the codebase takes a drizzle database. A WeakMap keeps that
 * plumbing out of the signatures rather than threading a second argument everywhere.
 */
const handles = new WeakMap<object, { sqlite: Database.Database; mutex: Mutex }>();

export function getHandle(db: object): { sqlite: Database.Database; mutex: Mutex } | null {
	return handles.get(db) ?? null;
}

export function openDatabase(file: string, migrationsFolder: string): OpenDatabase {
	fs.mkdirSync(path.dirname(file), { recursive: true });

	const sqlite = new Database(file);
	// WAL: readers never block the writer, and a crash mid-write leaves a recoverable file
	// rather than a corrupt one. FULL rather than NORMAL because losing an already-
	// acknowledged rubric to a power cut is not an acceptable trade for write speed.
	sqlite.pragma('journal_mode = WAL');
	sqlite.pragma('synchronous = FULL');
	sqlite.pragma('foreign_keys = ON');

	const db = drizzle(sqlite);
	migrate(db, { migrationsFolder });

	const mutex = new Mutex();
	handles.set(db, { sqlite, mutex });

	return {
		db,
		sqlite,
		mutex,
		close: () => sqlite.close()
	};
}

/** Where everything lives. One directory, so backups and restores are unambiguous. */
export class DataDirectory {
	constructor(private readonly root: string) {}

	roomFile(roomId: string): string {
		return path.join(this.root, 'rooms', `${this.safe(roomId)}.sqlite`);
	}

	groupFile(groupId: string): string {
		return path.join(this.root, 'groups', `${this.safe(groupId)}.sqlite`);
	}

	adminFile(): string {
		return path.join(this.root, 'admin.sqlite');
	}

	/** Ref rooms sit in their own folder, so nothing that lists Judges' Rooms ever sees one. */
	refRoomFile(roomId: string): string {
		return path.join(this.root, 'ref-rooms', `${this.safe(roomId)}.sqlite`);
	}

	listRefRoomIds(): string[] {
		const dir = path.join(this.root, 'ref-rooms');
		if (!fs.existsSync(dir)) {
			return [];
		}
		return fs
			.readdirSync(dir)
			.filter((name) => name.endsWith('.sqlite'))
			.map((name) => name.slice(0, -'.sqlite'.length));
	}

	roomExists(roomId: string): boolean {
		return fs.existsSync(this.roomFile(roomId));
	}

	refRoomExists(roomId: string): boolean {
		return fs.existsSync(this.refRoomFile(roomId));
	}

	groupExists(groupId: string): boolean {
		return fs.existsSync(this.groupFile(groupId));
	}

	removeRefRoom(roomId: string): void {
		const file = this.refRoomFile(roomId);
		for (const suffix of ['', '-wal', '-shm']) {
			fs.rmSync(`${file}${suffix}`, { force: true });
		}
	}

	/**
	 * Every room on disk.
	 *
	 * This is the thing self-hosting makes possible and the platform did not: Durable
	 * Objects cannot be enumerated, so the operator's list could only ever show rooms that
	 * had registered themselves. A directory can simply be read, so the list can be
	 * complete — including rooms created before the registry existed.
	 */
	listRoomIds(): string[] {
		const dir = path.join(this.root, 'rooms');
		if (!fs.existsSync(dir)) {
			return [];
		}
		return fs
			.readdirSync(dir)
			.filter((name) => name.endsWith('.sqlite'))
			.map((name) => name.slice(0, -'.sqlite'.length));
	}

	/** When a room's file was last written, or null if it is not there. */
	roomModifiedAt(roomId: string): Date | null {
		// The newest of the database and its WAL sidecar.
		//
		// In WAL mode a write goes to `-wal` and the main file is only touched at a
		// checkpoint, so statting the database alone can report a room as idle for hours
		// while judges are actively typing into it. For retention that is the difference
		// between "quiet since Sunday" and "deleted mid-event".
		const file = this.roomFile(roomId);
		let newest: number | null = null;

		for (const candidate of [file, `${file}-wal`]) {
			try {
				const time = fs.statSync(candidate).mtimeMs;
				newest = newest === null ? time : Math.max(newest, time);
			} catch {
				// Missing sidecar is normal; a missing database means no room.
			}
		}

		return newest === null ? null : new Date(newest);
	}

	/** Remove a room's file and its WAL sidecars. Destroying a room destroys the file. */
	removeRoom(roomId: string): void {
		const file = this.roomFile(roomId);
		for (const suffix of ['', '-wal', '-shm']) {
			fs.rmSync(`${file}${suffix}`, { force: true });
		}
	}

	/**
	 * Ids are uuids, but they arrive from the network and end up in a path, so they are
	 * checked rather than trusted. Anything unexpected is not sanitised into something
	 * plausible — it is refused.
	 */
	private safe(id: string): string {
		if (!/^[a-zA-Z0-9-]{1,64}$/.test(id)) {
			throw new Error('Invalid identifier');
		}
		return id;
	}
}

/**
 * Find the `drizzle` directory that holds the migration sets.
 *
 * It cannot be resolved by a fixed number of `..` hops: from source this file sits in
 * `src/runtime`, from the esbuild bundle it sits in `dist`, and in the container `dist`
 * and `drizzle` are siblings under `/app`. So walk up until it turns up, and say plainly
 * where it looked if it does not — a server that cannot find its migrations is dead
 * anyway, and the useful thing is to fail with the paths in hand.
 *
 * `MIGRATIONS_DIR` overrides the search for unusual layouts.
 */
let cachedMigrationsRoot: string | null = null;

function migrationsRoot(): string {
	if (cachedMigrationsRoot) {
		return cachedMigrationsRoot;
	}

	const override = process.env.MIGRATIONS_DIR;
	if (override) {
		cachedMigrationsRoot = path.resolve(override);
		return cachedMigrationsRoot;
	}

	const tried: string[] = [];
	let dir = import.meta.dirname;

	// Bounded so a missing directory cannot walk to the filesystem root and beyond.
	for (let depth = 0; depth < 6; depth++) {
		const candidate = path.join(dir, 'drizzle');
		tried.push(candidate);
		if (fs.existsSync(path.join(candidate, 'migrations', 'meta', '_journal.json'))) {
			cachedMigrationsRoot = candidate;
			return candidate;
		}
		const parent = path.dirname(dir);
		if (parent === dir) {
			break;
		}
		dir = parent;
	}

	throw new Error(
		`Could not find the drizzle migrations directory. Looked in:\n  ${tried.join('\n  ')}\n` + 'Set MIGRATIONS_DIR to point at it.'
	);
}

export function migrationsPath(name: 'migrations' | 'group-migrations' | 'admin-migrations' | 'ref-migrations'): string {
	return path.join(migrationsRoot(), name);
}

/**
 * Resolve the migrations up front.
 *
 * Databases are opened lazily, on the first connection to a room — so without this, a
 * packaging mistake surfaces as a crash when someone tries to judge rather than when the
 * server starts. Called from createServer so it fails at boot, loudly.
 */
export function assertMigrationsAvailable(): void {
	for (const name of ['migrations', 'group-migrations', 'admin-migrations', 'ref-migrations'] as const) {
		const journal = path.join(migrationsPath(name), 'meta', '_journal.json');
		if (!fs.existsSync(journal)) {
			throw new Error(`Missing migration set: ${journal}`);
		}
	}
}
