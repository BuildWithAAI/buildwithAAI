/**
 * Episode (1920x1080) and EpisodeShort (1080x1920): one component, two formats. calculateMetadata (compositions.tsx)
 * has already loaded, validated and resolved everything into props.resolved.
 *  - Fonts block the render until the language's faces are loaded; text is measured only after that.
 *  - Each scene is a Sequence at its own audio position. Transitions overlap VISUALS only: the incoming scene starts
 *    on its audio frame on top of the outgoing scene's trailing pad, so audio sync never moves.
 *  - Episode: ONE <Audio> plays narration.wav. Short: each scene plays its own window of narration.wav (trimBefore =
 *    the scene's frame in the full episode), retimed to start at 0.
 *  - A mock timeline is silent and badged; an unreviewed translation is badged.
 */
import React, {useEffect, useMemo, useState} from 'react';
import {AbsoluteFill, Html5Audio, Sequence, spring, staticFile, useCurrentFrame, useDelayRender, useVideoConfig} from 'remotion';
import type {SceneType} from './types';
import type {EpisodeProps, ResolvedEpisode} from './load';
import {loadLangFonts} from './i18n/fonts';
import {episodeSpans, shortSpans, type SceneSpan, type TransitionKind} from './timing';
import {C} from './theme';
import {EASE, frameToMs} from './motion';
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

export const SCENES: Record<SceneType, React.FC<{ctx: SceneCtx}>> = {
	hook: HookScene,
	talk: TalkScene,
	chart: ChartScene,
	steps: StepsScene,
	quote: QuoteScene,
	cta: CtaScene,
	endscreen: EndScreenScene,
};

/** Visual-only entry transition of a scene (opacity on a whole layer is allowed in transitions, ART_GUIDE CV1). */
const TransitionIn: React.FC<{kind: TransitionKind; frames: number; children: React.ReactNode}> = ({kind, frames, children}) => {
	const f = useCurrentFrame();
	const {fps, width} = useVideoConfig();
	if (kind === 'cut' || frames <= 0 || f >= frames) return <AbsoluteFill>{children}</AbsoluteFill>;
	if (kind === 'fade') return <AbsoluteFill style={{opacity: EASE.sinInOut(f / frames)}}>{children}</AbsoluteFill>;
	// slide / wipe: a no-overshoot spring (damping 200), MO16
	const p = spring({frame: f, fps, config: {damping: 200}, durationInFrames: frames});
	if (kind === 'slide') return <AbsoluteFill style={{transform: `translateX(${(1 - p) * width}px)`}}>{children}</AbsoluteFill>;
	return <AbsoluteFill style={{clipPath: `inset(0 0 0 ${(1 - p) * 100}%)`}}>{children}</AbsoluteFill>;
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
		<TransitionIn kind={span.transition} frames={span.transitionFrames}>
			<Scene ctx={ctx} />
			{r.format === 'landscape' ? <LowerThird format={r.format} lang={sb.lang} sc={sc} /> : null}
			<SourcesCard format={r.format} sb={sb} sc={sc} tl={tl} fps={30} frames={span.durationInFrames} />
		</TransitionIn>
	);
};

const EpisodeBody: React.FC<{r: ResolvedEpisode}> = ({r}) => {
	const {fps} = useVideoConfig();
	const sb = r.storyboard;
	const spans = useMemo(() => (r.format === 'vertical' ? shortSpans(sb, r.timeline, r.shortId as string, fps) : episodeSpans(sb, r.timeline, fps)), [r, sb, fps]);
	const track = useMemo(
		() => (r.captions ? captionTrack(spans.map((s) => ({fromMs: frameToMs(s.from, fps), words: r.timeline.scenes[s.index].words})), sb.lang) : []),
		[r, spans, fps, sb.lang],
	);
	const machine = sb.lang !== sb.sourceLang && sb.translation?.status !== 'native-reviewed';
	return (
		<AbsoluteFill style={{backgroundColor: C.bg}}>
			{spans.map((s) => (
				<Sequence key={s.id} from={s.from} durationInFrames={s.durationInFrames + s.tail} name={`${s.id} · ${s.type}`}>
					<SceneView r={r} span={s} />
				</Sequence>
			))}
			{sb.fiction ? (
				<Sequence from={0} durationInFrames={170} name="fiction card">
					<FictionCard format={r.format} sb={sb} />
				</Sequence>
			) : null}
			{r.captions ? <Captions track={track} format={r.format} lang={sb.lang} fps={fps} /> : null}
			<ReviewBadges format={r.format} mock={!!r.timeline.mock} machine={machine} />
			{r.narration && r.format === 'landscape' ? <Html5Audio src={staticFile(r.narration)} name="narration" /> : null}
			{r.narration && r.format === 'vertical'
				? spans.map((s) => (
						<Sequence key={`a-${s.id}`} from={s.from} durationInFrames={s.durationInFrames} name={`audio ${s.id}`}>
							<Html5Audio src={staticFile(r.narration as string)} trimBefore={s.srcFrom} />
						</Sequence>
					))
				: null}
		</AbsoluteFill>
	);
};

/** Fonts gate: blocks the render until the language's fonts are loaded, then measures and draws. */
export const EpisodeView: React.FC<EpisodeProps> = (props) => {
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
