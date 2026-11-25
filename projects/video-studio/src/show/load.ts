/**
 * Loading and resolving a show render for calculateMetadata (browser side, webpack bundle).
 *  - Storyboards: content/zoora-security/<slug>/storyboard.json (en) or storyboard.<lang>.json, bundled with webpack's
 *    require.context (every `remotion render` re-bundles, so new storyboards are picked up). Dev fixtures live in
 *    src/show/dev/fixtures/<slug>/ under the channel name "_dev".
 *  - Timeline: public/generated/<channel>/<slug>/<lang>/timeline.json (the voice step, scripts/voice), or
 *    props.timelineOverride. Only "_dev" falls back to the MOCK timeline (src/show/dev/mockTimeline.ts): silent, badged.
 *  - Narration: timeline.narration (the voice step's continuous track), else generated/<channel>/<slug>/<lang>/narration.wav.
 */
import {staticFile} from 'remotion';
import type {Format, Lang, ShowStoryboard, Timeline} from './types';
import {assertNoErrors, validateProps, validateShowStoryboard, validateShowTimeline, END_SCREEN_SEC} from './validate';
import {episodeSpans, shortSpans, spansFrames, SHORT_TARGET_SEC} from './timing';
import {showMockTimeline} from './dev/mockTimeline';

type WebpackContext = {keys(): string[]; (id: string): unknown};
type WebpackRequire = {context(dir: string, deep: boolean, re: RegExp): WebpackContext};

// Both calls must stay literal `require.context(...)` so webpack can resolve them at bundle time.
const CONTENT = (require as unknown as WebpackRequire).context('../../content', true, /^\.\/zoora-security\/[^/]+\/storyboard(\.[a-z]{2}(-[a-z]{2})?)?\.json$/);
const DEV = (require as unknown as WebpackRequire).context('./dev/fixtures', true, /^\.\/[^/]+\/storyboard(\.[a-z]{2}(-[a-z]{2})?)?\.json$/);

export const DEV_CHANNEL = '_dev';
export const FPS = 30;

const fileFor = (lang: Lang) => (lang === 'en' ? 'storyboard.json' : `storyboard.${lang}.json`);

export const loadShowStoryboard = (channel: string, slug: string, lang: Lang): ShowStoryboard => {
	const dev = channel === DEV_CHANNEL;
	const ctx = dev ? DEV : CONTENT;
	const prefix = dev ? `./${slug}/` : `./${channel}/${slug}/`;
	const key = `${prefix}${fileFor(lang)}`;
	if (!ctx.keys().includes(key)) {
		const have = ctx
			.keys()
			.filter((k) => k.startsWith(prefix))
			.map((k) => k.slice(prefix.length));
		const where = dev ? `src/show/dev/fixtures/${slug}/${fileFor(lang)}` : `content/${channel}/${slug}/${fileFor(lang)}`;
		throw new Error(`No storyboard at ${where}.${have.length ? ` This episode has: ${have.join(', ')}.` : ' Nothing exists for this channel/slug.'}`);
	}
	return ctx(key) as ShowStoryboard;
};

export const narrationPath = (channel: string, slug: string, lang: Lang) => `generated/${channel}/${slug}/${lang}/narration.wav`;
const timelinePath = (channel: string, slug: string, lang: Lang) => `generated/${channel}/${slug}/${lang}/timeline.json`;

const fetchJson = async <T,>(path: string, signal?: AbortSignal): Promise<T | null> => {
	const res = await fetch(staticFile(path), {signal});
	if (res.status === 404) return null;
	if (!res.ok) throw new Error(`GET ${path}: HTTP ${res.status}`);
	return (await res.json()) as T;
};

export type ShowProps = {
	channel: string;
	slug: string;
	lang: Lang;
	/** ShowShort only: which storyboard.shorts[] entry (default: the first). */
	shortId?: string;
	/** Burned-in captions. Default: on for ShowShort, off for ShowEpisode (YouTube carries the subtitles). */
	captions?: boolean;
	/** The channel's name under the show logo: "Zoodger News" (owner, 2026-11-24). Omitted: the channel's name for zoora-security, none for _dev (channel.ts). null hides it. A proper name: never localized. */
	channelName?: string | null;
	timelineOverride?: Timeline | null;
	/** Filled by calculateMetadata; never pass it yourself. */
	resolved?: ResolvedShow | null;
};

export type ResolvedShow = {
	format: Format;
	storyboard: ShowStoryboard;
	timeline: Timeline;
	shortId: string | null;
	narration: string | null; // public/ path of narration.wav; null for a mock timeline (silent)
	captions: boolean;
	durationInFrames: number;
	dev: boolean;
	warnings: string[];
};

export const resolveShow = async (props: ShowProps, format: Format, signal?: AbortSignal): Promise<ResolvedShow> => {
	const short = format === 'vertical';
	const label = `${short ? 'ShowShort' : 'ShowEpisode'} ${String(props.channel)}/${String(props.slug)} (${String(props.lang)})`;
	assertNoErrors(validateProps(props, short), label);
	const {channel, slug, lang} = props;
	const dev = channel === DEV_CHANNEL;
	const storyboard = loadShowStoryboard(channel, slug, lang);
	const shortId = short ? (props.shortId ?? storyboard.shorts?.[0]?.id ?? null) : null;
	const warnings = assertNoErrors(validateShowStoryboard(storyboard, {channel, slug, lang, short, shortId: shortId ?? undefined}), label);

	let timeline = props.timelineOverride ?? (await fetchJson<Timeline>(timelinePath(channel, slug, lang), signal));
	if (!timeline) {
		if (!dev) throw new Error(`${label}: no timeline at public/${timelinePath(channel, slug, lang)}. Run the voice step first: python scripts/voice/build.py content/${channel}/${slug} --lang ${lang} --voice im_nicola`);
		timeline = showMockTimeline(storyboard, {fps: FPS});
	}
	warnings.push(...assertNoErrors(validateShowTimeline(timeline, storyboard, FPS, {dev}), label));

	const spans = short ? shortSpans(storyboard, timeline, shortId as string, FPS) : episodeSpans(storyboard, timeline, FPS);
	const durationInFrames = spansFrames(spans);
	const sec = durationInFrames / FPS;
	if (short) {
		if (sec > SHORT_TARGET_SEC.hardMax) throw new Error(`${label}: the Short is ${sec.toFixed(1)} s; YouTube Shorts are at most ${SHORT_TARGET_SEC.hardMax} s`);
		if (sec < SHORT_TARGET_SEC.min || sec > SHORT_TARGET_SEC.max)
			warnings.push({level: 'warning', code: 'short.length', where: `shorts ${shortId}`, msg: `the Short is ${sec.toFixed(1)} s; the daily format is ${SHORT_TARGET_SEC.min}-${SHORT_TARGET_SEC.max} s`});
	} else {
		const outro = spans.find((s) => s.segment === 'outroEndScreen');
		if (outro) {
			const os = outro.durationInFrames / FPS;
			if (os < END_SCREEN_SEC.min) throw new Error(`${label}: the outro is ${os.toFixed(1)} s; end-screen elements need at least ${END_SCREEN_SEC.min} s (set its minDurationSec)`);
			if (os > END_SCREEN_SEC.max) warnings.push({level: 'warning', code: 'outro.long', where: outro.id, msg: `the outro is ${os.toFixed(1)} s; end screens show at most ${END_SCREEN_SEC.max} s`});
			if (sec < 25) warnings.push({level: 'warning', code: 'outro.short-video', where: outro.id, msg: 'end screens need a video of at least 25 s'});
		}
	}
	for (const w of warnings) console.warn(`[show] ${label}: ${w.where}: ${w.msg}`);
	return {
		format,
		storyboard,
		timeline,
		shortId,
		narration: timeline.mock ? null : ((timeline as Timeline & {narration?: string}).narration ?? narrationPath(channel, slug, lang)),
		captions: typeof props.captions === 'boolean' ? props.captions : short,
		durationInFrames,
		dev,
		warnings: warnings.map((w) => `${w.where}: ${w.msg}`),
	};
};
