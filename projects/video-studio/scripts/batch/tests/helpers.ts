/**
 * Test support: throwaway projects/video-studio layouts in a temp folder. Everything is fictional (example slugs,
 * reserved example.com sources); the uploader used by the approve tests is the real creator-hub one, with a temp
 * channels.json (category set) and a temp state folder, and no network.
 */
import {mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {deflateSync} from 'node:zlib';

export const BATCH_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const STUDIO = resolve(BATCH_DIR, '..', '..');
export const HUB = resolve(STUDIO, '..', 'creator-hub');
export const REAL_CONFIG = join(BATCH_DIR, 'config.json');

/** 2026-11-24 18:00 UTC (12:00 CST): tests run on a fixed clock, six days before week 2026-W49 starts. */
export const NOW = Date.parse('2026-11-24T18:00:00.000Z');

export type Workspace = {
	root: string;
	configPath: string;
	channelsPath: string;
	stateDir: string;
	write: (rel: string, content: string | Buffer, mtimeMs?: number) => string;
	read: (rel: string) => string;
	json: <T = unknown>(rel: string) => T;
	cleanup: () => void;
};

export const makeWorkspace = (o: {config?: unknown; backlogs?: Record<string, unknown>; categoryId?: string | null} = {}): Workspace => {
	const base = mkdtempSync(join(tmpdir(), 'batch-test-'));
	const root = join(base, 'video-studio');
	mkdirSync(root, {recursive: true});
	const write = (rel: string, content: string | Buffer, mtimeMs?: number): string => {
		const path = join(root, rel);
		mkdirSync(dirname(path), {recursive: true});
		writeFileSync(path, content);
		if (mtimeMs !== undefined) utimesSync(path, mtimeMs / 1000, mtimeMs / 1000);
		return path;
	};
	const config = o.config ?? JSON.parse(readFileSync(REAL_CONFIG, 'utf8'));
	const configPath = write('batch-config.json', JSON.stringify(config, null, 2));
	for (const [channel, backlog] of Object.entries(o.backlogs ?? {})) write(`content/${channel}/backlog.json`, `${JSON.stringify(backlog, null, 2)}\n`);
	const category = o.categoryId === undefined ? '28' : o.categoryId;
	const channelsPath = join(base, 'channels.json');
	writeFileSync(
		channelsPath,
		JSON.stringify({
			version: 1,
			dailyLimits: {defaultUnits: 10000, uploadCalls: 100},
			maxUnitsPerRun: 3000,
			minLeadMinutes: 60,
			approvalMaxDays: 30,
			channels: {
				'zoora-ai': {youtubeChannelId: null, categoryId: category, defaultLanguage: 'en', playlists: {long: null, short: null}},
				'zoora-security': {youtubeChannelId: null, categoryId: category, defaultLanguage: 'en', playlists: {long: null, short: null}},
			},
		}),
	);
	const stateDir = join(base, 'state');
	mkdirSync(stateDir, {recursive: true});
	return {
		root,
		configPath,
		channelsPath,
		stateDir,
		write,
		read: (rel) => readFileSync(join(root, rel), 'utf8'),
		json: <T>(rel: string) => JSON.parse(readFileSync(join(root, rel), 'utf8')) as T,
		cleanup: () => rmSync(base, {recursive: true, force: true}),
	};
};

/** A small two-channel config: Zoora AI long Mon + Thu with daily Shorts, security Tue explainer + Sat Scam of the Week. */
export const testConfig = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
	...(JSON.parse(readFileSync(REAL_CONFIG, 'utf8')) as Record<string, unknown>),
	...overrides,
});

export type TestIdea = Record<string, unknown>;

export const testIdea = (id: string, format: string, priority: number, extra: TestIdea = {}): TestIdea => ({
	id,
	title: `Test idea ${id}`,
	format,
	status: 'idea',
	priority,
	week: null,
	angle: `A fictional test angle for ${id}: what the video argues and how it ends, long enough to pass validation.`,
	evergreenTopic: 'drainers',
	relatedTopics: [],
	factTags: ['test-tag'],
	research: null,
	facts: [{need: 'A fictional fact need', factId: null, status: 'research needed'}],
	risks: ['A fictional risk note.'],
	languages: {master: 'en', dubs: ['es', 'pt-br']},
	shortIdeas: ['Angle one', 'Angle two', 'Angle three', 'Angle four'],
	...extra,
});

export const testBacklog = (channel: string, ideas: TestIdea[]): Record<string, unknown> => ({version: 1, channel, updated: '2026-11-24', status: 'test', rules: ['A test rule.'], ideas});

// ---------------------------------------------------------------- fake media

const CRC_TABLE = Array.from({length: 256}, (_, n) => {
	let c = n;
	for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
	return c >>> 0;
});
const crc32 = (buf: Buffer): number => {
	let c = 0xffffffff;
	for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
	return (c ^ 0xffffffff) >>> 0;
};

/** A valid solid-colour RGB PNG. */
export const makePng = (width: number, height: number, rgb: [number, number, number] = [41, 184, 173]): Buffer => {
	const chunk = (type: string, data: Buffer): Buffer => {
		const len = Buffer.alloc(4);
		len.writeUInt32BE(data.length);
		const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
		const crc = Buffer.alloc(4);
		crc.writeUInt32BE(crc32(body));
		return Buffer.concat([len, body, crc]);
	};
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(width, 0);
	ihdr.writeUInt32BE(height, 4);
	ihdr[8] = 8;
	ihdr[9] = 2;
	const row = Buffer.alloc(1 + width * 3);
	for (let x = 0; x < width; x++) row.set(rgb, 1 + x * 3);
	const raw = Buffer.concat(Array.from({length: height}, () => row));
	return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
};

/** Deterministic bytes standing in for a rendered MP4. */
export const fakeVideo = (bytes: number, seed = 7): Buffer => {
	const out = Buffer.alloc(bytes);
	let x = seed >>> 0 || 1;
	for (let i = 0; i < bytes; i++) {
		x ^= x << 13;
		x ^= x >>> 17;
		x ^= x << 5;
		out[i] = x & 0xff;
	}
	return out;
};

/**
 * Builds every file the weekly page and the uploader need for one episode and `shorts` Shorts: storyboard, claim
 * report, voice timeline, publish kit (+ shorts-<n>.txt), renders and thumbnails, in production order (so the render
 * is newer than the storyboard). `narration` lets a test inject hostile text.
 */
export const buildEpisode = (ws: Workspace, o: {channel: string; slug: string; shorts: number; narration?: string; sourceTitle?: string; sourceUrl?: string; claimPass?: boolean; kitCheckOk?: boolean; voice?: string}): void => {
	const {channel, slug} = o;
	const t0 = NOW - 3_600_000;
	const sceneIds = ['s01', 's02', 's03', 's04', 's05'];
	const storyboard = {
		version: 1,
		channel,
		slug,
		lang: 'en',
		sourceLang: 'en',
		title: `Test episode ${slug}`,
		fiction: channel === 'zoora-ai',
		scenes: sceneIds.map((id, i) => ({id, type: i === 0 ? 'hook' : 'talk', narration: i === 1 && o.narration ? o.narration : `Scene ${id} says something {$5|five dollars} [src:ex1].`, onScreen: {title: `On screen ${id}`}})),
		sources: [{id: 'ex1', title: o.sourceTitle ?? 'Example source', url: o.sourceUrl ?? 'https://example.com/report', quote: 'An example quote.', accessed: '2026-11-20', status: 'verified'}],
		shorts: Array.from({length: o.shorts}, (_, i) => ({id: `short-${i + 1}`, sceneIds: [sceneIds[i % sceneIds.length]], title: `Short ${i + 1} of ${slug}`})),
		thumbnails: [{id: 't1', text: 'Test', expression: 'neutral', badger: true}],
	};
	ws.write(`content/${channel}/${slug}/storyboard.json`, JSON.stringify(storyboard, null, 2), t0);
	ws.write(`content/${channel}/${slug}/research.md`, '# Research\n\n## Must not say\n\n- (none)\n', t0);
	ws.write(
		`public/generated/${channel}/${slug}/en/timeline.json`,
		JSON.stringify({version: 1, slug, lang: 'en', mode: 'native', voice: o.voice ?? 'im_nicola', speed: 1, fps: 30, totalMs: 60000, scenes: [], warnings: []}),
		t0 + 60_000,
	);
	ws.write(
		`out/claims/${slug}.en.json`,
		JSON.stringify({tool: 'claims/check', version: 1, channel, slug, lang: 'en', file: `content/${channel}/${slug}/storyboard.json`, checkedAt: new Date(t0 + 120_000).toISOString(), pass: o.claimPass ?? true, errors: o.claimPass === false ? 1 : 0, warnings: 0, findings: o.claimPass === false ? [{level: 'error', rule: 'unsourced-claim', where: 's02 · narration', scene: 's02', message: 'looks factual', fix: 'add a source'}] : [], claims: [], waivers: [], sources: [], mustNotSay: {}, namesList: {}, notes: []}),
		t0 + 120_000,
	);
	ws.write(`out/claims/${slug}.en.md`, '# Claim report\n', t0 + 120_000);
	const kitDir = `out/publish/${channel}/${slug}`;
	const posts = Object.fromEntries(['youtube', 'shorts', 'tiktok', 'reels', 'x', 'instagram'].map((p) => [p, {text: `Test post for ${p}.`, charCount: 20, limit: 5000, notes: []}]));
	const kit = {
		version: 1,
		channel,
		slug,
		youtubeVideoId: null,
		title: `Test episode ${slug}`,
		titleOptions: [`Test episode ${slug}`],
		summary: 'A fictional test episode.',
		chapters: [],
		sources: [{title: 'Example source', url: 'https://example.com/report'}],
		offers: [],
		disclosures: ['Fictional story with composite characters. Not financial advice.'],
		posts,
		captions: {srt: null, vtt: null},
		renders: [
			{id: 'long', kind: 'long', command: 'render long', output: `${kitDir}/media/long.mp4`},
			...Array.from({length: o.shorts}, (_, i) => ({id: `short-${i + 1}`, kind: 'short', command: `render short ${i + 1}`, output: `${kitDir}/media/short-${i + 1}.mp4`})),
			...[0, 1, 2].map((i) => ({id: `thumb-v${i}`, kind: 'thumbnail', command: 'thumbnails', output: `${kitDir}/media/thumbnails/en/v${i}.png`})),
		],
		settings: {madeForKids: false, containsSyntheticMedia: false, paidPromotion: false, reasons: ['madeForKids=false (studio default).', 'containsSyntheticMedia=false.', 'paidPromotion=false: no offers.']},
		checks: [{id: 'youtube-title', ok: true, detail: 'ok'}, {id: 'income-claims', ok: o.kitCheckOk ?? true, detail: o.kitCheckOk === false ? 'a phrase was flagged' : 'none'}],
		generatedAt: new Date(t0 + 180_000).toISOString(),
	};
	ws.write(`${kitDir}/kit.json`, JSON.stringify(kit, null, 2), t0 + 180_000);
	for (let i = 1; i <= o.shorts; i++) {
		const title = `Short ${i} of ${slug}`;
		const description = `A fictional Short.\n#test`;
		ws.write(`${kitDir}/shorts-${i}.txt`, `=== Short ${i} of ${o.shorts}: media/short-${i}.mp4 (0:45) ===\nTITLE (${title.length}/100 characters):\n${title}\n\nDESCRIPTION (${Buffer.byteLength(description)}/5000 bytes):\n${description}\n`, t0 + 180_000);
		ws.write(`${kitDir}/media/short-${i}.mp4`, fakeVideo(40_000, 100 + i), t0 + 240_000);
	}
	ws.write(`${kitDir}/media/long.mp4`, fakeVideo(120_000, 11), t0 + 240_000);
	for (let i = 0; i < 3; i++) ws.write(`${kitDir}/media/thumbnails/en/v${i}.png`, makePng(1280, 720, [40 + i, 184, 173]), t0 + 240_000);
};

/** Replaces fetch so a test fails loudly if anything tries the network. */
export const noNetwork = (): (() => void) => {
	const original = globalThis.fetch;
	globalThis.fetch = (async () => {
		throw new Error('network access in a test');
	}) as typeof fetch;
	return () => {
		globalThis.fetch = original;
	};
};

/** Collects log lines. */
export const logs = () => {
	const lines: string[] = [];
	return {lines, log: (line: string) => void lines.push(line), text: () => lines.join('\n')};
};
