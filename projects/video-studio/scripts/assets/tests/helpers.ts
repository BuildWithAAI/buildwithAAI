/** Shared helpers for the scripts/assets tests. */
import {spawnSync} from 'node:child_process';
import {cpSync, mkdtempSync, readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export const ASSETS = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const PROJECT = resolve(ASSETS, '../..');
export const FIXTURES = join(ASSETS, 'fixtures');
export const SLUG = 'fixture-fake-support';
export const CHANNEL = 'zoora-security';

export const hasTool = (bin: string, arg = '-version'): boolean => {
	const r = spawnSync(bin, [arg], {encoding: 'utf8'});
	return !r.error && r.status === 0;
};

export const HAS_FFMPEG = hasTool('ffmpeg') && hasTool('ffprobe');
export const HAS_PYTHON = hasTool('python3', '--version');

/** Parses XML with Python's stdlib parser; returns null when it is well-formed, else the error. */
export const xmlError = (text: string): string | null => {
	const r = spawnSync('python3', ['-I', '-c', 'import sys, xml.etree.ElementTree as E; E.fromstring(sys.stdin.buffer.read())'], {input: text, encoding: 'utf8'});
	return r.status === 0 ? null : r.stderr.trim().split('\n').pop() ?? 'parse error';
};

const ffmpeg = (args: string[]) => {
	const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], {encoding: 'utf8'});
	if (r.status !== 0) throw new Error(`ffmpeg failed: ${r.stderr}`);
};

/** A tone with word-like gaps, standing in for Kokoro narration (24 kHz mono PCM16, like the voice step). */
export const synthNarration = (file: string, seconds: number, amplitude = 0.35) =>
	ffmpeg(['-f', 'lavfi', '-i', `aevalsrc=exprs='${amplitude}*sin(2*PI*170*t)*lt(mod(t\\,0.4)\\,0.3)':s=24000:d=${seconds}`, '-c:a', 'pcm_s16le', file]);

/** A short decaying "huff" for Badger cue tests. */
export const synthClip = (file: string, seconds = 0.4) => ffmpeg(['-f', 'lavfi', '-i', `aevalsrc=exprs='0.4*sin(2*PI*520*t)*exp(-6*t)':s=48000:d=${seconds}`, '-ac', '2', '-c:a', 'pcm_s16le', file]);

export type Workspace = {root: string; content: string; generated: string; publish: string; out: string; offers: string; names: string; config: string};

/** Copies the fixture tree to a temp folder and (when ffmpeg exists) writes narration.wav for each language. */
export const workspace = (withAudio = HAS_FFMPEG): Workspace => {
	const root = mkdtempSync(join(tmpdir(), 'assets-test-'));
	cpSync(FIXTURES, root, {recursive: true});
	const ws: Workspace = {
		root,
		content: join(root, 'content'),
		generated: join(root, 'generated'),
		publish: join(root, 'publish'),
		out: join(root, 'out'),
		offers: join(root, 'offers.json'),
		names: join(root, 'names.txt'),
		config: join(root, 'config.test.json'),
	};
	if (withAudio) {
		for (const lang of ['en', 'es']) {
			const dir = join(ws.generated, CHANNEL, SLUG, lang);
			const tl = JSON.parse(readFileSync(join(dir, 'timeline.json'), 'utf8')) as {totalMs: number};
			synthNarration(join(dir, 'narration.wav'), tl.totalMs / 1000);
		}
	}
	return ws;
};

/** make.ts arguments that point every input at the workspace. */
export const wsArgs = (ws: Workspace, extra: string[] = []): string[] => [
	`${CHANNEL}/${SLUG}`,
	'--content-root',
	ws.content,
	'--generated-root',
	ws.generated,
	'--publish-root',
	ws.publish,
	'--offers',
	ws.offers,
	'--names',
	ws.names,
	'--config',
	ws.config,
	'--out',
	ws.out,
	'--podcast-min-sec',
	'30',
	'--now',
	'2026-11-24T12:00:00Z',
	...extra,
];

export const quiet = () => {
	const lines: string[] = [];
	return {lines, print: (l: string) => void lines.push(l)};
};
