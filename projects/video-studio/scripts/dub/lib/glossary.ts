/**
 * Do-not-translate terms (pure): character and brand names, platforms, named organisations, token tickers and URLs.
 * The sheet lists the ones that occur in the source; validate requires each one in every target string whose source
 * string has it. Matching is case-sensitive with Latin-script boundaries, so it works inside Devanagari and CJK text.
 */
import type {Lang} from '../../../src/episode/types.ts';
import {ORGS} from '../../claims/lib/lexicon.ts';
import {allMatches, escapeRe, latinTermRe} from '../../claims/lib/text.ts';

export type GlossaryTerm = {term: string; note: string; kind: 'name' | 'org' | 'ticker' | 'url' | 'extra'};

export const BASE_GLOSSARY: readonly GlossaryTerm[] = [
	{term: 'Zoo', kind: 'name', note: "the host's name (title case since 2026-11-24); never translate it (not 'zoológico', 'zoo', '动物园')"},
	{term: 'ZOO', kind: 'name', note: "older capitalisation of the host's name; keep it exactly as the source writes it"},
	{term: 'Badger', kind: 'name', note: "Zoo's dog; a name, never translate it (not 'Tejón', 'Texugo', 'Tasso', 'बिज्जू', '獾')"},
	{term: 'Zoora AI', kind: 'name', note: 'the channel name'},
	{term: 'Zoora', kind: 'name', note: 'the brand name'},
	{term: 'The Zoo & Badger Show', kind: 'name', note: 'the show name'},
	{term: 'Pump.fun', kind: 'name', note: 'platform name'},
	{term: 'PumpSwap', kind: 'name', note: 'platform name'},
	{term: 'Bubblemaps', kind: 'name', note: 'analytics firm'},
	{term: 'Solana', kind: 'name', note: 'blockchain name'},
	{term: 'Ethereum', kind: 'name', note: 'blockchain name'},
	{term: 'Bitcoin', kind: 'name', note: 'blockchain name'},
	{term: 'Telegram', kind: 'name', note: 'app name'},
	{term: 'YouTube', kind: 'name', note: 'platform name'},
	{term: 'X', kind: 'name', note: 'the platform formerly called Twitter'},
];

/** Well-known tickers matched as whole upper-case words (a "$TICKER" is always a ticker). */
const TICKERS = ['BTC', 'ETH', 'SOL', 'USDC', 'USDT', 'BNB', 'XRP', 'DOGE', 'PEPE', 'BONK', 'WIF', 'PUMP', 'TRUMP', 'MELANIA', 'LIBRA', 'HAWK', 'GOAT', 'AI16Z', 'ELIZA'];
const DOLLAR_TICKER = /(?<![\p{L}\p{N}])\$[A-Z][A-Z0-9]{1,11}(?![\p{L}\p{N}])/gu;
const BARE_TICKER = new RegExp(`(?<![\\p{L}\\p{N}$])(?:${TICKERS.join('|')})(?![\\p{L}\\p{N}])`, 'gu');
export const URL_TERM = /https?:\/\/[^\s)\]}>"']+|(?<![\p{L}\p{N}@.])(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|io|ai|fun|xyz|org|net|gg|app|so|co|me|tv|news|finance|exchange|dev)(?:\/[^\s)\]}>"']*)?/gu;

/** URLs in a text (trailing punctuation trimmed). */
export const urlsIn = (text: string): string[] => allMatches(URL_TERM, text).map((m) => m[0].replace(/[.,;:!?…]+$/, ''));

const countIn = (term: GlossaryTerm, text: string): number => {
	if (term.kind === 'url') return text.split(term.term).length - 1;
	if (term.kind === 'ticker') return allMatches(new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(term.term)}(?![\\p{L}\\p{N}])`, 'gu'), text).length;
	return allMatches(latinTermRe(term.term, 'gu'), text).length;
};
export const termCount = countIn;

/** The glossary for one episode: base names, organisations, tickers and URLs that occur in its source texts, plus extras. */
export const buildGlossary = (sourceTexts: string[], extra: GlossaryTerm[] = []): GlossaryTerm[] => {
	const all = sourceTexts.join('\n');
	const out: GlossaryTerm[] = [];
	const add = (t: GlossaryTerm) => {
		if (!out.some((x) => x.term === t.term) && countIn(t, all) > 0) out.push(t);
	};
	for (const t of BASE_GLOSSARY) add(t);
	for (const o of ORGS) add({term: o, kind: 'org', note: 'organisation name: keep it in Latin script (you may add a short native explanation once)'});
	for (const m of allMatches(DOLLAR_TICKER, all)) add({term: m[0], kind: 'ticker', note: 'token ticker (fictional ones too): copy exactly'});
	for (const m of allMatches(BARE_TICKER, all)) add({term: m[0], kind: 'ticker', note: 'token ticker: copy exactly, upper case'});
	for (const u of urlsIn(all)) add({term: u, kind: 'url', note: 'URL: copy exactly'});
	for (const t of extra) add(t);
	// a longer term that contains a shorter one ("Zoora AI" / "Zoora") is checked on its own; keep both
	return out;
};

/** Terms of the glossary that occur in one text. */
export const termsIn = (glossary: GlossaryTerm[], text: string): GlossaryTerm[] => glossary.filter((t) => countIn(t, text) > 0);

/**
 * Spoken respellings per target language (added 2026-11-24, VCD fix), the dub glossary's defaults: espeak reads these
 * terms wrongly in that language ("on-chain" as "on-cháin" in es), so the translator writes {term|spoken}. The voice
 * step's lexicon (scripts/voice/voicelib/lexicon.py) already says some of them; the sheet lists all of them, and
 * validate lists the ones a script uses for the native reviewer, who checks each by ear (machine-made).
 */
export type Respelling = {term: string; spoken: string; note: string};
const RESPELL: Partial<Record<Lang, Respelling[]>> = {
	es: [
		{term: 'on-chain', spoken: 'onchéin', note: 'espeak es reads "on-cháin"; the voice lexicon says "onchéin" too'},
		{term: 'Pump.fun', spoken: 'Pamp punto fan', note: 'the platform name, said the way Spanish-speaking crypto users say it'},
		{term: 'memecoins', spoken: 'mimcoins', note: 'English loanword; espeak es would read "memecoins" letter by letter'},
		{term: 'CoinGecko', spoken: 'Coin Guecko', note: 'espeak es reads "Coin Jeko"'},
		{term: 'Bubblemaps', spoken: 'Bábol maps', note: 'English name'},
		{term: 'bonding curve', spoken: 'bóndin kerv', note: 'keep the English term (the study\'s caveat); espeak es reads "curve" as "cur-ve"'},
	],
	'pt-br': [
		{term: 'on-chain', spoken: 'onchêin', note: 'espeak pt-br misreads the English loanword; the voice lexicon says "onchêin" too'},
		{term: 'Pump.fun', spoken: 'Pâmp ponto fân', note: 'the platform name, said the way Brazilian crypto users say it'},
		{term: 'memecoins', spoken: 'mímcoins', note: 'English loanword'},
		{term: 'CoinGecko', spoken: 'Côin Guéco', note: 'espeak pt-br reads "Coin Jéco"'},
		{term: 'Bubblemaps', spoken: 'Bâbou maps', note: 'English name'},
		{term: 'bonding curve', spoken: 'bôndin kârv', note: 'keep the English term (the study\'s caveat)'},
	],
};
export const respellingsFor = (lang: Lang): Respelling[] => RESPELL[lang] ?? [];
