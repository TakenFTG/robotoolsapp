import type { ClientAuthentication } from '@robotools.app/protocol/src/access';

/** Just the one call this helper makes. */
type AuthenticationNotifiable = {
	onClientAuthenticationChange: { mutation: (auth: ClientAuthentication) => Promise<unknown> };
};

/**
 * Tell a client its authentication changed, without waiting to be thanked.
 *
 * This is a notification, not a question. The client acts on the new authentication and
 * its acknowledgement tells the server nothing it goes on to use, so awaiting it buys
 * nothing and can cost a great deal.
 *
 * Every request in a room runs inside that room's mutex, and a client's reply arrives as
 * another message on the same socket — which used to queue on that same mutex. A handler
 * that sent a request to a client and waited for the reply was therefore waiting for a
 * message that could not be processed until the handler finished. Thirty seconds later
 * the request timed out and the caller was told "Internal server error". Unlocking a
 * Judge Advisor with a PIN, before PINs were removed, did exactly this.
 *
 * Room.attach now runs replies outside the lock, which breaks that cycle at the root.
 * Not awaiting remains the right shape regardless: a device that is backgrounded, asleep,
 * or on a phone that has switched apps may take a long time to answer, and no judging
 * action should be held up waiting for it.
 *
 * Takes the client proxy rather than the session so it does not have to restate WRPC's
 * generic chain — the call site already names the router it wants.
 */
export function notifyAuthenticationChange(client: AuthenticationNotifiable, authentication: ClientAuthentication): void {
	void client.onClientAuthenticationChange.mutation(authentication).catch((error: unknown) => {
		console.error('Failed to notify a client of its authentication change:', error);
	});
}
