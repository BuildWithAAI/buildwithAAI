/**
 * Wallet-address-like strings (pure): EVM addresses and hashes, base58 (Solana, Bitcoin legacy, Tron) addresses and
 * signatures, bech32 addresses, shortened forms ("7xKX…gAsU") and ENS names. The repo is public and scripts never show
 * real addresses (research "Must not say", CLAUDE.md), so a match is an error and is never echoed back.
 */
import {allMatches} from './text.ts';

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

/** The text with wallet-like strings replaced by "[wallet-like string]". */
export const redactWallets = (text: string): string => {
	const hits = findWallets(text);
	let out = '';
	let pos = 0;
	for (const h of hits) {
		out += text.slice(pos, h.index) + '[wallet-like string]';
		pos = h.index + h.length;
	}
	return out + text.slice(pos);
};
