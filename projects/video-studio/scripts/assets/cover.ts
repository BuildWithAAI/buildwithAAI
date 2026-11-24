/**
 * Podcast cover art: a 3000x3000 still of Zoo and Badger at the show desk, rendered from a Remotion still
 * composition when one exists. Run from projects/video-studio:
 *
 *   node scripts/assets/cover.ts <channel> [--entry src/episode/index.ts] [--composition PodcastCover] [--out <file.jpg>]
 *
 * The show set (src/show) and its cover composition belong to other workflows and do not exist yet (2026-11-24), so
 * today this prints the exact command to run once they land and exits 3 ("pending"). When the composition exists it
 * renders it, checks the result against Apple's show-art rules (square, 1400-3000 px, JPEG/PNG, RGB) and writes a
 * 3000 px JPEG. Exit codes: 0 written, 1 render or check failed, 2 usage, 3 composition not found.
 */
import {spawnSync} from 'node:child_process';
import {existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {checkCover, hasFfmpeg, squareJpeg} from './lib/audio.ts';
import {loadChannelConfig} from './lib/config.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const PROJECT = resolve(HERE, '../..');

const sourceFiles = (dir: string): string[] => {
	const out: string[] = [];
	for (const name of existsSync(dir) ? readdirSync(dir) : []) {
		const p = join(dir, name);
		if (statSync(p).isDirectory()) {
			if (name !== 'node_modules' && !name.startsWith('.')) out.push(...sourceFiles(p));
		} else if (/\.tsx?$/.test(name)) out.push(p);
	}
	return out;
};

/** Files under src/ that register a composition or still with this id. */
export const findComposition = (srcDir: string, id: string): string[] => {
	const re = new RegExp(`\\bid\\s*=\\s*(?:\\{\\s*)?["'\`]${id.replace(/[^A-Za-z0-9_-]/g, '')}["'\`]`);
	return sourceFiles(srcDir).filter((f) => re.test(readFileSync(f, 'utf8')));
};

export const renderCommand = (entry: string, id: string, png: string) => ['npx', 'remotion', 'still', entry, id, png, '--frame=0', '--image-format=png'];

export const main = (argv: string[], print = console.log, printError = console.error): number => {
	let parsed;
	try {
		parsed = parseArgs({args: argv, allowPositionals: true, strict: true, options: {entry: {type: 'string'}, composition: {type: 'string'}, out: {type: 'string'}, config: {type: 'string'}}});
	} catch (err) {
		printError(`${(err as Error).message}\nUsage: node scripts/assets/cover.ts <channel> [--entry src/episode/index.ts] [--composition PodcastCover] [--out file.jpg]`);
		return 2;
	}
	const {values: v, positionals} = parsed;
	if (positionals.length !== 1) {
		printError('Usage: node scripts/assets/cover.ts <channel> [--entry src/episode/index.ts] [--composition PodcastCover] [--out file.jpg]');
		return 2;
	}
	const channel = positionals[0];
	const cfg = loadChannelConfig(v.config ? resolve(process.cwd(), v.config) : join(HERE, 'config/channels.json'), channel);
	const id = v.composition ?? cfg.podcast.coverComposition ?? 'PodcastCover';
	const entry = v.entry ?? 'src/episode/index.ts';
	const out = v.out ? resolve(process.cwd(), v.out) : join(PROJECT, 'out/assets/_cover', channel, 'cover-3000.jpg');
	const where = findComposition(join(PROJECT, 'src'), id);
	if (!where.length) {
		print(`No "${id}" composition exists yet (searched src/ for id="${id}"). Cover art is PENDING.`);
		print('Once the show set lands, register a 3000x3000 still that shows Zoo and Badger at the show desk, e.g.');
		print(`  <Still id="${id}" component={PodcastCover} width={3000} height={3000} />`);
		print('(or a 1000x1000 still rendered with --scale=3), then run:');
		print(`  node scripts/assets/cover.ts ${channel}`);
		print('which runs:');
		print(`  ${renderCommand(entry, id, '<tmp>/cover.png').join(' ')}`);
		print('and converts the result to a 3000 px JPEG checked against Apple\'s rules. Then set podcast.coverFile in');
		print('scripts/assets/config/channels.json to the JPEG (commit it only if the owner approves the art).');
		return 3;
	}
	if (!hasFfmpeg()) {
		printError('ffmpeg/ffprobe are needed to check and convert the cover');
		return 1;
	}
	const work = mkdtempSync(join(tmpdir(), 'assets-cover-'));
	try {
		const png = join(work, 'cover.png');
		const cmd = renderCommand(entry, id, png);
		print(`Rendering ${id} (registered in ${where.map((w) => w.slice(PROJECT.length + 1)).join(', ')}): ${cmd.join(' ')}`);
		const r = spawnSync(cmd[0], cmd.slice(1), {cwd: PROJECT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']});
		if (r.status !== 0 || !existsSync(png)) {
			printError(`render failed (exit ${r.status}):\n${(r.stderr || r.stdout || '').trim().split('\n').slice(-15).join('\n')}`);
			return 1;
		}
		const check = checkCover(png);
		if (!check.ok) {
			printError(`the rendered still does not meet the show-art rules: ${check.problems.join('; ')}`);
			return 1;
		}
		squareJpeg(png, out, check.width);
		const final = checkCover(out);
		if (!final.ok) {
			printError(`the JPEG does not meet the show-art rules: ${final.problems.join('; ')}`);
			return 1;
		}
		print(`Wrote ${out} (${final.width}x${final.height} JPEG). Look at it before using it, then set podcast.coverFile.`);
		return 0;
	} finally {
		rmSync(work, {recursive: true, force: true});
	}
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	process.exitCode = main(process.argv.slice(2));
}
