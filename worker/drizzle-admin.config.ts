import type { Config } from 'drizzle-kit';

/**
 * The admin registry Durable Object has its own database, so it has its own migration
 * set — kept apart from the room and group sets so no migration can ever run against the
 * wrong storage.
 */
export default {
	schema: './src/admin/schema.ts',
	out: './drizzle/admin-migrations',
	dialect: 'sqlite'
} satisfies Config;
