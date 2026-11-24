/**
 * Shared scene plumbing: the scene context, the camera stage for the scene's shot (characters from the global
 * performance plan), card entry, and the per-scene source line.
 */
import React from 'react';
import {useCurrentFrame} from 'remotion';
import type {Format, Lang, ShowScene, ShowSegment, ShowStoryboard} from '../types';
import type {TimelineScene} from '../../episode/types';
import type {ShowSpan} from '../timing';
import {badgerStateAt, pushAt, zooStateAt, type ShowPlan} from '../perf/plan';
import {FRAME, shotFor} from '../layout/shots';
import {SEGMENT_BOXES, type SegmentBoxes} from '../layout/boxes';
import {StageLayer} from '../set/Stage';
import {Enter, SourceLine, type Box} from '../graphics/parts';
import {scenePublishers} from '../sources';
import {showLabel} from '../ui';

export type SceneCtx = {
	format: Format;
	lang: Lang;
	sb: ShowStoryboard;
	sc: ShowScene;
	tl: TimelineScene;
	span: ShowSpan;
	k: number; // index of the span in plan.spans
	seg: ShowSegment;
	plan: ShowPlan;
	channelName: string | null;
	/** True when the previous scene was another segment (the tag and cards make their entrance). */
	segmentStart: boolean;
};

export const frameSize = (format: Format) => FRAME[format];
export const boxesOf = (ctx: SceneCtx): SegmentBoxes => SEGMENT_BOXES[ctx.format][ctx.seg];

/** The set through this scene's camera, with Zoo and Badger as the plan has them at this frame. */
export const SceneStage: React.FC<{ctx: SceneCtx}> = ({ctx}) => {
	const local = useCurrentFrame();
	const g = ctx.span.from + local;
	const sp = ctx.plan.scenes[ctx.k];
	if (sp.shot === 'none') return null;
	const base = shotFor(ctx.format, sp.shot);
	// a Short's graphics card covers the wall: drop the wall dressing behind it rather than let it peek out
	const shot = ctx.format === 'vertical' && sp.hasCard && ctx.seg !== 'coldOpen' ? {...base, dressing: {logo: false, onAir: false}} : base;
	return (
		<StageLayer
			format={ctx.format}
			shot={shot}
			zoo={shot.cast.includes('zoo') ? zooStateAt(ctx.plan, ctx.k, g) : null}
			badger={shot.cast.includes('badger') ? badgerStateAt(ctx.plan, g) : null}
			push={pushAt(ctx.plan, ctx.k, g)}
			onAir={g >= ctx.plan.onAirFrom}
			breathFrame={g}
			channelName={ctx.channelName}
		/>
	);
};

/** A card that slides in from its side when its segment starts (and is simply there on a continuing scene). */
export const CardIn: React.FC<{ctx: SceneCtx; box: Box; at: number; children: React.ReactNode}> = ({ctx, box, at, children}) => {
	const b = boxesOf(ctx);
	if (!ctx.segmentStart) return <>{children}</>;
	return (
		<Enter at={at} from={b.from} box={box} frameSize={frameSize(ctx.format)}>
			{children}
		</Enter>
	);
};

/** "Source: ..." for the facts this scene states, under its card. */
export const SceneSource: React.FC<{ctx: SceneCtx; box?: Box | null}> = ({ctx, box}) => {
	const b = box === undefined ? boxesOf(ctx).source : box;
	const pubs = scenePublishers(ctx.sb, ctx.sc);
	if (!b || !pubs.length) return null;
	return <SourceLine label={showLabel(ctx.sb, 'source')} publishers={pubs} box={b} lang={ctx.lang} />;
};
