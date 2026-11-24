/**
 * Shared scene parts: the scene context, the character layer (ZOO + Badger in one SVG, one ground line, one scale),
 * flat cards and plates, and the text entry helpers. Flat fills and near-black outlines only (ART_GUIDE P1, SL4).
 */
import React, {useMemo} from 'react';
import {AbsoluteFill, useCurrentFrame} from 'remotion';
import {Badger, ZooRig} from '../../characters';
import type {Lang, Storyboard, StoryboardScene, TimelineScene} from '../types';
import type {ChartPlan} from '../chart/plan';
import {C, OUTLINE, R} from '../theme';
import {FRAME, type BadgerPlace, type Box, type Format, type ZooPlace} from '../layout/specs';
import {zooAt, type ZooSchedule} from '../perf/zoo';
import {badgerAt, type BadgerSchedule} from '../perf/badger';
import {directScene, type Direction, type DirectionInput} from './direction';
import {EASE} from '../motion';

export type SceneCtx = {
	format: Format;
	lang: Lang;
	sb: Storyboard;
	sc: StoryboardScene;
	tl: TimelineScene;
	fps: number;
	frames: number; // the scene's own length
	seed: string;
	chart?: ChartPlan;
};

export const useDirection = (ctx: SceneCtx, extra: Pick<DirectionInput, 'zooView' | 'badgerPlace' | 'badgerInsert'>): Direction =>
	useMemo(
		() => directScene({sc: ctx.sc, tl: ctx.tl, format: ctx.format, lang: ctx.lang, fps: ctx.fps, frames: ctx.frames, seed: ctx.seed, chart: ctx.chart, ...extra}),
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[ctx.sc, ctx.tl, ctx.format, ctx.lang, ctx.fps, ctx.frames, ctx.seed, ctx.chart, extra.zooView, extra.badgerPlace, extra.badgerInsert],
	);

export const SceneBg: React.FC<{children?: React.ReactNode}> = ({children}) => <AbsoluteFill style={{backgroundColor: C.bg}}>{children}</AbsoluteFill>;

/** Flat contact shadow under feet / paws (LS4: one flat ellipse, no blur, no opacity). Only when the ground is in frame. */
const Contact: React.FC<{x: number; y: number; rx: number; ry: number}> = ({x, y, rx, ry}) => <ellipse cx={x} cy={y} rx={rx} ry={ry} fill={C.shadow} />;

/**
 * ZOO and Badger in one SVG. Badger is drawn after ZOO when he stands in front (inFront), so overlap reads as depth.
 * Both use the placement's ground line and scale, so their relative size is the approved one.
 */
export const CharacterLayer: React.FC<{
	format: Format;
	zoo: {place: ZooPlace; schedule: ZooSchedule | null} | null;
	badger: {place: BadgerPlace; schedule: BadgerSchedule | null} | null;
	frameOffset?: number;
}> = ({format, zoo, badger, frameOffset = 0}) => {
	const frame = useCurrentFrame() + frameOffset;
	const {width, height} = FRAME[format];
	const z = zoo?.schedule ? zooAt(zoo.schedule, frame) : null;
	const b = badger?.schedule ? badgerAt(badger.schedule, frame) : null;
	const zooNode =
		zoo && z ? (
			<ZooRig
				key="zoo"
				x={zoo.place.x}
				y={zoo.place.y}
				scale={zoo.place.scale}
				view={z.view}
				pose={z.view === 'front' ? z.pose : 'stand'}
				poseAmount={z.poseAmount}
				pointWindup={z.pointWindup}
				expression={z.expression}
				mouth={z.mouth}
				blink={z.blink}
				browLift={z.browLift}
				lookX={z.lookX}
				lookY={z.lookY}
				headTilt={z.headTilt}
			/>
		) : null;
	const badgerNode =
		badger && b ? (
			<Badger
				key="badger"
				x={badger.place.x}
				y={badger.place.y}
				scale={badger.place.scale}
				view={badger.place.view}
				pose={b.pose}
				head={b.head}
				expression={b.expression}
				blink={b.blink}
				judge={b.judge}
				earsBack={b.earsBack}
				headTilt={b.headTilt}
				tailWag={b.tailWag}
				neckTurn={b.neckTurn}
				lookX={b.lookX}
				lookY={b.lookY}
			/>
		) : null;
	const shadows: React.ReactNode[] = [];
	if (zoo && z && zoo.place.y < height - 4) shadows.push(<Contact key="zs" x={zoo.place.x} y={zoo.place.y + 1} rx={118 * zoo.place.scale} ry={16 * zoo.place.scale} />);
	if (badger && b && badger.place.y < height - 4) {
		const sit = (badger.place.pose ?? 'stand') === 'sit';
		shadows.push(<Contact key="bs" x={badger.place.x + (sit ? -20 : 0) * badger.place.scale} y={badger.place.y + 1} rx={(sit ? 160 : 210) * badger.place.scale} ry={15 * badger.place.scale} />);
	}
	const front = badger?.place.inFront ?? true;
	return (
		<svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{position: 'absolute', left: 0, top: 0}}>
			{shadows}
			{front ? zooNode : badgerNode}
			{front ? badgerNode : zooNode}
		</svg>
	);
};

/** A light card with the house outline (4 px near-black, radius 16), border-box so the box is exact. */
export const Card: React.FC<{box: Box; fill?: string; radius?: number; style?: React.CSSProperties; children?: React.ReactNode}> = ({box, fill = C.card, radius = R.l, style, children}) => (
	<div
		style={{
			position: 'absolute',
			left: box.x,
			top: box.y,
			width: box.w,
			height: box.h,
			boxSizing: 'border-box',
			backgroundColor: fill,
			border: `${OUTLINE}px solid ${C.ink}`,
			borderRadius: radius,
			...style,
		}}
	>
		{children}
	</div>
);

/** Entry progress 0..1 of an item that appears at frame `at` over `len` frames (decelerate: text/UI entering, MO2). */
export const entry = (frame: number, at: number, len = 10): number => (frame < at ? 0 : frame >= at + len ? 1 : EASE.decel((frame - at) / len));

/** A clip-reveal wrapper: the content slides up from below its own box edge (no opacity, no blur). */
export const RiseClip: React.FC<{box: Box; p: number; children: React.ReactNode}> = ({box, p, children}) =>
	p <= 0 ? null : (
		<div style={{position: 'absolute', left: box.x, top: box.y, width: box.w, height: box.h, overflow: 'hidden'}}>
			<div style={{position: 'absolute', left: -box.x, top: -box.y, width: 0, height: 0, transform: `translateY(${(1 - p) * box.h}px)`}}>{children}</div>
		</div>
	);
