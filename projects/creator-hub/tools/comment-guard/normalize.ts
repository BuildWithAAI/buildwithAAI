/**
 * Text normalisation for the comment scam guard.
 *
 * Scam bots disguise trigger words and phone numbers so keyword filters miss them: styled Unicode
 * letters (𝐓𝐞𝐥𝐞𝐠𝐫𝐚𝐦, ᴛᴇʟᴇɢʀᴀᴍ), Cyrillic or Greek look-alikes inside Latin words (Теlеgrаm), spaced-out
 * letters (W h a t s A p p), invisible characters, and digits from other scripts or emoji keycaps
 * (１２３, ١٢٣, 1️⃣). These helpers undo that, so the rules in rules.ts can stay simple.
 */

/** Zero-width and formatting characters, variation selectors, the keycap mark and tag characters. */
const INVISIBLE =
	/[­͏؜ᅟᅠ឴឵᠋-᠏​-‏‪-‮⁠-⁯⃣ㅤ︀-️﻿ﾠ\u{E0000}-\u{E007F}\u{E0100}-\u{E01EF}]/gu;

/** Small capitals and IPA letters that "fancy text" generators use; they are never part of normal writing. */
const FANCY_LETTERS: Record<string, string> = {
	ȷ: 'j', ɑ: 'a', ɡ: 'g', ɩ: 'i', ɪ: 'i', ʟ: 'l', ɴ: 'n', ʀ: 'r', ꜱ: 's', ᴀ: 'a', ʙ: 'b', ᴄ: 'c', ᴅ: 'd', ᴇ: 'e',
	ꜰ: 'f', ɢ: 'g', ʜ: 'h', ᴊ: 'j', ᴋ: 'k', ᴍ: 'm', ᴏ: 'o', ᴘ: 'p', ǫ: 'q', ᴛ: 't', ᴜ: 'u', ᴠ: 'v', ᴡ: 'w', ʏ: 'y',
	ᴢ: 'z', ℓ: 'l', ƚ: 'l',
};
/** Real letters of Turkish, Polish, Nordic and other languages: read as plain Latin, but not suspicious. */
const LATIN_LETTERS: Record<string, string> = {ı: 'i', ł: 'l', ø: 'o', đ: 'd', ħ: 'h'};
const LATIN_LOOKALIKES: Record<string, string> = {...FANCY_LETTERS, ...LATIN_LETTERS};

/** Cyrillic, Greek and Armenian letters that look like Latin ones (lower case). */
const FOREIGN_LOOKALIKES: Record<string, string> = {
	а: 'a', в: 'b', г: 'r', е: 'e', ё: 'e', к: 'k', м: 'm', н: 'h', о: 'o', п: 'n', р: 'p', с: 'c', т: 't', у: 'y',
	х: 'x', ш: 'w', щ: 'w', ь: 'b', і: 'i', ї: 'i', ј: 'j', ѕ: 's', ԁ: 'd', ԛ: 'q', ԝ: 'w', һ: 'h', ӏ: 'l', ү: 'y',
	ҫ: 'c', α: 'a', β: 'b', γ: 'y', ε: 'e', η: 'n', ι: 'i', κ: 'k', μ: 'u', ν: 'v', ο: 'o', π: 'n', ρ: 'p', σ: 'o',
	ς: 'c', τ: 't', υ: 'u', χ: 'x', ω: 'w', ϲ: 'c', ϳ: 'j', ϵ: 'e', օ: 'o', ո: 'n', ս: 'u', ց: 'g', հ: 'h', զ: 'q',
};

/** Digits and symbols people use as letters in names ("Z00ra", "Zoor@"). Used for names only. */
const LEET: Record<string, string> = {
	'0': 'o', '1': 'l', '2': 'z', '3': 'e', '4': 'a', '5': 's', '6': 'b', '7': 't', '8': 'b', '9': 'g',
	'@': 'a', $: 's', '!': 'l', '|': 'l', '€': 'e', '¡': 'l',
};

const map = (text: string, table: Record<string, string>): string => {
	let out = '';
	for (const ch of text) out += table[ch] ?? ch;
	return out;
};

const DECIMAL_DIGIT = /\p{Nd}/u;
const digitCache = new Map<number, string>();

/**
 * Unicode guarantees that decimal digits come in contiguous runs of ten (0 to 9), so a digit's value is
 * its distance from the first digit of its block, modulo 10. This covers every script without a table.
 */
const digitValue = (codePoint: number): string => {
	let digit = digitCache.get(codePoint);
	if (digit === undefined) {
		let start = codePoint;
		while (DECIMAL_DIGIT.test(String.fromCodePoint(start - 1))) start--;
		digit = String((codePoint - start) % 10);
		digitCache.set(codePoint, digit);
	}
	return digit;
};

/** Converts every decimal digit (Arabic-Indic, Devanagari, full-width...) to ASCII 0-9. */
export const toAsciiDigits = (text: string): string =>
	text.replace(/\p{Nd}/gu, (d) => (d >= '0' && d <= '9' ? d : digitValue(d.codePointAt(0) ?? 48)));

/**
 * The base form every view starts from: NFKC (folds styled and full-width letters), invisible characters
 * removed, ASCII digits, plain plus signs, apostrophes and dashes, and collapsed spaces. Case is kept.
 */
export const baseText = (text: string): string =>
	toAsciiDigits(text.normalize('NFKC').replace(INVISIBLE, ''))
		.replace(/[➕✚✙]/gu, '+')
		.replace(/[‘’ʼ´`]/gu, "'")
		.replace(/[‐-―−]/gu, '-')
		.replace(/\r\n?/g, '\n')
		.replace(/[^\S\n]+/g, ' ')
		.replace(/ ?\n[\s]*/g, '\n')
		.trim();

const stripMarks = (text: string): string => text.normalize('NFKD').replace(/\p{M}/gu, '');

const FOREIGN_SCRIPT = /[\p{Script=Cyrillic}\p{Script=Greek}\p{Script=Armenian}]/u;
const LATIN_SCRIPT = /\p{Script=Latin}/u;
/** Four or more single letters separated by spaces or punctuation: "w h a t s a p p", "t.e.l.e.g.r.a.m". */
const SPACED_LETTERS = /(?<![\p{L}\p{N}])\p{L}(?:[ .\-_*·•|,/\\]{1,2}\p{L}){3,}(?![\p{L}\p{N}])/gu;
const STYLED = /[\u{1D400}-\u{1D7FF}\u{1F130}-\u{1F189}Ⓐ-ⓩ]/u;
const FULLWIDTH_LATIN = /[Ａ-Ｚａ-ｚ０-９]/u;
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const FANCY_CHARS = new RegExp(`[${Object.keys(FANCY_LETTERS).join('')}]`, 'u');

export type Obfuscation = 'styled letters' | 'mixed-script words' | 'spaced-out letters' | 'unusual digits';

/** One comment (or name) in the forms the rules match against. */
export type View = {
	/** baseText(): NFKC, ASCII digits, case kept. Used for names with capitals and phone numbers. */
	plain: string;
	/** plain, lower-cased. Used for non-Latin patterns (Cyrillic, Arabic, Devanagari). */
	lower: string;
	/** lower, accents removed, look-alike letters mapped to Latin, spaced-out letters joined. */
	latin: string;
	obfuscation: Obfuscation[];
};

export const makeView = (text: string): View => {
	const plain = baseText(text);
	const lower = plain.toLowerCase();
	const obfuscation = new Set<Obfuscation>();
	if (STYLED.test(text) || FANCY_CHARS.test(lower) || (FULLWIDTH_LATIN.test(text) && !CJK.test(text))) {
		obfuscation.add('styled letters');
	}
	if (/⃣/u.test(text) || (/[^\d\P{Nd}]/u.test(text) && /\p{Script=Latin}/u.test(text))) obfuscation.add('unusual digits');
	let latin = map(stripMarks(lower), LATIN_LOOKALIKES).replace(/[\p{L}\p{N}]+/gu, (word) => {
		if (!LATIN_SCRIPT.test(word) || !FOREIGN_SCRIPT.test(word)) return word;
		obfuscation.add('mixed-script words');
		return map(word, FOREIGN_LOOKALIKES);
	});
	latin = latin.replace(SPACED_LETTERS, (run) => {
		const joined = run.replace(/[^\p{L}]/gu, '');
		if (joined.length >= 5) obfuscation.add('spaced-out letters');
		return joined;
	});
	return {plain, lower, latin, obfuscation: [...obfuscation]};
};

/** Words impersonators add to a channel name ("Zoora AI Official Support Team"). */
const DECORATIONS = [
	'official', 'support', 'team', 'help', 'helpdesk', 'desk', 'admin', 'real', 'backup', 'live', 'shorts', 'channel',
	'tv', 'care', 'service', 'services', 'customer', 'hq', 'verified', 'the', 'original', 'giveaway', 'giveaways',
	'reward', 'rewards', 'promo', 'bonus', 'winner', 'winners', 'prize', 'manager', 'contact', 'info', 'inc', 'ltd',
	'llc', 'global', 'community', 'assist', 'assistance', 'center', 'centre', 'online', 'app', 'page', 'account',
	'agent', 'mod', 'moderator', 'staff', 'news',
];

const skeletonWord = (word: string): string =>
	map(map(map(stripMarks(word.toLowerCase()), LATIN_LOOKALIKES), FOREIGN_LOOKALIKES), LEET)
		.replace(/i/g, 'l')
		.replace(/rn/g, 'm')
		.replace(/vv/g, 'w')
		.replace(/[^a-z0-9]/g, '');

const DECORATION_SKELETONS = [...new Set(DECORATIONS.map(skeletonWord))].sort((a, b) => b.length - a.length);
const DECORATION_SET = new Set(DECORATION_SKELETONS);

/**
 * A comparable "skeleton" of a channel or author name: styled and look-alike letters folded, digits read
 * as letters (0→o, 1→l), I and l merged, separators removed and decoration words such as "official",
 * "support" or "team" dropped. "@Zооrа_АI-Support" and "Z00ra Al Official" both become "zooraal".
 */
export const nameSkeleton = (name: string): string => {
	const words = baseText(name)
		.replace(/^@+/, '')
		.replace(/(?<=\p{Ll})(?=\p{Lu})|(?<=\p{Lu})(?=\p{Lu}\p{Ll})/gu, ' ')
		.split(/[^\p{L}\p{N}@$!|€¡]+/u)
		.filter((word) => /[\p{L}\p{N}]/u.test(word)) // a lone "|" or "!" is a separator, not a letter
		.map(skeletonWord)
		.filter((word) => word && !DECORATION_SET.has(word));
	let skeleton = words.join('');
	for (let changed = true; changed; ) {
		changed = false;
		for (const decoration of DECORATION_SKELETONS) {
			if (skeleton.length - decoration.length < 4) continue;
			if (skeleton.endsWith(decoration)) skeleton = skeleton.slice(0, -decoration.length);
			else if (skeleton.startsWith(decoration)) skeleton = skeleton.slice(decoration.length);
			else continue;
			changed = true;
		}
	}
	return skeleton;
};

/** Optimal-string-alignment edit distance (insert, delete, substitute, swap neighbours). Stops past `max`. */
export const editDistance = (a: string, b: string, max = Number.POSITIVE_INFINITY): number => {
	if (Math.abs(a.length - b.length) > max) return max + 1;
	let before: number[] = [];
	let previous = Array.from({length: b.length + 1}, (_, j) => j);
	for (let i = 1; i <= a.length; i++) {
		const current = [i];
		let rowMin = i;
		for (let j = 1; j <= b.length; j++) {
			const cost = a[i - 1] === b[j - 1] ? 0 : 1;
			let value = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost);
			if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) value = Math.min(value, before[j - 2] + 1);
			current.push(value);
			rowMin = Math.min(rowMin, value);
		}
		if (rowMin > max) return max + 1;
		before = previous;
		previous = current;
	}
	return previous[b.length];
};

const QUOTED = new RegExp(
	[
		String.raw`"[^"\n]{1,300}"`,
		String.raw`“[^“”\n]{1,300}”`,
		String.raw`„[^“”\n]{1,300}[“”]`,
		String.raw`«[^»\n]{1,300}»`,
		String.raw`「[^」\n]{1,300}」`,
		String.raw`『[^』\n]{1,300}』`,
		// single quotes only at word edges, so apostrophes in "don't" or "Zoo's" are not quotes
		String.raw`(?<![\p{L}\p{N}])['‘](?:[^'‘’\n]|(?<=\p{L})['’](?=\p{L})){1,300}?['’](?![\p{L}\p{N}])`,
	].join('|'),
	'gu',
);

/** Separates quoted text (reported speech, e.g. a scam being warned about) from the writer's own words. */
export const splitQuotes = (text: string): {unquoted: string; quotes: string[]} => {
	const quotes: string[] = [];
	const unquoted = text.replace(QUOTED, (quote) => {
		quotes.push(quote);
		return ' … ';
	});
	return {unquoted, quotes};
};

/** "@someone " at the start of a reply is added by YouTube, not written by the author. */
export const stripReplyPrefix = (text: string): string => {
	const stripped = text.replace(/^\s*(?:@[\p{L}\p{N}_.\-]+[\s,:]*)+/u, '');
	return stripped.trim() ? stripped : text;
};

/** Distinct words used to spot the same text posted by several accounts (copy-paste bursts). */
export const burstTokens = (text: string): Set<string> =>
	new Set(
		makeView(text.replace(/@[\p{L}\p{N}_.\-]+/gu, ' ').replace(/https?:\/\/\S+/g, ' '))
			.latin.split(/[^\p{L}]+/u)
			.filter((word) => word.length >= 2),
	);
