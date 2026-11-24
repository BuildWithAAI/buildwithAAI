/** Test helpers: build segments and run one check without touching the disk. */
import {checkSegment, type Ctx} from '../lib/compare.ts';
import {loadGlossary} from '../lib/glossary.ts';
import {narrationView, segmentHash} from '../lib/segments.ts';
import {LANG_NAMES, type BackSegment, type Segment, type SegmentKind, type SegmentResult, type TargetLang} from '../lib/types.ts';

export const glossary = loadGlossary();

export const ctx = (lang: TargetLang = 'es'): Ctx => ({lang, langName: LANG_NAMES[lang], glossary});

/** A segment as the extractor builds it: narration markup resolved, tags kept, hash of the translation. */
export const seg = (source: string, translation: string, opts: {lang?: TargetLang; id?: string; kind?: SegmentKind} = {}): Segment => {
	const lang = opts.lang ?? 'es';
	const id = opts.id ?? 's01.narration';
	const sv = narrationView(source);
	const tv = narrationView(translation);
	return {
		id,
		kind: opts.kind ?? 'narration',
		context: 'test',
		sourceRaw: source,
		translationRaw: translation,
		source: sv.display,
		translation: tv.display,
		sourcePairs: sv.pairs,
		translationPairs: tv.pairs,
		sourceTags: sv.tags,
		translationTags: tv.tags,
		hash: segmentHash(lang, id, translation),
		order: 0,
	};
};

export const back = (s: Segment, text: string, blind = true): BackSegment => ({hash: s.hash as string, text, method: 'claude-session', by: 'test', blind, date: '2026-11-24'});

/** Check one source / translation / back-translation triple. */
export const check = (source: string, translation: string, bt: string, lang: TargetLang = 'es', kind: SegmentKind = 'narration'): SegmentResult => {
	const s = seg(source, translation, {lang, kind});
	return checkSegment(s, back(s, bt), ctx(lang));
};

export const codes = (r: SegmentResult, min: 'high' | 'medium' | 'low' | 'info' = 'low'): string[] => {
	const order = ['high', 'medium', 'low', 'info'];
	return r.findings.filter((f) => order.indexOf(f.severity) <= order.indexOf(min)).map((f) => `${f.severity}:${f.code}`);
};

export const has = (r: SegmentResult, code: string, severity?: string): boolean => r.findings.some((f) => f.code === code && (!severity || f.severity === severity));
