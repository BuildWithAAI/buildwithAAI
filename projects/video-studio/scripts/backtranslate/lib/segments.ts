/**
 * Every translated string of an episode, aligned with its English source: the title, each scene's narration and
 * on-screen fields, Short titles, thumbnail texts, UI and show labels, and the "developing" label. Channel-copy files
 * are split into paragraphs.
 *
 * Narration markup follows the episode engine (src/episode/markup.ts, the renderer's own parser): {display|spoken}
 * becomes its display side (what captions show), and [src:id] tags stay in place so the check can see which claim
 * each source backs.
 */
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {parseMarkup} from '../../../src/episode/markup.ts';
import {EN_UI} from '../../../src/episode/i18n/ui.ts';
import {copyBlocks, type CopyTarget} from './load.ts';
import type {MarkupPair, Segment, SegmentKind, TargetLang} from './types.ts';

/** onScreen keys that are not shown to the viewer (cue words pick a word of the narration). */
export const NON_DISPLAY_KEYS = new Set(['cues', 'badgerCue']);

export const segmentHash = (lang: TargetLang, id: string, text: string): string => createHash('sha256').update(`${lang}\n${id}\n${text}`, 'utf8').digest('hex').slice(0, 16);

export type NarrationView = {display: string; pairs: MarkupPair[]; tags: string[]; error?: string};

/** Display text with [src:id] tags kept, the {display|spoken} pairs and the tag ids, in order. */
export const narrationView = (raw: string): NarrationView => {
	try {
		const segs = parseMarkup(raw);
		const pairs: MarkupPair[] = [];
		const tags: string[] = [];
		let out = '';
		let pendingTags: string[] = [];
		const flushTags = () => {
			if (pendingTags.length) out += `[src:${pendingTags.join(',')}]`;
			pendingTags = [];
		};
		for (const s of segs) {
			if (s.kind === 'src') {
				pendingTags.push(s.id);
				tags.push(s.id);
				continue;
			}
			flushTags();
			if (s.kind === 'text') out += s.text;
			else {
				out += s.display;
				pairs.push({display: s.display, spoken: s.spoken});
			}
		}
		flushTags();
		return {display: out.replace(/[ \t]{2,}/g, ' ').trim(), pairs, tags};
	} catch (e) {
		return {display: raw, pairs: [], tags: [], error: (e as Error).message};
	}
};

type Raw = Record<string, unknown>;
const str = (x: unknown): string | null => (typeof x === 'string' ? x : null);

const SCENE_NAMES: Record<string, string> = {hook: 'hook', talk: 'talk', chart: 'chart', steps: 'steps', quote: 'quote', cta: 'call-to-action', endscreen: 'end-screen'};

const FIELD_NAMES: Record<string, string> = {
	title: 'title',
	kicker: 'kicker (small label above the title)',
	subtitle: 'subtitle',
	bullets: 'bullet',
	steps: 'step',
	quote: 'quote (kinetic text, revealed word by word as Zoo says it)',
	attribution: 'quote attribution',
	source: 'quote source line',
	pair: 'chart ticker pair',
	label: 'chart label',
	button: 'button label',
	disclosure: 'disclosure (legal: shown for the whole scene and also said aloud)',
	lowerThird: 'lower third',
	nodes: 'diagram node label',
	links: 'diagram arrow label',
	flag: "Badger's red flag card",
	fix: "Zoo's fix card",
	detail: 'fix card detail line',
	how: 'Scam of the Week: how it works',
	tell: 'Scam of the Week: the warning sign',
	wrong: 'correction: what we said',
	correct: 'correction: the correct fact',
	date: 'date line',
	ref: 'correction reference line',
	loss: 'Rekt Meter: reported loss',
	lossAlt: 'Rekt Meter: second reported figure',
	developing: 'DEVELOPING label',
	explainer: 'end-screen explainer title',
};

export type SegmentSet = {segments: Segment[]; notes: string[]};

/** English defaults for the show's labels (src/show/ui.ts), loaded only when a storyboard has showUi. */
const showDefaults = async (): Promise<Record<string, string>> => {
	try {
		const mod = (await import('../../../src/show/ui.ts')) as {EN_SHOW_UI?: Record<string, string>};
		return mod.EN_SHOW_UI ?? {};
	} catch {
		return {};
	}
};

const developingLabel = (sb: Raw): string | null => {
	const news = sb.news as Raw | undefined;
	const d = news?.developing ?? sb.developing;
	if (typeof d === 'string') return d;
	if (d && typeof d === 'object' && typeof (d as Raw).label === 'string') return (d as Raw).label as string;
	return null;
};

export const storyboardSegments = async (source: Raw, translation: Raw, lang: TargetLang): Promise<SegmentSet> => {
	const segments: Segment[] = [];
	const notes: string[] = [];
	let order = 0;
	const push = (s: Omit<Segment, 'order' | 'hash' | 'source' | 'translation'> & {source?: string | null; translation?: string | null}) => {
		const seg: Segment = {
			...s,
			source: s.source !== undefined ? s.source : s.sourceRaw,
			translation: s.translation !== undefined ? s.translation : s.translationRaw,
			hash: s.translationRaw === null ? null : segmentHash(lang, s.id, s.translationRaw),
			order: order++,
		};
		// strings that are empty on both sides (silent beats) are not segments
		if (!(seg.sourceRaw ?? '').trim() && !(seg.translationRaw ?? '').trim()) return;
		segments.push(seg);
	};
	const plain = (id: string, kind: SegmentKind, context: string, s: string | null, t: string | null, extra: Partial<Segment> = {}) =>
		push({id, kind, context, sourceRaw: s, translationRaw: t, ...extra});

	plain('title', 'title', 'Episode title (the YouTube title draft)', str(source.title), str(translation.title));

	const sScenes = (source.scenes as Raw[]).filter((x) => x && typeof x === 'object');
	const tScenes = (translation.scenes as Raw[]).filter((x) => x && typeof x === 'object');
	const tById = new Map(tScenes.map((s) => [String(s.id), s]));
	const seen = new Set<string>();
	const sceneList: Array<{id: string; s: Raw | null; t: Raw | null}> = sScenes.map((s) => ({id: String(s.id), s, t: tById.get(String(s.id)) ?? null}));
	for (const t of tScenes) if (!sScenes.some((s) => String(s.id) === String(t.id))) sceneList.push({id: String(t.id), s: null, t});
	if (sScenes.length !== tScenes.length || sScenes.some((s, i) => String(s.id) !== String(tScenes[i]?.id)))
		notes.push(`Scene lists differ: English ${sScenes.map((s) => String(s.id)).join(', ')}; translation ${tScenes.map((s) => String(s.id)).join(', ')}.`);

	for (const {id: sid, s, t} of sceneList) {
		if (seen.has(sid)) continue;
		seen.add(sid);
		const type = String((s ?? t)?.type ?? 'scene');
		const where = `${SCENE_NAMES[type] ?? type} scene ${sid}`;
		const sNar = str(s?.narration);
		const tNar = str(t?.narration);
		if ((sNar ?? '').trim() || (tNar ?? '').trim()) {
			const sv = sNar !== null ? narrationView(sNar) : null;
			const tv = tNar !== null ? narrationView(tNar) : null;
			if (sv?.error) notes.push(`${sid}.narration (English): markup error: ${sv.error}`);
			if (tv?.error) notes.push(`${sid}.narration (translation): markup error: ${tv.error}`);
			push({
				id: `${sid}.narration`,
				kind: 'narration',
				context: `Narration, ${where}: spoken by Zoo; captions show the same words`,
				sceneId: sid,
				sceneType: type,
				sourceRaw: sNar,
				translationRaw: tNar,
				source: sv ? sv.display : null,
				translation: tv ? tv.display : null,
				sourcePairs: sv?.pairs,
				translationPairs: tv?.pairs,
				sourceTags: sv?.tags,
				translationTags: tv?.tags,
			});
		}
		const sOn = (s?.onScreen ?? {}) as Raw;
		const tOn = (t?.onScreen ?? {}) as Raw;
		const keys = [...Object.keys(sOn), ...Object.keys(tOn).filter((k) => !(k in sOn))].filter((k) => !NON_DISPLAY_KEYS.has(k));
		for (const key of keys) {
			const a = sOn[key];
			const b = tOn[key];
			const field = FIELD_NAMES[key] ?? key;
			if (Array.isArray(a) || Array.isArray(b)) {
				const aa = Array.isArray(a) ? a : [];
				const bb = Array.isArray(b) ? b : [];
				const n = Math.max(aa.length, bb.length);
				if (aa.length !== bb.length) notes.push(`${sid}.onScreen.${key}: the English has ${aa.length} items, the translation ${bb.length}.`);
				for (let i = 0; i < n; i++) {
					const label = key === 'lowerThird' ? (i === 0 ? 'lower third: name' : 'lower third: role') : `${field} ${i + 1} of ${n}`;
					plain(`${sid}.onScreen.${key}.${i}`, 'onScreen', `On-screen ${label}, ${where}`, str(aa[i]), str(bb[i]), {sceneId: sid, sceneType: type});
				}
			} else {
				plain(`${sid}.onScreen.${key}`, 'onScreen', `On-screen ${field}, ${where}`, str(a), str(b), {sceneId: sid, sceneType: type});
			}
		}
	}

	// Short titles
	const sShorts = (Array.isArray(source.shorts) ? source.shorts : []) as Raw[];
	const tShorts = (Array.isArray(translation.shorts) ? translation.shorts : []) as Raw[];
	for (const sh of sShorts) {
		const tt = tShorts.find((x) => x.id === sh.id);
		plain(`shorts.${String(sh.id)}.title`, 'shortTitle', `Title of the Short "${String(sh.id)}" (YouTube title draft)`, str(sh.title), str(tt?.title));
	}
	// thumbnails (a translation carries only {id, text})
	const sThumbs = (Array.isArray(source.thumbnails) ? source.thumbnails : []) as Raw[];
	const tThumbs = (Array.isArray(translation.thumbnails) ? translation.thumbnails : []) as Raw[];
	for (const th of sThumbs) {
		const tt = tThumbs.find((x) => x.id === th.id);
		plain(`thumbnails.${String(th.id)}.text`, 'thumbnail', `Thumbnail ${String(th.id)} text (big ALL CAPS words on the image)`, str(th.text), str(tt?.text));
	}
	// UI labels: the English side is the storyboard's own label or the engine's default
	const sUi = (source.ui ?? {}) as Raw;
	const tUi = (translation.ui ?? {}) as Raw;
	const enUi = EN_UI as unknown as Record<string, string>;
	for (const key of [...new Set([...Object.keys(sUi), ...Object.keys(tUi)])]) {
		const own = str(sUi[key]);
		plain(`ui.${key}`, 'ui', `UI label "${key}" (small fixed text in the render)`, own ?? enUi[key] ?? null, str(tUi[key]), {sourceIsDefault: own === null});
	}
	const sShow = (source.showUi ?? {}) as Raw;
	const tShow = (translation.showUi ?? {}) as Raw;
	if (Object.keys(sShow).length || Object.keys(tShow).length) {
		const defaults = await showDefaults();
		for (const key of [...new Set([...Object.keys(sShow), ...Object.keys(tShow)])]) {
			const own = str(sShow[key]);
			plain(`showUi.${key}`, 'showUi', `Show label "${key}" (fixed text on the show set)`, own ?? defaults[key] ?? null, str(tShow[key]), {sourceIsDefault: own === null});
		}
	}
	const sDev = developingLabel(source);
	const tDev = developingLabel(translation);
	if (sDev !== null || tDev !== null) plain('news.developing', 'news', 'DEVELOPING badge label (shown on every frame of a developing story)', sDev, tDev);
	return {segments, notes};
};

/** Channel copy: each fenced block "id" with a translation block "id-<lang>", split into paragraphs. */
export const copySegments = (t: CopyTarget, lang: TargetLang): SegmentSet => {
	const blocks = copyBlocks(readFileSync(t.file, 'utf8'));
	const segments: Segment[] = [];
	const notes: string[] = [];
	let order = 0;
	const langIds = new Set(['es', 'pt-br', 'hi', 'it', 'zh', 'ja', 'fr']);
	for (const [id, text] of blocks) {
		const suffix = /-(es|pt-br|hi|it|zh|ja|fr)$/.exec(id);
		if (suffix && langIds.has(suffix[1])) continue;
		const tr = blocks.get(`${id}-${lang}`);
		if (tr === undefined) {
			notes.push(`Block "${id}" has no ${lang} translation (no block id=${id}-${lang}); not checked.`);
			continue;
		}
		const sp = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
		const tp = tr.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
		if (sp.length !== tp.length) notes.push(`Block "${id}": the English has ${sp.length} paragraphs, the translation ${tp.length}; paragraphs are paired in order.`);
		const n = Math.max(sp.length, tp.length);
		for (let i = 0; i < n; i++) {
			const sid = `copy.${id}.p${i + 1}`;
			const tRaw = tp[i] ?? null;
			segments.push({
				id: sid,
				kind: 'copy',
				context: `Channel copy "${id}", paragraph ${i + 1} of ${n}`,
				sourceRaw: sp[i] ?? null,
				translationRaw: tRaw,
				source: sp[i] ?? null,
				translation: tRaw,
				hash: tRaw === null ? null : segmentHash(lang, sid, tRaw),
				order: order++,
			});
		}
	}
	return {segments, notes};
};
