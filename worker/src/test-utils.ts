import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { awards, teams, metadata, judgeGroups, judgeAdvisors } from './db/schema';
import type { ServerContext } from './server-router';
import { Authentication } from './access/authentication';
import { generateAuthToken, JUDGE_ADVISOR_SINGLETON_ID } from './access/tokens';
import type { PhotosBucket } from './media/types';
import type { Network, ClientData } from '@robotools.app/wrpc/server/types';
import type { Award } from '@robotools.app/protocol/src/award';
import type { TeamData, TeamInfo } from '@robotools.app/protocol/src/team';
import { JudgesRoomNetwork } from './network/judges-room-network';
import type { EventGroupGateway } from './group/gateway';
import { noAdminRegistryGateway } from './admin/gateway';
import { disabledEmailSender, type EmailMessage } from './email/types';
import type { EmailContext } from './server-router';
import path from 'path';
import { cancelDeviceListBroadcast } from './routes/device';
import { noRefLinkGateway, type RefLinkGateway } from './ref/link-gateway';

/**
 * Creates an in-memory SQLite database for testing
 * This mocks the DrizzleSqliteDODatabase functionality needed for tests
 */
export function createTestDatabase() {
	// Create an in-memory SQLite database
	const sqlite = new Database(':memory:');
	const db = drizzle(sqlite);

	// Make transaction callback accept async functions in tests by bypassing real transactions
	// We don't test atomicity at unit level; this avoids better-sqlite3's sync-only transaction limitation
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const anyDb = db as any;
	const originalTransaction = anyDb.transaction?.bind(anyDb);
	anyDb.transaction = (cb: (tx: unknown) => unknown) => {
		try {
			return cb(anyDb);
		} catch (e) {
			// Fallback to original if needed
			return originalTransaction ? originalTransaction(cb) : cb(anyDb);
		}
	};

	// Apply Drizzle migrations to create the tables
	const migrationsFolder = path.join(__dirname, '../drizzle/migrations');
	migrate(db, { migrationsFolder });

	// Cast to match the expected DrizzleSqliteDODatabase interface
	// This works because both use the same drizzle-orm query API
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const testDb = db as any;

	return {
		db: testDb,
		sqlite,
		cleanup: () => {
			// Mirrors Room.close: a pending device-list timer would otherwise fire after the
			// connection is gone and log against a closed handle.
			cancelDeviceListBroadcast(db);
			sqlite.close();
		}
	};
}

/**
 * Creates a test server context with a test database
 */
function createMockPhotosBucket(): PhotosBucket {
	const objects = new Map<string, { bytes: Uint8Array; contentType: string }>();

	return {
		async get(photoId: string) {
			return objects.get(photoId) ?? null;
		},
		async put(photoId: string, bytes: Uint8Array, contentType: string) {
			objects.set(photoId, { bytes, contentType });
		},
		async delete(photoId: string | string[]) {
			for (const id of Array.isArray(photoId) ? photoId : [photoId]) {
				objects.delete(id);
			}
		}
	};
}

export type TestServerContextOptions = {
	/** Rooms learn their id from the connection; supply one when the test involves a group. */
	roomId?: string;
	/** Stands in for the EventGroup Durable Object. Defaults to "there is no group". */
	group?: EventGroupGateway;
	/**
	 * Mail. Defaults to disabled, matching an unconfigured server — so a test that means
	 * to exercise sending has to say so, and one that does not cannot accidentally pass
	 * because a stub silently succeeded.
	 */
	email?: EmailContext;
	/** Stands in for the hub's link to ref rooms. Defaults to "there are no ref rooms". */
	refLink?: RefLinkGateway;
};

/**
 * Records what would have been sent instead of sending it.
 *
 * Returned alongside the context so a test can assert on recipients and on the link in
 * the body — the link being the part that actually matters, and the part a mocked
 * transport is most likely to get wrong.
 */
export function createRecordingEmailContext(publicOrigin = 'https://judging.example.com'): EmailContext & { sent: EmailMessage[] } {
	const sent: EmailMessage[] = [];
	return {
		sent,
		publicOrigin,
		sender: {
			enabled: true,
			fromAddress: 'judging@example.com',
			async send(message: EmailMessage) {
				sent.push(message);
			}
		}
	};
}

export function createTestServerContext(options: TestServerContextOptions = {}): ServerContext & { cleanup: () => void } {
	const { db, cleanup } = createTestDatabase();

	// Minimal in-memory mock network implementation
	const connectedClientIds = new Set<string>();
	const connectedDeviceIds = new Set<string>();
	const clientData = new Map<string, ClientData>();

	const inner: Network = {
		async sendToClient() {
			return { kind: 'response', id: 'test', result: { type: 'data', data: null } };
		},
		async broadcast() {
			return [];
		},
		notifyClient(clientId: string) {
			if (!connectedClientIds.has(clientId)) {
				throw new Error(`Client ${clientId} is not connected`);
			}
		},
		notifyAll() {
			return [];
		},
		getConnectedClients() {
			return Array.from(connectedClientIds);
		},
		isClientConnected(clientId: string) {
			return connectedClientIds.has(clientId);
		},
		isDeviceConnected(deviceId: string) {
			return connectedDeviceIds.has(deviceId);
		},
		getAllClientData() {
			return Array.from(clientData.values());
		},
		getClientData(clientId: string) {
			return clientData.get(clientId) ?? null;
		},
		async kickClient(clientId: string) {
			connectedClientIds.delete(clientId);
		},
		async destroy() {
			connectedClientIds.clear();
			clientData.clear();
		}
	};

	const network = new JudgesRoomNetwork({
		inner,
		db,
		getWebSockets: () => [],
		group: options.group,
		// No RobotEvents in tests: an empty, unavailable snapshot is what a room with no
		// linked event returns anyway.
		matches: async () => ({ matches: [], rankings: [], skills: [], fetchedAt: null, error: null, available: false })
	});

	return {
		db,
		network,
		photos: createMockPhotosBucket(),
		auth: Authentication.unauthenticated(),
		roomId: options.roomId ?? null,
		registry: noAdminRegistryGateway,
		email: options.email ?? { sender: disabledEmailSender, publicOrigin: '' },
		refLink: options.refLink ?? noRefLinkGateway,
		cleanup
	};
}

/**
 * Sample test data for awards
 */
type AwardInDatabase = Award & { position: number };
export const sampleAwards: AwardInDatabase[] = [
	{
		name: 'Excellence Award',
		type: 'performance',
		acceptedGrades: ['High School', 'Middle School'],
		winnersCount: 1,
		requireNotebook: true,
		requireTeamInterview: true,
		position: 0
	},
	{
		name: 'Design Award',
		type: 'judged',
		acceptedGrades: ['High School'],
		winnersCount: 3,
		requireNotebook: true,
		requireTeamInterview: true,
		position: 1
	},
	{
		name: 'Teamwork Award',
		type: 'judged',
		acceptedGrades: ['Middle School', 'High School'],
		winnersCount: 2,
		requireNotebook: false,
		requireTeamInterview: false,
		position: 2
	},
	{
		name: 'Volunteer Award',
		type: 'volunteer_nominated',
		acceptedGrades: ['Elementary School', 'Middle School', 'High School'],
		winnersCount: 1,
		requireNotebook: false,
		requireTeamInterview: false,
		position: 3
	}
];

/**
 * Sample test data for team info
 */
export const sampleTeamInfoAndData: (TeamInfo & TeamData)[] = [
	{
		id: '550e8400-e29b-41d4-a716-446655440001',
		number: '123A',
		name: 'Robotics Team Alpha',
		city: 'San Francisco',
		state: 'CA',
		country: 'USA',
		shortName: 'Alpha',
		school: 'Tech High School',
		grade: 'High School',
		group: 'Group A',
		notebookLink: 'https://example.com/notebook',
		hasInnovateAwardSubmissionForm: false,
		notebookDevelopmentStatus: 'undetermined',
		hasSeasonSummary: false,
		absent: false
	},
	{
		id: '550e8400-e29b-41d4-a716-446655440002',
		number: '456B',
		name: 'Engineering Eagles',
		city: 'Austin',
		state: 'TX',
		country: 'USA',
		shortName: 'Eagles',
		school: 'Central Middle School',
		grade: 'Middle School',
		group: 'Group B',
		notebookLink: 'https://example.com/notebook',
		hasInnovateAwardSubmissionForm: false,
		notebookDevelopmentStatus: 'undetermined',
		hasSeasonSummary: false,
		absent: false
	},
	{
		id: '550e8400-e29b-41d4-a716-446655440003',
		number: '789C',
		name: 'Code Crushers',
		city: 'Seattle',
		state: 'WA',
		country: 'USA',
		shortName: 'Crushers',
		school: 'Innovation High',
		grade: 'High School',
		group: 'Group A',
		notebookLink: 'https://example.com/notebook',
		hasInnovateAwardSubmissionForm: false,
		notebookDevelopmentStatus: 'undetermined',
		hasSeasonSummary: false,
		absent: false
	},
	{
		id: '550e8400-e29b-41d4-a716-446655440004',
		number: '101D',
		name: 'Binary Builders',
		city: 'Portland',
		state: 'OR',
		country: 'USA',
		shortName: 'Builders',
		school: 'STEM Academy',
		grade: 'Middle School',
		group: 'Group C',
		notebookLink: 'https://example.com/notebook',
		hasInnovateAwardSubmissionForm: false,
		notebookDevelopmentStatus: 'undetermined',
		hasSeasonSummary: false,
		absent: false
	}
];

/**
 * Seeds the test database with sample data
 */
export async function seedTestDatabase(context: ServerContext) {
	// Insert one metadata row so essential data queries work
	await context.db.insert(metadata).values({
		eventName: 'Test Event',
		program: 'VIQRC',
		eventGradeLevel: 'MS Only',
		judgingMethod: 'assigned',
		judgingStep: 'beginning',
		accessControlEnabled: false
	});

	await context.db.insert(judgeAdvisors).values({
		id: JUDGE_ADVISOR_SINGLETON_ID,
		authToken: generateAuthToken()
	});

	// Insert a judge group so EssentialDataSchema (min 1) is satisfied
	await context.db.insert(judgeGroups).values({ id: 'group-1', name: 'Group 1' });

	// Insert sample awards
	// With { mode: 'json' }, Drizzle automatically handles JSON serialization
	await context.db.insert(awards).values(sampleAwards);

	// Insert sample team info
	await context.db.insert(teams).values(sampleTeamInfoAndData);
}
