/**
 * Render the whole branding kit, then run its QA. Node 22 runs this file directly (type stripping):
 *
 *   node src/branding/render.ts                 # everything, then QA
 *   node src/branding/render.ts --only=badge    # assets whose id contains "badge"
 *   node src/branding/render.ts --skip-video    # stills only
 *   node src/branding/render.ts --no-qa         # skip the QA run
 *
 * Bundles src/branding/index.ts once into out/brand/.bundle and renders every entry of assets.ts from it with the
 * Remotion CLI (stills as PNG; videos as H.264 with an empty AAC track). Exit code 1 if any render or check fails.
 */
import {spawnSync} from 'node:child_process';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {ASSETS, type Asset} from './assets.ts';
import {decodePng, encodePng, trimTransparent} from './qa/png.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const BUNDLE = join(ROOT, 'out', 'brand', '.bundle');

const args = process.argv.slice(2);
const only = args.find((a) => a.startsWith('--only='))?.slice('--only='.length);
const skipVideo = args.includes('--skip-video');
const noQa = args.includes('--no-qa');

const run = (cmd: string, argv: string[]): boolean => {
	const r = spawnSync(cmd, argv, {cwd: ROOT, stdio: ['ignore', 'inherit', 'inherit']});
	return r.status === 0;
};

const npxRemotion = (argv: string[]) => run('npx', ['remotion', ...argv, '--log=error']);

const renderAsset = (a: Asset): boolean => {
	const out = join(ROOT, a.out);
	mkdirSync(dirname(out), {recursive: true});
	const props = `--props=${JSON.stringify(a.props)}`;
	const ok =
		a.kind === 'still'
			? npxRemotion(['still', BUNDLE, a.composition, out, '--image-format=png', props, ...(a.frame !== undefined ? [`--frame=${a.frame}`] : [])])
			: npxRemotion(['render', BUNDLE, a.composition, out, props, ...(a.silentAudio ? ['--enforce-audio-track'] : [])]);
	if (ok && a.trim) writeFileSync(out, encodePng(trimTransparent(decodePng(readFileSync(out)))));
	return ok;
};

const main = (): number => {
	const list = ASSETS.filter((a) => (!only || a.id.includes(only)) && (!skipVideo || a.kind === 'still'));
	if (!list.length) {
		console.error(`no assets match ${only}`);
		return 1;
	}
	console.log(`bundling src/branding/index.ts -> ${BUNDLE}`);
	if (!npxRemotion(['bundle', 'src/branding/index.ts', '--out-dir', BUNDLE])) return 1;
	const failed: string[] = [];
	for (const a of list) {
		const t = Date.now();
		const ok = renderAsset(a);
		console.log(`${ok ? 'ok  ' : 'FAIL'} ${a.id} -> ${a.out} (${((Date.now() - t) / 1000).toFixed(1)} s)`);
		if (!ok) failed.push(a.id);
	}
	if (failed.length) {
		console.error(`render failed: ${failed.join(', ')}`);
		return 1;
	}
	if (noQa) return 0;
	return run(process.execPath, ['--disable-warning=MODULE_TYPELESS_PACKAGE_JSON', join(HERE, 'qa', 'run.ts')]) ? 0 : 1;
};

process.exit(main());
