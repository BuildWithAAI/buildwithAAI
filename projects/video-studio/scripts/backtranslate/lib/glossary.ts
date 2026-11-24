/**
 * Glossary: names that must not be translated, terms with accepted renderings, known wrong renderings and spellings
 * that break an owner rule. Loaded from scripts/backtranslate/glossary.json plus optional extra files (same format).
 */
import {readFileSync} from 'node:fs';
import {escapeRe, fold, stripAccents} from './text.ts';
import type {Finding, TargetLang} from './types.ts';

export type GlossaryTerm = {
	id: string;
	en: string;
	aliases?: string[];
	/** Match the English (and dnt) forms case-sensitively. Default: true for names (first letter upper case). */
	case?: boolean;
	/** Do not translate: the English form must appear in the translation as written. */
	dnt?: boolean;
	es?: string[];
	'pt-br'?: string[];
	wrong?: Partial<Record<TargetLang, string[]>>;
	forbid?: string[];
	status: 'approved' | 'proposed';
	note?: string;
};

export type Glossary = {terms: GlossaryTerm[]; files: string[]};

export class GlossaryError extends Error {}

const isStrArr = (x: unknown): x is string[] => Array.isArray(x) && x.every((s) => typeof s === 'string' && s.trim() !== '');

export const parseGlossary = (raw: unknown, file: string): GlossaryTerm[] => {
	const doc = raw as {terms?: unknown};
	if (!doc || typeof doc !== 'object' || !Array.isArray(doc.terms)) throw new GlossaryError(`${file}: expected {"terms": [...]}`);
	return doc.terms.map((t, i) => {
		const where = `${file}: terms[${i}]`;
		const o = t as Record<string, unknown>;
		if (!o || typeof o !== 'object') throw new GlossaryError(`${where}: not an object`);
		if (typeof o.id !== 'string' || !o.id) throw new GlossaryError(`${where}: id is required`);
		if (typeof o.en !== 'string' || !o.en.trim()) throw new GlossaryError(`${where} (${o.id}): en is required`);
		for (const k of ['aliases', 'es', 'pt-br', 'forbid'] as const) if (o[k] !== undefined && !isStrArr(o[k])) throw new GlossaryError(`${where} (${o.id}): ${k} must be a list of non-empty strings`);
		if (o.wrong !== undefined) {
			if (typeof o.wrong !== 'object' || o.wrong === null) throw new GlossaryError(`${where} (${o.id}): wrong must be {"es": [...], "pt-br": [...]}`);
			for (const [k, v] of Object.entries(o.wrong)) if ((k !== 'es' && k !== 'pt-br') || !isStrArr(v)) throw new GlossaryError(`${where} (${o.id}): wrong.${k} must be es or pt-br with a list of strings`);
		}
		if (o.status !== 'approved' && o.status !== 'proposed') throw new GlossaryError(`${where} (${o.id}): status must be "approved" or "proposed"`);
		if (!o.dnt && !o.es && !o['pt-br'] && !o.forbid && !o.wrong) throw new GlossaryError(`${where} (${o.id}): give dnt, renderings (es / pt-br), wrong or forbid`);
		return o as unknown as GlossaryTerm;
	});
};

export const DEFAULT_GLOSSARY = new URL('../glossary.json', import.meta.url).pathname;

export const loadGlossary = (extra: string[] = []): Glossary => {
	const files = [DEFAULT_GLOSSARY, ...extra];
	const byId = new Map<string, GlossaryTerm>();
	for (const f of files) {
		let raw: unknown;
		try {
			raw = JSON.parse(readFileSync(f, 'utf8'));
		} catch (e) {
			throw new GlossaryError(`${f}: ${(e as Error).message}`);
		}
		for (const t of parseGlossary(raw, f)) byId.set(t.id, t); // a later file overrides a term with the same id
	}
	return {terms: [...byId.values()], files};
};

const caseSensitive = (t: GlossaryTerm): boolean => t.case ?? /^\p{Lu}/u.test(t.en);

/** The English form (or an alias) in English text. */
const enRe = (t: GlossaryTerm): RegExp => {
	const forms = [t.en, ...(t.aliases ?? [])].sort((a, b) => b.length - a.length);
	const body = forms.map((f) => escapeRe(f).replace(/\s+/g, '\\s+') + (caseSensitive(t) ? '' : '(?:s|es)?')).join('|');
	return new RegExp(`(?<![\\p{L}\\p{N}])(?:${body})(?![\\p{L}\\p{N}])`, caseSensitive(t) ? 'u' : 'iu');
};

/** A rendering in Spanish or Portuguese text: accent- and case-insensitive, gender and number tolerant per word. */
const renderingRe = (r: string): RegExp => {
	const words = stripAccents(r).toLowerCase().split(/\s+/).filter(Boolean);
	const body = words
		.map((w) => {
			const e = escapeRe(w);
			if (/[oa]$/.test(w)) return `${escapeRe(w.slice(0, -1))}[oa]s?`;
			if (/[^aeiou]$/.test(w) && w.length > 2) return `${e}(?:s|es)?`;
			return `${e}s?`;
		})
		.join('[\\s-]+');
	return new RegExp(`(?<![\\p{L}\\p{N}])${body}(?![\\p{L}\\p{N}])`, 'u');
};

const exactRe = (s: string, cs: boolean): RegExp => new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(s).replace(/\s+/g, '\\s+')}(?![\\p{L}\\p{N}])`, cs ? 'u' : 'iu');

/**
 * Glossary findings for one segment, read on the translation itself (`source` is English, `translation` Spanish or
 * Portuguese). The back-translation is not used: a localized segment name ("El consejo de Zoo") comes back as its own
 * literal meaning ("Zoo's advice"), not as the English term.
 */
export const glossaryFindings = (glossary: Glossary, lang: TargetLang, source: string, translation: string): Finding[] => {
	const out: Finding[] = [];
	const trFold = fold(translation);
	for (const t of glossary.terms) {
		const inSource = enRe(t).test(source);
		// spelling rules (owner rules) apply wherever the form appears
		for (const bad of t.forbid ?? []) {
			const re = exactRe(bad, true);
			const inTr = re.test(translation);
			const inSrc = re.test(source);
			if (inTr || inSrc) {
				out.push({
					code: 'glossary-forbidden-spelling',
					severity: 'low',
					message: `"${bad}" breaks a naming rule: write "${t.en}"${t.note ? ` (${t.note})` : ''}.${inSrc ? ' The English source has it too: fix the source first, then the translation.' : ''}`,
					evidence: {source: inSrc ? bad : undefined, translation: inTr ? bad : undefined},
				});
			}
		}
		if (!inSource) continue;
		// known wrong renderings
		const wrongUsed = (t.wrong?.[lang] ?? []).filter((w) => renderingRe(w).test(trFold));
		if (wrongUsed.length) {
			out.push({
				code: 'glossary-wrong-rendering',
				severity: 'high',
				message: `"${t.en}" is rendered as "${wrongUsed.join('", "')}", which changes the meaning${t.note ? ` (${t.note})` : ''}.`,
				evidence: {source: t.en, translation: wrongUsed.join(', ')},
			});
		}
		// required form in the translation
		const accepted = t[lang] ?? [];
		let ok = false;
		if (t.dnt && exactRe(t.en, caseSensitive(t)).test(translation)) ok = true;
		if (!ok && accepted.some((r) => (t.dnt && caseSensitive(t) ? exactRe(r, true).test(translation) : renderingRe(r).test(trFold)))) ok = true;
		if (!ok && !wrongUsed.length) {
			const want = t.dnt ? [`"${t.en}" as written`, ...accepted.filter((a) => a !== t.en).map((a) => `"${a}"`)] : accepted.map((a) => `"${a}"`);
			if (want.length) {
				out.push({
					code: t.dnt ? 'glossary-name-changed' : 'glossary-term-missing',
					severity: t.status === 'approved' ? 'medium' : 'low',
					message: `"${t.en}" is in the English but the ${lang === 'es' ? 'Spanish' : 'Portuguese'} has none of ${want.join(' / ')}${t.status === 'proposed' ? ' (proposed glossary entry: confirm with the native reviewer)' : ''}${t.note ? `. ${t.note}` : '.'}`,
					evidence: {source: t.en},
				});
			}
		}
	}
	return out;
};
