/**
 * What the analytics exports do not say: each video's format, topic tags and the other ids its hub
 * links used. Two sources, both optional:
 *
 * - videos.csv, kept by the owner (default data/videos.csv; see videos.example.csv), and
 * - publish kits (video-studio/out/publish/<channel>/<slug>/kit.json), which link an episode slug to
 *   its YouTube id, so clicks tagged ?v=<slug> count for the published video.
 */
import {existsSync, readdirSync, readFileSync, statSync} from 'node:fs';
import {join} from 'node:path';
import {parseVideoId} from '../../src/server/offers.ts';
import {CsvError, MAX_CSV_BYTES, normalizeHeader, parseCsv, parseDate} from './csv.ts';
import type {CatalogEntry, Issue, KitInfo} from './model.ts';

const COLUMNS = {
	videoId: ['video_id', 'videoid', 'video id', 'video'],
	aliases: ['aliases', 'alias', 'slug', 'slugs'],
	title: ['title', 'video title'],
	channel: ['channel'],
	format: ['format'],
	tags: ['tags', 'tag', 'topics', 'topic'],
	publishedAt: ['published_at', 'publishedat', 'published', 'publish date'],
} as const;

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const TAG = /^[\p{L}\p{N}][\p{L}\p{N} &+/-]{0,39}$/u;

/** "Scams; AI agents" -> ["scams", "ai agents"]. Tags are compared in lower case. */
export const parseTags = (raw: string): string[] =>
	[...new Set(raw.split(/[;|,]/).map((t) => t.trim().replace(/\s+/g, ' ').toLowerCase()).filter(Boolean))];

export const parseCatalog = (text: string, file: string): {entries: CatalogEntry[]; issues: Issue[]} => {
	const issues: Issue[] = [];
	let table;
	try {
		table = parseCsv(text);
	} catch (err) {
		if (err instanceof CsvError) return {entries: [], issues: [{level: 'error', where: file, message: err.message}]};
		throw err;
	}
	const header = table.header.map(normalizeHeader);
	const col = (names: readonly string[]): number => header.findIndex((h) => names.includes(h));
	const at = Object.fromEntries(Object.entries(COLUMNS).map(([key, names]) => [key, col(names)])) as Record<keyof typeof COLUMNS, number>;
	if (at.videoId === -1) return {entries: [], issues: [{level: 'error', where: file, message: 'videos.csv needs a video_id column'}]};

	const entries: CatalogEntry[] = [];
	const seen = new Set<string>();
	for (const row of table.rows) {
		const cell = (key: keyof typeof COLUMNS): string => (at[key] === -1 ? '' : (row.cells[at[key]] ?? '').trim());
		const where = `${file}:${row.line}`;
		const videoId = parseVideoId(cell('videoId'));
		if (!videoId) {
			issues.push({level: 'warning', where, message: `video_id "${cell('videoId')}" is not a YouTube id or episode slug; row skipped`});
			continue;
		}
		if (seen.has(videoId)) {
			issues.push({level: 'warning', where, message: `${videoId} is listed twice; the first row is used`});
			continue;
		}
		seen.add(videoId);
		const aliases: string[] = [];
		for (const raw of cell('aliases').split(/[\s;|,]+/).filter(Boolean)) {
			const alias = parseVideoId(raw);
			if (alias && alias !== videoId) aliases.push(alias);
			else if (!alias) issues.push({level: 'warning', where, message: `alias "${raw}" is not a valid id; ignored`});
		}
		const formatRaw = cell('format').toLowerCase();
		const format = formatRaw === 'long' || formatRaw === 'short' ? formatRaw : formatRaw === 'shorts' ? 'short' : null;
		if (formatRaw && !format) issues.push({level: 'warning', where, message: `format "${cell('format')}" must be "long" or "short"; ignored`});
		const tags = parseTags(cell('tags')).filter((tag) => {
			if (TAG.test(tag)) return true;
			issues.push({level: 'warning', where, message: `tag "${tag}" is not a short plain label (up to 40 letters, digits, spaces, & + / -); ignored`});
			return false;
		});
		const publishedRaw = cell('publishedAt');
		const publishedAt = publishedRaw ? parseDate(publishedRaw) : null;
		if (publishedRaw && !publishedAt) issues.push({level: 'warning', where, message: `published_at "${publishedRaw}" is not a date (YYYY-MM-DD); ignored`});
		const channel = cell('channel') || null;
		entries.push({videoId, aliases, title: cell('title') || null, channel, format, tags, publishedAt});
	}
	return {entries, issues};
};

export const readCatalog = (file: string): {entries: CatalogEntry[]; issues: Issue[]} => {
	try {
		if (statSync(file).size > MAX_CSV_BYTES) return {entries: [], issues: [{level: 'error', where: file, message: 'file is too large'}]};
		return parseCatalog(readFileSync(file, 'utf8'), file);
	} catch (err) {
		return {entries: [], issues: [{level: 'error', where: file, message: `cannot read: ${(err as Error).message}`}]};
	}
};

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** Reads the fields of one kit.json the dashboard needs; null (with a warning) when they are not valid. */
export const parseKit = (input: unknown, file: string): {kit: KitInfo | null; issue: Issue | null} => {
	const fail = (message: string): {kit: null; issue: Issue} => ({kit: null, issue: {level: 'warning', where: file, message: `publish kit ignored: ${message}`}});
	if (!isRecord(input) || input.version !== 1) return fail('not a version 1 kit.json');
	const slug = typeof input.slug === 'string' ? parseVideoId(input.slug) : null;
	if (!slug) return fail('"slug" is missing or invalid');
	if (typeof input.channel !== 'string' || !input.channel.trim()) return fail('"channel" is missing');
	const youtubeVideoId = input.youtubeVideoId;
	if (youtubeVideoId !== null && (typeof youtubeVideoId !== 'string' || !YOUTUBE_ID.test(youtubeVideoId))) return fail('"youtubeVideoId" must be null or an 11-character id');
	const kinds = Array.isArray(input.renders) ? input.renders.map((r) => (isRecord(r) ? r.kind : null)) : [];
	const format = kinds.includes('long') ? 'long' : kinds.includes('short') ? 'short' : null;
	return {
		kit: {channel: input.channel.trim(), slug, youtubeVideoId, title: typeof input.title === 'string' ? input.title.trim() : slug, format, file},
		issue: null,
	};
};

/** Every <dir>/<slug>/kit.json for one channel (the publish-kit layout). */
export const readKits = (dir: string): {kits: KitInfo[]; issues: Issue[]} => {
	const kits: KitInfo[] = [];
	const issues: Issue[] = [];
	if (!existsSync(dir)) return {kits, issues};
	for (const name of readdirSync(dir).sort()) {
		const file = join(dir, name, 'kit.json');
		if (!existsSync(file)) continue;
		try {
			if (statSync(file).size > 5 * 1024 * 1024) {
				issues.push({level: 'warning', where: file, message: 'publish kit ignored: file is too large'});
				continue;
			}
			const {kit, issue} = parseKit(JSON.parse(readFileSync(file, 'utf8')), file);
			if (kit) kits.push(kit);
			if (issue) issues.push(issue);
		} catch (err) {
			issues.push({level: 'warning', where: file, message: `publish kit ignored: ${(err as Error).message}`});
		}
	}
	return {kits, issues};
};
