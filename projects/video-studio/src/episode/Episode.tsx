/**
 * Episode (1920x1080) and EpisodeShort (1080x1920): one component, two formats. calculateMetadata (compositions.tsx)
 * has already loaded, validated and resolved everything into props.resolved.
 *  - Fonts block the render until the language's faces are loaded; text is measured only after that.
 *  - Each scene is a Sequence at its own audio position. Transitions overlap VISUALS only and are VOICE-FREE
 *    (timing.ts): the incoming scene's visuals may start `preroll` frames early, held on its frame 0, inside the
 *    outgoing scene's silent tail; the outgoing scene may render `tail` frames past its end. Audio never moves. Since
 *    2026-11-25 the music bed is continuous through transitions, and no effect plays in one unless the storyboard asks
 *    (a wipe's short whoosh; a slide's soft air only with sfx.transition): audio/plan.ts, measured by the gate.
 *  - A slide is a short push with a fade; a wipe's edge carries motion blur (ART_GUIDE MO16; timing.ts).
 *  - Episode: ONE <Audio> plays narration.wav. Short: each scene plays its own window of narration.wav (trimBefore =
 *    the scene's frame in the full episode), retimed to start at 0.
 *  - Sound (2026-11-25): <EpisodeAudio> plays resolved.audio, the plan made in calculateMetadata (beds, sting, effects).
 *    The opt-in brand sting draws the branding kit's ZooraSting over its slot. audioStems (measurement renders) draws
 *    no picture at all and plays only the stems asked for.
 *  - A mock timeline is silent and badged; an unreviewed translation is badged; the Studio preview's approximate bed
 *    audio is badged (only renders are judged).
 */
import React, {useEffect, useMemo, useState} from 'react';
import {AbsoluteFill, Freeze, Html5Audio, Sequence, staticFile, useCurrentFrame, useDelayRender, useRemotionEnvironment, useVideoConfig} from 'remotion';
import {ZooraSting} from '../branding/kit';
import {EpisodeAudio} from './audio/EpisodeAudio';
import type {AudioStem} from './audio/plan';
import type {SceneType} from './types';
import type {EpisodeProps, ResolvedEpisode} from './load';
import {loadLangFonts} from './i18n/fonts';
import {episodeSpans, shortSpans, SLIDE_PUSH, transitionProgress, wipeStrips, type SceneSpan, type TransitionKind} from './timing';
import {C} from './theme';
import {frameToMs} from './motion';
import type {SceneCtx} from './scenes/parts';
import {HookScene} from './scenes/Hook';
import {TalkScene} from './scenes/Talk';
import {ChartScene} from './scenes/Chart';
import {StepsScene} from './scenes/Steps';
import {QuoteScene} from './scenes/Quote';
import {CtaScene} from './scenes/Cta';
import {EndScreenScene} from './scenes/EndScreen';
import {FictionCard, LowerThird, ReviewBadges, SourcesCard} from './scenes/Overlays';
import {Captions, captionTrack} from './captions/Captions';
import {sceneFaces} from './layout/faces';

export const SCENES: Record<SceneType, React.FC<{ctx: SceneCtx}>> = {
	hook: HookScene,
	talk: TalkScene,
	chart: ChartScene,
	steps: StepsScene,
	quote: QuoteScene,
	cta: CtaScene,
	endscreen: EndScreenScene,
};

/**
 * Visual-only entry transition of a scene (opacity on a whole layer is allowed in transitions, ART_GUIDE CV1). `at`: how
 * many transition frames have already run when this layer shows its own frame 0 (the pre-roll part runs in its own
 * Sequence). Progress, the slide's push and the wipe's motion-blurred edge: timing.ts. Every pixel of the incoming layer
 * is blended at most once (no stacked translucent copies, which drift flat colours in this renderer).
 */
const TransitionIn: React.FC<{kind: TransitionKind; frames: number; at: number; children: React.ReactNode}> = ({kind, frames, at, children}) => {
	const t = useCurrentFrame() + at;
	const {width} = useVideoConfig();
	if (kind === 'cut' || frames <= 0 || t >= frames)
		return (
			<AbsoluteFill>
				<AbsoluteFill key={0}>{children}</AbsoluteFill>
			</AbsoluteFill>
		);
	const fade = transitionProgress('fade', t + 1, frames);
	if (kind === 'fade')
		return (
			<AbsoluteFill>
				<AbsoluteFill key={0} style={{opacity: fade}}>
					{children}
				</AbsoluteFill>
			</AbsoluteFill>
		);
	if (kind === 'slide') {
		const p = transitionProgress('slide', t + 1, frames);
		return (
			<AbsoluteFill>
				<AbsoluteFill key={0} style={{transform: `translateX(${(1 - p) * SLIDE_PUSH * width}px)`, opacity: fade}}>
					{children}
				</AbsoluteFill>
			</AbsoluteFill>
		);
	}
	return (
		<AbsoluteFill>
			{wipeStrips(t + 1, frames, width).map((st, i) => (
				<AbsoluteFill key={i} style={{clipPath: `inset(0 ${width - st.to}px 0 ${st.from}px)`, opacity: st.alpha}}>
					{children}
				</AbsoluteFill>
			))}
		</AbsoluteFill>
	);
};

const SceneView: React.FC<{r: ResolvedEpisode; span: SceneSpan}> = ({r, span}) => {
	const sb = r.storyboard;
	const sc = sb.scenes[span.index];
	const tl = r.timeline.scenes[span.index];
	const ctx: SceneCtx = useMemo(
		() => ({format: r.format, lang: sb.lang, sb, sc, tl, fps: 30, frames: span.durationInFrames, seed: `${sb.slug}:${sc.id}:${r.format}`, chart: r.charts[sc.id]}),
		[r, sb, sc, tl, span.durationInFrames],
	);
	const Scene = SCENES[sc.type];
	return (
		<>
			<Scene ctx={ctx} />
			{r.format === 'landscape' ? <LowerThird format={r.format} lang={sb.lang} sc={sc} /> : null}
			<SourcesCard format={r.format} sb={sb} sc={sc} tl={tl} fps={30} frames={span.durationInFrames} startFrame={span.from} />
		</>
	);
};

/** The narration as the render plays it: one track (Episode), or each Short scene's own window of it. */
const Narration: React.FC<{r: ResolvedEpisode; spans: SceneSpan[]}> = ({r, spans}) => {
	if (!r.narration) return null;
	if (r.format === 'landscape') return <Html5Audio src={staticFile(r.narration)} name="narration" />;
	return (
		<>
			{spans.map((s) => (
				<Sequence key={`a-${s.id}`} from={s.from} durationInFrames={s.durationInFrames} name={`audio ${s.id}`}>
					<Html5Audio src={staticFile(r.narration as string)} trimBefore={s.srcFrom} />
				</Sequence>
			))}
		</>
	);
};

/** Picture spans: the plan may force a cut (the scene after the brand sting enters on a cut). */
const useSpans = (r: ResolvedEpisode): SceneSpan[] => {
	const {fps} = useVideoConfig();
	return useMemo(() => {
		if (r.format === 'vertical') return shortSpans(r.storyboard, r.timeline, r.shortId as string, fps);
		const forceCut = r.audio.picture.forceCut;
		return episodeSpans(r.storyboard, r.timeline, fps, 'landscape', forceCut.length ? {forceCut: new Set(forceCut)} : {});
	}, [r, fps]);
};

/** A measurement render (src/episode/tools/render.sh): only the audio stems asked for, no picture, no fonts. */
const StemsOnly: React.FC<{r: ResolvedEpisode; stems: readonly AudioStem[]}> = ({r, stems}) => {
	const spans = useSpans(r);
	return (
		<AbsoluteFill style={{backgroundColor: C.bg}}>
			{stems.includes('voice') ? <Narration r={r} spans={spans} /> : null}
			<EpisodeAudio plan={r.audio} stems={stems} />
		</AbsoluteFill>
	);
};

const EpisodeBody: React.FC<{r: ResolvedEpisode}> = ({r}) => {
	const {fps} = useVideoConfig();
	const env = useRemotionEnvironment();
	const sb = r.storyboard;
	const spans = useSpans(r);
	// caption pages are clipped to their scene: the last page of a scene never runs over the next shot
	const track = useMemo(
		() =>
			r.captions
				? captionTrack(
						spans.map((s) => ({
							fromMs: frameToMs(s.from, fps),
							toMs: frameToMs(s.from + s.durationInFrames, fps),
							words: r.timeline.scenes[s.index].words,
							faces: sceneFaces(sb.scenes[s.index], r.format),
						})),
						sb.lang,
					)
				: [],
		[r, spans, fps, sb.lang],
	);
	const machine = sb.lang !== sb.sourceLang && sb.translation?.status !== 'native-reviewed';
	return (
		<AbsoluteFill style={{backgroundColor: C.bg}}>
			{spans.map((s) => (
				<React.Fragment key={s.id}>
					{s.preroll > 0 ? (
						// the transition's first frames, inside the previous scene's silent tail: this scene held on its frame 0
						<Sequence from={s.from - s.preroll} durationInFrames={s.preroll} name={`${s.id} · ${s.transition} in`}>
							<TransitionIn kind={s.transition} frames={s.transitionFrames} at={0}>
								<Freeze frame={0}>
									<SceneView r={r} span={s} />
								</Freeze>
							</TransitionIn>
						</Sequence>
					) : null}
					<Sequence from={s.from} durationInFrames={s.durationInFrames + s.tail} name={`${s.id} · ${s.type}`}>
						<TransitionIn kind={s.transition} frames={s.transitionFrames} at={s.preroll}>
							<SceneView r={r} span={s} />
						</TransitionIn>
					</Sequence>
				</React.Fragment>
			))}
			{sb.fiction ? (
				<Sequence from={0} durationInFrames={170} name="fiction card">
					<FictionCard format={r.format} sb={sb} />
				</Sequence>
			) : null}
			{r.audio.picture.sting ? (
				// the opt-in brand sting: the branding kit's card over its slot (its jingle plays in EpisodeAudio, on the plan)
				<Sequence from={r.audio.picture.sting.from} durationInFrames={r.audio.picture.sting.durationInFrames} name="brand sting">
					<ZooraSting tagline={r.audio.picture.sting.tagline ?? undefined} />
				</Sequence>
			) : null}
			{r.captions ? <Captions track={track} format={r.format} lang={sb.lang} fps={fps} /> : null}
			<ReviewBadges format={r.format} mock={!!r.timeline.mock} machine={machine} previewAudio={!env.isRendering && r.audio.beds.length > 0} />
			<Narration r={r} spans={spans} />
			<EpisodeAudio plan={r.audio} stems={null} />
		</AbsoluteFill>
	);
};

/** Fonts gate: blocks the render until the language's fonts are loaded, then measures and draws. */
export const EpisodeView: React.FC<EpisodeProps> = (props) => {
	if (props.audioStems && props.audioStems.length) {
		// a measurement render draws nothing, so it needs no fonts (critic F16: it used to render every scene)
		if (!props.resolved) throw new Error('Episode: props.resolved is missing (calculateMetadata did not run)');
		return <StemsOnly r={props.resolved} stems={props.audioStems} />;
	}
	return <EpisodeFull {...props} />;
};

const EpisodeFull: React.FC<EpisodeProps> = (props) => {
	const r = props.resolved;
	const lang = r?.storyboard.lang ?? props.lang;
	const {delayRender, continueRender, cancelRender} = useDelayRender();
	const [handle] = useState(() => delayRender(`Loading fonts for ${lang}`));
	const [ready, setReady] = useState(false);
	useEffect(() => {
		loadLangFonts(lang)
			.then(() => setReady(true))
			.catch((err) => cancelRender(err));
	}, [lang, cancelRender]);
	useEffect(() => {
		if (ready) continueRender(handle);
	}, [ready, handle, continueRender]);
	if (!r) throw new Error('Episode: props.resolved is missing (calculateMetadata did not run)');
	if (!ready) return <AbsoluteFill style={{backgroundColor: C.bg}} />;
	return <EpisodeBody r={r} />;
};
