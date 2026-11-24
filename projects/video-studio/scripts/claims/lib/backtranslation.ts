/**
 * The back-translation record (scripts/backtranslate: content/<channel>/<slug>/dub/backtranslation.<lang>.json) read
 * by the claim gate and the dub validator (added 2026-11-24, VCD fix). The research "Must not say" phrases are English,
 * so they cannot match a Spanish or Portuguese script; the literal English back-translation of that script can. Every
 * current item's back-translation is scanned with the English must-not-say patterns and the English income lexicon.
 * Items made from an older translation (stale) are skipped and counted.
 */
import {existsSync} from 'node:fs';
import {join} from 'node:path';
import type {Storyboard} from '../../../src/episode/types.ts';
import {incomeHits} from './income.ts';
import {isRecord, readJson} from './load.ts';
import {scanMustNotSay, type MnsList} from './mustnotsay.ts';
import {clean, oneLine} from './text.ts';

export type BtItem = {id: string; text: string; bt: string};
export type BtRecord = {path: string; items: BtItem[]};
export type BtHit = {id: string; kind: 'must-not-say' | 'income'; phrase: string; detail: string; bt: string};

export const backtranslationPath = (dir: string, lang: string): string => join(dir, 'dub', `backtranslation.${lang}.json`);

export const loadBacktranslation = (dir: string, lang: string): BtRecord | null => {
	const path = backtranslationPath(dir, lang);
	if (!existsSync(path)) return null;
	const x = readJson(path);
	if (!isRecord(x) || !isRecord(x.items)) return null;
	const items: BtItem[] = [];
	for (const [id, v] of Object.entries(x.items)) if (isRecord(v) && typeof v.bt === 'string' && typeof v.text === 'string') items.push({id, text: v.text, bt: v.bt});
	return {path, items};
};

/** The current text at a back-translation segment id ("s02.narration", "s02.onScreen.bullets.1", "title", "ui.sources"). */
export const textAtSegment = (sb: Storyboard, id: string): string | undefined => {
	if (id === 'title') return sb.title;
	let m = /^shorts\.(.+)\.title$/.exec(id);
	if (m) return sb.shorts?.find((s) => s.id === m![1])?.title;
	m = /^thumbnails\.(.+)\.text$/.exec(id);
	if (m) return sb.thumbnails?.find((t) => t.id === m![1])?.text;
	m = /^ui\.(.+)$/.exec(id);
	if (m) {
		const v = (sb.ui as Record<string, unknown> | undefined)?.[m[1]];
		return typeof v === 'string' ? v : undefined;
	}
	m = /^([^.]+)\.narration$/.exec(id);
	if (m) return sb.scenes.find((s) => s.id === m![1])?.narration;
	m = /^([^.]+)\.onScreen\.([^.]+)(?:\.(\d+))?$/.exec(id);
	if (m) {
		const v = sb.scenes.find((s) => s.id === m![1])?.onScreen?.[m[2]];
		if (m[3] === undefined) return typeof v === 'string' ? v : undefined;
		return Array.isArray(v) ? v[Number(m[3])] : undefined;
	}
	return undefined;
};

export const scanBacktranslation = (rec: BtRecord, sb: Storyboard, mns: MnsList): {hits: BtHit[]; stale: string[]; checked: number} => {
	const hits: BtHit[] = [];
	const stale: string[] = [];
	let checked = 0;
	for (const it of rec.items) {
		const now = textAtSegment(sb, it.id);
		if (now === undefined || clean(now) !== clean(it.text)) {
			stale.push(it.id);
			continue;
		}
		checked++;
		for (const h of scanMustNotSay(it.bt, mns))
			if (h.pattern.level === 'error') hits.push({id: it.id, kind: 'must-not-say', phrase: h.pattern.phrase, detail: `research.md ${h.rule.id} (line ${h.rule.line}): ${oneLine(h.rule.text, 160)}`, bt: it.bt});
		for (const h of incomeHits(it.bt, 'en')) if (!h.negated && h.rule.level === 'error') hits.push({id: it.id, kind: 'income', phrase: h.text, detail: h.rule.label, bt: it.bt});
	}
	return {hits, stale, checked};
};
