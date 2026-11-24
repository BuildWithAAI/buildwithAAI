/** Small helpers shared by the daily orchestrator: hashing, JSON files, atomic writes, dates, slugs. */
import {createHash} from 'node:crypto';
import {closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, renameSync, statSync, writeFileSync} from 'node:fs';
import {dirname, relative} from 'node:path';

export const sha256 = (buf: Buffer | string): string => createHash('sha256').update(buf).digest('hex');

/** sha256 of a file, streamed in 1 MB blocks so a render does not have to fit in memory twice. */
export const sha256File = (path: string): string | null => {
	if (!existsSync(path)) return null;
	const h = createHash('sha256');
	const fd = openSync(path, 'r');
	try {
		const buf = Buffer.alloc(1 << 20);
		let n: number;
		while ((n = readSync(fd, buf, 0, buf.length, null)) > 0) h.update(buf.subarray(0, n));
	} finally {
		closeSync(fd);
	}
	return h.digest('hex');
};

export const fileSize = (path: string): number | null => {
	try {
		return statSync(path).size;
	} catch {
		return null;
	}
};

export type JsonRead<T = unknown> = {ok: true; data: T; sha256: string} | {ok: false; missing: boolean; error: string};

export const readJson = <T = unknown>(path: string): JsonRead<T> => {
	if (!existsSync(path)) return {ok: false, missing: true, error: `not found: ${path}`};
	let buf: Buffer;
	try {
		buf = readFileSync(path);
	} catch (err) {
		return {ok: false, missing: false, error: `cannot read ${path}: ${errText(err)}`};
	}
	try {
		return {ok: true, data: JSON.parse(buf.toString('utf8').replace(/^﻿/, '')) as T, sha256: sha256(buf)};
	} catch (err) {
		return {ok: false, missing: false, error: `invalid JSON in ${path}: ${errText(err)}`};
	}
};

/** Write through a temp file in the same folder and rename it, so a reader never sees half a file (*.tmp is gitignored). */
export const writeAtomic = (path: string, content: string | Buffer): void => {
	mkdirSync(dirname(path), {recursive: true});
	const tmp = `${path}.${process.pid}.tmp`;
	writeFileSync(tmp, content);
	renameSync(tmp, path);
};

export const writeJson = (path: string, data: unknown): void => writeAtomic(path, `${JSON.stringify(data, null, 2)}\n`);

export const errText = (err: unknown): string => (err instanceof Error ? err.message : String(err));

export const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

export const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

export const unique = <T>(xs: readonly T[]): T[] => xs.filter((x, i) => xs.indexOf(x) === i);

/** Path relative to the studio root for reports (absolute when outside it). */
export const rel = (root: string, p: string): string => {
	const r = relative(root, p);
	return r && !r.startsWith('..') ? r : p;
};

// ---------------------------------------------------------------------------------------------------------------
// Dates. The channel runs on the owner's calendar (America/Chicago). Dates are plain YYYY-MM-DD strings; the
// arithmetic below works on UTC midnights, so it has no daylight-saving edge cases.

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const isDate = (s: unknown): s is string => typeof s === 'string' && DATE_RE.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().startsWith(s);

/** Today's calendar date in a time zone, e.g. todayIn('America/Chicago'). */
export const todayIn = (timeZone: string, now: Date = new Date()): string => {
	const parts = new Intl.DateTimeFormat('en-CA', {timeZone, year: 'numeric', month: '2-digit', day: '2-digit'}).formatToParts(now);
	const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
	return `${get('year')}-${get('month')}-${get('day')}`;
};

/** A readable local time for the owner, e.g. "2026-11-24 06:05 CST". */
export const localTime = (iso: string, timeZone: string): string => {
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return iso;
	const parts = new Intl.DateTimeFormat('en-US', {timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZoneName: 'short'}).formatToParts(d);
	const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
	return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')} ${get('timeZoneName')}`;
};

export const addDays = (date: string, n: number): string => {
	const d = new Date(`${date}T00:00:00Z`);
	d.setUTCDate(d.getUTCDate() + n);
	return d.toISOString().slice(0, 10);
};

/** Whole days from a to b (b - a). */
export const daysBetween = (a: string, b: string): number => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "Nov 24" */
export const shortDate = (date: string): string => {
	const [, m, d] = date.split('-').map(Number);
	return `${MONTHS[m - 1]} ${d}`;
};

// ---------------------------------------------------------------------------------------------------------------
// Slugs

/** Lowercase a-z, 0-9 and single hyphens, at most `max` characters, never ending in a hyphen. */
export const slugify = (s: string, max = 40): string => {
	const base = s
		.normalize('NFKD')
		.replace(/[̀-ͯ]/g, '')
		.toLowerCase()
		.replace(/&/g, ' and ')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
	const cut = base.slice(0, max).replace(/-+$/g, '');
	return cut || 'story';
};

/** <date>-<slug>: what every later step calls the episode. Same alphabet as the thumbnail and publish-kit tools. */
export const DATE_SLUG_RE = /^(\d{4}-\d{2}-\d{2})-([a-z0-9][a-z0-9-]{0,59})$/;

export const parseDateSlug = (s: string): {date: string; slug: string} | null => {
	const m = DATE_SLUG_RE.exec(s);
	if (!m || !isDate(m[1]) || m[2].endsWith('-')) return null;
	return {date: m[1], slug: m[2]};
};

export const clip = (s: string, n: number): string => (s.length <= n ? s : `${s.slice(0, Math.max(0, n - 1)).trimEnd()}…`);

/** The last `n` characters of a command's output, for reports. */
export const tail = (s: string, n = 2000): string => (s.length <= n ? s : `…${s.slice(-n)}`);

/** "$6,360,000,000" for 6360000000; the exact figure the source stored, never rounded. */
export const usdExact = (n: number): string => `$${Math.round(n).toLocaleString('en-US')}`;

// ---------------------------------------------------------------------------------------------------------------
// Credentials. Only the hub's posting tools (announcer, Threat Brief) need the posting credentials; every other step
// (the radar parsing untrusted feeds, the voice, the render with its npm dependencies and Chromium, the thumbnails,
// the publish kit, both gates) runs with them removed, so a bad dependency or a parser bug cannot read them.

/** Names that hold posting credentials or other secrets. */
export const SECRET_PREFIXES = ['TELEGRAM_', 'X_API_', 'X_ACCESS_', 'KIT_', 'ANNOUNCER_', 'THREAT_BRIEF_'];
export const SECRET_SUFFIX = /(?:_TOKEN|_SECRET|_API_KEY|_PASSWORD|_PRIVATE_KEY)$/i;

/** A copy of env without posting credentials or other secrets (and without the names in `extra`). */
export const scrubEnv = (env: NodeJS.ProcessEnv, extra: string[] = []): NodeJS.ProcessEnv => {
	const drop = new Set(extra);
	const out: NodeJS.ProcessEnv = {};
	for (const [k, v] of Object.entries(env)) {
		if (v === undefined || drop.has(k) || SECRET_SUFFIX.test(k) || SECRET_PREFIXES.some((p) => k.toUpperCase().startsWith(p))) continue;
		out[k] = v;
	}
	return out;
};
