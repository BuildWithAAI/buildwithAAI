/**
 * The claim gate's privacy detectors, copied into the fact bank (pure, plus one file reader).
 *
 * Why a copy: the claim gate (scripts/claims, another workflow's tool) is not committed yet, so importing it broke
 * every clean checkout of the branch (the CLI crashed on start, the tests could not load, the type check failed). These
 * are verbatim copies of scripts/claims/lib/names.ts (loadNames, findNames), wallets.ts (findWallets, KIND_LABEL),
 * quiet.ts (quietTypelessWarning) and the two text helpers they use, as of 2026-11-24. Both gates must agree on what
 * is a private name or a wallet address, so tests/facts.test.ts compares this file with scripts/claims/lib whenever
 * that folder is present, and fails on any difference. Once scripts/claims is committed, this file can re-export it.
 *
 * Private names: data/private/names.txt is gitignored: one name or @handle per line, "#" comments, entries shorter than
 * 3 characters ignored. A matched name is NEVER printed or written: reports say "private name #N".
 */
import {existsSync, readFileSync} from 'node:fs';

/* ------------------------------------------------------------------ text helpers (claims/lib/text.ts) */

export const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** All matches of a regex (adds the g flag when missing). */
export const allMatches = (re: RegExp, text: string): RegExpExecArray[] => {
	const g = re.flags.includes('g') ? re : new RegExp(re.source, re.flags + 'g');
	g.lastIndex = 0;
	const out: RegExpExecArray[] = [];
	let m: RegExpExecArray | null;
	while ((m = g.exec(text))) {
		out.push(m);
		if (m[0] === '') g.lastIndex++;
	}
	return out;
};

/* ------------------------------------------------------------------ private names (claims/lib/names.ts) */

export type NameList = {path: string | null; count: number; patterns: RegExp[]};

export const EMPTY_NAMES: NameList = {path: null, count: 0, patterns: []};

export const namePatterns = (names: string[]): RegExp[] =>
	names.map((raw) => {
		const n = raw.normalize('NFC').trim();
		const handle = n.startsWith('@') ? n.slice(1) : null;
		const body = escapeRe(handle ?? n).replace(/\s+/g, '\\s+');
		return new RegExp(`(?<![\\p{L}\\p{M}\\p{N}_])${handle ? '@?' : ''}${body}(?![\\p{L}\\p{M}\\p{N}_])`, 'iu');
	});

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
	const out: number[] = [];
	list.patterns.forEach((re, i) => {
		if (re.test(t)) out.push(i + 1);
	});
	return out;
};

/* ------------------------------------------------------------------ wallet-like strings (claims/lib/wallets.ts) */

export type WalletKind = 'evm-address' | 'evm-hash' | 'base58' | 'bech32' | 'short-address' | 'ens';
export type WalletHit = {kind: WalletKind; index: number; length: number; level: 'error' | 'warning'};

const B58 = '1-9A-HJ-NP-Za-km-z';
const PATTERNS: Array<{kind: WalletKind; re: RegExp; level: 'error' | 'warning'}> = [
	{kind: 'evm-hash', re: /(?<![0-9A-Za-z])0x[0-9a-fA-F]{64}(?![0-9A-Za-z])/g, level: 'error'},
	{kind: 'evm-address', re: /(?<![0-9A-Za-z])0x[0-9a-fA-F]{40}(?![0-9A-Za-z])/g, level: 'error'},
	{kind: 'bech32', re: /(?<![0-9A-Za-z])(?:bc|tb|ltc)1[02-9ac-hj-np-z]{11,71}(?![0-9A-Za-z])/g, level: 'error'},
	// base58 runs of 26-90 characters that mix letters and digits: addresses (26-44) and signatures (87-88)
	{kind: 'base58', re: new RegExp(`(?<![0-9A-Za-z])(?=[${B58}]*\\d)(?=[${B58}]*[A-Za-z])[${B58}]{26,90}(?![0-9A-Za-z])`, 'g'), level: 'error'},
	// shortened forms keep enough of a real address to identify it: "7xKX…gAsU", "0x12ab...89ef"
	{kind: 'short-address', re: /(?<![0-9A-Za-z])0x[0-9a-fA-F]{3,10}(?:…|\.{2,3})[0-9a-fA-F]{3,10}(?![0-9A-Za-z])/g, level: 'error'},
	{kind: 'short-address', re: new RegExp(`(?<![0-9A-Za-z])(?=[${B58}.…]*\\d)[${B58}]{3,10}(?:…|\\.{2,3})[${B58}]{3,10}(?![0-9A-Za-z])`, 'g'), level: 'error'},
	{kind: 'ens', re: /(?<![0-9A-Za-z-])[a-z0-9-]{3,}\.eth(?![0-9A-Za-z])/gi, level: 'warning'},
];

export const KIND_LABEL: Record<WalletKind, string> = {
	'evm-address': 'an EVM wallet or contract address',
	'evm-hash': 'an EVM transaction hash',
	base58: 'a base58 address or signature (Solana, Bitcoin, Tron)',
	bech32: 'a bech32 Bitcoin address',
	'short-address': 'a shortened address',
	ens: 'an ENS name',
};

export const findWallets = (text: string): WalletHit[] => {
	const out: WalletHit[] = [];
	for (const p of PATTERNS) {
		for (const m of allMatches(p.re, text)) {
			if (out.some((h) => m.index < h.index + h.length && h.index < m.index + m[0].length)) continue;
			out.push({kind: p.kind, index: m.index, length: m[0].length, level: p.level});
		}
	}
	return out.sort((a, b) => a.index - b.index);
};

/* ------------------------------------------------------------------ one Node warning (claims/lib/quiet.ts) */

/**
 * Drop exactly one Node warning: MODULE_TYPELESS_PACKAGE_JSON, which Node prints when it loads src/episode/*.ts (ES
 * modules under the studio's package.json, which has no "type" field and is not ours to change). Every other warning
 * still prints. Must run before the module graph that contains src/episode is loaded, so the entry point imports its
 * implementation dynamically.
 */
export const quietTypelessWarning = (): void => {
	const original = process.emitWarning;
	process.emitWarning = function (this: unknown, warning: string | Error, ...rest: unknown[]) {
		const opt = rest[0];
		const code = typeof opt === 'object' && opt !== null ? (opt as {code?: string}).code : rest[1];
		if (code === 'MODULE_TYPELESS_PACKAGE_JSON') return;
		return (original as (...a: unknown[]) => void).call(process, warning, ...rest);
	} as typeof process.emitWarning;
};
