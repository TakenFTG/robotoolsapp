import type { Config } from 'drizzle-kit';

/**
 * Ref rooms have their own database, so they have their own migration set — a room or
 * group migration can never run against a ref room's storage, or the reverse.
 */
export default {
	schema: './src/ref/schema.ts',
	out: './drizzle/ref-migrations',
	dialect: 'sqlite'
} satisfies Config;
