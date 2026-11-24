/**
 * Small shared helpers for the asset multiplier (scripts/assets). Pure Node stdlib.
 */
import {createHash} from 'node:crypto';
import {existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync} from 'node:fs';
import {dirname} from 'node:path';

export const sha256 = (data: string | Uint8Array): string => createHash('sha256').update(data).digest('hex');

export const sha256File = (path: string): string | null => (existsSync(path) ? sha256(readFileSync(path)) : null);

export const fileSize = (path: string): number | null => (existsSync(path) ? statSync(path).size : null);

export const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** Writes atomically (temp file + rename), creating parent folders. Temp files end in .tmp (gitignored). */
export const writeFile = (path: string, data: string | Uint8Array): void => {
	mkdirSync(dirname(path), {recursive: true});
	const tmp = `${path}.${process.pid}.tmp`;
	writeFileSync(tmp, data);
	renameSync(tmp, path);
};

export const writeJson = (path: string, value: unknown): void => writeFile(path, `${JSON.stringify(value, null, 2)}\n`);

export class InputError extends Error {}

export const readJson = (path: string, what: string): unknown => {
	let text: string;
	try {
		text = readFileSync(path, 'utf8');
	} catch (err) {
		throw new InputError(`cannot read ${what} at ${path}: ${(err as Error).message}`);
	}
	try {
		return JSON.parse(text) as unknown;
	} catch (err) {
		throw new InputError(`${what} at ${path} is not valid JSON: ${(err as Error).message}`);
	}
};

const pad = (n: number, width = 2): string => String(n).padStart(width, '0');

/** "MM:SS" below an hour, "H:MM:SS" from an hour (YouTube and Spotify chapter style). Floors to the second. */
export const clock = (ms: number): string => {
	const total = Math.max(0, Math.floor(ms / 1000));
	const h = Math.floor(total / 3600);
	const m = Math.floor((total % 3600) / 60);
	const s = total % 60;
	return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
};

const hmsParts = (ms: number) => {
	const t = Math.max(0, Math.round(ms));
	return {h: Math.floor(t / 3_600_000), m: Math.floor((t % 3_600_000) / 60_000), s: Math.floor((t % 60_000) / 1000), ms: t % 1000};
};

/** WebVTT and Podlove/NPT timestamp: HH:MM:SS.mmm */
export const hmsDot = (ms: number): string => {
	const p = hmsParts(ms);
	return `${pad(p.h)}:${pad(p.m)}:${pad(p.s)}.${pad(p.ms, 3)}`;
};

/** SubRip timestamp: HH:MM:SS,mmm */
export const hmsComma = (ms: number): string => hmsDot(ms).replace('.', ',');

/** ISO 8601 duration for schema.org, e.g. "PT1M5S" (whole seconds, rounded). */
export const isoDuration = (ms: number): string => {
	const total = Math.max(0, Math.round(ms / 1000));
	const h = Math.floor(total / 3600);
	const m = Math.floor((total % 3600) / 60);
	const s = total % 60;
	return `PT${h ? `${h}H` : ''}${m ? `${m}M` : ''}${s || (!h && !m) ? `${s}S` : ''}`;
};

/** Cuts text at a word boundary so it is at most `max` characters, adding "…" when it had to cut. */
export const truncate = (text: string, max: number): string => {
	const clean = text.replace(/\s+/g, ' ').trim();
	if ([...clean].length <= max) return clean;
	const chars = [...clean].slice(0, Math.max(1, max - 1)).join('');
	const cut = chars.replace(/\s+\S*$/, '');
	return `${(cut.length >= chars.length * 0.6 ? cut : chars).replace(/[\s,;:.\-–—]+$/, '')}…`;
};

/** First sentence (or the whole text when it has no sentence end). */
export const firstSentence = (text: string): string => {
	const clean = text.replace(/\s+/g, ' ').trim();
	const m = /^(.+?[.!?…。！？])(\s|$)/u.exec(clean);
	return m ? m[1] : clean;
};

/** A YYYY-MM-DD date or a full ISO timestamp → a full ISO timestamp in UTC; null when invalid. */
export const isoTimestamp = (value: string): string | null => {
	const v = value.trim();
	const date = /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T00:00:00Z`) : new Date(v);
	if (Number.isNaN(date.getTime()) || !/^\d{4}-\d{2}-\d{2}/.test(v)) return null;
	return date.toISOString().replace(/\.000Z$/, 'Z');
};

/** RFC 822 date for RSS 2.0 (pubDate, lastBuildDate). */
export const rfc822 = (iso: string): string => new Date(iso).toUTCString().replace(/GMT$/, '+0000');

/** Stable, deduplicated (case-insensitive) list of non-empty trimmed strings. */
export const uniqueStrings = (items: Iterable<string>): string[] => {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const raw of items) {
		const item = raw.replace(/\s+/g, ' ').trim();
		const key = item.toLowerCase();
		if (!item || seen.has(key)) continue;
		seen.add(key);
		out.push(item);
	}
	return out;
};
