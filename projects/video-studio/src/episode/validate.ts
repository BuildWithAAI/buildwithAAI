/**
 * Validation for Episode / EpisodeShort (pure). calculateMetadata runs it, so a broken storyboard or timeline fails the
 * render before frame 0 with every problem listed. Errors block; warnings are printed.
 */
import type {MouthShape} from '../characters/types';
import type {Lang, SceneType, Storyboard, StoryboardScene, Timeline} from './types.ts';
import {displayText, MarkupError, parseMarkup, sourceIds, spokenText} from './markup.ts';
import {uiLabel, type UiKey} from './i18n/ui.ts';
import {normWord} from './cues.ts';

export type Issue = {level: 'error' | 'warning'; where: string; msg: string};

export const LANGS: readonly Lang[] = ['en', 'es', 'pt-br', 'hi', 'it', 'zh', 'ja'];
export const SCENE_TYPES: readonly SceneType[] = ['hook', 'talk', 'chart', 'steps', 'quote', 'cta', 'endscreen'];
export const MOUTHS: readonly MouthShape[] = ['closed', 'slightlyOpen', 'ah', 'ee', 'oh', 'mbp'];
export const REACTIONS = ['neutral', 'happy', 'worried', 'shocked', 'judge', 'lookUp'] as const;
export const MAX_BULLETS = 4;
export const MAX_STEPS = 5;
export const END_SCREEN_MS = 20_000; // the end screen holds the last 20 s (YouTube allows 5-20 s)
export const SHORT_MAX_MS = 180_000; // Shorts: 3 min or less
export const MIN_VIDEO_FOR_END_SCREEN_MS = 25_000;

const SLUG = /^[A-Za-z0-9_][A-Za-z0-9_-]{0,80}$/;

export type EpisodeInput = {channel?: unknown; slug?: unknown; lang?: unknown; shortId?: unknown; captions?: unknown};

export const validateProps = (p: EpisodeInput, short: boolean): Issue[] => {
	const out: Issue[] = [];
	const e = (msg: string) => out.push({level: 'error', where: 'props', msg});
	if (typeof p.channel !== 'string' || !SLUG.test(p.channel)) e(`channel must be a slug like "zoora-ai" (got ${JSON.stringify(p.channel)})`);
	if (typeof p.slug !== 'string' || !SLUG.test(p.slug)) e(`slug must be a slug like "pumpfun-top-caller" (got ${JSON.stringify(p.slug)})`);
	if (typeof p.lang !== 'string' || !LANGS.includes(p.lang as Lang))
		e(`lang must be one of ${LANGS.join(', ')} (got ${JSON.stringify(p.lang)})${typeof p.lang === 'string' && p.lang.startsWith('fr') ? '; French is excluded: Kokoro has no male French voice' : ''}`);
	if (p.shortId !== undefined && (typeof p.shortId !== 'string' || !p.shortId)) e('shortId must be a non-empty string');
	if (!short && p.shortId !== undefined) out.push({level: 'warning', where: 'props', msg: 'shortId is ignored by Episode (use EpisodeShort)'});
	if (p.captions !== undefined && typeof p.captions !== 'boolean') e('captions must be true or false');
	return out;
};

export const str = (sc: StoryboardScene, key: string): string | undefined => {
	const v = sc.onScreen?.[key];
	return typeof v === 'string' && v.trim() ? v.trim() : undefined;
};
export const list = (sc: StoryboardScene, key: string): string[] | undefined => {
	const v = sc.onScreen?.[key];
	return Array.isArray(v) ? v.map((x) => String(x).trim()) : undefined;
};

/** Whether a scene shows the sources card (see StoryboardScene.showSources). */
export const showsSources = (sc: StoryboardScene): boolean => {
	let ids: string[] = [];
	try {
		ids = sourceIds(sc.narration);
	} catch {
		return false;
	}
	return ids.length > 0 && (sc.showSources ?? sc.type !== 'quote');
};

const loose = (s: string) => normWord(s.replace(/\s+/g, ''));
/** Letters and digits only (NFKC, lower case): what must match between a storyboard's narration and its voiced words. */
const letters = (s: string) => s.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

/** Dev fixtures (src/episode/dev/fixtures) are the only storyboards exempt from the real-channel source rules. */
export const DEV_CHANNEL_ID = '_dev';
const ISO_DATE = /^\d{4}-\d{2}-\d{2}/;

export type StoryboardCtx = {channel: string; slug: string; lang: Lang; short: boolean; shortId?: string};

export const validateStoryboard = (sb: Storyboard, c: StoryboardCtx): Issue[] => {
	const out: Issue[] = [];
	const e = (where: string, msg: string) => out.push({level: 'error', where, msg});
	const w = (where: string, msg: string) => out.push({level: 'warning', where, msg});
	if (sb.version !== 1) e('storyboard', `version must be 1 (got ${JSON.stringify(sb.version)})`);
	if (sb.channel !== c.channel) e('storyboard', `channel "${sb.channel}" does not match props.channel "${c.channel}"`);
	if (sb.slug !== c.slug) e('storyboard', `slug "${sb.slug}" does not match props.slug "${c.slug}"`);
	if (sb.lang !== c.lang) e('storyboard', `lang "${sb.lang}" does not match props.lang "${c.lang}" (translations live in storyboard.<lang>.json)`);
	if (!LANGS.includes(sb.sourceLang)) e('storyboard', `sourceLang "${sb.sourceLang}" is not a supported language`);
	if (!Array.isArray(sb.scenes) || !sb.scenes.length) {
		e('storyboard', 'scenes must be a non-empty array');
		return out;
	}
	const srcIds = new Set((sb.sources ?? []).map((s) => s.id));
	const ids = new Set<string>();
	const needUi = new Set<UiKey>();
	if (sb.fiction) needUi.add('fictionDisclaimer');
	sb.scenes.forEach((sc, i) => {
		const at = `scenes[${i}] "${sc.id}"`;
		if (!sc.id || typeof sc.id !== 'string') e(at, 'id must be a non-empty string');
		if (ids.has(sc.id)) e(at, 'duplicate scene id');
		ids.add(sc.id);
		if (!SCENE_TYPES.includes(sc.type)) {
			e(at, `type must be one of ${SCENE_TYPES.join(', ')}`);
			return;
		}
		try {
			parseMarkup(sc.narration);
		} catch (err) {
			e(at, `narration markup: ${err instanceof MarkupError ? err.message : String(err)}`);
			return;
		}
		for (const id of sourceIds(sc.narration)) if (!srcIds.has(id)) e(at, `[src:${id}] cites a source that is not in storyboard.sources`);
		if (showsSources(sc)) needUi.add('sources');
		if (sc.badger?.reaction && !REACTIONS.includes(sc.badger.reaction)) e(at, `badger.reaction must be one of ${REACTIONS.join(', ')}`);
		if (sc.zoo?.pose === 'point' && sc.zoo.view && sc.zoo.view !== 'front') w(at, 'ZOO can only point in the front view; the point is skipped');
		if (sc.zoo?.pose === 'typing') w(at, "zoo.pose 'typing' needs a desk set and is not used by the scene templates; ZOO stands");
		const cues = list(sc, 'cues');
		switch (sc.type) {
			case 'hook':
				if (!str(sc, 'title')) e(at, 'hook needs onScreen.title');
				break;
			case 'talk': {
				const b = list(sc, 'bullets') ?? [];
				if (b.length > MAX_BULLETS) e(at, `talk shows at most ${MAX_BULLETS} bullets (got ${b.length})`);
				if (b.some((x) => !x)) e(at, 'empty bullet');
				if (!b.length && !str(sc, 'title')) w(at, 'talk scene with no title and no bullets: ZOO talks alone');
				if (cues && cues.length !== b.length) w(at, `onScreen.cues has ${cues.length} entries for ${b.length} bullets`);
				break;
			}
			case 'steps': {
				const s = list(sc, 'steps') ?? [];
				if (!s.length) e(at, 'steps needs onScreen.steps (1-5 items)');
				if (s.length > MAX_STEPS) e(at, `steps shows at most ${MAX_STEPS} steps (got ${s.length})`);
				if (s.some((x) => !x)) e(at, 'empty step');
				break;
			}
			case 'chart': {
				if (!sc.chart) {
					e(at, 'chart scene needs a chart field');
					break;
				}
				if (sc.chart.seed === undefined && !sc.chart.dataFile) e(at, 'chart needs chart.seed (synthetic) or chart.dataFile');
				if (sc.chart.seed !== undefined && !sc.chart.illustrative) e(at, 'synthetic (seeded) chart data must be marked illustrative: true (CHART_SPEC CD3)');
				if (sc.chart.seed !== undefined && !str(sc, 'pair')) e(at, 'a seeded chart needs onScreen.pair, e.g. "$ZOO / SOL" (fictional ticker, no real token)');
				if (sc.chart.illustrative) needUi.add('illustrative');
				break;
			}
			case 'quote': {
				if (!str(sc, 'quote')) e(at, 'quote needs onScreen.quote');
				if (!str(sc, 'attribution')) e(at, 'quote needs onScreen.attribution');
				if (!str(sc, 'source') && !sourceIds(sc.narration).length) e(at, 'quote needs onScreen.source or a [src:id] in the narration');
				break;
			}
			case 'cta': {
				if ((sb.offers ?? []).length) {
					const d = str(sc, 'disclosure');
					if (!d) e(at, 'storyboard.offers is set: the CTA needs onScreen.disclosure (shown on screen)');
					// the SPOKEN side (fixed 2026-11-24, review: a display-only {text|} disclosure passed here but fails the
					// claim gate): captions alone are not a spoken disclosure
					else if (!loose(spokenText(sc.narration)).includes(loose(d)))
						e(at, `storyboard.offers is set: the CTA narration must SAY the disclosure ("${d}") as well as show it (FTC 16 CFR 255); display-only {text|} markup is not said`);
				}
				if (!str(sc, 'button')) needUi.add('subscribe');
				break;
			}
			case 'endscreen':
				if (i !== sb.scenes.length - 1) e(at, 'the end screen must be the last scene');
				if (!c.short) {
					needUi.add('watchNext');
					needUi.add('subscribeSlot');
				}
				if ((sc.minDurationSec ?? 0) < END_SCREEN_MS / 1000) w(at, `set minDurationSec: ${END_SCREEN_MS / 1000} so the voice step holds the end screen for 20 s`);
				break;
		}
	});
	if (!c.short && !sb.scenes.some((sc) => sc.badger?.present))
		e('storyboard', 'Badger must appear recognizably in every episode (PROJECT_INSTRUCTIONS): set badger.present on at least one scene');
	// real channels: every cited source must be one the claim gate accepts (scripts/claims: source-unverified,
	// source-not-https, source-no-accessed). The full gate (unsourced claims, must-not-say, income, names, wallets) runs
	// in scripts/claims; Node tools check its report (src/episode/node/claimGate.ts). Added 2026-11-24 (review).
	if (c.channel !== DEV_CHANNEL_ID) {
		const cited = new Set<string>();
		for (const sc of sb.scenes) {
			try {
				for (const id of sourceIds(sc.narration)) cited.add(id);
			} catch {
				// markup errors are reported per scene above
			}
		}
		for (const src of sb.sources ?? []) {
			if (!cited.has(src.id)) continue;
			const at = `sources[${src.id}]`;
			if (src.status !== 'verified') e(at, `is cited but its status is "${String(src.status)}": only verified sources may back a claim (run the claim gate: node scripts/claims/check.ts)`);
			if (!/^https:\/\//i.test(String(src.url ?? ''))) e(at, 'is cited but its url is not https');
			if (!ISO_DATE.test(String(src.accessed ?? ''))) e(at, 'is cited but has no accessed date (YYYY-MM-DD)');
		}
	}
	for (const k of needUi) if (!uiLabel(sb, k)) e('storyboard.ui', `"${k}" is required in a ${sb.lang} storyboard (no English UI text in a dubbed render)`);
	// shorts
	const shortIds = new Set<string>();
	for (const s of sb.shorts ?? []) {
		if (shortIds.has(s.id)) e(`shorts "${s.id}"`, 'duplicate short id');
		shortIds.add(s.id);
		if (!s.sceneIds?.length) e(`shorts "${s.id}"`, 'sceneIds must not be empty');
		for (const id of s.sceneIds ?? []) {
			const sc = sb.scenes.find((x) => x.id === id);
			if (!sc) e(`shorts "${s.id}"`, `scene "${id}" does not exist`);
			else if (sc.type === 'endscreen' && c.short && s.id === c.shortId) w(`shorts "${s.id}"`, 'Shorts have no end-screen elements: the end screen becomes a plain outro card');
		}
	}
	if (c.short) {
		if (!(sb.shorts ?? []).length) e('storyboard', 'EpisodeShort needs storyboard.shorts');
		else if (c.shortId && !shortIds.has(c.shortId)) e('props', `shortId "${c.shortId}" is not in storyboard.shorts (${[...shortIds].join(', ')})`);
		const s = (sb.shorts ?? []).find((x) => x.id === c.shortId) ?? (sb.shorts ?? [])[0];
		if (s && !s.sceneIds.some((id) => sb.scenes.find((x) => x.id === id)?.badger?.present))
			w(`shorts "${s.id}"`, 'Badger does not appear in this Short');
	}
	return out;
};

export const validateTimeline = (tl: Timeline, sb: Storyboard, fps: number, c: {short: boolean; shortId?: string}): Issue[] => {
	const out: Issue[] = [];
	const e = (where: string, msg: string) => out.push({level: 'error', where, msg});
	const w = (where: string, msg: string) => out.push({level: 'warning', where, msg});
	const frameMs = 1000 / fps;
	if (tl.version !== 1) e('timeline', `version must be 1 (got ${JSON.stringify(tl.version)})`);
	if (tl.lang !== sb.lang) e('timeline', `lang "${tl.lang}" does not match the storyboard's "${sb.lang}"`);
	if (tl.fps !== fps) e('timeline', `fps ${tl.fps} does not match the composition's ${fps} fps (the mouth track is per frame)`);
	if (!(tl.totalMs > 0)) e('timeline', 'totalMs must be > 0');
	if (!Array.isArray(tl.scenes) || tl.scenes.length !== sb.scenes.length) {
		e('timeline', `has ${tl.scenes?.length ?? 0} scenes, the storyboard ${sb.scenes.length}: re-run the voice step`);
		return out;
	}
	let end = 0;
	tl.scenes.forEach((s, i) => {
		const at = `timeline.scenes[${i}] "${s.id}"`;
		if (s.id !== sb.scenes[i].id) e(at, `id does not match storyboard scene "${sb.scenes[i].id}" (same order required)`);
		if (Math.abs(s.startMs - end) > frameMs + 0.5) e(at, `starts at ${s.startMs} ms but the previous scene ends at ${end} ms (scenes must be contiguous)`);
		if (!(s.durationMs > 0)) e(at, 'durationMs must be > 0');
		if (s.speechMs > s.durationMs + frameMs) e(at, `speechMs ${s.speechMs} > durationMs ${s.durationMs}`);
		let prev = -Infinity;
		s.words.forEach((wd, k) => {
			if (!(wd.endMs >= wd.startMs) || wd.startMs < prev - 1) e(at, `word ${k} "${wd.text}" has bad or unordered timing`);
			if (wd.endMs > s.durationMs + frameMs) e(at, `word ${k} "${wd.text}" ends after the scene`);
			if (wd.stressMs !== undefined && (wd.stressMs < wd.startMs - 1 || wd.stressMs > wd.endMs + 1)) w(at, `word ${k} stressMs is outside the word`);
			prev = wd.startMs;
		});
		const frames = Math.round((s.durationMs * fps) / 1000);
		if (!Array.isArray(s.mouth)) e(at, 'mouth must be an array (one shape per frame)');
		else {
			const bad = s.mouth.findIndex((m) => !MOUTHS.includes(m));
			if (bad >= 0) e(at, `mouth[${bad}] "${s.mouth[bad]}" is not in the mouth library`);
			if (Math.abs(s.mouth.length - frames) > 2) w(at, `mouth has ${s.mouth.length} frames, the scene ${frames}`);
		}
		// the voiced words must be this narration (fixed 2026-11-24, review): a storyboard edited after the voice step
		// would render captions, cues and lip-sync for words that are not said, and skip the claim gate's check of them
		if (!tl.mock) {
			let want = '';
			try {
				want = letters(displayText(sb.scenes[i].narration));
			} catch {
				want = '';
			}
			const got = letters((s.words ?? []).map((wd) => wd.text).join(''));
			if (want && got !== want)
				e(at, 'its words differ from the storyboard narration: the storyboard changed after the voice step. Re-run the claim gate (node scripts/claims/check.ts) and the voice step for this language');
		}
		if (sb.scenes[i].type === 'endscreen' && !c.short && s.durationMs < END_SCREEN_MS - frameMs)
			e(at, `the end screen lasts ${(s.durationMs / 1000).toFixed(1)} s; it must hold 20 s (storyboard minDurationSec: 20)`);
		end = s.startMs + s.durationMs;
	});
	if (Math.abs(end - tl.totalMs) > frameMs + 0.5) e('timeline', `totalMs ${tl.totalMs} != end of the last scene ${end}`);
	if (!c.short && sb.scenes.some((x) => x.type === 'endscreen') && tl.totalMs < MIN_VIDEO_FOR_END_SCREEN_MS) e('timeline', 'end screens need a video of 25 s or more');
	if (c.short) {
		const s = (sb.shorts ?? []).find((x) => x.id === c.shortId) ?? (sb.shorts ?? [])[0];
		if (s) {
			const ms = s.sceneIds.reduce((a, id) => a + (tl.scenes.find((x) => x.id === id)?.durationMs ?? 0), 0);
			if (ms > SHORT_MAX_MS) e(`shorts "${s.id}"`, `is ${(ms / 1000).toFixed(1)} s; Shorts must be 3 min or less`);
		}
	}
	if (tl.mock) w('timeline', 'MOCK timeline: silent preview, not lip-synced');
	for (const m of tl.warnings ?? []) w('timeline (voice step)', m);
	return out;
};

/** Throw one error listing every error; return the warnings. */
export const assertNoErrors = (issues: Issue[], label: string): Issue[] => {
	const errs = issues.filter((x) => x.level === 'error');
	if (errs.length) throw new Error(`${label}: ${errs.length} problem${errs.length > 1 ? 's' : ''}\n${errs.map((x) => `  - ${x.where}: ${x.msg}`).join('\n')}`);
	return issues.filter((x) => x.level === 'warning');
};
