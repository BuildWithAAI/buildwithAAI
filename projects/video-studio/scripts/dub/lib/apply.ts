/**
 * import: a filled translation sheet + the source storyboard -> storyboard.<lang>.json (pure). Everything that is not
 * text (scene ids, types, characters, charts, sources, offers, shorts' scenes, thumbnail designs) is copied from the
 * source; every text comes from the sheet. The result is marked {status: 'machine', method, reviewed: false}: renders
 * carry the "machine translation: needs native review" badge until the owner records a native review.
 */
import type {Lang, Storyboard} from '../../../src/episode/types.ts';
import {isRecord} from '../../claims/lib/load.ts';
import {isLang} from '../../claims/lib/text.ts';
import {buildSheet, SHEET_KIND, type Sheet, type SheetItem} from './sheet.ts';

export type ApplyResult = {storyboard: Storyboard | null; problems: string[]};

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

/** Shape check of a sheet read from disk. */
export const sheetProblems = (x: unknown): string[] => {
	if (!isRecord(x)) return ['the sheet must be a JSON object'];
	const out: string[] = [];
	if (x.kind !== SHEET_KIND || x.version !== 1) out.push(`not a translation sheet (kind "${SHEET_KIND}", version 1)`);
	if (!isLang(x.targetLang)) out.push('targetLang is missing or unsupported');
	if (x.method !== 'machine' && x.method !== 'human') out.push('"method" must be "machine" (an agent or MT translated it) or "human" (a person did)');
	if (!Array.isArray(x.items)) out.push('items must be an array');
	if (typeof x.sourceSha256 !== 'string') out.push('sourceSha256 is missing');
	return out;
};

/** The current source text at an item's address, or undefined when the address no longer exists. */
const sourceAt = (sb: Storyboard, it: SheetItem): string | undefined => {
	if (it.kind === 'title') return sb.title;
	if (it.kind === 'short-title') return sb.shorts?.find((s) => s.id === it.ref)?.title;
	if (it.kind === 'thumbnail') return sb.thumbnails?.find((t) => t.id === it.ref)?.text;
	if (it.kind === 'ui') return it.source; // ui labels may be English defaults that are not in the source file
	if (it.kind === 'source-title') return sb.sources?.find((x) => x.id === it.ref)?.title;
	const sc = sb.scenes.find((s) => s.id === it.scene);
	if (!sc) return undefined;
	if (it.kind === 'narration') return sc.narration;
	if (it.kind === 'waiver') return sc.claimWaivers?.[it.index ?? -1]?.match;
	const v = sc.onScreen?.[it.field ?? ''];
	if (it.index === undefined) return typeof v === 'string' ? v : undefined;
	return Array.isArray(v) ? v[it.index] : undefined;
};

export const applySheet = (src: Storyboard, sheet: Sheet, lang: Lang): ApplyResult => {
	const problems: string[] = [];
	if (sheet.targetLang !== lang) problems.push(`the sheet is for "${sheet.targetLang}", not "${lang}"`);
	const out = clone(src);
	out.lang = lang;
	const ui: Record<string, string> = {};
	const seen = new Set<string>();
	for (const it of sheet.items) {
		if (seen.has(it.key)) problems.push(`${it.key}: duplicate item`);
		seen.add(it.key);
		const tr = typeof it.translation === 'string' ? it.translation.trim() : '';
		if (!tr) {
			problems.push(`${it.key}: no translation`);
			continue;
		}
		const now = sourceAt(src, it);
		if (now === undefined) {
			problems.push(`${it.key}: no longer exists in the source storyboard (re-run prepare)`);
			continue;
		}
		if (now !== it.source) {
			problems.push(`${it.key}: the source text changed since prepare (re-run prepare; unchanged translations carry over)`);
			continue;
		}
		switch (it.kind) {
			case 'title':
				out.title = tr;
				break;
			case 'short-title': {
				const s = out.shorts?.find((x) => x.id === it.ref);
				if (s) s.title = tr;
				break;
			}
			case 'thumbnail': {
				const t = out.thumbnails?.find((x) => x.id === it.ref);
				if (t) t.text = tr;
				break;
			}
			case 'ui':
				ui[it.ref ?? ''] = tr;
				break;
			case 'source-title': {
				const so = out.sources?.find((x) => x.id === it.ref);
				if (so) so.title = tr;
				break;
			}
			default: {
				const sc = out.scenes.find((x) => x.id === it.scene);
				if (!sc) break;
				if (it.kind === 'narration') sc.narration = tr;
				else if (it.kind === 'waiver') {
					const w = sc.claimWaivers?.[it.index ?? -1];
					if (w) w.match = tr;
				} else if (sc.onScreen) {
					const field = it.field ?? '';
					const v = sc.onScreen[field];
					if (it.index === undefined) sc.onScreen[field] = tr;
					else if (Array.isArray(v)) v[it.index] = tr;
				}
			}
		}
	}
	// every source string must have an item (a sheet edited by hand could have lost some)
	const expected = buildSheet(src, {targetLang: lang, sourceFile: '', sourceSha256: '', preparedAt: '', method: sheet.method}).items.map((it) => it.key);
	for (const k of expected) if (!seen.has(k)) problems.push(`${k}: missing from the sheet (re-run prepare)`);
	if (Object.keys(ui).length) out.ui = ui as Storyboard['ui'];
	else delete out.ui;
	out.translation = {status: 'machine', method: sheet.method, reviewed: false};
	return {storyboard: problems.length ? null : out, problems};
};
