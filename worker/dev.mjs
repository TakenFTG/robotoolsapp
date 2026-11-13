import { spawn } from 'node:child_process';
import esbuild from 'esbuild';

/**
 * Dev runner: build, run, rebuild on change, restart.
 *
 * Node's `--experimental-strip-types` cannot run this codebase — it only erases types, and
 * both parameter properties (`constructor(private readonly opts)`) and wrpc's
 * `ConnectionCloseCode` enum emit real code. Rather than contort the source to suit a
 * stripper, dev uses the same esbuild bundle production does, so there is one toolchain
 * and one set of TypeScript semantics to reason about.
 */

const BUILD = {
	entryPoints: ['src/main.ts'],
	bundle: true,
	platform: 'node',
	target: 'node22',
	format: 'esm',
	outfile: 'dist/server.js',
	sourcemap: true,
	// Native module, and ws is left to Node so it uses the installed build.
	external: ['better-sqlite3', 'ws'],
	banner: { js: "import{createRequire}from'module';const require=createRequire(import.meta.url);" }
};

let child = null;

function restart() {
	if (child) {
		child.kill('SIGTERM');
	}
	// worker/.env (gitignored) supplies local settings such as ROBOTEVENTS_TOKEN, the same
	// variables judging.env carries in production. Optional: the server runs without it.
	child = spawn(process.execPath, ['--env-file-if-exists=.env', 'dist/server.js'], { stdio: 'inherit' });
	child.on('exit', (code, signal) => {
		// A clean restart kills with SIGTERM; anything else is the server actually failing.
		if (signal !== 'SIGTERM' && code !== 0) {
			console.error(`\nServer exited with code ${code}. Waiting for changes…`);
		}
	});
}

const context = await esbuild.context({
	...BUILD,
	plugins: [
		{
			name: 'restart',
			setup(build) {
				build.onEnd((result) => {
					if (result.errors.length > 0) {
						console.error('Build failed; keeping the previous server running.');
						return;
					}
					restart();
				});
			}
		}
	]
});

await context.watch();
console.log('Watching for changes…');

for (const signal of ['SIGINT', 'SIGTERM']) {
	process.on(signal, () => {
		child?.kill('SIGTERM');
		void context.dispose().then(() => process.exit(0));
	});
}
