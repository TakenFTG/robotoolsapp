import type { Config } from 'drizzle-kit';

/**
 * The EventGroup Durable Object has its own database, so it has its own migration set.
 * Keeping them apart is what stops a room migration from ever running against a group's
 * storage, or the reverse.
 */
export default {
	schema: './src/group/schema.ts',
	out: './drizzle/group-migrations',
	dialect: 'sqlite'
} satisfies Config;
