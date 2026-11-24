/**
 * Private names (pure + one reader). data/private/names.txt is gitignored: one name or @handle per line, "#" comments,
 * entries shorter than 3 characters ignored (the same format as scripts/assets). A matched name is NEVER printed or
 * written: reports say "private name #N" and every snippet is redacted.
 *
 * Matching ignores accents on both sides (2026-11-24, VCD fix): "Jordán Vexley" in a Spanish script matches
 * "Jordan Vexley" in the list, and a list entry "José" matches "Jose". namePatterns() is unchanged (scripts/facts keeps
 * a verbatim copy and compares the two); findNames() and redactNames() also try each pattern with its accents removed
 * against the text with its accents removed.
 */
import {existsSync, readFileSync} from 'node:fs';
import {escapeRe} from './text.ts';

/** `path`: the list file read (null = none). `skipped`: the caller asked not to read one (--no-names). */
export type NameList = {path: string | null; count: number; patterns: RegExp[]; skipped?: boolean};

export const EMPTY_NAMES: NameList = {path: null, count: 0, patterns: []};

/** Letters and digits with their accents removed (NFKD, combining marks dropped). */
export const stripMarks = (s: string): string => s.normalize('NFKD').replace(/\p{M}/gu, '');

export const namePatterns = (names: string[]): RegExp[] =>
	names.map((raw) => {
		const n = raw.normalize('NFC').trim();
		const handle = n.startsWith('@') ? n.slice(1) : null;
		const body = escapeRe(handle ?? n).replace(/\s+/g, '\\s+');
		return new RegExp(`(?<![\\p{L}\\p{M}\\p{N}_])${handle ? '@?' : ''}${body}(?![\\p{L}\\p{M}\\p{N}_])`, 'iu');
	});

const BEFORE = '(?<![\\p{L}\\p{M}\\p{N}_])';
const AFTER = '(?![\\p{L}\\p{M}\\p{N}_])';
/** The pattern with accents removed, matching letters that carry accents in (NFD) text: "Jordan" finds "Jordán". */
const foldedCache = new WeakMap<RegExp, RegExp>();
const folded = (re: RegExp): RegExp => {
	let f = foldedCache.get(re);
	if (!f) {
		const src = re.source;
		if (!src.startsWith(BEFORE) || !src.endsWith(AFTER)) f = re;
		else {
			// only the name body changes: each letter or digit may be followed by combining marks in the NFD text
			const body = stripMarks(src.slice(BEFORE.length, src.length - AFTER.length)).replace(/\\.|[\p{L}\p{N}]/gu, (m) => (m.startsWith('\\') ? m : `${m}\\p{M}*`));
			f = new RegExp(`${BEFORE}${body}${AFTER}`, re.flags.replace('g', ''));
		}
		foldedCache.set(re, f);
	}
	return f;
};

export const parseNames = (text: string): string[] =>
	text
		.split(/\r?\n/)
		.map((l) => l.replace(/#.*$/, '').trim())
		.filter((l) => [...l.replace(/^@/, '')].length >= 3);

export const loadNames = (path: string | null): NameList => {
	if (!path || !existsSync(path)) return {path: null, count: 0, patterns: []};
	const names = parseNames(readFileSync(path, 'utf8'));
	return {path, count: names.length, patterns: namePatterns(names)};
};

/** 1-based numbers of the list entries found in the text. */
export const findNames = (text: string, list: NameList): number[] => {
	const t = text.normalize('NFC');
	const nfd = text.normalize('NFD');
	const out: number[] = [];
	list.patterns.forEach((re, i) => {
		if (re.test(t) || folded(re).test(nfd)) out.push(i + 1);
	});
	return out;
};

/** The text with every private name replaced by "[private name #N]". */
export const redactNames = (text: string, list: NameList): string =>
	list.patterns
		.reduce((acc, re, i) => acc.replace(new RegExp(folded(re).source, `${folded(re).flags}g`), `[private name #${i + 1}]`), text.normalize('NFD'))
		.normalize('NFC');
