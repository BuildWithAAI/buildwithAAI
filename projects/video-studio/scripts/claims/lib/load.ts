/**
 * Files and paths shared by the claim gate and the dubbing tools: the studio root, episode folders, storyboards,
 * the private names list and the offer registry. The only module here that touches the file system (plus names.ts).
 */
import {createHash} from 'node:crypto';
import {existsSync, readFileSync, statSync} from 'node:fs';
import {basename, dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import type {Lang, Storyboard} from '../../../src/episode/types.ts';
import {isLang, langProblem} from './text.ts';

/** projects/video-studio (this file is scripts/claims/lib/load.ts). */
export const STUDIO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** Bad input (missing folder, unreadable JSON, unsupported language): exit code 2, not a gate failure. */
export class InputError extends Error {}

/** An episode folder given relative to the working directory or to projects/video-studio. */
export const resolveEpisodeDir = (arg: string, cwd = process.cwd()): string => {
	const tried = [resolve(cwd, arg), resolve(STUDIO, arg)];
	for (const c of tried) if (existsSync(c) && statSync(c).isDirectory()) return c;
	throw new InputError(`no episode folder at "${arg}" (looked at ${[...new Set(tried)].join(' and ')})`);
};

export const readJson = (path: string): unknown => {
	let text: string;
	try {
		text = readFileSync(path, 'utf8');
	} catch (e) {
		throw new InputError(`cannot read ${path}: ${(e as Error).message}`);
	}
	try {
		return JSON.parse(text);
	} catch (e) {
		throw new InputError(`${path} is not valid JSON: ${(e as Error).message}`);
	}
};

export const sha256File = (path: string): string => createHash('sha256').update(readFileSync(path)).digest('hex');

export const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

/** Light shape check, enough for the tools to walk the storyboard without crashing. */
export const storyboardShapeProblems = (x: unknown): string[] => {
	if (!isRecord(x)) return ['the storyboard must be a JSON object'];
	const out: string[] = [];
	if (x.version !== 1) out.push(`version must be 1 (got ${JSON.stringify(x.version)})`);
	if (typeof x.lang !== 'string' || !isLang(x.lang)) out.push(`lang must be one of en, es, pt-br, hi, it, zh, ja (got ${JSON.stringify(x.lang)})${typeof x.lang === 'string' && langProblem(x.lang) ? `: ${langProblem(x.lang)}` : ''}`);
	if (typeof x.sourceLang !== 'string' || !isLang(x.sourceLang)) out.push(`sourceLang must be a supported language (got ${JSON.stringify(x.sourceLang)})`);
	if (!Array.isArray(x.scenes) || !x.scenes.length) out.push('scenes must be a non-empty array');
	else
		x.scenes.forEach((sc, i) => {
			if (!isRecord(sc) || typeof sc.id !== 'string' || !sc.id) out.push(`scenes[${i}] needs a string id`);
			else if (typeof sc.narration !== 'string') out.push(`scenes[${i}] "${sc.id}" needs a narration string`);
			else if (sc.onScreen !== undefined && !isRecord(sc.onScreen)) out.push(`scenes[${i}] "${sc.id}": onScreen must be an object`);
		});
	if (!Array.isArray(x.sources)) out.push('sources must be an array (it may be empty)');
	if (typeof x.title !== 'string') out.push('title must be a string');
	if (typeof x.fiction !== 'boolean') out.push('fiction must be true or false');
	return out;
};

/** Which file holds the storyboard for `lang`: storyboard.<lang>.json, or storyboard.json when its lang matches. */
export const storyboardFile = (dir: string, lang?: Lang): {path: string; lang: Lang} => {
	const base = join(dir, 'storyboard.json');
	const baseLang = (): Lang | null => {
		if (!existsSync(base)) return null;
		const sb = readJson(base);
		return isRecord(sb) && isLang(sb.lang) ? sb.lang : null;
	};
	if (!lang) {
		if (!existsSync(base)) throw new InputError(`no storyboard.json in ${dir}`);
		const l = baseLang();
		if (!l) throw new InputError(`${base} has no valid "lang"`);
		return {path: base, lang: l};
	}
	const own = join(dir, `storyboard.${lang}.json`);
	if (existsSync(own)) return {path: own, lang};
	if (baseLang() === lang) return {path: base, lang};
	throw new InputError(`no ${lang} storyboard in ${dir}: expected storyboard.${lang}.json${existsSync(base) ? ` (storyboard.json is "${baseLang()}")` : ''}`);
};

/** The source-language storyboard of an episode (the master that translations follow). */
export const sourceStoryboardFile = (dir: string, sourceLang: Lang): string | null => {
	const base = join(dir, 'storyboard.json');
	if (existsSync(base)) {
		const sb = readJson(base);
		if (isRecord(sb) && sb.lang === sourceLang) return base;
	}
	const own = join(dir, `storyboard.${sourceLang}.json`);
	return existsSync(own) ? own : null;
};

export const loadStoryboard = (path: string): Storyboard => {
	const x = readJson(path);
	const problems = storyboardShapeProblems(x);
	if (problems.length) throw new InputError(`${path}: ${problems.join('; ')}`);
	return x as Storyboard;
};

/** content/<channel>/<slug> -> {channel, slug}. */
export const channelSlugOf = (dir: string): {channel: string; slug: string} => ({channel: basename(dirname(dir)), slug: basename(dir)});

export const DEFAULT_NAMES = join(STUDIO, 'data', 'private', 'names.txt');

/** creator-hub's offer registry: config/offers.json (gitignored, real) else offers.example.json. */
export const defaultOffersPath = (): string | null => {
	const cfg = join(STUDIO, '..', 'creator-hub', 'config');
	for (const f of ['offers.json', 'offers.example.json']) if (existsSync(join(cfg, f))) return join(cfg, f);
	return null;
};

/** `category` (exchange, token, security, own-product ...) and `fiuIndRegistered` (India) added 2026-11-24 for the regional rules. */
export type OfferInfo = {id: string; relationship: string; disclosure: string; category?: string; fiuIndRegistered?: boolean};

export const loadOffers = (path: string | null): Map<string, OfferInfo> | null => {
	if (!path || !existsSync(path)) return null;
	const x = readJson(path);
	if (!isRecord(x) || !Array.isArray(x.offers)) return null;
	const out = new Map<string, OfferInfo>();
	for (const o of x.offers) {
		if (isRecord(o) && typeof o.id === 'string')
			out.set(o.id, {
				id: o.id,
				relationship: String(o.relationship ?? ''),
				disclosure: String(o.disclosure ?? ''),
				...(typeof o.category === 'string' ? {category: o.category} : {}),
				...(o.fiuIndRegistered === true ? {fiuIndRegistered: true} : {}),
			});
	}
	return out;
};

/** Today in the owner's time zone (America/Chicago), as YYYY-MM-DD. */
export const todayIso = (): string => new Intl.DateTimeFormat('en-CA', {timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit'}).format(new Date());
