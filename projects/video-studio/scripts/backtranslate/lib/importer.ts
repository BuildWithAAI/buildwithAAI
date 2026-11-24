/**
 * import: a filled worksheet (JSON or Markdown) becomes the back-translation record. Each text is accepted only if it
 * was made from the CURRENT translation (same hash), reads as English, and is not a copy of the translation. The
 * record keeps who back-translated each segment (a Claude session or a person, never an external API) and whether
 * they worked blind.
 */
import {fold, looksNotEnglish, stripNotes, stripTags, words} from './text.ts';
import {BACK_METHODS, isTargetLang, type BackMethod, type BackTranslation, type Segment, type TargetLang} from './types.ts';
import {parseWorksheetMarkdown} from './worksheet.ts';

export class ImportError extends Error {}

export type FilledItem = {id: string; hash: string; bt: string};

export const parseFilled = (text: string, file: string): {items: FilledItem[]; meta: {channel?: string; slug?: string; lang?: string}} => {
	const trimmed = text.trimStart();
	if (trimmed.startsWith('{')) {
		let doc: unknown;
		try {
			doc = JSON.parse(text);
		} catch (e) {
			throw new ImportError(`${file}: not valid JSON: ${(e as Error).message}`);
		}
		const d = doc as {kind?: unknown; items?: unknown; channel?: unknown; slug?: unknown; lang?: unknown};
		if (d.kind !== 'backtranslation-worksheet' || !Array.isArray(d.items)) throw new ImportError(`${file}: not a back-translation worksheet (kind "backtranslation-worksheet" with items[])`);
		const items = d.items.map((it, i) => {
			const o = it as Record<string, unknown>;
			if (typeof o.id !== 'string' || typeof o.hash !== 'string') throw new ImportError(`${file}: items[${i}] needs id and hash`);
			if (o.bt !== undefined && typeof o.bt !== 'string') throw new ImportError(`${file}: items[${i}] (${o.id}): bt must be a string`);
			return {id: o.id, hash: o.hash, bt: typeof o.bt === 'string' ? o.bt.trim() : ''};
		});
		return {items, meta: {channel: typeof d.channel === 'string' ? d.channel : undefined, slug: typeof d.slug === 'string' ? d.slug : undefined, lang: typeof d.lang === 'string' ? d.lang : undefined}};
	}
	const items = parseWorksheetMarkdown(text);
	if (!items.length) throw new ImportError(`${file}: no worksheet items found (each item needs its "<!-- id: ... · hash: ... -->" line)`);
	const head = /^# Back-translation worksheet: ([^/\s]+)\/(\S+) \(/m.exec(text);
	return {items, meta: {channel: head?.[1], slug: head?.[2]}};
};

export type ImportOptions = {channel: string; slug: string; lang: TargetLang; method: BackMethod; by: string; blind: boolean; date: string};
export type ImportOutcome = {record: BackTranslation; imported: string[]; unfilled: string[]; rejected: Array<{id: string; why: string}>; warnings: string[]};

/** Initials or a role, never a private full name: the repo is public. */
export const checkWho = (who: string): string | null => {
	const t = who.trim();
	if (!t) return '--who is required: initials or a role, e.g. "claude-session" or "native reviewer ES-1"';
	if (t.length > 60) return '--who is too long: use initials or a role';
	if (/^\p{Lu}\p{Ll}+(?:[ -]\p{Lu}\p{Ll}+)+$/u.test(t)) return '--who looks like a full name; use initials or a role (the repository is public)';
	return null;
};

export const emptyRecord = (channel: string, slug: string, lang: TargetLang): BackTranslation => ({kind: 'backtranslation', version: 1, channel, slug, lang, segments: {}});

export const validateRecord = (raw: unknown, file: string, lang: TargetLang): BackTranslation => {
	const r = raw as Partial<BackTranslation>;
	if (!r || r.kind !== 'backtranslation' || r.version !== 1) throw new ImportError(`${file}: not a back-translation record (kind "backtranslation", version 1)`);
	if (!isTargetLang(r.lang) || r.lang !== lang) throw new ImportError(`${file}: lang is "${String(r.lang)}", expected "${lang}"`);
	if (!r.segments || typeof r.segments !== 'object') throw new ImportError(`${file}: segments must be an object`);
	for (const [id, s] of Object.entries(r.segments)) {
		if (!s || typeof s.hash !== 'string' || typeof s.text !== 'string' || !BACK_METHODS.includes(s.method) || typeof s.by !== 'string' || typeof s.blind !== 'boolean' || typeof s.date !== 'string')
			throw new ImportError(`${file}: segments["${id}"] needs hash, text, method (${BACK_METHODS.join(' | ')}), by, blind and date`);
	}
	return r as BackTranslation;
};

export const importFilled = (segments: Segment[], existing: BackTranslation | null, items: FilledItem[], opts: ImportOptions): ImportOutcome => {
	const record: BackTranslation = existing ? {...existing, segments: {...existing.segments}} : emptyRecord(opts.channel, opts.slug, opts.lang);
	const byId = new Map(segments.map((s) => [s.id, s]));
	const imported: string[] = [];
	const unfilled: string[] = [];
	const rejected: Array<{id: string; why: string}> = [];
	const warnings: string[] = [];
	const seen = new Set<string>();
	for (const it of items) {
		if (seen.has(it.id)) {
			rejected.push({id: it.id, why: 'listed twice in the worksheet'});
			continue;
		}
		seen.add(it.id);
		const seg = byId.get(it.id);
		if (!seg || seg.hash === null) {
			rejected.push({id: it.id, why: 'no such translated segment in the episode now'});
			continue;
		}
		if (it.hash !== seg.hash) {
			rejected.push({id: it.id, why: 'the translation changed after this worksheet was made: run prepare again and back-translate the new text'});
			continue;
		}
		const bt = it.bt.trim();
		if (!bt) {
			unfilled.push(it.id);
			continue;
		}
		const plain = stripNotes(stripTags(bt));
		if (looksNotEnglish(plain)) {
			rejected.push({id: it.id, why: 'reads as Spanish or Portuguese, not English'});
			continue;
		}
		const tr = stripTags(seg.translation ?? '');
		const src = stripTags(seg.source ?? '');
		if (fold(plain) === fold(tr) && words(tr).length >= 3 && fold(tr) !== fold(src)) {
			rejected.push({id: it.id, why: 'identical to the translation: it was copied, not back-translated'});
			continue;
		}
		if ((seg.translationTags ?? []).length && !/\[src:/.test(bt)) warnings.push(`${it.id}: the [src:...] tags were dropped (accepted; tag positions are then checked on the translation only)`);
		record.segments[it.id] = {hash: it.hash, text: bt, method: opts.method, by: opts.by.trim(), blind: opts.blind, date: opts.date};
		imported.push(it.id);
	}
	return {record, imported, unfilled, rejected, warnings};
};
