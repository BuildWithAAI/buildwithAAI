/**
 * ShowEpisode (1920x1080) and ShowShort (1080x1920): one component, two formats. calculateMetadata (Root.tsx) has
 * already loaded, validated and resolved the storyboard and the timeline into props.resolved.
 *  - Fonts block the render until the language's faces are loaded; text is measured only after that.
 *  - One performance plan (perf/plan.ts) for the whole render; each scene is a <Sequence> at its own audio frame.
 *  - Transitions overlap VISUALS only (the outgoing scene stays under the incoming one), so audio sync never moves.
 *  - ShowEpisode plays the one continuous narration track; ShowShort plays each scene's window of it.
 *  - Every scene draws the header row: its segment tag and, for a developing story (news.developing), the DEVELOPING
 *    badge, so the label is on every frame. Review badges mark silent previews, dev fixtures and unreviewed
 *    translations (never publishable).
 */
import React, {useEffect, useMemo, useState} from 'react';
import {AbsoluteFill, Html5Audio, Sequence, spring, staticFile, useCurrentFrame, useDelayRender, useVideoConfig} from 'remotion';
import type {ShowSegment} from './types';
import type {ResolvedShow, ShowProps} from './load';
import {episodeSpans, shortSpans, type ShowSpan, type TransitionKind} from './timing';
import {planShow} from './perf/plan';
import {loadLangFonts} from '../episode/i18n/fonts';
import {EASE} from '../episode/motion';
import {G} from './graphics/theme';
import {ReviewBadges} from './graphics/parts';
import {REVIEW_POS} from './layout/boxes';
import {FRAME} from './layout/shots';
import {captionPages, ShowCaptions} from './captions/ShowCaptions';
import type {SceneCtx} from './scenes/common';
import {ColdOpen} from './scenes/ColdOpen';
import {Headline} from './scenes/Headline';
import {HowItWorked} from './scenes/HowItWorked';
import {BadgerRedFlag} from './scenes/BadgerRedFlag';
import {ZooOneFix} from './scenes/ZooOneFix';
import {ScamOfTheWeek} from './scenes/ScamOfTheWeek';
import {Correction} from './scenes/Correction';
import {Sources} from './scenes/Sources';
import {OutroEndScreen} from './scenes/OutroEndScreen';
import {Beat} from './scenes/Beat';
import {Desk} from './scenes/Desk';

export const SEGMENTS: Record<ShowSegment, React.FC<{ctx: SceneCtx}>> = {
	coldOpen: ColdOpen,
	headline: Headline,
	howItWorked: HowItWorked,
	badgerRedFlag: BadgerRedFlag,
	zooOneFix: ZooOneFix,
	scamOfTheWeek: ScamOfTheWeek,
	correction: Correction,
	sources: Sources,
	outroEndScreen: OutroEndScreen,
	beat: Beat,
	desk: Desk,
};

/** Visual-only entry transition (fading a whole layer is allowed in transitions, ART_GUIDE CV1; slide/wipe MO16). */
const TransitionIn: React.FC<{kind: TransitionKind; frames: number; children: React.ReactNode}> = ({kind, frames, children}) => {
	const f = useCurrentFrame();
	const {fps, width} = useVideoConfig();
	if (kind === 'cut' || frames <= 0 || f >= frames) return <AbsoluteFill>{children}</AbsoluteFill>;
	if (kind === 'fade') return <AbsoluteFill style={{opacity: EASE.sinInOut(f / frames)}}>{children}</AbsoluteFill>;
	const p = spring({frame: f, fps, config: {damping: 200}, durationInFrames: frames});
	if (kind === 'slide') return <AbsoluteFill style={{transform: `translateX(${(1 - p) * width}px)`}}>{children}</AbsoluteFill>;
	return <AbsoluteFill style={{clipPath: `inset(0 0 0 ${(1 - p) * 100}%)`}}>{children}</AbsoluteFill>;
};

/** True when scene k opens its segment (the previous non-beat scene was another segment). */
export const opensSegment = (spans: ShowSpan[], k: number): boolean => {
	for (let i = k - 1; i >= 0; i--) if (spans[i].segment !== 'beat') return spans[i].segment !== spans[k].segment;
	return true;
};

const ShowBody: React.FC<{r: ResolvedShow; channelName: string | null}> = ({r, channelName}) => {
	const {fps} = useVideoConfig();
	const sb = r.storyboard;
	const format = r.format;
	const spans = useMemo(() => (format === 'vertical' ? shortSpans(sb, r.timeline, r.shortId as string, fps) : episodeSpans(sb, r.timeline, fps)), [r, sb, format, fps]);
	const plan = useMemo(
		() => planShow({sb, tl: r.timeline, spans, format, fps, frames: r.durationInFrames, seed: `${sb.slug}:${sb.lang}:${format}:${r.shortId ?? 'episode'}`}),
		[sb, r, spans, format, fps],
	);
	const pages = useMemo(() => (r.captions ? captionPages(spans, r.timeline, sb.lang, fps) : []), [r, spans, sb.lang, fps]);
	const machine = sb.lang !== sb.sourceLang && sb.translation?.status !== 'native-reviewed';
	const review = [
		...(r.timeline.mock ? ['SILENT PREVIEW · mock timeline, not lip-synced'] : []),
		...(r.dev ? ['DEV FIXTURE · not real news'] : []),
		...(machine ? ['MACHINE TRANSLATION · needs native review'] : []),
	];
	const {width} = FRAME[format];
	return (
		<AbsoluteFill style={{backgroundColor: G.bg}}>
			{spans.map((s, k) => {
				const ctx: SceneCtx = {
					format,
					lang: sb.lang,
					sb,
					sc: sb.scenes[s.index],
					tl: r.timeline.scenes[s.index],
					span: s,
					k,
					seg: s.segment,
					plan,
					channelName,
					segmentStart: opensSegment(spans, k),
				};
				const Scene = SEGMENTS[s.segment];
				return (
					<Sequence key={s.id} from={s.from} durationInFrames={s.durationInFrames + s.tail} name={`${s.id} · ${s.segment}`}>
						<TransitionIn kind={s.transition} frames={s.transitionFrames}>
							<Scene ctx={ctx} />
						</TransitionIn>
					</Sequence>
				);
			})}
			{r.captions ? <ShowCaptions pages={pages} format={format} lang={sb.lang} /> : null}
			<ReviewBadges items={review} right={REVIEW_POS[format].right} bottom={REVIEW_POS[format].bottom} frameWidth={width} />
			{r.narration && format === 'landscape' ? <Html5Audio src={staticFile(r.narration)} name="narration" /> : null}
			{r.narration && format === 'vertical'
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
export const ShowView: React.FC<ShowProps> = (props) => {
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
	if (!r) throw new Error('Show: props.resolved is missing (calculateMetadata did not run)');
	if (!ready) return <AbsoluteFill style={{backgroundColor: G.bg}} />;
	return <ShowBody r={r} channelName={props.channelName ?? null} />;
};
