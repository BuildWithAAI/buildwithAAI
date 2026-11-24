/**
 * Is this the same incident? Radar ids are "<earliest date>-<name slug>" and can change between days (a database
 * record lands with an earlier date, the display name flips), so the daily matches incidents the way the radar's
 * history does (scripts/radar/radarlib/history.py match_previous): the same id, or the protocol's aliases match
 * (an exact alias, or one name as a whole word inside the other) and the incident dates are within 3 days.
 * Near-miss spellings never match on their own: "Prism" is not "Prisma Finance" and "Sonne" is not "Sonnet".
 * A port of the radar's norm_name / core_name / aliases_for / names_match (Python), kept in step with it.
 */
import {daysBetween, isDate} from './util.ts';

/** Generic trailing words of a protocol name (radar textutil._GENERIC_SUFFIX). */
const GENERIC_SUFFIX = new Set([
	'cex', 'dex', 'amm', 'perps', 'perp', 'lend', 'lending', 'finance', 'protocol', 'network', 'labs', 'dao', 'exchange', 'markets', 'market', 'bridge', 'swap', 'international',
	'wallet', 'wallets', 'token', 'vault', 'vaults', 'pool', 'pools', 'app', 'platform', 'foundation', 'v1', 'v2', 'v3', 'v4', 'chain', 'official', 'io', 'xyz', 'fi',
]);

/** Words that are never an alias on their own (radar cluster.ALIAS_STOP). */
const ALIAS_STOP = new Set([
	'bitcoin', 'ethereum', 'solana', 'bsc', 'base', 'polygon', 'arbitrum', 'optimism', 'avalanche', 'tron', 'crypto', 'defi', 'dex', 'cex', 'bridge', 'protocol', 'exchange', 'wallet', 'the',
	'network', 'chain', 'token', 'app', 'vault', 'lend', 'finance', 'labs', 'users', 'supply chain', 'unknown', 'other', 'hack', 'exploit', 'north korea', 'dprk', 'lazarus',
]);

/** Lower-case ASCII-folded name with punctuation flattened to single spaces (radar norm_name). */
export const normName = (name: string): string =>
	(name ?? '')
		.normalize('NFKD')
		.replace(/[̀-ͯ]/g, '')
		.toLowerCase()
		.replace(/’/g, "'")
		.replace(/'s /g, ' ')
		.replace(/[^a-z0-9.]+/g, ' ')
		.replace(/(?<![a-z0-9])\.|\.(?![a-z0-9])/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();

/** The name without parentheticals and generic trailing words: "Chainflip AMM" -> "chainflip" (radar core_name). */
export const coreName = (name: string): string => {
	const tokens = normName((name ?? '').replace(/\([^)]*\)/g, ' ')).split(' ').filter(Boolean);
	while (tokens.length > 1 && GENERIC_SUFFIX.has(tokens[tokens.length - 1])) tokens.pop();
	while (tokens.length > 1 && tokens[0] === 'the') tokens.shift();
	return tokens.join(' ');
};

const validAlias = (a: string): boolean => {
	const s = a.trim();
	return !!s && !ALIAS_STOP.has(s) && (s.length >= 3 || /\d/.test(s));
};

/** Every alias of a protocol name: the full and core names, with and without spaces, and one-word parentheticals. */
export const aliasesFor = (name: string): Set<string> => {
	const out = new Set<string>();
	if (!name) return out;
	const full = normName(name.replace(/\([^)]*\)/g, ' '));
	const core = coreName(name);
	for (const c of [full, core, full.replace(/ /g, ''), core.replace(/ /g, '')]) if (validAlias(c)) out.add(c);
	for (const m of name.matchAll(/\(([^)]*)\)/g)) {
		const inner = m[1].trim();
		if (inner && !inner.includes(' ') && validAlias(normName(inner))) out.add(normName(inner));
	}
	return out;
};

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** An exact alias, or one name as a whole word inside the other (4 characters or more). Never a near miss. */
export const namesMatch = (a: Set<string>, b: Set<string>): boolean => {
	if (!a.size || !b.size) return false;
	for (const x of a) if (b.has(x)) return true;
	for (const x of a)
		for (const y of b) {
			const [short, long] = x.length <= y.length ? [x, y] : [y, x];
			if (short.length >= 4 && new RegExp(`(?<![a-z0-9])${esc(short)}(?![a-z0-9])`).test(long)) return true;
		}
	return false;
};

export type IncidentRef = {id?: string | null; protocol?: string | null; date?: string | null};

/**
 * The same incident: the same radar id, or matching names with dates within `days` of each other. With
 * `unknownDate: 'match'` a missing date on either side still matches on the name (the cautious direction for
 * "already covered": no repeat video); with 'no-match' it does not (the cautious direction for corrections: never
 * compare two different incidents).
 */
export const sameIncident = (a: IncidentRef, b: IncidentRef, o: {days?: number; unknownDate?: 'match' | 'no-match'} = {}): boolean => {
	if (a.id && b.id && a.id === b.id) return true;
	if (!a.protocol || !b.protocol || !namesMatch(aliasesFor(a.protocol), aliasesFor(b.protocol))) return false;
	if (!isDate(a.date) || !isDate(b.date)) return (o.unknownDate ?? 'match') === 'match';
	return Math.abs(daysBetween(a.date, b.date)) <= (o.days ?? 3);
};
