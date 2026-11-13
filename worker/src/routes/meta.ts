import { z } from 'zod';
import type { WRPCRootObject } from '@robotools.app/wrpc/server';
import type { ServerContext } from '../server-router';

/**
 * What is actually running here.
 *
 * Deliberately not the app version baked into the web bundle. That number describes the
 * product; this one describes the deployment, and the two answer different questions. When
 * a Judge Advisor reports something odd, the useful fact is which release the server is
 * on — which is the release tag CI built, not a constant in the source.
 */
export const ServerInfoSchema = z.object({
	/**
	 * The release tag this image was built from, or `dev` for an image built outside CI.
	 *
	 * `dev` is honest rather than apologetic: a locally built image genuinely has no
	 * release identity, and printing a plausible-looking version for one would be worse
	 * than admitting there isn't one.
	 */
	version: z.string()
});

/** Read once: the value cannot change without the process restarting. */
const serverVersion = process.env.APP_VERSION?.trim() || 'dev';

export function buildMetaRoute(w: WRPCRootObject<object, ServerContext, Record<string, never>>) {
	return {
		// No authentication check. The version is on the login page of most software and is
		// not a secret — and gating it would make it unavailable in exactly the situation
		// where someone is trying to work out why they cannot get in.
		getServerInfo: w.procedure.output(ServerInfoSchema).query(() => {
			return { version: serverVersion };
		})
	};
}
