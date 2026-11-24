/**
 * The bank on disk: content/facts/facts.jsonl, one fact per line, sorted by id, keys in a fixed order (so a change to
 * one fact is a one-line diff). Writes go to a temporary file first and replace the bank in one rename.
 */
import {existsSync, mkdirSync, readFileSync, renameSync, writeFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import type {Fact, FactSource, SourceCheck, Translation} from './types.ts';

/** projects/video-studio (this file is scripts/facts/lib/store.ts). */
export const STUDIO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
export const FACTS_DIR = join(STUDIO, 'content', 'facts');
export const DEFAULT_BANK = join(FACTS_DIR, 'facts.jsonl');
export const DEFAULT_HOSTS = join(FACTS_DIR, 'hosts.json');
export const DEFAULT_NAMES = join(STUDIO, 'data', 'private', 'names.txt');

/** Bad input (missing file, unreadable JSON): exit code 2. */
export class InputError extends Error {}

export type LoadedBank = {path: string; facts: Fact[]; raw: unknown[]; problems: Array<{line: number; message: string}>};

/** Read the bank. A missing file is an empty bank; a line that is not JSON is reported, not thrown. */
export const loadBank = (path = DEFAULT_BANK): LoadedBank => {
	const out: LoadedBank = {path, facts: [], raw: [], problems: []};
	if (!existsSync(path)) return out;
	const lines = readFileSync(path, 'utf8').split('\n');
	lines.forEach((line, i) => {
		if (!line.trim()) return;
		try {
			const x = JSON.parse(line) as unknown;
			out.raw.push(x);
			out.facts.push(x as Fact);
		} catch (e) {
			out.problems.push({line: i + 1, message: `not valid JSON: ${(e as Error).message}`});
		}
	});
	return out;
};

const pick = <T extends object>(o: T, keys: Array<keyof T>): T => {
	const out = {} as T;
	for (const k of keys) if (o[k] !== undefined) out[k] = o[k];
	return out;
};

const orderCheck = (c: SourceCheck): SourceCheck => pick(c, ['at', 'by', 'result', 'detail']);
const orderSource = (s: FactSource): FactSource => ({...pick(s, ['url', 'title', 'cardTitle', 'publisher', 'published', 'tier', 'accessed', 'excerpt']), checks: (s.checks ?? []).map(orderCheck)});
const orderTranslation = (t: Translation): Translation => pick(t, ['statement', 'translation', 'reviewed']);

/** A fact with its keys in the canonical order (unknown keys are kept at the end, so validation can report them). */
export const orderFact = (f: Fact): Fact => {
	const known: Fact = {
		id: f.id,
		statement: f.statement,
		numbers: f.numbers,
		entities: f.entities,
		tags: f.tags,
		volatility: f.volatility,
		verification: f.verification,
		verifiedAt: f.verifiedAt,
		recheckAfter: f.recheckAfter,
		sources: Array.isArray(f.sources) ? f.sources.map(orderSource) : f.sources,
		languages: f.languages && typeof f.languages === 'object' ? Object.fromEntries(Object.entries(f.languages).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, v && typeof v === 'object' ? orderTranslation(v as Translation) : v])) : f.languages,
		usage: Array.isArray(f.usage) ? [...f.usage].sort() : f.usage,
		notes: f.notes,
	};
	const extra = Object.fromEntries(Object.entries(f).filter(([k]) => !(k in known)));
	return {...known, ...extra};
};

export const serializeBank = (facts: Fact[]): string =>
	[...facts]
		.sort((a, b) => a.id.localeCompare(b.id))
		.map((f) => JSON.stringify(orderFact(f)))
		.join('\n') + (facts.length ? '\n' : '');

export const saveBank = (path: string, facts: Fact[]): void => {
	mkdirSync(dirname(path), {recursive: true});
	const tmp = `${path}.${process.pid}.tmp`;
	writeFileSync(tmp, serializeBank(facts));
	renameSync(tmp, path);
};

export type HostsFile = {allow: string[]; notes: Record<string, string>};

/** The fetch allowlist: hosts the environment lets this session reach (owner-approved). */
export const loadHosts = (path = DEFAULT_HOSTS): HostsFile => {
	if (!existsSync(path)) throw new InputError(`no host allowlist at ${path}`);
	let x: unknown;
	try {
		x = JSON.parse(readFileSync(path, 'utf8'));
	} catch (e) {
		throw new InputError(`${path} is not valid JSON: ${(e as Error).message}`);
	}
	const o = x as {allow?: unknown; notes?: unknown};
	if (!o || !Array.isArray(o.allow) || !o.allow.every((h) => typeof h === 'string' && /^[a-z0-9.-]+$/.test(h)))
		throw new InputError(`${path}: "allow" must be a list of lower-case host names`);
	const notes = o.notes && typeof o.notes === 'object' ? (o.notes as Record<string, string>) : {};
	return {allow: o.allow as string[], notes};
};

/** Is the URL's host on the allowlist (exactly, or a subdomain of an entry: www.theblock.co under theblock.co)? */
export const hostAllowed = (url: string, allow: string[] | 'any'): boolean => {
	let host: string;
	try {
		const u = new URL(url);
		if (u.protocol !== 'https:') return false;
		host = u.hostname.toLowerCase();
	} catch {
		return false;
	}
	if (allow === 'any') return true;
	return allow.some((a) => host === a || host.endsWith(`.${a}`));
};
