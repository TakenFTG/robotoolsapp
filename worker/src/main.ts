import path from 'node:path';
import { createServer } from './server';
import { readEmailConfiguration, type EmailConfiguration } from './email/config';
import { getRobotEventsToken } from './matches/source';

/**
 * Entry point.
 *
 * All configuration is environment variables, so the same build runs from a shell, a
 * systemd unit or a container without a config file to keep in sync.
 */

const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? '0.0.0.0';
const dataDir = path.resolve(process.env.DATA_DIR ?? './data');

// Defaults to the sibling web build, which is where `bun run build` puts it.
const staticDirRaw = process.env.STATIC_DIR ?? path.resolve(import.meta.dirname, '..', '..', 'web', 'build');
const staticDir = staticDirRaw === 'none' ? null : path.resolve(staticDirRaw);

const adminUsername = process.env.ADMIN_USERNAME?.trim() || null;
const adminPassword = process.env.ADMIN_PASSWORD?.trim() || null;

if (!Number.isFinite(port) || port <= 0) {
	console.error('PORT must be a positive number');
	process.exit(1);
}

// Half-configured is a trap: an admin surface that answers with a username and no
// password, or the reverse, is worse than one that is plainly off.
if (!!adminUsername !== !!adminPassword) {
	console.error('Set both ADMIN_USERNAME and ADMIN_PASSWORD, or neither');
	process.exit(1);
}

/**
 * Mail configuration is validated here rather than at first send.
 *
 * A typo in SMTP_FROM that only surfaces when a Judge Advisor tries to invite a panel
 * surfaces at the worst possible moment. readEmailConfiguration throws on anything
 * half-set, and an unconfigured server simply cannot send — which is the default.
 */
let email: EmailConfiguration;
try {
	email = readEmailConfiguration(process.env);
} catch (error) {
	console.error(error instanceof Error ? error.message : error);
	process.exit(1);
}

/**
 * Retention.
 *
 * On by default, because the alternative is confidential judging material sitting on a
 * server until somebody remembers to remove it, and the privacy policy promises otherwise.
 * Both numbers are configurable and the whole thing can be switched off, since what counts
 * as "over" differs between operators.
 */
const retentionEnabled = (process.env.RETENTION_ENABLED ?? 'true').trim() !== 'false';
const deleteAfterDays = Number(process.env.RETENTION_DELETE_AFTER_DAYS ?? 7);
const warnAfterDays = Number(process.env.RETENTION_WARN_AFTER_DAYS ?? 6);

if (retentionEnabled) {
	if (!Number.isFinite(deleteAfterDays) || deleteAfterDays <= 0) {
		console.error('RETENTION_DELETE_AFTER_DAYS must be a positive number of days');
		process.exit(1);
	}
	// A warning after the deletion would never be sent, and the operator would not find
	// out until an event vanished without notice.
	if (!Number.isFinite(warnAfterDays) || warnAfterDays <= 0 || warnAfterDays >= deleteAfterDays) {
		console.error('RETENTION_WARN_AFTER_DAYS must be a positive number of days, and less than RETENTION_DELETE_AFTER_DAYS');
		process.exit(1);
	}
}

const retention = { enabled: retentionEnabled, deleteAfterDays, warnAfterDays };

const { server, hub } = createServer({ port, host, dataDir, staticDir, adminUsername, adminPassword, email, retention });

server.listen(port, host, () => {
	console.log(`Judges' Room listening on http://${host}:${port}`);
	console.log(`  data:   ${dataDir}`);
	console.log(`  static: ${staticDir ?? '(disabled)'}`);
	console.log(`  vex:    ${getRobotEventsToken() ? 'API key set' : 'no API key — match schedule disabled (set ROBOTEVENTS_TOKEN)'}`);
	console.log(`  admin:  ${adminUsername ? 'enabled' : 'disabled (set ADMIN_USERNAME and ADMIN_PASSWORD)'}`);
	console.log(
		`  email:  ${email.sender.enabled ? `enabled, from ${email.sender.fromAddress}` : 'disabled (set SMTP_HOST, SMTP_FROM and PUBLIC_ORIGIN)'}`
	);
});

/**
 * Shut down deliberately.
 *
 * SQLite in WAL mode needs its connections closed to checkpoint cleanly. Killing the
 * process without this leaves recoverable but untidy files, and on a judging weekend the
 * restart that follows is the worst possible time to discover that.
 */
let shuttingDown = false;
function shutdown(signal: string): void {
	if (shuttingDown) {
		return;
	}
	shuttingDown = true;
	console.log(`\nReceived ${signal}, shutting down…`);

	// Hang up first. `server.close()` stops accepting new connections and then waits for the
	// existing ones to end — and a WebSocket never ends on its own, so with judges connected
	// the callback below simply never ran and shutdown took the full fallback every time.
	// Closing them here is what makes the rest of this immediate.
	hub.closeConnections();

	// Keep-alive HTTP connections are the same problem in miniature.
	server.closeIdleConnections();

	server.close(() => {
		hub.close();
		process.exit(0);
	});

	// A safety net, not the normal path. Short, because by the time this fires the sockets
	// are already gone and something unexpected is holding the loop open — waiting longer
	// will not help, and the databases are checkpointed either way.
	setTimeout(() => {
		console.warn('Connections did not settle; closing anyway.');
		hub.close();
		process.exit(0);
	}, 2_000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

/**
 * Log unhandled rejections rather than dying of them.
 *
 * Node's default is to exit, which for a judging server means every connected device is
 * dropped mid-event because one background broadcast failed. The right trade here is to
 * stay up and be loud: the failure is recorded with its stack, and the people in the room
 * keep working. An uncaught *exception* is a different matter and is left to crash, since
 * by then the process state is not to be trusted.
 */
process.on('unhandledRejection', (reason) => {
	console.error('Unhandled promise rejection:', reason);
});
