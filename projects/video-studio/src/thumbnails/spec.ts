/**
 * Thumbnail spec (pure: no Remotion, no DOM; the Node tests and scripts/thumbnails.ts import it too).
 *
 * Contract: Storyboard.thumbnails (src/episode/types.ts) holds the 3 Test & Compare variants: {id, text, expression,
 * badger}. Expression and badger come from storyboard.json (the master design); a non-English thumbnail takes ONLY its
 * text from storyboard.<lang>.json (matched by id, else by position), so the A/B design is identical in every language.
 *
 * Contract addition (thumbnail builder, 2026-11-24, optional, recorded in src/thumbnails/README.md):
 *   thumbnails[].badgerReaction?: 'neutral' | 'happy' | 'worried' | 'shocked' | 'judge'
 *   Badger's face when badger is true. Default: derived from Zoo's expression (badgerReactionFor).
 *
 * Text rules (channel rules + docs/research/platform-facts-2026-11-23.md "thumbnails and titles"):
 *  - 4 words or fewer (zh/ja have no spaces: at most 10 characters, a Latin or digit run counts as one);
 *  - optional explicit line breaks: a newline ("MY BOT\nDID WHAT?") fixes the break, at most 3 lines; otherwise the
 *    layout breaks the text for the biggest legible size;
 *  - no emoji, no arrows, no repeated "!!"/"?!" punctuation (clickbait), no currency, percent or "100x" figures;
 *  - nothing that implies profit: the core return/income terms of the platform research fail the render. The claim
 *    checker remains the full gate for titles, descriptions and thumbnail text in every language.
 */
import type {Expression} from '../characters/types.ts';
import type {Lang, Storyboard} from '../episode/types.ts';

export const VARIANTS = [0, 1, 2] as const;
export type ThumbVariant = (typeof VARIANTS)[number];
export const LANGS: readonly Lang[] = ['en', 'es', 'pt-br', 'hi', 'it', 'zh', 'ja'];
export const EXPRESSIONS: readonly Expression[] = ['neutral', 'happy', 'worried', 'shocked'];

export type BadgerReaction = 'neutral' | 'happy' | 'worried' | 'shocked' | 'judge';
export const BADGER_REACTIONS: readonly BadgerReaction[] = ['neutral', 'happy', 'worried', 'shocked', 'judge'];

/** One storyboard.thumbnails[] entry plus the optional thumbnail-builder addition. */
export type ThumbnailEntry = NonNullable<Storyboard['thumbnails']>[number] & {badgerReaction?: BadgerReaction};

/**
 * Composition input props. `variant` is the position 0|1|2 in storyboard.thumbnails (the contract); the entry's id
 * ("a", "b", ...) is accepted too, because scripts/publish-kit/render-plan.ts passes the id.
 */
export type ThumbInput = {channel: string; slug: string; lang: Lang; variant: ThumbVariant | string};

/** The position of a variant given as 0|1|2, "0".."2" or an entry id; -1 when it names nothing. */
export const variantIndex = (variant: unknown, list: ReadonlyArray<{id?: unknown}>): number => {
	if (typeof variant === 'number') return Number.isInteger(variant) && variant >= 0 && variant < 3 ? variant : -1;
	if (typeof variant !== 'string') return -1;
	if (/^[0-2]$/.test(variant)) return Number(variant);
	const i = list.findIndex((e) => e && e.id === variant);
	return i >= 0 && i < 3 ? i : -1;
};

/** What calculateMetadata resolves for the component (and what the render script reads back). */
export type ResolvedThumb = {
	channel: string;
	slug: string;
	lang: Lang;
	variant: ThumbVariant;
	id: string;
	text: string; // as written in the storyboard (the component upper-cases Latin scripts)
	expression: Expression;
	badger: boolean;
	badgerReaction: BadgerReaction;
	/** True when lang is not the source language and the translation is not marked native-reviewed. */
	machine: boolean;
	title: string;
	warnings: string[];
};

export type Issue = {level: 'error' | 'warning'; where: string; msg: string};

/** Badger's default face for Zoo's expression: the calm, quietly judging co-host (PROJECT_INSTRUCTIONS). */
export const badgerReactionFor = (e: Expression): BadgerReaction => (e === 'worried' ? 'worried' : 'judge');

export const UNSPACED_LANGS: ReadonlySet<Lang> = new Set<Lang>(['zh', 'ja']);
/** Scripts with case: the thumbnail headline is set in capitals (Anton). */
export const CASED_LANGS: ReadonlySet<Lang> = new Set<Lang>(['en', 'es', 'pt-br', 'it']);

export const MAX_WORDS = 4;
export const MAX_UNSPACED_UNITS = 10;

/**
 * Words of a thumbnail text. Spaced scripts: whitespace tokens that contain a letter or digit. zh/ja: each Han/kana
 * character is one unit and a run of Latin letters or digits is one unit; punctuation does not count.
 */
export const textUnits = (text: string, lang: Lang): string[] => {
	const t = text.normalize('NFC').trim();
	if (!UNSPACED_LANGS.has(lang)) return t.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w));
	return t.match(/[A-Za-z0-9]+|[\p{L}\p{N}]/gu) ?? [];
};

/**
 * The headline as drawn: spaces normalised, a newline kept as the writer's explicit line break, and Latin scripts in
 * capitals (Devanagari and CJK have no case).
 */
export const displayText = (text: string, lang: Lang): string => {
	const t = text
		.normalize('NFC')
		.split('\n')
		.map((l) => l.replace(/\s+/g, ' ').trim())
		.filter(Boolean)
		.join('\n');
	return CASED_LANGS.has(lang) ? t.toLocaleUpperCase(lang === 'pt-br' ? 'pt-BR' : lang) : t;
};

const EMOJI = /\p{Extended_Pictographic}|\p{Regional_Indicator}|\u{FE0F}|\u{20E3}/u;
/** Arrows: the Unicode arrow blocks, dingbat and supplemental arrows, and ASCII arrows such as -> or =>. */
const ARROWS = /[\u{2190}-\u{21FF}\u{2794}-\u{27BF}\u{27F0}-\u{27FF}\u{2900}-\u{297F}\u{2B00}-\u{2BFF}\u{1F800}-\u{1F8FF}]|->|=>|<-|<=(?!\d)|>>|<</u;
const REPEATED_PUNCT = /[!！]{2,}|[?？]{2,}|[?？][!！]|[!！][?？]/u;
const MONEY_SIGNS = /[$€£¥₹₿¢₩₽]/u;
const FIGURES = /\d(?:[.,]\d+)?\s*[xX×](?!\p{L})|(?<!\p{L})[xX×]\s*\d|\d\s*[%％]|[%％]\s*\d|[+＋]\s*\d/u;

/**
 * Profit, return and income terms (lower case, matched as whole words or phrases). English list from the platform
 * research block list; es/pt/it/hi/zh equivalents of its core terms. Not exhaustive: the claim checker is the gate.
 */
const PROFIT_TERMS: readonly string[] = [
	// en
	'profit', 'profits', 'profitable', 'gain', 'gains', 'returns', 'roi', 'yield', 'apy', 'apr', 'passive income', 'income',
	'invest', 'investing', 'investment', 'get rich', 'rich quick', 'millionaire', 'free money', 'easy money', 'make money',
	'money printer', 'moon', 'mooning', 'to the moon', 'lambo', '100x', '1000x', 'next gem', "don't miss", 'dont miss',
	'price target', 'guaranteed', 'guarantee', 'risk-free', 'risk free', 'buy now', 'cash out',
	// es
	'ganancia', 'ganancias', 'rentable', 'rentabilidad', 'rendimiento', 'invertir', 'inversión', 'dinero fácil',
	'hazte rico', 'garantizado', 'garantizada', 'sin riesgo', 'a la luna', 'ingresos pasivos',
	// pt-br
	'lucro', 'lucros', 'ganhos', 'rendimento', 'investir', 'investimento', 'dinheiro fácil', 'fique rico', 'garantido',
	'garantida', 'sem risco', 'para a lua', 'renda passiva',
	// it
	'guadagno', 'guadagni', 'profitto', 'profitti', 'rendimento', 'investire', 'investimento', 'soldi facili',
	'diventa ricco', 'garantito', 'garantita', 'senza rischio', 'sulla luna', 'reddito passivo',
	// hi
	'मुनाफ़ा', 'मुनाफा', 'कमाई', 'निवेश', 'गारंटी', 'अमीर बनें', 'पैसा कमाएँ', 'पैसा कमाएं',
	// zh
	'利润', '赚钱', '收益', '暴富', '稳赚', '投资', '回报', '翻倍', '保证', '躺赚',
];
/** Ambiguous in a security channel ("is it safe?"): warned, not failed. */
const WARN_TERMS: readonly string[] = ['safe', 'early', 'free', 'seguro', 'grátis', 'gratis', 'sicuro', 'gratuito', 'सुरक्षित', '安全', '免费'];

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const termRe = (term: string): RegExp =>
	/^[\p{Script=Han}]/u.test(term) ? new RegExp(escapeRe(term), 'u') : new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(term)}(?![\\p{L}\\p{N}])`, 'iu');
const PROFIT_RES = PROFIT_TERMS.map((t) => [t, termRe(t)] as const);
const WARN_RES = WARN_TERMS.map((t) => [t, termRe(t)] as const);

/** Check one thumbnail text. Errors fail the render; warnings are printed. */
export const checkText = (text: unknown, lang: Lang, where: string): Issue[] => {
	const out: Issue[] = [];
	const err = (msg: string) => out.push({level: 'error', where, msg});
	if (typeof text !== 'string' || !text.trim()) {
		err('text is missing or empty');
		return out;
	}
	const t = text.normalize('NFC');
	const units = textUnits(t, lang);
	if (units.length === 0) err(`text "${t}" has no words`);
	if (UNSPACED_LANGS.has(lang)) {
		if (units.length > MAX_UNSPACED_UNITS) err(`text "${t}" has ${units.length} characters; ${lang} thumbnails take ${MAX_UNSPACED_UNITS} or fewer`);
	} else if (units.length > MAX_WORDS) err(`text "${t}" has ${units.length} words; thumbnails take ${MAX_WORDS} or fewer`);
	if (/[\r\t]/.test(t)) err('text contains a tab or carriage return');
	const lines = t.split('\n');
	if (lines.length > 3) err(`text has ${lines.length} lines; a newline is an explicit break and 3 lines is the most`);
	else if (lines.length > 1 && lines.some((l) => !l.trim())) err('text has an empty line');
	if (EMOJI.test(t)) err(`text "${t}" contains an emoji (channel rule: no emojis)`);
	if (ARROWS.test(t)) err(`text "${t}" contains an arrow (channel rule: no clickbait arrows)`);
	if (REPEATED_PUNCT.test(t)) err(`text "${t}" repeats punctuation such as "!!" or "?!" (clickbait)`);
	if (MONEY_SIGNS.test(t)) err(`text "${t}" contains a currency sign (nothing that implies profit)`);
	if (FIGURES.test(t)) err(`text "${t}" contains a multiplier, percentage or signed figure (nothing that implies profit)`);
	const plain = t.replace(/[’‘]/g, "'");
	for (const [term, re] of PROFIT_RES) if (re.test(plain)) err(`text "${t}" contains "${term}" (nothing that implies profit; see the claim checker rules)`);
	for (const [term, re] of WARN_RES) if (re.test(plain)) out.push({level: 'warning', where, msg: `text "${t}" contains "${term}": make sure it cannot read as a safety or return promise`});
	return out;
};

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Validate the master (storyboard.json) thumbnail set. */
export const checkMasterThumbnails = (sb: Pick<Storyboard, 'thumbnails'> & {lang?: Lang}, where: string): Issue[] => {
	const out: Issue[] = [];
	const list = (sb as {thumbnails?: unknown}).thumbnails;
	if (!Array.isArray(list) || list.length === 0) {
		out.push({level: 'error', where, msg: 'storyboard.json has no thumbnails[]; add the 3 Test & Compare variants ({id, text, expression, badger})'});
		return out;
	}
	if (list.length !== 3) out.push({level: list.length > 3 ? 'error' : 'warning', where, msg: `thumbnails[] has ${list.length} entries; YouTube Test & Compare takes exactly 3`});
	const ids = new Set<string>();
	list.forEach((raw, i) => {
		const w = `${where} thumbnails[${i}]`;
		if (!isObj(raw)) {
			out.push({level: 'error', where: w, msg: 'not an object'});
			return;
		}
		if (typeof raw.id !== 'string' || !raw.id.trim()) out.push({level: 'error', where: w, msg: 'id is missing'});
		else if (ids.has(raw.id)) out.push({level: 'error', where: w, msg: `duplicate id "${raw.id}"`});
		else ids.add(raw.id);
		if (!EXPRESSIONS.includes(raw.expression as Expression)) out.push({level: 'error', where: w, msg: `expression must be one of ${EXPRESSIONS.join(', ')}`});
		if (typeof raw.badger !== 'boolean') out.push({level: 'error', where: w, msg: 'badger must be true or false'});
		if (raw.badgerReaction !== undefined && !BADGER_REACTIONS.includes(raw.badgerReaction as BadgerReaction))
			out.push({level: 'error', where: w, msg: `badgerReaction must be one of ${BADGER_REACTIONS.join(', ')}`});
		out.push(...checkText(raw.text, sb.lang ?? 'en', w));
	});
	const texts = list.filter(isObj).map((r) => (typeof r.text === 'string' ? r.text.trim().toLowerCase() : ''));
	if (new Set(texts).size < texts.length) out.push({level: 'warning', where, msg: 'two variants share the same text: Test & Compare learns more when the variants differ'});
	return out;
};

/** The localized entry for a master entry: same id first, then the same position. */
export const localizedEntry = (master: ThumbnailEntry, index: number, localized: unknown): ThumbnailEntry | null => {
	if (!Array.isArray(localized)) return null;
	const byId = localized.find((e) => isObj(e) && e.id === master.id);
	if (byId) return byId as ThumbnailEntry;
	const byPos = localized[index];
	return isObj(byPos) && byPos.id === undefined ? (byPos as ThumbnailEntry) : null;
};

/**
 * Resolve one variant from the master storyboard and (for lang != en) the localized storyboard. Pure: the caller loads
 * the JSON. Throws one error that names every problem.
 */
export const resolveThumb = (input: ThumbInput, master: Storyboard, localized: Storyboard | null): ResolvedThumb => {
	const where = `${input.channel}/${input.slug}`;
	const issues: Issue[] = [];
	if (!LANGS.includes(input.lang)) issues.push({level: 'error', where, msg: `lang must be one of ${LANGS.join(', ')}`});
	issues.push(...checkMasterThumbnails(master, `${where} storyboard.json`));
	const list = (master.thumbnails ?? []) as ThumbnailEntry[];
	const index = variantIndex(input.variant, list);
	if (index < 0) issues.push({level: 'error', where, msg: `variant ${JSON.stringify(input.variant)} must be 0, 1, 2 or the id of one of the first three thumbnails`});
	const entry = index >= 0 ? list[index] : undefined;
	if (index >= 0 && !entry && !issues.some((i) => i.level === 'error')) issues.push({level: 'error', where, msg: `storyboard.json has no thumbnails[${index}]`});
	let text = entry?.text ?? '';
	let machine = false;
	if (input.lang !== 'en' && entry) {
		const file = `storyboard.${input.lang}.json`;
		if (!localized) issues.push({level: 'error', where, msg: `no ${file}: translate the storyboard (thumbnails[].text included) first`});
		else {
			if (localized.lang !== input.lang) issues.push({level: 'error', where: `${where} ${file}`, msg: `its lang is "${localized.lang}", expected "${input.lang}"`});
			const loc = localizedEntry(entry, index, localized.thumbnails);
			if (!loc || typeof loc.text !== 'string')
				issues.push({level: 'error', where: `${where} ${file}`, msg: `thumbnails[] has no entry with id "${entry.id}": add its translated text (the English text is never used in a ${input.lang} thumbnail)`});
			else {
				text = loc.text;
				issues.push(...checkText(loc.text, input.lang, `${where} ${file} thumbnails[${entry.id}]`));
				if (loc.expression !== undefined && loc.expression !== entry.expression)
					issues.push({level: 'warning', where: `${where} ${file}`, msg: `thumbnails[${entry.id}].expression differs from storyboard.json; the master design is used`});
				if (loc.badger !== undefined && loc.badger !== entry.badger)
					issues.push({level: 'warning', where: `${where} ${file}`, msg: `thumbnails[${entry.id}].badger differs from storyboard.json; the master design is used`});
			}
			// the contract (Storyboard.translation): a translated file counts as machine until it says native-reviewed
			machine = localized.lang !== localized.sourceLang && localized.translation?.status !== 'native-reviewed';
		}
	}
	const errors = issues.filter((i) => i.level === 'error');
	if (errors.length) throw new Error(`Thumbnail ${where} (${input.lang}, variant ${JSON.stringify(input.variant)}):\n${errors.map((e) => `  - ${e.where}: ${e.msg}`).join('\n')}`);
	const e = entry as ThumbnailEntry;
	return {
		channel: input.channel,
		slug: input.slug,
		lang: input.lang,
		variant: index as ThumbVariant,
		id: e.id,
		text,
		expression: e.expression,
		badger: e.badger,
		badgerReaction: e.badgerReaction ?? badgerReactionFor(e.expression),
		machine,
		title: (localized ?? master).title,
		warnings: issues.filter((i) => i.level === 'warning').map((i) => `${i.where}: ${i.msg}`),
	};
};
