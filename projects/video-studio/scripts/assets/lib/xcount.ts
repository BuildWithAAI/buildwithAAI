/**
 * X (Twitter) post length, counted the way X does: twitter-text config v3
 * (raw.githubusercontent.com/twitter/twitter-text/master/config/v3.json, read 2026-11-24): limit 280, weight 1 for
 * U+0000-U+10FF, U+2000-U+200D, U+2010-U+201F, U+2032-U+2037, weight 2 for everything else, each emoji counts 2,
 * and every URL counts 23 (t.co) whatever its length (docs.x.com "Counting characters", seen as a search extract).
 * Bare domains such as zoora.ai are auto-linked by X, so they count 23 too; this errs on the long side.
 */

export const X_LIMIT = 280;
export const X_URL_LENGTH = 23;

const RANGES: [number, number][] = [
	[0x0000, 0x10ff],
	[0x2000, 0x200d],
	[0x2010, 0x201f],
	[0x2032, 0x2037],
];

const TLDS =
	'com|net|org|ai|io|co|app|dev|gov|edu|fun|xyz|tv|me|ly|gg|so|us|uk|de|es|br|pt|it|fr|in|jp|cn|info|biz|news|tech|finance|money|crypto|link|site|online|store|blog|page|cloud|eu|ca|au|nl|ch|se|no|fi|dk|pl|ru|mx|ar|cl|io';

const URL_RE = new RegExp(
	`https?:\\/\\/[^\\s<>"]+|(?<![\\p{L}\\p{N}@._-])(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\\.)+(?:${TLDS})(?![\\p{L}\\p{N}-])(?:\\/[^\\s<>"]*)?`,
	'giu',
);

const EMOJI_RE = /\p{RI}\p{RI}|[#*0-9]️?⃣|\p{Extended_Pictographic}(?:️|\p{EMod}|‍\p{Extended_Pictographic}️?)*/gu;

const TRAILING = /[.,;:!?)\]}'"»”’]+$/u;

/** URLs as X would link them (trailing punctuation is not part of the link). */
export const findUrls = (text: string): {url: string; index: number}[] =>
	[...text.normalize('NFC').matchAll(URL_RE)].map((m) => ({url: m[0].replace(TRAILING, ''), index: m.index ?? 0}));

const weight = (cp: number): number => (RANGES.some(([a, b]) => cp >= a && cp <= b) ? 1 : 2);

export const xLength = (text: string): number => {
	let t = text.normalize('NFC');
	let total = 0;
	for (const {url} of findUrls(t)) {
		total += X_URL_LENGTH;
		t = t.replace(url, ' ');
		total -= 1; // the placeholder space
	}
	t = t.replace(EMOJI_RE, () => {
		total += 2;
		return '';
	});
	for (const ch of t) total += weight(ch.codePointAt(0) as number);
	return total;
};
