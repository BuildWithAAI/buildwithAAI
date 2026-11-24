/**
 * Meaning-bearing small words (pure): negation, modality, hedges and attribution, and imperatives.
 *
 * English lexicons run on the source and the back-translation (both English), after expandEnglish() turned "don't"
 * into "do not". Spanish and Portuguese cue lists run on the translation itself as a second, independent signal
 * (they do not need the back-translation to be right). They are machine-made (2026-11-24) and need a native
 * speaker's review like every translation asset.
 */
import {clean, expandEnglish, stripNotes, stripTags, wordRe} from './text.ts';
import type {TargetLang} from './types.ts';

const count = (re: RegExp, text: string): number => {
	const g = re.flags.includes('g') ? re : new RegExp(re.source, `${re.flags}g`);
	g.lastIndex = 0;
	return [...text.matchAll(g)].length;
};

const firstMatches = (re: RegExp, text: string): string[] => {
	const g = re.flags.includes('g') ? re : new RegExp(re.source, `${re.flags}g`);
	g.lastIndex = 0;
	return [...text.matchAll(g)].map((m) => m[0].toLowerCase());
};

/**
 * English text prepared for the lexicons: tags and back-translator notes removed, contractions expanded, lowercased,
 * and "first/second" alternatives reduced to the first reading (so "may/will" is not counted twice).
 */
export const prepEnglish = (s: string, reading: 'first' | 'last' = 'first'): string =>
	expandEnglish(stripNotes(stripTags(s)))
		.replace(/\p{L}+(?:\/\p{L}+)+/gu, (m) => {
			const alts = m.split('/');
			return reading === 'first' ? alts[0] : alts[alts.length - 1];
		})
		.toLowerCase()
		.replace(/\s+/g, ' ');

/** "IN DEVELOPMENT/DEVELOPING": a back-translator's alternatives. A cue counts when any reading has it. */
const readings = (s: string): Array<'first' | 'last'> => (/\p{L}\/\p{L}/u.test(s) ? ['first', 'last'] : ['first']);
const maxOver = <T extends Record<string, unknown>>(s: string, f: (reading: 'first' | 'last') => T, keys: Array<keyof T>): T => {
	const rs = readings(s).map(f);
	if (rs.length === 1) return rs[0];
	const out = {...rs[0]};
	for (const k of keys) (out as Record<string, unknown>)[k as string] = Math.max(...rs.map((r) => r[k] as number));
	for (const k of ['words', 'explicitWords', 'implicitWords'])
		if (k in out) (out as Record<string, unknown>)[k] = [...new Set(rs.flatMap((r) => ((r as Record<string, unknown>)[k] as string[] | undefined) ?? []))];
	return out;
};

// ---------------------------------------------------------------------------------------------------------------------
// Negation (English)
// ---------------------------------------------------------------------------------------------------------------------

/** "not only", "no doubt", "no matter", "nothing but" are not negations of the claim. */
const NOT_NEGATION = [/\bnot only\b/g, /\bno doubt\b/g, /\bno matter\b/g, /\bnothing but\b/g];

const EXPLICIT_NEG = wordRe(`not|no|never|none|nobody|no one|nothing|nowhere|neither|nor|without`);
const NEVER = wordRe(`never|not ever|not once|at no time|no longer|not anymore|not any more`);
/** Words that carry negative polarity without "not": "hates" ~ "does not like", "avoid" ~ "do not". */
const IMPLICIT_NEG = wordRe(
	`hate[sd]?|hating|refuse[sd]?|refusing|fail(?:s|ed|ing)?|lack(?:s|ed|ing)?|avoid(?:s|ed|ing)?|stop(?:s|ped|ping)?|prevent(?:s|ed|ing)?|den(?:y|ies|ied|ying)|unable|impossible|forbid(?:s|den)?|ban(?:s|ned)?|prohibit(?:s|ed)?|reject(?:s|ed|ing)?|decline[sd]?|instead of|rather than|far from|free of|hardly|barely|scarcely|rarely|seldom|unless`,
);

export type Polarity = {explicit: number; never: number; implicit: number; words: string[]; explicitWords: string[]; implicitWords: string[]};

export const polarity = (english: string): Polarity => maxOver(english, (r) => polarityOf(english, r), ['explicit', 'never', 'implicit']);

const polarityOf = (english: string, reading: 'first' | 'last'): Polarity => {
	let t = prepEnglish(english, reading);
	for (const re of NOT_NEGATION) t = t.replace(re, ' ');
	const never = count(NEVER, t);
	// "not ever" / "no longer" count once, as NEVER, not twice
	const tNoNever = t.replace(new RegExp(NEVER.source, 'giu'), ' NEVERWORD ');
	const explicit = count(EXPLICIT_NEG, tNoNever) + never;
	const implicit = count(IMPLICIT_NEG, t);
	const explicitWords = [...firstMatches(NEVER, t), ...firstMatches(EXPLICIT_NEG, tNoNever)];
	const implicitWords = firstMatches(IMPLICIT_NEG, t);
	return {explicit, never, implicit, words: [...explicitWords, ...implicitWords], explicitWords, implicitWords};
};

// ---------------------------------------------------------------------------------------------------------------------
// Modality (English)
// ---------------------------------------------------------------------------------------------------------------------

export type ModalClass = 'oblig' | 'advice' | 'possib' | 'ability' | 'future' | 'sure' | 'always';

const MODAL: Record<ModalClass, RegExp> = {
	oblig: wordRe(`must|have to|has to|had to|need to|needs to|needed to|required to|is required|are required|mandatory|make sure|be sure to|it is essential|got to`),
	advice: wordRe(`should|ought to|had better|would better|better to|recommend(?:s|ed)?|advisable|it is best|best to|suggest(?:s|ed)?`),
	possib: wordRe(`may|might|could|possibly|perhaps|maybe|potentially|possible|likely|probably|probable|chance`),
	ability: wordRe(`can|able to`),
	future: wordRe(`will|shall|going to|is about to`),
	sure: wordRe(`definitely|certainly|surely|guaranteed|guarantee[sd]?|for sure|undoubtedly|inevitably|without (?:a )?doubt|no doubt`),
	always: wordRe(`always|every time|at all times|without exception`),
};

export const MODAL_NAMES: Record<ModalClass, string> = {
	oblig: 'obligation (must / have to)',
	advice: 'advice (should)',
	possib: 'possibility (may / might / could)',
	ability: 'ability (can)',
	future: 'future / certainty (will)',
	sure: 'certainty (definitely / guaranteed)',
	always: 'absolute (always)',
};

export type Modality = Record<ModalClass, number> & {words: string[]};

export const modality = (english: string): Modality => maxOver(english, (r) => modalityOf(english, r), ['oblig', 'advice', 'possib', 'ability', 'future', 'sure', 'always']);

const modalityOf = (english: string, reading: 'first' | 'last'): Modality => {
	// "can not" stays ability+negation; "will not" is future+negation; "May 5" is a date, not a modal.
	const t = prepEnglish(english.replace(/\bMay(?= \d)/g, ' '), reading);
	const out = {words: [] as string[]} as Modality;
	for (const k of Object.keys(MODAL) as ModalClass[]) {
		out[k] = count(MODAL[k], t);
		out.words.push(...firstMatches(MODAL[k], t));
	}
	return out;
};

// ---------------------------------------------------------------------------------------------------------------------
// Hedges and attribution (English)
// ---------------------------------------------------------------------------------------------------------------------

export type HedgeClass = 'alleged' | 'attrib' | 'uncert';

const HEDGE: Record<HedgeClass, RegExp> = {
	alleged: wordRe(`allegedly|alleged|alleges|alleging|allegations?|accused|accuses|accusing|accusations?|suspected|purportedly|purported|supposedly|so-called|is said to|are said to|was said to|were said to`),
	// "per FixtureSwap" is counted separately (it needs the capital letter)
	attrib: wordRe(
		`according to|as reported by|reportedly|reported by|reports? that|reported that|is reported|was reported|were reported|says?|said|claims?|claimed|claiming|states|stated|told(?! (?:from|by|in|through|as|with|over)(?![\\p{L}]))|tells(?! (?:from|the story|a story|stories)(?![\\p{L}]))|in a statement|announced|acknowledged|admitted|denied|denies|warns?|warned|alerted|estimates?|estimated|lists|put it|puts it|wrote(?! to(?![\\p{L}]))|writes(?! to(?![\\p{L}]))|notes that|noted|confirmed|confirms|insists|insisted`,
	),
	// "developing" as a news label, not "developing an app"; "may change" is left to the modality check
	uncert: wordRe(
		`apparently|seemingly|appears? to|appeared to|seems? to|seemed to|believed to|thought to|unconfirmed|unverified|preliminary|developing(?! (?:a|an|the|new|our|your|their|his|her|its|apps?|software|code|tools?|products?|games?|bots?|agents?)(?![\\p{L}]))|in development|under investigation|investigation is ongoing|ongoing|not yet confirmed|not confirmed|yet to be confirmed|early reports|unclear|it is unclear|subject to change`,
	),
};

export const HEDGE_NAMES: Record<HedgeClass, string> = {
	alleged: 'allegation (allegedly / suspected)',
	attrib: 'attribution (according to / says / reports)',
	uncert: 'uncertainty (apparently / preliminary / developing)',
};

export type Hedges = Record<HedgeClass, number> & {words: string[]; byClass: Record<HedgeClass, string[]>};

export const hedges = (english: string): Hedges => {
	const rs = readings(english).map((r) => hedgesOf(english, r));
	if (rs.length === 1) return rs[0];
	const out = maxOver(english, (r) => hedgesOf(english, r), ['alleged', 'attrib', 'uncert']);
	out.byClass = {alleged: [], attrib: [], uncert: []};
	for (const c of ['alleged', 'attrib', 'uncert'] as HedgeClass[]) out.byClass[c] = [...new Set(rs.flatMap((r) => r.byClass[c]))];
	return out;
};

const hedgesOf = (english: string, reading: 'first' | 'last'): Hedges => {
	// attribution "per X" needs the original case; "the United States" is not "states"
	const raw = expandEnglish(stripNotes(stripTags(english)))
		.replace(/\p{L}+(?:\/\p{L}+)+/gu, (m) => {
			const alts = m.split('/');
			return reading === 'first' ? alts[0] : alts[alts.length - 1];
		})
		.replace(/\s+/g, ' ')
		.replace(/\bUnited States\b/gi, 'United_Statesname');
	const t = raw.toLowerCase();
	const per = /\bper (?=[A-Z])/g;
	const byClass: Record<HedgeClass, string[]> = {
		alleged: firstMatches(HEDGE.alleged, t),
		attrib: [...firstMatches(HEDGE.attrib, t), ...firstMatches(per, raw)],
		uncert: firstMatches(HEDGE.uncert, t),
	};
	return {
		alleged: byClass.alleged.length,
		attrib: byClass.attrib.length,
		uncert: byClass.uncert.length,
		words: [...byClass.alleged, ...byClass.attrib, ...byClass.uncert],
		byClass,
	};
};

// ---------------------------------------------------------------------------------------------------------------------
// Imperatives (English): "Check who bought", "Never buy", "Don't share it"
// ---------------------------------------------------------------------------------------------------------------------

const IMPERATIVE_VERBS = new Set(
	`check verify review buy sell use keep put store move send report block stop avoid read look see watch subscribe share follow remember ask type enter
	sign click turn write save revoke update enable disable install uninstall think wait make take get go try learn confirm call contact delete ignore
	trust test compare set add remove find give let tell open close copy paste scan protect secure back lock hold pause slow research search beware
	consider note start begin leave join like comment hit tap press download visit limit run guard treat assume expect question doubt demand insist
	refuse reject decline cancel withdraw transfer split double-check be do pay sit stay act`
		.split(/\s+/)
		.filter(Boolean),
);
const LEAD = new Set('and so then first second third finally also now next just please but or plus'.split(' '));

/** true when a clause of the sentence starts with a bare verb: "Check who bought", "So before you follow, do three things". */
export const isImperative = (sentenceEnglish: string): boolean => {
	const clauses = prepEnglish(sentenceEnglish)
		.split(/[,:;]/)
		.map((c) => c.replace(/^[^a-z]+/, '').split(/\s+/).filter(Boolean));
	return clauses.some((ws) => {
		let i = 0;
		while (i < ws.length && LEAD.has(ws[i])) i++;
		const w0 = ws[i];
		const w1 = ws[i + 1] ?? '';
		if (w0 === undefined) return false;
		if (w0 === 'do') return w1 === 'not' || (w1 !== '' && !/^(?:you|we|they|i|he|she|it|not)$/.test(w1));
		if (w0 === 'never' || w0 === 'always') return IMPERATIVE_VERBS.has(w1);
		if (w0 === 'be') return /^(?:careful|sure|aware|wary|skeptical|suspicious)$/.test(w1);
		return IMPERATIVE_VERBS.has(w0);
	});
};

// ---------------------------------------------------------------------------------------------------------------------
// Spanish and Portuguese cues (run on the translation directly)
// ---------------------------------------------------------------------------------------------------------------------

type Cues = {neg: RegExp; never: RegExp; hedge: RegExp};

const CUES: Record<TargetLang, Cues> = {
	es: {
		// negative concord ("no ... nada") counts once per sentence (see sentenceCues)
		neg: wordRe(`no|nunca|jamás|jamas|nadie|nada|ningún|ninguno|ninguna|ningunos|ningunas|ni|sin|tampoco`),
		never: wordRe(`nunca|jamás|jamas|ya no`),
		hedge: wordRe(
			`según|segun|de acuerdo con|supuestamente|presuntamente|presunt[oa]s?|aparentemente|al parecer|dicen?|dijo|dijeron|afirm(?:a|an|ó|aron)|asegur(?:a|an|ó|aron)|inform(?:a|an|ó|aron)|report(?:a|an|ó|aron)|señal(?:a|an|ó|aron)|advierten?|advirti(?:ó|eron)|alert(?:a|an|ó|aron) que|estim(?:a|an|ó|aron)|declar(?:a|an|ó|aron)|indic(?:a|an|ó|aron)|sostienen?|sostuvo|sostuvieron|enumera|en palabras de|en desarrollo|preliminar(?:es)?|sin confirmar|no confirmad[oa]s?|bajo investigación|en curso|sujet[oa]s? a cambios`,
		),
	},
	'pt-br': {
		neg: wordRe(`não|nao|nunca|jamais|ninguém|ninguem|nada|nenhum|nenhuma|nenhuns|nenhumas|nem|sem|tampouco`),
		never: wordRe(`nunca|jamais|não mais|nao mais`),
		hedge: wordRe(
			`segundo (?:o|a|os|as|um|uma)|de acordo com|conforme (?:o|a|os|as)|supostamente|alegadamente|supost[oa]s?|aparentemente|ao que parece|diz|dizem|disse|disseram|afirm(?:a|am|ou|aram)|inform(?:a|am|ou|aram)|relat(?:a|am|ou|aram)|apont(?:a|am|ou|aram)|alert(?:ou|aram|am)|alerta que|estim(?:a|am|ou|aram)|declar(?:a|am|ou|aram)|avis(?:ou|aram)|nas palavras de|em desenvolvimento|preliminar(?:es)?|não confirmad[oa]s?|sem confirmação|sob investigação|em andamento|sujeit[oa]s? a mudanças`,
		),
	},
};

export type SentenceCues = {negated: boolean; never: boolean; hedges: number};

/** Per-sentence cues in a Spanish or Portuguese sentence. */
export const sentenceCues = (sentence: string, lang: TargetLang): SentenceCues => {
	const t = clean(stripTags(sentence)).toLowerCase();
	const c = CUES[lang];
	return {negated: count(c.neg, t) > 0, never: count(c.never, t) > 0, hedges: count(c.hedge, t)};
};

/** Same summary for an English sentence, so the two can be compared sentence by sentence. */
export const englishSentenceCues = (sentence: string): SentenceCues => {
	const p = polarity(sentence);
	const h = hedges(sentence);
	return {negated: p.explicit > 0, never: p.never > 0, hedges: h.alleged + h.attrib + h.uncert};
};
