/**
 * Named things in English text (pure): organisations, products and people's names (capitalised words that do not
 * start a sentence, CamelCase), acronyms, tickers, URLs and handles. A translation keeps them as written; when one
 * disappears from both the translation and the back-translation, a fact may have lost its subject.
 */
import {stripTags, upperShare} from './text.ts';

const MONTHS_DAYS = new Set(
	'January February March April May June July August September October November December Jan Feb Mar Apr Jun Jul Aug Sep Sept Oct Nov Dec Monday Tuesday Wednesday Thursday Friday Saturday Sunday'.split(' '),
);
/** Not names: common-noun abbreviations ("in your DMs") and the like. */
const NOT_NAMES = new Set(['I', 'OK', 'TV', 'A', 'AM', 'PM', 'DM', 'DMs', 'FAQ', 'FAQs', 'ID', 'IDs', 'PIN', 'PINs', 'URL', 'URLs', 'OTP', 'OTPs', 'PDF', 'FYI', 'ASAP', 'TBD', 'ETA', 'CEO', 'CEOs', 'CTO', 'CFO']);
/** Tickers that stay names even in ALL CAPS text ("$DEMO / SOL"). */
const TICKERS = new Set(['BTC', 'ETH', 'SOL', 'USDC', 'USDT', 'BNB', 'XRP', 'DOGE', 'TON', 'SUI', 'AVAX', 'LINK', 'DAI', 'PEPE', 'BONK', 'WIF']);
const CONNECTORS = new Set(['&', 'of', 'de', 'for', 'da', 'do']);
/** Capitalised only because they start a sentence. */
const SENTENCE_WORDS = new Set(
	'The A An This That These Those In On At As If When While So But And Or Then Here There Our Your My His Her Its Their We You They It He She One Every Each All No Next First Now Why How What Who Where'.split(' '),
);

const isCap = (w: string): boolean => /^\p{Lu}/u.test(w);
const isCamel = (w: string): boolean => /^\p{Lu}?\p{Ll}+\p{Lu}/u.test(w) || /\p{Ll}\p{Lu}/u.test(w);
const isAcronym = (w: string): boolean => /^\p{Lu}{2,}\d*s?$/u.test(w) || /^\p{Lu}+\d+$/u.test(w);

export const extractEntities = (input: string): string[] => {
	// "US$" / "R$" / "U$S" are currency signs, not names
	const text = stripTags(input).replace(/\b(?:US|U\$S|R)\$/g, '$');
	const out = new Set<string>();
	let rest = text;
	for (const m of text.matchAll(/https?:\/\/[^\s)]+|\b[\w-]+\.(?:com|org|net|io|ai|fun|xyz|app|dev)\b|@[A-Za-z0-9_]+|#[A-Za-z0-9_]+|\$[A-Za-z][A-Za-z0-9]{1,11}\b/g)) {
		out.add(m[0].replace(/[.,;:!?]+$/, ''));
		rest = rest.replace(m[0], ' '.repeat(m[0].length));
	}
	const allCaps = upperShare(text) > 0.6;
	// words with their sentence-start flag
	const words: Array<{w: string; start: boolean}> = [];
	let atStart = true;
	for (const m of rest.matchAll(/[\p{L}\p{N}][\p{L}\p{N}'’.&-]*|[.!?:;"“”(·•|–—/]|&/gu)) {
		const tok = m[0];
		if (/^[.!?:;"“”(·•|–—/]$/.test(tok)) {
			atStart = true;
			continue;
		}
		const clean = tok.replace(/['’]s$/u, '').replace(/[.'’-]+$/u, '');
		words.push({w: clean, start: atStart});
		atStart = /[.!?]$/.test(tok) && !/\.\w/.test(tok) && tok.length > 2 ? true : false;
	}
	const capitalisedMidSentence = new Set(words.filter((x) => !x.start && isCap(x.w)).map((x) => x.w));
	let run: string[] = [];
	const flush = () => {
		while (run.length && CONNECTORS.has(run[run.length - 1])) run.pop();
		if (run.length) {
			const name = run.join(' ');
			if (!MONTHS_DAYS.has(name) && !NOT_NAMES.has(name)) out.add(name);
		}
		run = [];
	};
	for (let i = 0; i < words.length; i++) {
		const {w, start} = words[i];
		const acronym = isAcronym(w);
		const next = words[i + 1];
		// "Example Security Lab" at a sentence start: the first word belongs to the name when a capitalised word follows
		const startsName = start && !SENTENCE_WORDS.has(w) && !!next && !next.start && isCap(next.w);
		const named = isCap(w) && (!start || isCamel(w) || /\d/.test(w) || capitalisedMidSentence.has(w) || startsName);
		if (allCaps) {
			// ALL CAPS text: only tickers and well-formed acronyms with digits survive
			if (/^\p{Lu}+\d+$/u.test(w) || TICKERS.has(w)) out.add(w);
			continue;
		}
		if ((acronym && !NOT_NAMES.has(w)) || (named && !MONTHS_DAYS.has(w))) {
			run.push(w);
			continue;
		}
		if (run.length && CONNECTORS.has(w) && i + 1 < words.length && isCap(words[i + 1].w) && !words[i + 1].start) {
			run.push(w);
			continue;
		}
		flush();
	}
	flush();
	return [...out];
};
