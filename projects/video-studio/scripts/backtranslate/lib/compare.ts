/**
 * The comparison (pure): every segment's English source against its back-translation, and against the Spanish or
 * Portuguese text itself where that can be read reliably. Deterministic: same inputs, same report.
 *
 * Checks, per segment: numbers and units (with qualifiers such as "more than"), negation (and "never" softened to
 * "not"), modality (may / must / will / should, instructions softened to options), hedges and attribution
 * ("allegedly", "according to", "says"), named entities, glossary terms, [src:id] claim tags, {display|spoken} pairs,
 * sentence counts and alignment (omitted or added sentences), and a similarity score.
 *
 * Where the back-translation and the direct reading disagree, the finding says so: a number that is right in the
 * Spanish but wrong in the back-translation is most likely a back-translation slip, and is reported one level lower.
 */
import {alignSentences, type AlignPair} from './align.ts';
import {extractEntities} from './entities.ts';
import {glossaryFindings, type Glossary} from './glossary.ts';
import {englishSentenceCues, HEDGE_NAMES, hedges, isImperative, modality, polarity, sentenceCues, type HedgeClass} from './lexicon.ts';
import {describeNum, extractNumbers, matchNumbers, qualChange, QUAL_WORDS, type Num, type NumMatch} from './numbers.ts';
import {textOverlap} from './similarity.ts';
import {expandEnglish, fold, looksNotEnglish, sentenceTexts, SRC_TAG, stripNotes, stripTags} from './text.ts';
import {LANG_NAMES, type BackSegment, type BackTranslation, type Finding, type MarkupPair, type Segment, type SegmentResult, type Severity, type TargetLang} from './types.ts';

export const WEIGHT: Record<Severity, number> = {high: 30, medium: 10, low: 3, info: 0};

const cut = (s: string, max = 160): string => (s.length > max ? `${s.slice(0, max - 1)}…` : s);
const q = (s: string): string => `"${cut(s.trim(), 120)}"`;

export type Ctx = {lang: TargetLang; langName: string; glossary: Glossary};

// ---------------------------------------------------------------------------------------------------------------------
// Numbers: one verdict per English number, reconciling the back-translation with the direct reading
// ---------------------------------------------------------------------------------------------------------------------

type NumState = {kind: 'ok' | 'alt' | 'changed' | 'unit' | 'unit-dropped' | 'missing'; other?: Num};

const stateIn = (m: NumMatch, n: Num): NumState => {
	const p = m.pairs.find((x) => x.a === n);
	if (p) return {kind: p.via === 'alt' ? 'alt' : 'ok', other: p.b};
	const c = m.changed.find((x) => x.a === n);
	if (c) return {kind: c.why === 'value' ? 'changed' : c.why, other: c.b};
	return {kind: 'missing'};
};

const BAD = new Set(['changed', 'unit', 'unit-dropped', 'missing']);

const trapNote = (n: Num, t: Num | undefined, lang: TargetLang): string => {
	if (!t) return '';
	const raw = t.raw.toLowerCase();
	if (lang === 'es' && /bill[oó]n|billones/.test(raw) && Math.abs(t.value - n.value * 1000) < 1) return ' Spanish "billón" is a million million (10^12): an English billion is "mil millones".';
	if (/\bmil\b/.test(raw) && !/mil+(?:l|h)/.test(raw) && Math.abs(t.value * 1000 - n.value) < 1) return ` "mil" is a thousand: a million is "${lang === 'es' ? 'millón' : 'milhão'}".`;
	return '';
};

const localeDigits = (x: number): string => {
	const [int, dec] = String(+x.toFixed(6)).split('.');
	return `${int.replace(/\B(?=(\d{3})+(?!\d))/g, '.')}${dec ? `,${dec}` : ''}`;
};

const numberFindings = (seg: Segment, back: string | null, ctx: Ctx): {findings: Finding[]; score: number | null} => {
	const out: Finding[] = [];
	const src = extractNumbers(stripTags(seg.source ?? ''), 'en');
	const tr = extractNumbers(stripTags(seg.translation ?? ''), ctx.lang);
	const bt = back !== null ? extractNumbers(stripNotes(stripTags(back)), 'en') : null;
	const mT = matchNumbers(src, tr);
	const mB = bt ? matchNumbers(src, bt) : null;
	const L = ctx.langName;
	let checked = 0;
	let good = 0;
	for (const n of src) {
		const t = stateIn(mT, n);
		const b = mB ? stateIn(mB, n) : null;
		const name = `${describeNum(n)} (${q(n.raw)})`;
		if (n.soft && (t.kind === 'missing' || t.kind === 'ok') && (!b || b.kind === 'missing' || b.kind === 'ok')) continue;
		checked++;
		const tBad = BAD.has(t.kind);
		const bBad = b ? BAD.has(b.kind) : false;
		const tSays = t.other ? `${describeNum(t.other)} (${q(t.other.raw)})` : 'no such number';
		const bSays = b?.other ? `${describeNum(b.other)} (${q(b.other.raw)})` : 'no such number';
		if (!tBad && !bBad) good++;
		if (b === null) {
			if (t.kind === 'changed' || t.kind === 'unit') out.push({code: 'number-changed', severity: 'high', message: `The English says ${name}; the ${L} reads ${tSays}.${trapNote(n, t.other, ctx.lang)}`, evidence: {source: n.raw, translation: t.other?.raw}});
			else if (t.kind === 'unit-dropped') out.push({code: 'number-unit-dropped', severity: 'medium', message: `The English says ${name}; the ${L} has ${tSays} without the unit or currency.`, evidence: {source: n.raw, translation: t.other?.raw}});
			else if (t.kind === 'missing') out.push({code: 'number-not-found', severity: 'medium', message: `The English says ${name}; the checker cannot find it in the ${L}. Check it is there and reads the same.`, evidence: {source: n.raw}});
		} else if (tBad && bBad) {
			if (t.kind === 'missing' && b.kind === 'missing') out.push({code: 'number-missing', severity: n.soft ? 'low' : 'high', message: `The English says ${name}; neither the ${L} nor the back-translation has it.`, evidence: {source: n.raw}});
			else if (t.kind === 'unit-dropped' || b.kind === 'unit-dropped') out.push({code: 'number-unit-dropped', severity: 'medium', message: `The English says ${name}; the ${L} reads ${tSays} and the back-translation ${bSays}: the unit or currency is gone.`, evidence: {source: n.raw, translation: t.other?.raw, back: b.other?.raw}});
			else out.push({code: 'number-changed', severity: 'high', message: `The English says ${name}; the ${L} reads ${tSays} and the back-translation ${bSays}.${trapNote(n, t.other, ctx.lang)}`, evidence: {source: n.raw, translation: t.other?.raw, back: b.other?.raw}});
		} else if (bBad) {
			out.push({code: 'number-back-mismatch', severity: 'medium', message: `The back-translation reads ${bSays} where the English says ${name}, but the ${L} has ${tSays}: probably a back-translation slip. Confirm the ${L}.`, evidence: {source: n.raw, translation: t.other?.raw, back: b.other?.raw}});
		} else if (tBad) {
			if (t.kind === 'missing') out.push({code: 'number-not-parsed', severity: 'low', message: `The back-translation has ${name}, but the checker cannot find it in the ${L}: confirm the ${L} says it.`, evidence: {source: n.raw, back: b.other?.raw}});
			else out.push({code: 'number-check-translation', severity: 'medium', message: `The back-translation has ${name}, but the ${L} reads ${tSays} to the checker. Confirm what a ${L} viewer reads.${trapNote(n, t.other, ctx.lang)}`, evidence: {source: n.raw, translation: t.other?.raw, back: b.other?.raw}});
		}
		// digit style a reader of the target language would misread
		if (t.other && (t.kind === 'alt' || (t.kind === 'ok' && t.other.format === 'en' && n.kind !== 'year'))) {
			const misread = t.kind === 'alt' ? ` A ${L} reader reads it as ${localeDigits(t.other.value)}.` : '';
			out.push({
				code: 'number-format',
				severity: t.kind === 'alt' ? (ctx.lang === 'pt-br' ? 'high' : 'medium') : 'low',
				message: `${q(t.other.raw)} uses English digit style.${misread} Write ${localeDigits(t.kind === 'alt' ? (t.other.alt as number) : t.other.value)}${ctx.lang === 'es' ? ' (Mexico uses 1,500.5; Spain and most of South America 1.500,5: pick the audience\'s style)' : ''}.`,
				evidence: {source: n.raw, translation: t.other.raw},
			});
		}
		if (t.other?.bareDollar) {
			out.push({
				code: 'currency-symbol',
				severity: 'low',
				message:
					ctx.lang === 'es'
						? `${q(t.other.raw)}: "$" alone is the peso sign in Mexico, Argentina, Chile and Colombia. Write "US$" or "dólares" when it means US dollars.`
						: `${q(t.other.raw)}: Brazilian Portuguese writes US dollars as "US$" ("$" alone is unusual and "R$" is reais).`,
				evidence: {translation: t.other.raw},
			});
		}
		// qualifiers: "more than" / "about" / "less than"
		const qb = b?.other && (b.kind === 'ok' || b.kind === 'alt') ? qualChange(n.qual, b.other.qual) : null;
		const qt = t.other && (t.kind === 'ok' || t.kind === 'alt') ? qualChange(n.qual, t.other.qual) : null;
		const qual = qb ?? qt;
		if (qual && qual !== 'none' && (qb === null || qb !== 'none')) {
			const other = (qb !== null ? b?.other : t.other) as Num;
			out.push({
				code: qual === 'major' ? 'number-qualifier-flipped' : 'number-qualifier-changed',
				severity: qual === 'major' ? 'high' : 'medium',
				message: `${name} is "${QUAL_WORDS[n.qual]}" in the English but "${QUAL_WORDS[other.qual]}" in the ${qb !== null ? 'back-translation' : L} (${q(other.raw)}).`,
				evidence: {source: n.raw, back: qb !== null ? other.raw : undefined, translation: qb === null ? other.raw : undefined},
			});
		}
	}
	// numbers that the English does not have
	const addedT = mT.added.filter((x) => !x.soft);
	const addedB = mB ? mB.added.filter((x) => !x.soft) : [];
	const usedT = new Set<Num>();
	for (const x of addedB) {
		const twin = addedT.find((y) => !usedT.has(y) && Math.abs(y.value - x.value) <= Math.abs(x.value) * 0.005);
		if (twin) {
			usedT.add(twin);
			out.push({code: 'number-added', severity: 'medium', message: `The ${L} and the back-translation both have ${describeNum(x)} (${q(twin.raw)}), which the English does not.`, evidence: {translation: twin.raw, back: x.raw}});
		} else out.push({code: 'number-added-back', severity: 'low', message: `The back-translation has ${describeNum(x)} (${q(x.raw)}), which the English does not.`, evidence: {back: x.raw}});
	}
	for (const y of addedT) if (!usedT.has(y)) out.push({code: 'number-added-translation', severity: 'low', message: `The ${L} has ${describeNum(y)} (${q(y.raw)}), which the English does not.`, evidence: {translation: y.raw}});
	const extra = addedB.length;
	const score = checked + extra ? good / (checked + extra) : null;
	return {findings: out, score};
};

// ---------------------------------------------------------------------------------------------------------------------
// Negation, modality, hedges: per aligned sentence pair
// ---------------------------------------------------------------------------------------------------------------------

type PairCtx = {srcText: string; backText: string; tr: string | null; label: string; sentences: number[]};

/**
 * The channel's call-to-action formula "Badger watches the charts so you don't have to" often comes back as "...for
 * you". That drops a "not" and a "have to" without changing the meaning, so the pair is forgiven exactly once. A real
 * inversion ("so you have to") does not match and is still reported.
 */
const FOR_YOU_IDIOM = /\bso (?:that )?you (?:do not|need not) (?:have|need) to\b/i;
const FOR_YOU = /\b(?:for you|on your behalf|instead of you|in your place)\b/i;
const forYouSwap = (p: PairCtx): boolean => FOR_YOU_IDIOM.test(expandEnglish(p.srcText)) && !FOR_YOU_IDIOM.test(expandEnglish(p.backText)) && FOR_YOU.test(p.backText);
/** The same idiom read directly in the translation: "por ti" / "por você" for "so you don't have to". */
const FOR_YOU_TR = /(?<![\p{L}])(?:por ti|por vos|por usted|en tu lugar|por você|por voce|no seu lugar|no teu lugar)(?![\p{L}])/iu;

const sentenceLabel = (idx: number[]): string => (idx.length === 1 ? `sentence ${idx[0] + 1}` : `sentences ${idx.map((i) => i + 1).join('+')}`);

const negationFindings = (p: PairCtx, ctx: Ctx): {findings: Finding[]; bad: boolean; applicable: boolean} => {
	const out: Finding[] = [];
	const s0 = polarity(p.srcText);
	const s = forYouSwap(p) ? {...s0, explicit: s0.explicit - 1} : s0;
	const b = polarity(p.backText);
	const tc = p.tr !== null ? sentenceCues(p.tr, ctx.lang) : null;
	const L = ctx.langName;
	const ev = {source: p.srcText, back: p.backText, translation: p.tr ?? undefined};
	const applicable = s.explicit + s.implicit + b.explicit + b.implicit > 0;
	let bad = false;
	let lost = false;
	if (s.explicit !== b.explicit) {
		if (s.explicit + s.implicit === b.explicit + b.implicit) {
			// "never buy" -> "avoid buying" is reported once, as never-softened or negation-rephrased (below)
			if (!(s.never > b.never)) out.push({code: 'negation-rephrased', severity: 'low', sentences: p.sentences, message: `${p.label}: the negation is expressed differently ("${s.words.join(', ') || '-'}" vs "${b.words.join(', ') || '-'}"). Usually fine; confirm the sense is the same.`, evidence: ev});
		} else if (s.explicit > b.explicit) {
			bad = true;
			lost = true;
			const trKeeps = tc?.negated === true;
			out.push({
				code: 'negation-lost',
				severity: trKeeps ? 'medium' : 'high',
				sentences: p.sentences,
				message: `${p.label}: a negation is gone ("${s.words.join(', ')}" in the English, ${b.words.length ? `"${b.words.join(', ')}"` : 'none'} in the back-translation). A warning may now say the opposite.${trKeeps ? ` The ${L} sentence still has a negation word: possibly a back-translation slip, check the ${L}.` : tc ? ` The ${L} sentence has no negation word either.` : ''}`,
				evidence: ev,
			});
		} else {
			bad = true;
			const trHas = tc?.negated === true;
			out.push({
				code: 'negation-added',
				severity: tc && !trHas ? 'medium' : 'high',
				sentences: p.sentences,
				message: `${p.label}: the back-translation has a negation the English does not ("${b.words.join(', ')}"). The meaning may be inverted.${tc && !trHas ? ` The ${L} sentence has no negation word: possibly a back-translation slip.` : ''}`,
				evidence: ev,
			});
		}
	}
	// "never" -> "not" / "avoid": the warning survives but loses its absolute force. An instruction to the viewer
	// ("Never share it") is the dangerous case; a statement ("most coins never see day two") is a nuance to check.
	// "never see day two" -> "without a second day" keeps the absolute sense: a rephrasing, not a softening
	const ABSOLUTE = new Set(['without', 'no', 'none', 'nothing', 'nobody', 'no one', 'nowhere', 'neither', 'nor']);
	const rephrasedAbsolute = b.implicit <= s.implicit && b.explicitWords.length > 0 && b.explicitWords.every((w) => ABSOLUTE.has(w));
	if (!lost && s.never > b.never && rephrasedAbsolute) {
		out.push({code: 'negation-rephrased', severity: 'low', sentences: p.sentences, message: `${p.label}: "never" became "${b.explicitWords.join(', ')}", which keeps the absolute sense. Confirm the ${L} reads as strongly.`, evidence: ev});
	} else if (!lost && s.never > b.never) {
		bad = true;
		const trNever = tc?.never === true;
		const instruction = isImperative(p.srcText);
		out.push({
			code: 'never-softened',
			severity: instruction ? (trNever ? 'medium' : 'high') : trNever ? 'low' : 'medium',
			sentences: p.sentences,
			message: `${p.label}: "never" is gone (back-translation: "${b.words.join(', ') || 'no negation'}"): ${instruction ? 'an absolute warning to the viewer was softened' : 'the statement lost its absolute "never"'}.${trNever ? ` The ${L} sentence still says "${ctx.lang === 'es' ? 'nunca' : 'nunca/jamais'}": possibly a back-translation slip.` : ''}`,
			evidence: ev,
		});
	} else if (b.never > s.never && !bad) {
		out.push({code: 'never-added', severity: 'low', sentences: p.sentences, message: `${p.label}: the back-translation says "never" where the English has a plain negation: stronger than the English.`, evidence: ev});
	}
	return {findings: out, bad, applicable};
};

const modalityFindings = (p: PairCtx): {findings: Finding[]; bad: boolean; applicable: boolean} => {
	const out: Finding[] = [];
	const s0 = modality(p.srcText);
	const s = forYouSwap(p) ? {...s0, oblig: s0.oblig - 1} : s0;
	const b = modality(p.backText);
	const pol = polarity(p.srcText);
	const impS = isImperative(p.srcText);
	const impB = isImperative(p.backText);
	const warning = pol.explicit > 0 || pol.never > 0;
	const ev = {source: p.srcText, back: p.backText, translation: p.tr ?? undefined};
	const w = (x: typeof s) => x.words.join(', ') || 'none';
	const add = (code: string, severity: Severity, message: string) => out.push({code, severity, sentences: p.sentences, message: `${p.label}: ${message}`, evidence: ev});
	const lostPossib = s.possib > b.possib;
	const gainPossib = b.possib > s.possib;
	const gainOption = gainPossib || b.ability > s.ability;
	if (lostPossib) {
		if (b.future > s.future || b.sure > s.sure || b.oblig > s.oblig) add('modality-hardened', 'high', `a possibility became a certainty or a duty ("${w(s)}" -> "${w(b)}").`);
		else add('possibility-lost', 'high', `"${s.words.filter((x) => /may|might|could|possib|perhaps|maybe|potential|likely|probab|chance/.test(x)).join(', ')}" is gone: a possibility now reads as a fact.`);
	} else if (s.oblig > b.oblig) {
		if (gainOption) add('warning-softened', 'high', `an obligation became an option ("${w(s)}" -> "${w(b)}").`);
		else if (b.advice > s.advice) add('warning-softened', 'medium', `"must" became "should" ("${w(s)}" -> "${w(b)}").`);
		else if (!impB) add('obligation-lost', 'medium', `the obligation ("${w(s)}") is gone.`);
	} else if (s.advice > b.advice) {
		if (b.oblig > s.oblig) add('modality-strengthened', 'medium', `"should" became "must" ("${w(s)}" -> "${w(b)}").`);
		else if (gainOption) add('warning-softened', 'medium', `advice became a mere option ("${w(s)}" -> "${w(b)}").`);
		else if (!impB) add('advice-lost', 'low', `the advice word ("${w(s)}") is gone.`);
	} else if (impS && !impB && (gainOption || b.advice > s.advice)) {
		add('instruction-softened', warning ? 'high' : 'medium', `an instruction to the viewer became an option ("${w(b)}"): the viewer is no longer told to do it.`);
	} else if (gainPossib) {
		if (s.future + s.sure > 0) add('certainty-softened', 'medium', `a certainty became a possibility ("${w(s)}" -> "${w(b)}").`);
		else add('hedge-added', 'low', `the back-translation adds a possibility ("${w(b)}") the English does not have.`);
	} else if (b.oblig > s.oblig && !impS) add('obligation-added', 'low', `the back-translation adds an obligation ("${w(b)}").`);
	if (b.sure > s.sure) add('certainty-added', 'medium', `"${b.words.filter((x) => /definite|certain|sure|guarantee|undoubt|inevitab|doubt/.test(x)).join(', ')}" adds certainty the English does not claim.`);
	else if (s.sure > b.sure) add('certainty-lost', 'low', `the certainty word ("${w(s)}") is gone.`);
	if (s.always > b.always) add('absolute-lost', 'medium', `"always" (or "every time") is gone: an absolute rule became a softer one.`);
	else if (b.always > s.always) add('absolute-added', 'low', `the back-translation adds "always".`);
	if (impS && !impB && !out.length) add('instruction-changed', 'low', 'an instruction to the viewer reads as a statement in the back-translation. Check the mood (imperative) in the translation.');
	const any = (x: typeof s) => Object.entries(x).some(([k, v]) => k !== 'words' && (v as number) > 0);
	return {findings: out, bad: out.some((f) => f.severity !== 'low'), applicable: any(s) || any(b) || impS};
};

const hedgeFindings = (p: PairCtx, ctx: Ctx): {findings: Finding[]; bad: boolean; applicable: boolean} => {
	const out: Finding[] = [];
	const s = hedges(p.srcText);
	const b = hedges(p.backText);
	const tc = p.tr !== null ? sentenceCues(p.tr, ctx.lang) : null;
	const sc = englishSentenceCues(p.srcText);
	const ev = {source: p.srcText, back: p.backText, translation: p.tr ?? undefined};
	let bad = false;
	for (const c of ['alleged', 'attrib', 'uncert'] as HedgeClass[]) {
		if (s[c] > b[c]) {
			bad = true;
			const trKeeps = tc !== null && tc.hedges >= sc.hedges;
			out.push({
				code: c === 'attrib' ? 'attribution-lost' : 'hedge-lost',
				severity: trKeeps ? 'medium' : 'high',
				sentences: p.sentences,
				message: `${p.label}: ${HEDGE_NAMES[c]} is gone (English: "${s.byClass[c].join(', ')}"; back-translation: ${b.byClass[c].length ? `"${b.byClass[c].join(', ')}"` : 'none'}). The claim now reads as a plain fact${c === 'attrib' ? ' with no one standing behind it' : ''}.${trKeeps ? ` The ${ctx.langName} sentence still has an attribution or hedge word: possibly a back-translation slip.` : tc ? ` The ${ctx.langName} sentence has none either.` : ''}`,
				evidence: ev,
			});
		} else if (b[c] > s[c]) {
			out.push({code: 'hedge-added', severity: 'low', sentences: p.sentences, message: `${p.label}: the back-translation adds ${HEDGE_NAMES[c]} ("${b.byClass[c].join(', ')}"): more cautious than the English.`, evidence: ev});
		}
	}
	const applicable = s.alleged + s.attrib + s.uncert + b.alleged + b.attrib + b.uncert > 0;
	return {findings: out, bad, applicable};
};

// ---------------------------------------------------------------------------------------------------------------------
// Claim tags, markup pairs, entities
// ---------------------------------------------------------------------------------------------------------------------

const tagsOf = (text: string): string[] => [...text.matchAll(SRC_TAG)].flatMap((m) => m[0].replace(/^\[src:\s*|\]$/g, '').split(',').map((x) => x.trim()).filter(Boolean));

const multisetDiff = (a: string[], b: string[]): string[] => {
	const left = [...b];
	const out: string[] = [];
	for (const x of a) {
		const i = left.indexOf(x);
		if (i >= 0) left.splice(i, 1);
		else out.push(x);
	}
	return out;
};

const tagFindings = (seg: Segment, S: string[], T: string[], B: string[] | null, align: AlignPair[] | null, ctx: Ctx): {findings: Finding[]; ok: boolean; applicable: boolean} => {
	const out: Finding[] = [];
	const sTags = seg.sourceTags ?? [];
	const tTags = seg.translationTags ?? [];
	if (!sTags.length && !tTags.length) return {findings: out, ok: true, applicable: false};
	const L = ctx.langName;
	for (const id of new Set(multisetDiff(sTags, tTags)))
		out.push({code: 'claim-tag-missing', severity: 'high', message: `[src:${id}] is in the English narration but not in the ${L}: the claim it backs has no source in the dub (the claim gate will fail it).`, evidence: {source: `[src:${id}]`}});
	for (const id of new Set(multisetDiff(tTags, sTags))) out.push({code: 'claim-tag-extra', severity: 'medium', message: `[src:${id}] is in the ${L} but not in the English narration.`, evidence: {translation: `[src:${id}]`}});
	const moved = new Set<string>();
	if (S.length === T.length) {
		S.forEach((s, i) => {
			for (const id of multisetDiff(tagsOf(s), tagsOf(T[i]))) {
				const where = T.findIndex((t) => tagsOf(t).includes(id));
				if (where >= 0 && where !== i) {
					moved.add(id);
					out.push({code: 'claim-tag-moved', severity: 'medium', sentences: [i + 1], message: `[src:${id}] backs English sentence ${i + 1} but sits on ${L} sentence ${where + 1}: the source now backs a different claim.`, evidence: {source: s, translation: T[where]}});
				}
			}
		});
	}
	if (B && align) {
		const backTags = B.flatMap(tagsOf);
		if (sTags.length && !backTags.length) out.push({code: 'back-dropped-tags', severity: 'info', message: 'The back-translation dropped the [src:id] tags (the worksheet asks to keep them), so tag positions were checked on the translation only.'});
		for (const pair of align) {
			if (!pair.src.length || !pair.back.length) continue;
			const sHere = pair.src.flatMap((i) => tagsOf(S[i]));
			const bHere = pair.back.flatMap((j) => tagsOf(B[j]));
			for (const id of multisetDiff(bHere, sHere)) {
				if (moved.has(id) || !sTags.includes(id)) continue;
				moved.add(id);
				out.push({code: 'claim-tag-moved', severity: 'medium', sentences: pair.src.map((i) => i + 1), message: `In the back-translation [src:${id}] follows ${sentenceLabel(pair.src)}, which does not carry it in the English: check which claim it backs in the ${L}.`, evidence: {source: pair.src.map((i) => S[i]).join(' '), back: pair.back.map((j) => B[j]).join(' ')}});
			}
		}
	}
	return {findings: out, ok: !out.some((f) => f.severity === 'high' || f.severity === 'medium'), applicable: true};
};

const markupFindings = (seg: Segment, ctx: Ctx): Finding[] => {
	const out: Finding[] = [];
	const L = ctx.langName;
	const firm = (x: Num[]) => x.filter((n) => !n.soft);
	const numeric = (p: MarkupPair, lang: 'en' | TargetLang) => firm(extractNumbers(p.display, lang)).length + firm(extractNumbers(p.spoken, lang)).length > 0;
	const sp = (seg.sourcePairs ?? []).filter((p) => numeric(p, 'en'));
	const tAll = seg.translationPairs ?? [];
	const tp = tAll.filter((p) => numeric(p, ctx.lang));
	// pronunciation respellings ({Bubblemaps|Bábol maps}): nothing to compare, but the reviewer should hear them
	const respell = tAll.filter((p) => !numeric(p, ctx.lang) && p.display !== p.spoken);
	if (respell.length)
		out.push({code: 'voice-respelling', severity: 'info', message: `Respelled for the ${L} voice (listen to how they sound): ${respell.map((p) => `"${p.display}" said as "${p.spoken}"`).join('; ')}.`});
	if (sp.length !== tp.length)
		out.push({
			code: 'markup-pairs-differ',
			severity: 'medium',
			message: `The English narration spells out ${sp.length} number(s) for the voice ({display|spoken}), the ${L} ${tp.length}. A number the voice reads from digits may be read wrongly.`,
		});
	tp.forEach((t, i) => {
		const tDisp = firm(extractNumbers(t.display, ctx.lang));
		const tSpoken = firm(extractNumbers(t.spoken, ctx.lang));
		const s = sp.length === tp.length ? sp[i] : null;
		const ev = {source: s ? `{${s.display}|${s.spoken}}` : undefined, translation: `{${t.display}|${t.spoken}}`};
		if (s) {
			// the dubbed voice must say what the English voice says (the English may round on purpose: "nearly nineteen million")
			const sSpoken = firm(extractNumbers(s.spoken, 'en'));
			const m = matchNumbers(sSpoken, tSpoken);
			if (m.changed.length || m.missing.length || m.added.length) {
				out.push({code: 'spoken-number-changed', severity: 'high', message: `In the English Zoo says ${q(s.spoken)} (${sSpoken.map(describeNum).join(', ') || 'no number'}); in the ${L} he says ${q(t.spoken)} (${tSpoken.map(describeNum).join(', ') || 'no number'}).`, evidence: ev});
				return;
			}
			for (const p of m.pairs) {
				const qc = qualChange(p.a.qual, p.b.qual);
				if (qc !== 'none') out.push({code: 'spoken-qualifier-changed', severity: qc === 'major' ? 'high' : 'medium', message: `Zoo says "${QUAL_WORDS[p.a.qual]}" ${describeNum(p.a)} in the English but "${QUAL_WORDS[p.b.qual]}" in the ${L} (${q(t.spoken)}).`, evidence: ev});
			}
			return;
		}
		// no English pair to compare with: the spoken side must agree with the captions (allowing "about/nearly" rounding)
		if (tDisp.length && !tSpoken.length) {
			out.push({code: 'spoken-number-missing', severity: 'medium', message: `The captions show ${q(t.display)} but Zoo says ${q(t.spoken)}, with no number the checker can read.`, evidence: ev});
			return;
		}
		const m = matchNumbers(tDisp, tSpoken);
		const rounded = m.changed.every((c) => c.why === 'value' && Math.abs(c.b.value - c.a.value) <= Math.abs(c.a.value) * (c.b.qual === 'approx' || c.b.qual === 'nearly' ? 0.1 : 0.02));
		if ((m.changed.length && !rounded) || m.missing.length)
			out.push({code: 'spoken-display-mismatch', severity: 'high', message: `The captions show ${q(t.display)} (${tDisp.map(describeNum).join(', ')}) but Zoo says ${q(t.spoken)} (${tSpoken.map(describeNum).join(', ')}).`, evidence: ev});
	});
	return out;
};

const glossaryCovers = (ctx: Ctx, name: string): boolean => {
	const f = fold(name);
	return ctx.glossary.terms.some((t) => [t.en, ...(t.aliases ?? []), ...(t.es ?? []), ...(t['pt-br'] ?? [])].some((x) => fold(x) === f || f.split(' ').includes(fold(x))));
};

const entityFindings = (seg: Segment, back: string | null, ctx: Ctx): {findings: Finding[]; score: number | null} => {
	const out: Finding[] = [];
	const src = stripTags(seg.source ?? '');
	const tr = stripTags(seg.translation ?? '');
	// words inside a glossary term the source uses ("Week" in "Scam of the Week") are the glossary's business
	const termsHere = ctx.glossary.terms.map((t) => t.en).filter((en) => fold(src).includes(fold(en)));
	const ents = extractEntities(src).filter((e) => !glossaryCovers(ctx, e) && !termsHere.some((en) => en.includes(e)));
	let found = 0;
	for (const e of ents) {
		const inTr = tr.includes(e) || fold(tr).includes(fold(e));
		const inBack = back !== null && fold(back).includes(fold(e));
		if (inTr) found++;
		if (!inTr && (back === null || !inBack))
			out.push({code: 'entity-missing', severity: 'medium', message: `"${e}" is named in the English but not in the ${ctx.langName}${back !== null ? ' or the back-translation' : ''}: a fact may have lost its subject.`, evidence: {source: e}});
		else if (!inTr && inBack)
			out.push({code: 'entity-translated', severity: 'low', message: `"${e}" is not written as is in the ${ctx.langName} (the back-translation has it). Names of organisations and products stay as written unless an official ${ctx.langName} name exists.`, evidence: {source: e}});
	}
	// names in the translation that the English does not have
	const srcFold = fold(src);
	const added = new Set<string>();
	for (const e of extractEntities(tr)) {
		if (glossaryCovers(ctx, e) || srcFold.includes(fold(e))) continue;
		added.add(e);
	}
	// a capitalised word written the same in the translation and in the English back-translation is a name, even at
	// the start of a sentence ("Binance las rastreó" / "Binance tracked them"), where capitals prove nothing
	if (back !== null) {
		const backWords = new Set((stripTags(back).match(/\p{Lu}[\p{L}\p{N}.&-]{2,}/gu) ?? []).map((w) => w.replace(/[.-]+$/, '')));
		for (const raw of tr.match(/\p{Lu}[\p{L}\p{N}.&-]{2,}/gu) ?? []) {
			const w = raw.replace(/[.-]+$/, '');
			if (!backWords.has(w) || srcFold.includes(fold(w)) || glossaryCovers(ctx, w) || [...added].some((x) => x.includes(w))) continue;
			added.add(w);
		}
	}
	for (const e of added) out.push({code: 'entity-added', severity: 'medium', message: `The ${ctx.langName} names "${e}", which the English does not mention.`, evidence: {translation: e}});
	// one name out and another in: a fact is now attributed to someone else
	const missing = out.filter((f) => f.code === 'entity-missing');
	const addedFindings = out.filter((f) => f.code === 'entity-added');
	if (missing.length && addedFindings.length) {
		const swapped: Finding = {
			code: 'entity-swapped',
			severity: 'high',
			message: `"${missing.map((f) => f.evidence?.source).join('", "')}" in the English became "${addedFindings.map((f) => f.evidence?.translation).join('", "')}" in the ${ctx.langName}: the claim now names someone else.`,
			evidence: {source: missing.map((f) => f.evidence?.source).join(', '), translation: addedFindings.map((f) => f.evidence?.translation).join(', ')},
		};
		return {findings: [...out.filter((f) => f.code !== 'entity-missing' && f.code !== 'entity-added'), swapped], score: ents.length ? found / ents.length : null};
	}
	return {findings: out, score: ents.length ? found / ents.length : null};
};

// ---------------------------------------------------------------------------------------------------------------------
// One segment
// ---------------------------------------------------------------------------------------------------------------------

const MISSING_SEVERITY: Record<string, Severity> = {narration: 'high', thumbnail: 'medium', title: 'medium', shortTitle: 'medium', onScreen: 'medium', ui: 'medium', showUi: 'medium', news: 'high', copy: 'medium'};

export const checkSegment = (seg: Segment, back: BackSegment | null, ctx: Ctx): SegmentResult => {
	const base = {id: seg.id, kind: seg.kind, context: seg.context, order: seg.order, source: seg.source, translation: seg.translation, lostWords: [] as string[], addedWords: [] as string[]};
	const L = ctx.langName;
	if (seg.translationRaw === null || !(seg.translation ?? '').trim()) {
		const f: Finding = {
			code: 'missing-translation',
			severity: MISSING_SEVERITY[seg.kind] ?? 'medium',
			message:
				seg.kind === 'thumbnail'
					? `Not translated: storyboard.${ctx.lang}.json has no thumbnails[] entry for this id, so no ${L} thumbnail can be rendered (the thumbnail tool refuses English text in a ${L} thumbnail).`
					: `Not translated: the ${L} storyboard has no text here.`,
		};
		return {...base, status: 'missing-translation', back: null, similarity: null, overlap: null, keyScore: null, risk: WEIGHT[f.severity], findings: [f]};
	}
	if (seg.sourceRaw === null) {
		const f: Finding = {code: 'extra-translation', severity: 'medium', message: `The ${L} has text here but the English storyboard does not: nothing to compare it with.`};
		return {...base, status: 'extra-translation', back: back?.text ?? null, similarity: null, overlap: null, keyScore: null, risk: WEIGHT.medium, findings: [f]};
	}
	const source = seg.source ?? '';
	const translation = seg.translation ?? '';
	const current = back && back.hash === seg.hash ? back : null;
	const findings: Finding[] = [];
	const S = sentenceTexts(source);
	const T = sentenceTexts(translation);

	// checks that need no back-translation
	const glossaryOnly = glossaryFindings(ctx.glossary, ctx.lang, stripTags(source), stripTags(translation));
	findings.push(...glossaryOnly);
	if (seg.kind === 'narration') findings.push(...markupFindings(seg, ctx));

	if (!current) {
		const nums = numberFindings(seg, null, ctx);
		findings.push(...nums.findings);
		findings.push(...tagFindings(seg, S, T, null, null, ctx).findings);
		findings.push(...entityFindings(seg, null, ctx).findings);
		const status = back ? 'stale-back-translation' : 'no-back-translation';
		return {...base, status, back: back?.text ?? null, similarity: null, overlap: null, keyScore: null, risk: findings.reduce((a, f) => a + WEIGHT[f.severity], 0), findings};
	}

	const backText = stripNotes(current.text);
	if (looksNotEnglish(backText)) {
		findings.push({code: 'back-not-english', severity: 'high', message: `The back-translation reads as ${L}, not English: it was not back-translated. Redo this segment.`, evidence: {back: current.text}});
		return {...base, status: 'checked', back: current.text, similarity: null, overlap: null, keyScore: null, risk: findings.reduce((a, f) => a + WEIGHT[f.severity], 0), findings, back_meta: meta(current)};
	}
	const B = sentenceTexts(backText);
	if (fold(stripTags(backText)) === fold(stripTags(source)) && source.split(/\s+/).length >= 6)
		findings.push({code: 'back-identical-to-source', severity: 'info', message: 'The back-translation is word for word the English source. Normal for a short literal line; see the note at the top if many are.'});

	// sentences
	const align = alignSentences(S, B);
	if (S.length !== T.length)
		findings.push({code: 'sentence-count', severity: 'low', message: `The English has ${S.length} sentence${S.length === 1 ? '' : 's'}, the ${L} ${T.length}${B.length !== T.length ? `, the back-translation ${B.length}` : ''}. Merged or split sentences change pacing and caption breaks; dropped ones lose content (see below).`});
	for (const pair of align) {
		if (pair.src.length && !pair.back.length) {
			const slip = S.length === T.length;
			findings.push({
				code: 'sentence-missing',
				severity: slip ? 'medium' : 'high',
				sentences: pair.src.map((i) => i + 1),
				message: `English ${sentenceLabel(pair.src)} has no counterpart in the back-translation: ${q(pair.src.map((i) => S[i]).join(' '))}.${slip ? ` The ${L} has as many sentences as the English: the back-translation may have skipped it; check the ${L}.` : ''}`,
				evidence: {source: pair.src.map((i) => S[i]).join(' ')},
			});
		} else if (!pair.src.length && pair.back.length) {
			findings.push({code: 'sentence-added', severity: 'medium', message: `The back-translation has a sentence the English does not: ${q(pair.back.map((j) => B[j]).join(' '))}.`, evidence: {back: pair.back.map((j) => B[j]).join(' ')}});
		}
	}

	// per-pair meaning checks
	const dims: number[] = [];
	let negBad = false;
	let negApplicable = false;
	let modBad = false;
	let modApplicable = false;
	let hedgeBad = false;
	let hedgeApplicable = false;
	for (const pair of align) {
		if (!pair.src.length || !pair.back.length) continue;
		const srcText = pair.src.map((i) => S[i]).join(' ');
		const pBack = pair.back.map((j) => B[j]).join(' ');
		const tr = S.length === T.length ? pair.src.map((i) => T[i]).join(' ') : null;
		const pc: PairCtx = {srcText, backText: pBack, tr, label: S.length > 1 ? `English ${sentenceLabel(pair.src)}` : 'This line', sentences: pair.src.map((i) => i + 1)};
		const n = negationFindings(pc, ctx);
		const m = modalityFindings(pc);
		const h = hedgeFindings(pc, ctx);
		findings.push(...n.findings, ...m.findings, ...h.findings);
		negBad ||= n.bad;
		negApplicable ||= n.applicable;
		modBad ||= m.bad;
		modApplicable ||= m.applicable;
		hedgeBad ||= h.bad;
		hedgeApplicable ||= h.applicable;
	}
	// direct reading of the translation, for sentences the back-translation did not flag
	if (S.length === T.length) {
		S.forEach((s, i) => {
			const idiom = FOR_YOU_IDIOM.test(expandEnglish(s)) && FOR_YOU_TR.test(T[i]);
			const cs = englishSentenceCues(idiom ? expandEnglish(s).replace(FOR_YOU_IDIOM, 'for you') : s);
			const ct = sentenceCues(T[i], ctx.lang);
			const flagged = (code: RegExp) => findings.some((f) => code.test(f.code) && (f.sentences ?? []).includes(i + 1));
			if (cs.negated && !ct.negated && !flagged(/^(?:negation|never)-/))
				findings.push({code: 'translation-negation-missing', severity: 'medium', sentences: [i + 1], message: `English sentence ${i + 1} is negative but the ${L} sentence has no negation word (${ctx.lang === 'es' ? 'no, nunca, nadie, ni, sin' : 'não, nunca, ninguém, nem, sem'}...). Check it: ${q(T[i])}.`, evidence: {source: s, translation: T[i]}});
			if (cs.never && !ct.never && !flagged(/^(?:never|negation)-/))
				findings.push({code: 'translation-never-missing', severity: 'medium', sentences: [i + 1], message: `English sentence ${i + 1} says "never"; the ${L} sentence has no "nunca"/"jamás"${ctx.lang === 'pt-br' ? '/"jamais"' : ''}. Check the warning kept its strength: ${q(T[i])}.`, evidence: {source: s, translation: T[i]}});
			if (cs.hedges > ct.hedges && !flagged(/^(?:hedge|attribution)-/))
				findings.push({code: 'translation-hedge-missing', severity: 'medium', sentences: [i + 1], message: `English sentence ${i + 1} attributes or hedges its claim; the checker finds fewer such words in the ${L} sentence. Check: ${q(T[i])}.`, evidence: {source: s, translation: T[i]}});
		});
	}
	const nums = numberFindings(seg, backText, ctx);
	findings.push(...nums.findings);
	const tags = tagFindings(seg, S, T, B, align, ctx);
	findings.push(...tags.findings);
	const ents = entityFindings(seg, backText, ctx);
	findings.push(...ents.findings);

	if (nums.score !== null) dims.push(nums.score);
	if (negApplicable) dims.push(negBad ? 0 : 1);
	if (modApplicable) dims.push(modBad ? 0 : 1);
	if (hedgeApplicable) dims.push(hedgeBad ? 0 : 1);
	if (ents.score !== null) dims.push(ents.score);
	if (tags.applicable) dims.push(tags.ok ? 1 : 0);
	const gl = glossaryOnly.filter((f) => f.code !== 'glossary-forbidden-spelling');
	if (gl.length) dims.push(gl.some((f) => f.severity === 'high' || f.severity === 'medium') ? 0 : 0.5);

	const ov = textOverlap(source, backText);
	const keyScore = dims.length ? dims.reduce((a, b) => a + b, 0) / dims.length : null;
	const similarity = Math.round((keyScore === null ? ov.score : 0.65 * ov.score + 0.35 * keyScore) * 100) / 100;
	if (ov.sourceCount >= 3) {
		if (ov.score < 0.3) findings.push({code: 'low-similarity', severity: 'high', message: `Very little of the English content comes back (${Math.round(ov.score * 100)}% word overlap). Not in the back-translation: ${ov.lost.join(', ') || '-'}; new: ${ov.added.join(', ') || '-'}.`});
		else if (ov.score < 0.5) findings.push({code: 'low-similarity', severity: 'medium', message: `Only ${Math.round(ov.score * 100)}% of the English content words come back. Not in the back-translation: ${ov.lost.join(', ') || '-'}; new: ${ov.added.join(', ') || '-'}.`});
	} else if (ov.score < 0.5 && ov.lost.length) findings.push({code: 'low-similarity', severity: 'low', message: `Short text with different words: "${ov.lost.join(', ')}" became "${ov.added.join(', ') || 'nothing'}".`});
	if (ov.lost.length && ov.score >= 0.5 && ov.score < 0.9 && !findings.some((f) => f.code === 'low-similarity'))
		findings.push({code: 'words-differ', severity: 'low', message: `Word choice differs: "${ov.lost.join(', ')}" ${ov.added.length ? `came back as "${ov.added.join(', ')}"` : 'did not come back'}. Usually a nuance; the native reviewer decides.`});
	// a headline fragment ("NEVER SEE DAY TWO") only looks like an instruction; the low "mood" note is noise there
	if (seg.kind === 'thumbnail' || seg.kind === 'title' || seg.kind === 'shortTitle') {
		for (let i = findings.length - 1; i >= 0; i--) if (findings[i].code === 'instruction-changed') findings.splice(i, 1);
	}
	const risk = Math.round(findings.reduce((a, f) => a + WEIGHT[f.severity], 0) + (1 - similarity) * 10);
	return {
		...base,
		status: 'checked',
		back: current.text,
		similarity,
		overlap: ov.score,
		keyScore: keyScore === null ? null : Math.round(keyScore * 100) / 100,
		risk,
		findings,
		lostWords: ov.lost,
		addedWords: ov.added,
		sentenceCounts: {source: S.length, translation: T.length, back: B.length},
		back_meta: meta(current),
	};
};

const meta = (b: BackSegment) => ({method: b.method, by: b.by, blind: b.blind, date: b.date});

// ---------------------------------------------------------------------------------------------------------------------
// The episode
// ---------------------------------------------------------------------------------------------------------------------

/** Scene-level check: the kinetic quote reveals words as Zoo says them, so the dubbed narration should say the quote. */
const quoteFindings = (results: SegmentResult[], segments: Segment[], ctx: Ctx): void => {
	for (const seg of segments) {
		const m = /^(.+)\.onScreen\.quote$/.exec(seg.id);
		if (!m || !seg.source || !seg.translation) continue;
		const nar = segments.find((s) => s.id === `${m[1]}.narration`);
		if (!nar?.source || !nar.translation) continue;
		const strip = (s: string) => fold(stripTags(s)).replace(/[^\p{L}\p{N} ]/gu, ' ').replace(/\s+/g, ' ').trim();
		if (strip(nar.source).includes(strip(seg.source)) && !strip(nar.translation).includes(strip(seg.translation))) {
			const r = results.find((x) => x.id === seg.id);
			if (!r) continue;
			r.findings.push({code: 'quote-not-said', severity: 'low', message: `Zoo says this quote in the English narration, but the ${ctx.langName} narration words it differently from the on-screen ${ctx.langName} quote; the quote's words appear as Zoo says them, so they should match.`, evidence: {translation: seg.translation}});
			r.risk += WEIGHT.low;
		}
	}
};

export type CompareOutput = {results: SegmentResult[]; notes: string[]};

export const compareAll = (segments: Segment[], record: BackTranslation | null, lang: TargetLang, glossary: Glossary): CompareOutput => {
	const ctx: Ctx = {lang, langName: LANG_NAMES[lang], glossary};
	const notes: string[] = [];
	const results = segments.map((seg) => checkSegment(seg, record?.segments[seg.id] ?? null, ctx));
	quoteFindings(results, segments, ctx);
	// a back-translation that repeats the English word for word in most longer lines was probably not made blind
	const longChecked = results.filter((r) => r.status === 'checked' && (r.source ?? '').split(/\s+/).length >= 6);
	const identical = longChecked.filter((r) => r.findings.some((f) => f.code === 'back-identical-to-source'));
	if (longChecked.length >= 3 && identical.length / longChecked.length >= 0.6)
		notes.push(`${identical.length} of ${longChecked.length} longer back-translations repeat the English word for word. A blind, literal back-translation rarely does: confirm the back-translator did not work from the English, or redo it blind.`);
	if (record) {
		const known = new Set(segments.map((s) => s.id));
		const orphans = Object.keys(record.segments).filter((id) => !known.has(id));
		if (orphans.length) notes.push(`The back-translation record has ${orphans.length} segment(s) that no longer exist: ${orphans.slice(0, 8).join(', ')}${orphans.length > 8 ? '…' : ''}.`);
	}
	return {results, notes};
};
