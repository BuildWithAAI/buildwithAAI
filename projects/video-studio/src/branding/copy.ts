/**
 * Channel-copy tools (pure): read the paste-ready blocks of content/<channel>/channel-copy.md and lint them against
 * YouTube's limits (spec.ts TEXT_LIMITS) and the house rules (CLAUDE.md: the host is "Zoo", never "ZOO"; no income,
 * return or price claims; no "buy" calls; never ask for wallet secrets).
 *
 * This is a narrow copy lint for channel fields, not the general claim gate (scripts/claims), which reviews scripts.
 */
import {TEXT_LIMITS} from './spec.ts';

/** Fenced ```text id=<id> blocks of a markdown file, keyed by id (content trimmed). */
export const parseBlocks = (md: string): Record<string, string> => {
	const out: Record<string, string> = {};
	const re = /```text id=([a-z0-9-]+)\n([\s\S]*?)```/g;
	for (let m = re.exec(md); m; m = re.exec(md)) {
		if (out[m[1]] !== undefined) throw new Error(`duplicate block id ${m[1]}`);
		out[m[1]] = m[2].replace(/\s+$/, '');
	}
	return out;
};

export const lines = (block: string): string[] => block.split('\n').map((l) => l.trim()).filter(Boolean);

/** Keywords as YouTube stores them: space-separated, multi-word keywords in double quotes. */
export const storedKeywords = (keywords: readonly string[]): string => keywords.map((k) => (/\s/.test(k) ? `"${k}"` : k)).join(' ');

export type Playlist = {title: string; description: string; contents: string; order: string};
export const parsePlaylists = (block: string): Playlist[] =>
	lines(block).map((l) => {
		const parts = l.split('|').map((p) => p.trim());
		if (parts.length !== 4 || parts.some((p) => !p)) throw new Error(`playlist line needs 4 fields: ${l}`);
		return {title: parts[0], description: parts[1], contents: parts[2], order: parts[3]};
	});

/** Spoken form of the voice step's markup: {display|spoken} -> spoken. */
export const spoken = (s: string): string => s.replace(/\{([^|{}]*)\|([^{}]*)\}/g, '$2');
export const wordCount = (s: string): number => (spoken(s).match(/[A-Za-z0-9À-ɏ']+/g) ?? []).length;

export type Issue = {rule: string; text: string};

const NEGATION = /\b(not|never|no|isn't|won't|don't|doesn't|nobody)\b/i;
/** Sentences end at . ! ? or a line break (not at a colon: "What this channel is not: ..." is one sentence). */
const sentences = (text: string): string[] => text.split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter(Boolean);

/** Phrases that must never appear in channel copy (the old forex-robot promises, hype, income talk). */
const BANNED: ReadonlyArray<[RegExp, string]> = [
	[/\bforex\b/i, 'forex: the channel is not about a forex robot'],
	[/\btrading robot\b|\bexpert advisor\b/i, 'trading robot / Expert Advisor promise'],
	[/\blive results\b|\bperformance updates?\b/i, 'results/performance promise'],
	[/\bguarantee/i, 'guarantee'],
	[/\bpassive income\b|\bfinancial freedom\b|\b\d+x\b|\bto the moon\b/i, 'income or hype claim'],
	[/\bbuy now\b|\bdm me\b|\bjoin (my|our) (signals?|group)\b/i, 'call to buy or to join a signals group'],
	[/\b(send|share|enter|give) (us |me )?your (seed|private key|recovery phrase)/i, 'asks for wallet secrets (cryptophishing)'],
];

/** Phrases allowed only inside a negated sentence ("not a way to get rich", "we never tell you to buy"). */
const NEGATED_ONLY: ReadonlyArray<[RegExp, string]> = [
	[/\bget rich\b/i, '"get rich" outside a negation'],
	[/\b(financial|investment) advice\b/i, '"financial advice" outside a negation'],
	[/\bsignals?\b/i, '"signals" outside a negation'],
	[/\bprice predictions?\b/i, '"price predictions" outside a negation'],
	[/\bbuy\b/i, '"buy" outside a negation'],
];

/** `prose` = sentences a viewer reads as claims (descriptions, narration); keyword and playlist lists are topics. */
export const lintText = (text: string, prose = true): Issue[] => {
	const issues: Issue[] = [];
	const t = spoken(text);
	if (/\bZOO\b/.test(t)) issues.push({rule: 'host name is "Zoo", never "ZOO"', text: (/[^\n]*\bZOO\b[^\n]*/.exec(t) ?? [''])[0]});
	for (const [re, rule] of BANNED) if (re.test(t)) issues.push({rule, text: (new RegExp(`[^\\n]*${re.source}[^\\n]*`, 'i').exec(t) ?? [''])[0]});
	if (prose) {
		for (const s of sentences(t)) {
			for (const [re, rule] of NEGATED_ONLY) if (re.test(s) && !NEGATION.test(s)) issues.push({rule, text: s});
		}
	}
	if (/\[[^\]]*\]|\bTBD\b/.test(t)) issues.push({rule: 'placeholder left in paste-ready text', text: (/[^\n]*(\[[^\]]*\]|\bTBD\b)[^\n]*/.exec(t) ?? [''])[0]});
	return issues;
};

export type CopyReport = {
	descriptionChars: number;
	keywordsStoredChars: number;
	playlists: Playlist[];
	trailerWords: number;
	trailerLines: number;
	issues: Issue[];
};

/** Lint a whole channel-copy.md: limits plus the text rules on every paste-ready block. */
export const lintChannelCopy = (md: string): CopyReport => {
	const b = parseBlocks(md);
	for (const id of ['description', 'keywords', 'playlists', 'trailer-narration']) if (b[id] === undefined) throw new Error(`channel copy is missing the ${id} block`);
	const issues: Issue[] = [];
	const description = b.description;
	if (description.length > TEXT_LIMITS.channelDescription) issues.push({rule: `description over ${TEXT_LIMITS.channelDescription} characters`, text: `${description.length}`});
	const kw = lines(b.keywords);
	const stored = storedKeywords(kw);
	if (stored.length > TEXT_LIMITS.channelKeywordsTotal) issues.push({rule: `keywords over ${TEXT_LIMITS.channelKeywordsTotal} characters as stored`, text: `${stored.length}`});
	if (new Set(kw.map((k) => k.toLowerCase())).size !== kw.length) issues.push({rule: 'duplicate keyword', text: kw.join(', ')});
	if (kw.some((k) => k.includes('"'))) issues.push({rule: 'keyword contains a quotation mark (YouTube truncates)', text: kw.join(', ')});
	const playlists = parsePlaylists(b.playlists);
	for (const p of playlists) if (p.title.length > 60) issues.push({rule: 'playlist title over 60 characters (house limit; YouTube allows 150)', text: p.title});
	for (const [id, text] of Object.entries(b)) {
		const list = id === 'keywords' || id === 'playlists';
		for (const i of lintText(list ? text.replace(/\|/g, '.') : text, !list)) issues.push({rule: `${id}: ${i.rule}`, text: i.text});
	}
	for (const [id, text] of Object.entries(b)) if (id.startsWith('description-') && text.length > TEXT_LIMITS.channelDescription) issues.push({rule: `${id} over ${TEXT_LIMITS.channelDescription} characters`, text: `${text.length}`});
	const trailer = lines(b['trailer-narration']);
	return {
		descriptionChars: description.length,
		keywordsStoredChars: stored.length,
		playlists,
		trailerWords: trailer.reduce((s, l) => s + wordCount(l), 0),
		trailerLines: trailer.length,
		issues,
	};
};
