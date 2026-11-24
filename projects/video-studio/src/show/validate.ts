/**
 * Show validator (pure). Runs in calculateMetadata before frame 0: every error is listed, then the render stops.
 * It does NOT replace the claim gate (scripts/news), which checks facts against stored source excerpts, names and
 * how-tos. This is the renderer's own refusal to draw something wrong:
 *  - news, not fiction; every cited source exists and is verified;
 *  - each segment has its copy; the Rekt Meter's figure matches its display text and names its source;
 *  - diagrams are concept-level (no code, addresses, links or numbered steps);
 *  - the outro is last; dubbed storyboards carry every UI label they show;
 *  - the timeline matches the storyboard and uses Zoo's voice (im_nicola, owner decision 2026-11-24).
 */
import type {Issue, ShowScene, ShowStoryboard, ShowUiLabels, Timeline} from './types.ts';
import {BADGER_REACTIONS, DIAGRAM_KINDS} from './types.ts';
import {list, onScreenStrings, SEGMENT_SPECS, segmentOf, segmentTag, str} from './segments.ts';
import {lossAgrees} from './money.ts';
import {conceptProblems} from './concept.ts';
import {citedSourceIds, sceneSourceIds} from './sources.ts';
import {parseMarkup, MarkupError} from '../episode/markup.ts';
import {EN_SHOW_UI} from './ui.ts';

export const SHOW_CHANNELS = ['zoora-security', '_dev'] as const;
export const ZOO_VOICE = 'im_nicola';
export const LANGS = ['en', 'es', 'pt-br', 'hi', 'it', 'zh', 'ja'] as const;
export const NODE_MAX_CHARS = 32;
export const LINK_MAX_CHARS = 28;
export const DIAGRAM_NODES = {min: 2, max: 5} as const;
/** End screens: YouTube shows them in the last 5-20 s of a video (docs/research/platform-facts-2026-11-23.md). */
export const END_SCREEN_SEC = {min: 5, max: 20} as const;

const err = (code: string, where: string, msg: string): Issue => ({level: 'error', code, where, msg});
const warn = (code: string, where: string, msg: string): Issue => ({level: 'warning', code, where, msg});

export type ShowInput = {channel: unknown; slug: unknown; lang: unknown; shortId?: unknown};

export const validateProps = (p: ShowInput, short: boolean): Issue[] => {
	const out: Issue[] = [];
	if (typeof p.channel !== 'string' || !(SHOW_CHANNELS as readonly string[]).includes(p.channel))
		out.push(err('props.channel', 'props', `channel must be one of ${SHOW_CHANNELS.join(', ')} (got ${JSON.stringify(p.channel)}); the show format is for the security channel`));
	if (typeof p.slug !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(p.slug)) out.push(err('props.slug', 'props', `slug must be a lowercase slug (got ${JSON.stringify(p.slug)})`));
	if (typeof p.lang !== 'string' || !(LANGS as readonly string[]).includes(p.lang)) out.push(err('props.lang', 'props', `lang must be one of ${LANGS.join(', ')} (got ${JSON.stringify(p.lang)})`));
	if (!short && p.shortId !== undefined) out.push(warn('props.shortId', 'props', 'shortId is ignored by ShowEpisode'));
	return out;
};

/** The developing label of the whole video (news.developing, or its alias developing), or null. */
export const developingOf = (sb: Pick<ShowStoryboard, 'news' | 'developing'>): {label: string | null; asOf: string | null} | null => {
	const d = sb.news?.developing ?? sb.developing;
	if (d === undefined || d === false || d === null) return null;
	if (d === true) return {label: null, asOf: null};
	if (typeof d === 'string') return {label: d.trim() || null, asOf: null};
	return {label: d.label?.trim() || null, asOf: d.asOf?.trim() || null};
};

/** UI labels a storyboard's render shows (so a dubbed storyboard must translate them). */
export const neededLabels = (sb: ShowStoryboard): Array<keyof ShowUiLabels> => {
	const need = new Set<keyof ShowUiLabels>();
	const dev = developingOf(sb);
	if (dev) {
		if (!dev.label) need.add('developing');
		if (dev.asOf) need.add('asOf');
	}
	for (const sc of sb.scenes) {
		let seg;
		try {
			seg = segmentOf(sc);
		} catch {
			continue;
		}
		const tag = segmentTag(seg, sc);
		if (tag) need.add(tag);
		if (sceneSourceIds(sc).length && seg !== 'sources') need.add('source');
		if (seg === 'headline') {
			if (sc.rekt) {
				need.add('reportedBy');
				need.add('logScale');
			}
			if (sc.rekt?.alt) need.add('alsoReported');
		}
		if (seg === 'howItWorked') {
			need.add('conceptOnly');
			if (!str(sc, 'title')) need.add('howItWorked');
		}
		if (seg === 'scamOfTheWeek') {
			if (str(sc, 'how')) need.add('howItWorks');
			if (str(sc, 'tell')) need.add('tell');
			if (str(sc, 'fix')) need.add('fix');
		}
		if (seg === 'correction') {
			need.add('correct');
			if (str(sc, 'wrong')) need.add('weSaid');
		}
		if (seg === 'sources') {
			need.add('linksBelow');
			need.add('accessed');
		}
		if (seg === 'outroEndScreen') ['explainer', 'latest', 'subscribe', 'linkedBelow'].forEach((k) => need.add(k as keyof ShowUiLabels));
	}
	return [...need];
};

const validateScene = (sb: ShowStoryboard, sc: ShowScene, k: number, last: boolean, byId: Map<string, ShowStoryboard['sources'][number]>, out: Issue[]) => {
	const at = `scenes[${k}] ${String(sc.id)}`;
	let seg;
	try {
		seg = segmentOf(sc);
	} catch (e) {
		out.push(err('scene.segment', at, (e as Error).message));
		return;
	}
	if (typeof sc.narration !== 'string') out.push(err('scene.narration', at, 'narration must be a string (empty for a silent beat)'));
	else {
		try {
			parseMarkup(sc.narration);
		} catch (e) {
			out.push(err('scene.markup', at, e instanceof MarkupError ? e.message : String(e)));
		}
	}
	if (sc.onScreen !== undefined && (typeof sc.onScreen !== 'object' || sc.onScreen === null || Array.isArray(sc.onScreen))) out.push(err('scene.onScreen', at, 'onScreen must be an object of strings / string lists'));
	const spec = SEGMENT_SPECS[seg];
	for (const key of spec.required) {
		const v = sc.onScreen?.[key];
		const ok = spec.lists?.includes(key) ? Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === 'string' && x.trim()) : typeof v === 'string' && v.trim().length > 0;
		if (!ok) out.push(err('segment.required', at, `segment ${seg} needs onScreen.${key}${spec.lists?.includes(key) ? ' (a non-empty list of strings)' : ''}`));
	}
	for (const key of spec.lists ?? []) {
		const v = sc.onScreen?.[key];
		if (v !== undefined && !(Array.isArray(v) && v.every((x) => typeof x === 'string'))) out.push(err('segment.list', at, `onScreen.${key} must be a list of strings`));
	}
	// sources cited by this scene
	for (const id of sceneSourceIds(sc)) {
		const s = byId.get(id);
		if (!s) out.push(err('source.unknown', at, `cites source "${id}", which is not in storyboard.sources`));
		else if (s.status !== 'verified') out.push(err('source.unverified', at, `cites source "${id}" with status "${String(s.status)}"; only verified sources go on air (accuracy first)`));
	}
	// concept-level text, everywhere on screen
	for (const {key, value} of onScreenStrings(sc)) {
		const diagramLabel = seg === 'howItWorked' && /^(?:nodes|links)\[/.test(key);
		for (const p of conceptProblems(value, {steps: diagramLabel})) out.push(err(`concept.${p.code}`, `${at} onScreen.${key}`, `shows ${p.msg} ("${p.match}"); keep mechanisms at concept level`));
	}
	// Badger's reactions
	const reaction = sc.badger?.reaction;
	if (reaction !== undefined && !['neutral', 'happy', 'worried', 'shocked', 'judge', 'lookUp'].includes(reaction)) out.push(err('badger.reaction', at, `unknown badger.reaction "${String(reaction)}"`));
	(sc.badgerBeats ?? []).forEach((b, i) => {
		if (!b || !(BADGER_REACTIONS as readonly string[]).includes(b.reaction)) out.push(err('badgerBeats.reaction', `${at} badgerBeats[${i}]`, `reaction must be one of ${BADGER_REACTIONS.join(', ')}`));
		const a = b?.after;
		if (a !== undefined && !(a === 'end' || (typeof a === 'number' && Number.isInteger(a) && a >= 0) || (typeof a === 'string' && a.trim())))
			out.push(err('badgerBeats.after', `${at} badgerBeats[${i}]`, "after must be 'end', a line index (0, 1, ...) or a cue word"));
		if (b?.hold !== undefined && !(Number.isInteger(b.hold) && b.hold >= 12 && b.hold <= 150)) out.push(err('badgerBeats.hold', `${at} badgerBeats[${i}]`, 'hold must be a whole number of frames, 12-150'));
	});
	// segment specifics
	if (seg === 'headline') {
		const loss = str(sc, 'loss');
		const r = sc.rekt;
		if (loss && !r) out.push(err('rekt.missing', at, 'onScreen.loss needs scene.rekt {usd, source}: the meter names who reported the figure'));
		if (r) {
			if (!loss) out.push(err('rekt.display', at, 'scene.rekt needs onScreen.loss, the reported figure as the source states it (the claim gate checks that text)'));
			if (!(typeof r.usd === 'number' && Number.isFinite(r.usd) && r.usd > 0)) out.push(err('rekt.usd', at, 'rekt.usd must be a positive number of USD'));
			if (typeof r.source !== 'string' || !r.source) out.push(err('rekt.source', at, 'rekt.source must name the storyboard source that reports the figure'));
			if (loss && typeof r.usd === 'number' && r.usd > 0) {
				const agrees = lossAgrees(loss, r.usd);
				if (agrees === false) out.push(err('rekt.mismatch', at, `onScreen.loss "${loss}" does not match rekt.usd ${r.usd} (within 5%)`));
				if (agrees === null) out.push(warn('rekt.unchecked', at, `onScreen.loss "${loss}" could not be read as a number; its match with rekt.usd was not machine-checked`));
			}
			if (r.alt) {
				const alt = str(sc, 'lossAlt');
				if (!alt) out.push(err('rekt.altDisplay', at, 'rekt.alt needs onScreen.lossAlt (the second outlet\'s figure as it states it)'));
				if (!(typeof r.alt.usd === 'number' && r.alt.usd > 0)) out.push(err('rekt.altUsd', at, 'rekt.alt.usd must be a positive number of USD'));
				else if (alt) {
					const ok = lossAgrees(alt, r.alt.usd);
					if (ok === false) out.push(err('rekt.altMismatch', at, `onScreen.lossAlt "${alt}" does not match rekt.alt.usd ${r.alt.usd}`));
				}
				if (r.alt.source === r.source) out.push(err('rekt.altSameSource', at, 'rekt.alt must come from a different outlet than rekt.source'));
				if (r.alt.usd === r.usd) out.push(warn('rekt.altSame', at, 'rekt.alt reports the same figure; drop it'));
			}
		} else if (str(sc, 'lossAlt')) out.push(err('rekt.altOrphan', at, 'onScreen.lossAlt without scene.rekt.alt'));
	}
	if (seg === 'howItWorked') {
		const kinds = sc.diagram?.nodes;
		const labels = list(sc, 'nodes');
		const links = sc.onScreen?.links;
		if (!Array.isArray(kinds) || !kinds.length) out.push(err('diagram.nodes', at, 'howItWorked needs scene.diagram.nodes: the kind of each node'));
		else {
			kinds.forEach((kd, i) => {
				if (!(DIAGRAM_KINDS as readonly string[]).includes(kd)) out.push(err('diagram.kind', `${at} diagram.nodes[${i}]`, `unknown kind "${String(kd)}" (one of: ${DIAGRAM_KINDS.join(', ')})`));
			});
			if (kinds.length < DIAGRAM_NODES.min || kinds.length > DIAGRAM_NODES.max) out.push(err('diagram.size', at, `a diagram has ${DIAGRAM_NODES.min}-${DIAGRAM_NODES.max} nodes (got ${kinds.length}); a concept, not a walkthrough`));
			if (labels.length !== kinds.length) out.push(err('diagram.labels', at, `onScreen.nodes has ${labels.length} labels for ${kinds.length} nodes`));
		}
		labels.forEach((l, i) => {
			if (l.length > NODE_MAX_CHARS) out.push(err('diagram.labelLength', `${at} onScreen.nodes[${i}]`, `node label is ${l.length} characters; keep it to ${NODE_MAX_CHARS}`));
		});
		if (links !== undefined) {
			const ls = Array.isArray(links) ? links : [];
			if (ls.length !== Math.max(0, labels.length - 1)) out.push(err('diagram.links', at, `onScreen.links needs ${Math.max(0, labels.length - 1)} labels (one per arrow; "" for none), got ${ls.length}`));
			ls.forEach((l, i) => {
				if (typeof l === 'string' && l.length > LINK_MAX_CHARS) out.push(err('diagram.linkLength', `${at} onScreen.links[${i}]`, `arrow label is ${l.length} characters; keep it to ${LINK_MAX_CHARS}`));
			});
		}
	}
	if (seg === 'outroEndScreen' && !last) out.push(err('outro.notLast', at, 'outroEndScreen must be the last scene (its end-screen zones need the final seconds)'));
	if (seg === 'beat' && typeof sc.narration === 'string' && sc.narration.trim() && !sc.minDurationSec) out.push(warn('beat.narration', at, 'a beat scene is normally silent (empty narration + minDurationSec about 1.2)'));
	if (seg === 'beat' && typeof sc.narration === 'string' && !sc.narration.trim() && !(typeof sc.minDurationSec === 'number' && sc.minDurationSec >= 0.8))
		out.push(err('beat.length', at, 'a silent beat needs minDurationSec of at least 0.8 (the voice step makes it that long)'));
};

export const validateShowStoryboard = (sb: ShowStoryboard, o: {channel: string; slug: string; lang: string; short: boolean; shortId?: string}): Issue[] => {
	const out: Issue[] = [];
	if (!sb || typeof sb !== 'object') return [err('storyboard', 'storyboard', 'not an object')];
	if (sb.version !== 1) out.push(err('storyboard.version', 'storyboard', `version must be 1 (got ${String(sb.version)})`));
	if (sb.channel !== o.channel) out.push(err('storyboard.channel', 'storyboard', `channel is "${sb.channel}", expected "${o.channel}"`));
	if (sb.slug !== o.slug) out.push(err('storyboard.slug', 'storyboard', `slug is "${sb.slug}", expected "${o.slug}"`));
	if (sb.lang !== o.lang) out.push(err('storyboard.lang', 'storyboard', `lang is "${sb.lang}", expected "${o.lang}"`));
	if (sb.fiction !== false) out.push(err('storyboard.fiction', 'storyboard', 'the security show is news: fiction must be false'));
	if (!Array.isArray(sb.scenes) || !sb.scenes.length) return [...out, err('storyboard.scenes', 'storyboard', 'no scenes')];
	if (!Array.isArray(sb.sources)) out.push(err('storyboard.sources', 'storyboard', 'sources must be a list'));
	const ids = new Set<string>();
	for (const sc of sb.scenes) {
		if (typeof sc.id !== 'string' || !sc.id) out.push(err('scene.id', 'storyboard', 'every scene needs an id'));
		else if (ids.has(sc.id)) out.push(err('scene.duplicate', sc.id, 'duplicate scene id'));
		ids.add(sc.id);
	}
	const byId = new Map((sb.sources ?? []).map((s) => [s.id, s]));
	sb.scenes.forEach((sc, k) => validateScene(sb, sc, k, k === sb.scenes.length - 1, byId, out));
	if (sb.scenes.some((sc) => sc.segment === 'sources') && !citedSourceIds(sb).length) out.push(err('sources.empty', 'storyboard', 'a sources segment needs cited sources'));
	for (const s of sb.sources ?? []) {
		if (typeof s.url !== 'string' || !/^https?:\/\//.test(s.url)) out.push(err('source.url', `sources ${s.id}`, 'url must be http(s)'));
		if (typeof s.accessed !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(s.accessed)) out.push(err('source.accessed', `sources ${s.id}`, 'accessed must be a YYYY-MM-DD date'));
	}
	const dev = developingOf(sb);
	if (dev?.asOf && !/^\d{4}-\d{2}-\d{2}/.test(dev.asOf)) out.push(err('developing.asOf', 'storyboard.news.developing', 'asOf must be an ISO date or date-time'));
	// a dubbed storyboard carries its own UI labels
	if (sb.lang !== 'en') {
		const missing = neededLabels(sb).filter((k) => !(typeof sb.showUi?.[k] === 'string' && (sb.showUi[k] as string).trim()));
		if (missing.length) out.push(err('showUi.missing', 'storyboard.showUi', `lang ${sb.lang} must translate: ${missing.map((k) => `${k} (en: "${EN_SHOW_UI[k]}")`).join(', ')}`));
	}
	if (o.short) {
		const id = o.shortId;
		const short = (sb.shorts ?? []).find((x) => x.id === id);
		if (!id) out.push(err('short.none', 'storyboard.shorts', 'ShowShort needs storyboard.shorts (or a shortId)'));
		else if (!short) out.push(err('short.unknown', 'storyboard.shorts', `no short "${id}"`));
		else
			for (const sid of short.sceneIds) {
				if (!ids.has(sid)) out.push(err('short.scene', `shorts ${id}`, `scene "${sid}" does not exist`));
			}
	}
	return out;
};

/** The timeline must be the voice step's output for exactly this storyboard. */
export const validateShowTimeline = (tl: Timeline, sb: ShowStoryboard, fps: number, o: {dev: boolean}): Issue[] => {
	const out: Issue[] = [];
	if (!tl || typeof tl !== 'object') return [err('timeline', 'timeline', 'not an object')];
	if (tl.version !== 1) out.push(err('timeline.version', 'timeline', `version must be 1 (got ${String(tl.version)})`));
	if (tl.fps !== fps) out.push(err('timeline.fps', 'timeline', `fps is ${tl.fps}, the show renders at ${fps}`));
	if (tl.lang !== sb.lang) out.push(err('timeline.lang', 'timeline', `timeline lang ${tl.lang} != storyboard lang ${sb.lang}`));
	if (tl.mock && !o.dev) out.push(err('timeline.mock', 'timeline', 'a mock timeline may only render dev fixtures (it is silent and not lip-synced)'));
	if (!tl.mock && tl.voice !== ZOO_VOICE) out.push((o.dev ? warn : err)('timeline.voice', 'timeline', `voice is "${tl.voice}"; Zoo's voice is ${ZOO_VOICE} in every language (owner decision 2026-11-24). Re-run the voice step with --voice ${ZOO_VOICE}`));
	if (!Array.isArray(tl.scenes) || tl.scenes.length !== sb.scenes.length) {
		out.push(err('timeline.scenes', 'timeline', `timeline has ${tl.scenes?.length ?? 0} scenes, storyboard has ${sb.scenes.length}; re-run the voice step`));
		return out;
	}
	let expect = 0;
	tl.scenes.forEach((s, k) => {
		const at = `timeline.scenes[${k}] ${s.id}`;
		if (s.id !== sb.scenes[k].id) out.push(err('timeline.order', at, `expected scene "${sb.scenes[k].id}"`));
		if (!Number.isInteger(s.startMs) || s.startMs !== expect) out.push(err('timeline.start', at, `startMs ${s.startMs}, expected ${expect} (cumulative)`));
		if (!(s.durationMs > 0) || (s.durationMs * fps) % 1000 !== 0) out.push(err('timeline.duration', at, `durationMs ${s.durationMs} is not a positive whole number of frames at ${fps} fps`));
		const frames = Math.round((s.durationMs * fps) / 1000);
		if (!Array.isArray(s.mouth) || s.mouth.length !== frames) out.push(err('timeline.mouth', at, `mouth has ${s.mouth?.length ?? 0} frames, the scene has ${frames}`));
		if (!(s.speechMs >= 0 && s.speechMs <= s.durationMs)) out.push(err('timeline.speech', at, `speechMs ${s.speechMs} outside 0..${s.durationMs}`));
		let prev = -1;
		for (const w of s.words ?? []) {
			if (!(w.startMs >= 0 && w.endMs >= w.startMs && w.endMs <= s.durationMs + 1)) {
				out.push(err('timeline.word', at, `word "${w.text}" ${w.startMs}-${w.endMs} ms is outside the scene`));
				break;
			}
			if (w.startMs < prev) {
				out.push(err('timeline.wordOrder', at, `word "${w.text}" starts before the previous word`));
				break;
			}
			prev = w.startMs;
		}
		expect = s.startMs + s.durationMs;
	});
	if (tl.totalMs !== expect) out.push(err('timeline.total', 'timeline', `totalMs ${tl.totalMs} != sum of scenes ${expect}`));
	return out;
};

/** Throw one error listing every error (the render stops before frame 0); return the warnings. */
export const assertNoErrors = (issues: Issue[], label: string): Issue[] => {
	const errors = issues.filter((i) => i.level === 'error');
	if (errors.length) throw new Error(`${label}: ${errors.length} error(s):\n${errors.map((e) => `  - [${e.code}] ${e.where}: ${e.msg}`).join('\n')}`);
	return issues.filter((i) => i.level === 'warning');
};
