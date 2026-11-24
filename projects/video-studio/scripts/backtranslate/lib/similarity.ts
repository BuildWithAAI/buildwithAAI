/**
 * Token-overlap similarity between the English source and the back-translation (pure).
 *
 * Content words only: function words, numbers, negations, modals and hedge words are left out because they have
 * their own checks (a lost "never" is a finding, not a slightly lower score). Words are stemmed ("bought" -> "buy",
 * "checks" -> "check") and synonym families merged ("review" = "check"); near synonyms earn partial credit.
 * The score is the Dice coefficient of the two multisets: 1 = same content words, 0 = nothing in common.
 */
import {stem} from './stem.ts';
import {applyPhrases, canonical, isNear, NEAR_CREDIT} from './synonyms.ts';
import {expandEnglish, STOPWORDS, stripNotes, stripTags, tokens} from './text.ts';

const NUMBER_WORDS = new Set(
	'zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty thirty forty fifty sixty seventy eighty ninety hundred hundreds thousand thousands million millions billion billions trillion dozen dozens half single point percent first second third fourth fifth sixth seventh eighth ninth tenth'.split(' '),
);
const KEY_WORDS = new Set(
	`not no never none nobody nothing nowhere neither nor without must should may might could can will shall would ought maybe perhaps possibly probably likely
	allegedly alleged reportedly according says said say claims claimed claim apparently seemingly supposedly purportedly
	within less fewer more than roughly approximately nearly almost around least`
		.split(/\s+/)
		.filter(Boolean),
);

/** A content word; `alts` holds the other readings of a back-translator's "trade/operation" (it counts once). */
export type ContentToken = {canon: string; surface: string; alts?: string[]};

const keep = (w: string): boolean => !!w && w.length > 1 && !STOPWORDS.has(w) && !NUMBER_WORDS.has(w) && !KEY_WORDS.has(w) && !/^\d/.test(w);

export const contentTokens = (english: string): ContentToken[] => {
	const groups: string[][] = [];
	const t = applyPhrases(expandEnglish(stripNotes(stripTags(english))).toLowerCase()).replace(/\p{L}+(?:\/\p{L}+)+/gu, (m) => {
		groups.push(m.split('/'));
		return ` altgroup${groups.length - 1}x `;
	});
	const out: ContentToken[] = [];
	for (const {word} of tokens(t)) {
		const g = /^altgroup(\d+)x$/.exec(word);
		if (g) {
			const alts = groups[Number(g[1])].filter(keep).map((w) => canonical(stem(w)));
			if (alts.length) out.push({canon: alts[0], surface: groups[Number(g[1])].join('/'), alts});
			continue;
		}
		for (const w of word.split('-')) if (keep(w)) out.push({canon: canonical(stem(w)), surface: w});
	}
	return out;
};

const readingsOf = (x: ContentToken): string[] => x.alts ?? [x.canon];

export type Overlap = {score: number; lost: string[]; added: string[]; sourceCount: number; backCount: number};

export const overlap = (a: ContentToken[], b: ContentToken[]): Overlap => {
	if (!a.length && !b.length) return {score: 1, lost: [], added: [], sourceCount: 0, backCount: 0};
	const usedB = new Array<boolean>(b.length).fill(false);
	const matchedA = new Array<boolean>(a.length).fill(false);
	let credit = 0;
	a.forEach((x, i) => {
		const j = b.findIndex((y, k) => !usedB[k] && readingsOf(x).some((c) => readingsOf(y).includes(c)));
		if (j >= 0) {
			usedB[j] = true;
			matchedA[i] = true;
			credit += 1;
		}
	});
	a.forEach((x, i) => {
		if (matchedA[i]) return;
		const j = b.findIndex((y, k) => !usedB[k] && readingsOf(x).some((c) => readingsOf(y).some((d) => isNear(c, d))));
		if (j >= 0) {
			usedB[j] = true;
			matchedA[i] = true;
			credit += NEAR_CREDIT;
		}
	});
	const score = (2 * credit) / (a.length + b.length);
	return {
		score: Math.round(score * 1000) / 1000,
		lost: a.filter((_, i) => !matchedA[i]).map((x) => x.surface),
		added: b.filter((_, k) => !usedB[k]).map((x) => x.surface),
		sourceCount: a.length,
		backCount: b.length,
	};
};

export const textOverlap = (source: string, back: string): Overlap => overlap(contentTokens(source), contentTokens(back));
