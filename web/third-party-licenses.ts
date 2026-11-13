/**
 * Writes `third-party-licenses.txt` into the client build: every npm package bundled into
 * the browser code, with its version, its declared licence and the licence text it ships.
 *
 * Minifying strips the copyright comments that many of these licences (MIT, BSD, ISC and
 * the like) require to travel with every copy, so this file is where those notices live.
 * It covers the client build only, because that is the code handed to visitors; the
 * server is not distributed.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { Plugin } from 'vite';

const FILE_NAME = 'third-party-licenses.txt';
const LICENSE_FILE = /^(licen[cs]e|copying|notice)(\.(md|txt|markdown))?$/i;

interface Package {
	name: string;
	version: string;
	license: string;
	texts: string[];
}

/** The directory of the package that owns `file`: the nearest package.json with a name. */
function packageRoot(file: string): string | null {
	let dir = path.dirname(file);
	while (dir.includes(`${path.sep}node_modules${path.sep}`)) {
		const manifest = path.join(dir, 'package.json');
		if (fs.existsSync(manifest)) {
			try {
				if (JSON.parse(fs.readFileSync(manifest, 'utf8')).name) return dir;
			} catch {
				// An unreadable manifest is not a package root; keep walking up.
			}
		}
		dir = path.dirname(dir);
	}
	return null;
}

function readPackage(root: string): Package {
	const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
	const declared = manifest.license ?? manifest.licenses;
	const license =
		typeof declared === 'string'
			? declared
			: Array.isArray(declared)
				? declared.map((l) => l.type ?? l).join(' OR ')
				: (declared?.type ?? 'UNKNOWN');
	const texts = fs
		.readdirSync(root)
		.filter((f) => LICENSE_FILE.test(f))
		.sort()
		.map((f) => fs.readFileSync(path.join(root, f), 'utf8').trim());
	return { name: manifest.name, version: manifest.version ?? '', license, texts };
}

export function thirdPartyLicenses(): Plugin {
	return {
		name: 'third-party-licenses',
		apply: 'build',
		generateBundle(_options, bundle) {
			if (this.environment?.config.build.ssr) return;

			const roots = new Set<string>();
			for (const output of Object.values(bundle)) {
				if (output.type !== 'chunk') continue;
				for (const id of output.moduleIds) {
					const file = id.replace(/^\0/, '').split('?')[0];
					if (!file.includes(`${path.sep}node_modules${path.sep}`)) continue;
					const root = packageRoot(file);
					if (root) roots.add(fs.realpathSync(root));
				}
			}

			const packages = new Map<string, Package>();
			for (const root of roots) {
				const pkg = readPackage(root);
				packages.set(`${pkg.name}@${pkg.version}`, pkg);
			}
			const sorted = [...packages.values()].sort((a, b) => a.name.localeCompare(b.name));

			const rule = '-'.repeat(78);
			const sections = sorted.map((p) =>
				[
					rule,
					`${p.name} ${p.version}`,
					`License: ${p.license}`,
					'',
					p.texts.length > 0 ? p.texts.join('\n\n') : '(This package ships no licence file. Its package.json declares the licence above.)'
				].join('\n')
			);

			const header = [
				'Third-party software in robotools.app',
				'',
				'robotools.app is free software under the GNU General Public License v3.0.',
				'Its source code is at https://github.com/TakenFTG/robotoolsapp.',
				'',
				`The browser app includes the following ${sorted.length} packages, each under its own licence.`,
				''
			].join('\n');

			this.emitFile({
				type: 'asset',
				fileName: FILE_NAME,
				source: `${header}\n${sections.join('\n\n')}\n`
			});
		}
	};
}
