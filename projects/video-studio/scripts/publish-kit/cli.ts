/**
 * Publish kit CLI: one episode in, every platform's text, the render plan and the checklist out.
 *   node scripts/publish-kit/cli.ts <channel>/<slug> [options]       (run from projects/video-studio)
 * Writes out/publish/<channel>/<slug>/. Exit codes: 0 every check passes, 1 the kit was written but some checks
 * fail (see checklist.md), 2 bad input or usage (nothing written).
 */
import {chmodSync, mkdirSync, readdirSync, rmSync, writeFileSync} from 'node:fs';
import {join, relative, resolve} from 'node:path';
import {parseArgs} from 'node:util';
import {loadEpisode} from './episode.ts';
import {buildKit} from './kit.ts';
import {DEFAULT_HUB, hubBase, loadRegistry} from './offers.ts';
import type {PublishKit} from './types.ts';
import {InputError} from './util.ts';

export const PROJECT_ROOT = resolve(import.meta.dirname, '../..');
const CREATOR_HUB = resolve(PROJECT_ROOT, '../creator-hub');

const USAGE = `Usage: node scripts/publish-kit/cli.ts <channel>/<slug> [options]

Reads content/<channel>/<slug>/episode.json (+ captions.json, channel.json and the voice timeline when present)
and writes out/publish/<channel>/<slug>/: kit.json, youtube-description.txt, pinned-comment.txt, shorts-<n>.txt,
tiktok.txt, reels.txt, x.txt, instagram.txt, captions.srt/.vtt, render-plan.sh and checklist.md.

Options:
  --youtube-id <id>   the video's YouTube id once uploaded (overrides episode.json)
  --offers <file>     offer registry (default: ../creator-hub/config/offers.json, else offers.example.json)
  --captions <file>   captions.json to use instead of the episode folder's
  --timeline <file>   timeline.json to use instead of public/generated/<channel>/<slug>/<lang>/timeline.json
  --hub <url>         hub origin (default: $HUB_BASE_URL or ${DEFAULT_HUB})
  --out <dir>         output folder (default: out/publish/<channel>/<slug>)
  -h, --help          show this help

Exit codes: 0 all checks pass; 1 kit written, some checks fail (see checklist.md); 2 bad input (nothing written).`;

export type CliIO = {log: (line: string) => void; error: (line: string) => void; env: Record<string, string | undefined>; now: () => Date; cwd: string};

const defaultIO = (): CliIO => ({log: (l) => console.log(l), error: (l) => console.error(l), env: process.env, now: () => new Date(), cwd: process.cwd()});

const parse = (argv: string[]) =>
	parseArgs({
		args: argv,
		allowPositionals: true,
		options: {
			'youtube-id': {type: 'string'},
			offers: {type: 'string'},
			captions: {type: 'string'},
			timeline: {type: 'string'},
			hub: {type: 'string'},
			out: {type: 'string'},
			help: {type: 'boolean', short: 'h'},
		},
	});

/** Generated names this tool owns in the output folder; stale ones from an earlier run are removed. */
const OWNED = /^(?:kit\.json|youtube-description\.txt|pinned-comment\.txt|shorts-\d+\.txt|tiktok\.txt|reels\.txt|x\.txt|instagram\.txt|captions\.(?:srt|vtt)|render-plan\.sh|checklist\.md)$/;

export const writeKit = (outDir: string, files: Record<string, string>): void => {
	mkdirSync(outDir, {recursive: true});
	for (const name of readdirSync(outDir)) if (OWNED.test(name) && !(name in files)) rmSync(join(outDir, name));
	for (const [name, content] of Object.entries(files)) {
		const path = join(outDir, name);
		writeFileSync(path, content);
		if (name.endsWith('.sh')) chmodSync(path, 0o755);
	}
};

const report = (kit: PublishKit, outDir: string, notes: string[], io: CliIO): number => {
	const failing = kit.checks.filter((c) => !c.ok);
	const shown = relative(io.cwd, outDir) || '.';
	io.log(`Publish kit for ${kit.channel}/${kit.slug}: "${kit.title}"`);
	io.log(`Wrote ${shown}/ (kit.json, post texts, render-plan.sh, checklist.md). Nothing was rendered or uploaded.`);
	for (const note of notes) io.log(`note: ${note}`);
	io.log(`${kit.checks.length - failing.length}/${kit.checks.length} checks pass.`);
	for (const c of failing) io.log(`FAIL ${c.id}: ${c.detail}`);
	if (failing.length) io.log(`Fix these before publishing; ${shown}/checklist.md lists every step.`);
	return failing.length ? 1 : 0;
};

export const run = (argv: string[], io: CliIO = defaultIO()): number => {
	let args: ReturnType<typeof parse>;
	try {
		args = parse(argv);
	} catch (err) {
		io.error(`${(err as Error).message}\n\n${USAGE}`);
		return 2;
	}
	if (args.values.help) {
		io.log(USAGE);
		return 0;
	}
	if (args.positionals.length !== 1) {
		io.error(USAGE);
		return 2;
	}
	try {
		const m = /^([^/]+)\/([^/]+)$/.exec(args.positionals[0].trim());
		if (!m) throw new InputError(`expected <channel>/<slug>, got "${args.positionals[0]}"`);
		const [, channel, slug] = m;
		const fromCwd = (path: string | undefined): string | null => (path ? resolve(io.cwd, path) : null);
		const episode = loadEpisode(PROJECT_ROOT, channel, slug, {captions: fromCwd(args.values.captions), timeline: fromCwd(args.values.timeline)});
		const youtubeId = args.values['youtube-id'];
		if (youtubeId !== undefined) {
			if (!/^[A-Za-z0-9_-]{11}$/.test(youtubeId)) throw new InputError('--youtube-id must be an 11-character YouTube video id');
			episode.youtubeVideoId = youtubeId;
		}
		const hub = hubBase(args.values.hub ?? (io.env.HUB_BASE_URL || DEFAULT_HUB));
		const registry = loadRegistry(CREATOR_HUB, fromCwd(args.values.offers));
		const {kit, files} = buildKit(episode, {
			hub,
			registry: registry.registry,
			registryPath: relative(PROJECT_ROOT, registry.path),
			registryIsExample: registry.isExample,
			now: io.now(),
		});
		const outDir = fromCwd(args.values.out) ?? join(PROJECT_ROOT, 'out', 'publish', channel, slug);
		writeKit(outDir, files);
		return report(kit, outDir, episode.notes, io);
	} catch (err) {
		if (err instanceof InputError) {
			io.error(err.message);
			return 2;
		}
		throw err;
	}
};

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) {
	process.exitCode = run(process.argv.slice(2));
}
