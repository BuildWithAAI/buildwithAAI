/**
 * Dev compositions for the ZOO rig. Each viewBox reproduces the framing of the matching reference
 * crop in reference/crops/ (crop pixel -> world unit mapping measured from the crops), so a render
 * can be compared and overlaid 1:1 with the approved drawing.
 */
import React from 'react';
import {AbsoluteFill, Composition, useCurrentFrame} from 'remotion';
import {BRAND} from '../../palette';
import type {Expression, MouthShape, ZooPose, ZooView} from '../../types';
import {ZooRig} from '../Zoo';
import {Chair, Desk, Keyboard, Monitor} from '../props';
import {TYPING_LAYOUT} from '../views/Typing';

const Bg: React.FC<{children: React.ReactNode}> = ({children}) => <AbsoluteFill style={{backgroundColor: BRAND.background}}>{children}</AbsoluteFill>;

/** zoo_turn_front.png: 300x660 px, 1 px = 900/630 u, ground at crop y=640, centre x=150. */
const FRONT_VB = '-214.29 -914.29 428.57 942.86';
/** zoo_expr_*.png: 400x400 px, 1 px = 0.699 u, face centre x=217, hair top y=22. */
const EXPR_VB = '-151.68 -915.38 279.6 279.6';
/** zoo_mouth_*.png: 340x220 px, 1 px = 0.4116 u, moustache top y=48. */
const MOUTH_VB = '-69.97 -804.76 139.94 90.55';
/** zoo_pose_point.png: 420x520 px, 1 px = 1.837 u, figure centre x=190, ground y=505. */
const POINT_VB = '-349.03 -927.69 771.54 955.24';

/** zoo_turn_34.png: 320x660 px, origin crop (154, 640), 1 px = 900/630 u. */
const TQ_VB = '-220 -914.29 457.14 942.86';
/** zoo_turn_side.png: 280x660 px, origin crop (150, 640). */
const SIDE_VB = '-214.29 -914.29 400 942.86';
/** zoo_turn_back.png: 320x660 px, origin crop (154.5, 640). */
const BACK_VB = '-220.71 -914.29 457.14 942.86';

/** One turnaround view framed like its reference crop (for 1:1 comparison). */
export const ZooViewDev: React.FC<{view: 'threeQuarter' | 'side' | 'back'; expression?: Expression; mouth?: MouthShape}> = ({view, expression, mouth}) => (
	<Bg>
		<svg width="100%" height="100%" viewBox={view === 'threeQuarter' ? TQ_VB : view === 'side' ? SIDE_VB : BACK_VB}>
			<ZooRig view={view} expression={expression} mouth={mouth} />
		</svg>
	</Bg>
);

/** 3/4 busts: same framing scale as the front expression busts, centred on the 3/4 face. */
const EXPR34_VB = '-140 -915.38 279.6 279.6';
export const ZooExpressions34Dev: React.FC = () => (
	<Bg>
		<div style={{display: 'flex', width: '100%', height: '100%'}}>
			{EXPRS.map((e) => (
				<svg key={e} width={400} height={400} viewBox={EXPR34_VB}>
					<ZooRig view="threeQuarter" expression={e} />
				</svg>
			))}
		</div>
	</Bg>
);

/** 3/4 mouth library: six shapes framed like zoo_mouth_*.png, centred on the 3/4 mouth. */
const MOUTH34_VB = '-40.97 -804.76 139.94 90.55';
export const ZooMouths34Dev: React.FC = () => (
	<Bg>
		<div style={{display: 'flex', flexWrap: 'wrap', width: '100%', height: '100%'}}>
			{MOUTHS.map((m) => (
				<svg key={m} width={340} height={220} viewBox={MOUTH34_VB}>
					<ZooRig view="threeQuarter" mouth={m} />
				</svg>
			))}
		</div>
	</Bg>
);

/** Side heads: the six mouth shapes, then the four expressions (profile facing screen right). */
const SIDE_HEAD_VB = '-30 -860 125 125';
export const ZooSideHeadsDev: React.FC = () => (
	<Bg>
		<div style={{display: 'flex', flexWrap: 'wrap', width: '100%', height: '100%'}}>
			{MOUTHS.map((m) => (
				<svg key={m} width={300} height={300} viewBox={SIDE_HEAD_VB}>
					<ZooRig view="side" mouth={m} />
				</svg>
			))}
			{EXPRS.map((e) => (
				<svg key={e} width={300} height={300} viewBox={SIDE_HEAD_VB}>
					<ZooRig view="side" expression={e} />
				</svg>
			))}
		</div>
	</Bg>
);

/** zoo_pose_typing.png: 520x500 px framed at 1.555 u/px, origin crop (252, 478) (decision ZOO-T1). */
const TYPING_VB = '-391.86 -743.29 808.6 777.5';
const L = TYPING_LAYOUT;
/** Seated typing pose with its props; finger taps run from the frame. */
export const ZooTypingDev: React.FC<{typing?: boolean}> = ({typing = true}) => (
	<Bg>
		<svg width="100%" height="100%" viewBox={TYPING_VB}>
			<Chair x={L.chair.x} y={L.chair.y} />
			<ZooRig
				pose="typing"
				typing={typing}
				between={
					<>
						<Desk x={L.desk.x} y={L.desk.y} />
						<Monitor x={L.monitor.x} y={L.monitor.y} />
						<Keyboard x={L.keyboard.x} y={L.keyboard.y} />
					</>
				}
			/>
		</svg>
	</Bg>
);

/**
 * Turnaround row laid out like the sheet: view origins at sheet x = 445 / 707 / 955 / 1187.25 px on the
 * ground line y = 320 px, 1 sheet px = 900/315 u (crop offsets found by matching the crops in the sheet).
 * viewBox = sheet region x 340..1290, y 0..350.
 */
const TURN_U = 900 / 315;
const TURN_X = {front: 0, threeQuarter: (707 - 445) * TURN_U, side: (955 - 445) * TURN_U, back: (1187.25 - 445) * TURN_U} as const;
const TURN_VB = `${(340 - 445) * TURN_U} ${-320 * TURN_U} ${950 * TURN_U} ${350 * TURN_U}`;
const TURN_LABELS: [keyof typeof TURN_X, string][] = [['front', 'Front'], ['threeQuarter', '3/4'], ['side', 'Side'], ['back', 'Back']];
export const ZooTurnaroundDev: React.FC = () => (
	<Bg>
		<svg width="100%" height="100%" viewBox={TURN_VB}>
			<line x1={(360 - 445) * TURN_U} y1={1.5} x2={(1270 - 445) * TURN_U} y2={1.5} stroke={BRAND.nearBlack} strokeWidth={3} />
			{TURN_LABELS.map(([v, label]) => (
				<g key={v}>
					<ZooRig view={v} x={TURN_X[v]} breathe={false} />
					<text x={TURN_X[v]} y={58} textAnchor="middle" fontFamily="sans-serif" fontWeight={700} fontSize={44} fill={BRAND.nearBlack}>
						{label}
					</text>
				</g>
			))}
		</svg>
	</Bg>
);

const VIEW_MATRIX: Array<React.ComponentProps<typeof ZooRig>> = [
	{view: 'threeQuarter', expression: 'happy', mouth: 'ee', headTilt: 6},
	{view: 'threeQuarter', expression: 'worried', blink: 0.6, lookX: -1},
	{view: 'threeQuarter', expression: 'shocked', blink: 1},
	{view: 'threeQuarter', mouth: 'oh', lookY: 1, browLift: 1},
	{view: 'side', expression: 'worried', mouth: 'ah', headTilt: -6},
	{view: 'side', blink: 1, lookX: -1},
	{view: 'back', headTilt: 8},
	{view: 'threeQuarter', showPivots: true},
];
/** Combination check for the extra views (expression x explicit mouth x blink/tilt/look extremes). */
export const ZooViewsMatrixDev: React.FC = () => (
	<Bg>
		<div style={{display: 'flex', flexWrap: 'wrap', width: '100%', height: '100%'}}>
			{VIEW_MATRIX.map((p, i) => (
				<svg key={i} width={400} height={400} viewBox={p.view === 'back' ? '-140 -915.38 279.6 279.6' : p.view === 'side' ? '-110 -915.38 279.6 279.6' : '-140 -915.38 279.6 279.6'}>
					<ZooRig {...p} breathe={false} />
				</svg>
			))}
		</div>
	</Bg>
);

/** Same typing scene drawn as two ZOO layers around the desk set (layer="back" / layer="front"). */
export const ZooTypingLayersDev: React.FC = () => (
	<Bg>
		<svg width="100%" height="100%" viewBox={TYPING_VB}>
			<Chair x={L.chair.x} y={L.chair.y} />
			<ZooRig pose="typing" typing layer="back" />
			<Desk x={L.desk.x} y={L.desk.y} />
			<Monitor x={L.monitor.x} y={L.monitor.y} />
			<Keyboard x={L.keyboard.x} y={L.keyboard.y} />
			<ZooRig pose="typing" typing layer="front" showPivots />
		</svg>
	</Bg>
);

export const ZooFrontDev: React.FC = () => (
	<Bg>
		<svg width="100%" height="100%" viewBox={FRONT_VB}>
			<ZooRig />
		</svg>
	</Bg>
);

const EXPRS: Expression[] = ['neutral', 'happy', 'worried', 'shocked'];
/** lineScale: 1 = LINE widths; ~0.55 reproduces the sheet's bust line weight at this framing. */
export const ZooExpressionsDev: React.FC<{lineScale?: number; browLift?: number}> = ({lineScale = 1, browLift = 0}) => (
	<Bg>
		<div style={{display: 'flex', width: '100%', height: '100%'}}>
			{EXPRS.map((e) => (
				<svg key={e} width={400} height={400} viewBox={EXPR_VB}>
					<ZooRig expression={e} lineScale={lineScale} browLift={browLift} breathe={false} />
				</svg>
			))}
		</div>
	</Bg>
);

const MOUTHS: MouthShape[] = ['closed', 'slightlyOpen', 'ah', 'ee', 'oh', 'mbp'];
export const ZooMouthsDev: React.FC<{lineScale?: number}> = ({lineScale = 1}) => (
	<Bg>
		<div style={{display: 'flex', flexWrap: 'wrap', width: '100%', height: '100%'}}>
			{MOUTHS.map((m) => (
				<svg key={m} width={340} height={220} viewBox={MOUTH_VB}>
					<ZooRig mouth={m} lineScale={lineScale} breathe={false} />
				</svg>
			))}
		</div>
	</Bg>
);

export const ZooPointDev: React.FC<{amount?: number}> = ({amount}) => {
	const frame = useCurrentFrame();
	const a = amount ?? Math.min(1, frame / 30);
	return (
		<Bg>
			<svg width="100%" height="100%" viewBox={POINT_VB}>
				<ZooRig pose="point" poseAmount={a} />
			</svg>
		</Bg>
	);
};

/** Idle preview: blink, brow lift, look and breathing over 4 s. */
export const ZooIdleDev: React.FC = () => {
	const frame = useCurrentFrame();
	const blink = frame >= 40 && frame <= 46 ? 1 - Math.abs(frame - 43) / 3 : 0;
	const browLift = frame >= 60 && frame <= 90 ? Math.sin(((frame - 60) / 30) * Math.PI) : 0;
	return (
		<Bg>
			<svg width="100%" height="100%" viewBox={FRONT_VB}>
				<ZooRig blink={blink} browLift={browLift} lookX={frame > 95 ? 0.6 : 0} />
			</svg>
		</Bg>
	);
};

const MATRIX: Array<React.ComponentProps<typeof ZooRig>> = [
	{expression: 'happy', mouth: 'ee'},
	{expression: 'worried', mouth: 'ah'},
	{expression: 'shocked', mouth: 'mbp'},
	{expression: 'neutral', blink: 0.5, headTilt: 7, lookX: -1},
	{expression: 'happy', mouth: 'oh', headTilt: -7, lookY: 1},
	{expression: 'worried', mouth: 'slightlyOpen', lookX: 1, lookY: -1},
	{expression: 'shocked', blink: 1},
	{expression: 'neutral', browLift: 1, mouth: 'ah'},
];
/** Combination check: expression x explicit mouth x blink/tilt/look extremes. */
export const ZooMatrixDev: React.FC = () => (
	<Bg>
		<div style={{display: 'flex', flexWrap: 'wrap', width: '100%', height: '100%'}}>
			{MATRIX.map((p, i) => (
				<svg key={i} width={400} height={400} viewBox={EXPR_VB}>
					<ZooRig {...p} />
				</svg>
			))}
		</div>
	</Bg>
);

/** High-resolution head close-up for world-space overlays: 6 px per unit, world box x -100..90, y -905..-730. */
const HEAD_VB = '-100 -905 190 175';
export const ZooHeadDev: React.FC<React.ComponentProps<typeof ZooRig>> = (p) => (
	<Bg>
		<svg width="100%" height="100%" viewBox={HEAD_VB}>
			<ZooRig breathe={false} {...p} />
		</svg>
	</Bg>
);

/**
 * High-resolution zoom on any world box of a view (repair round 3: hands and shoes are compared against the 2x crops at
 * 8-10 px per unit). The box's top-left maps to the image's top-left at min(1200 / w, 1200 / h) px per unit.
 */
export const ZooZoomDev: React.FC<{view?: ZooView; box: [number, number, number, number]; lineScale?: number; pose?: ZooPose; poseAmount?: number}> = ({
	view = 'front',
	box,
	lineScale = 1,
	pose,
	poseAmount,
}) => (
	<Bg>
		<svg width="100%" height="100%" viewBox={box.join(' ')} preserveAspectRatio="xMinYMin meet">
			<ZooRig view={view} pose={pose} poseAmount={poseAmount} lineScale={lineScale} breathe={false} />
		</svg>
	</Bg>
);

/**
 * The front figure at the three delivery framings (repair round 3): the asset sheet (0.54 px/u, lineScale 1.59), the proof
 * pair (0.88 px/u, lineScale 1) and ZooFront (1.4 px/u, lineScale 1), side by side, top-aligned.
 */
const SCALES: [number, number][] = [
	[0.54, 1.59],
	[0.88, 1],
	[1.4, 1],
];
export const ZooScalesDev: React.FC<{view?: ZooView; expression?: Expression}> = ({view = 'front', expression}) => (
	<Bg>
		<div style={{display: 'flex', alignItems: 'flex-start', gap: 20}}>
			{SCALES.map(([k, ls]) => (
				<svg key={k} width={428.57 * k} height={942.86 * k} viewBox={FRONT_VB}>
					<ZooRig view={view} expression={expression} lineScale={ls} breathe={false} />
				</svg>
			))}
		</div>
	</Bg>
);

/**
 * The four expressions at the three face framings (repair round 5): one row per expression, framed like zoo_expr_*.png
 * (EXPR_VB) at the crop's 1.43 px/u (400 px, lineScale 1, as ZooExpressions), the ZooSheet bust (322 px = 1.15 px/u,
 * lineScale 0.74) and the proof pair's 0.88 px/u (246 px, lineScale 1).
 */
const FACE_SCALES: [number, number][] = [
	[400, 1],
	[322, 0.74],
	[246, 1],
];
export const ZooFaceScalesDev: React.FC<{view?: ZooView}> = ({view = 'front'}) => (
	<Bg>
		<div style={{display: 'flex', flexDirection: 'column', gap: 10}}>
			{EXPRS.map((e) => (
				<div key={e} style={{display: 'flex', alignItems: 'flex-start', gap: 10}}>
					{FACE_SCALES.map(([px, ls]) => (
						<svg key={px} width={px} height={px} viewBox={view === 'front' ? EXPR_VB : EXPR34_VB}>
							<ZooRig view={view} expression={e} lineScale={ls} breathe={false} />
						</svg>
					))}
				</div>
			))}
		</div>
	</Bg>
);

export const ZooDevRoot: React.FC = () => (
	<>
		<Composition id="ZooZoom" component={ZooZoomDev} durationInFrames={1} fps={30} width={1200} height={1200} defaultProps={{view: 'front' as ZooView, box: [70, -440, 80, 120] as [number, number, number, number], lineScale: 1}} />
		<Composition id="ZooScales" component={ZooScalesDev} durationInFrames={1} fps={30} width={1340} height={1320} defaultProps={{view: 'front' as ZooView}} />
		<Composition id="ZooFaceScales" component={ZooFaceScalesDev} durationInFrames={1} fps={30} width={988} height={1630} defaultProps={{view: 'front' as ZooView}} />
		<Composition id="ZooHead" component={ZooHeadDev} durationInFrames={1} fps={30} width={1140} height={1050} defaultProps={{lineScale: 0.55}} />
		<Composition id="ZooFront" component={ZooFrontDev} durationInFrames={1} fps={30} width={600} height={1320} />
		<Composition id="ZooExpressions" component={ZooExpressionsDev} durationInFrames={1} fps={30} width={1600} height={400} />
		<Composition id="ZooMouths" component={ZooMouthsDev} durationInFrames={1} fps={30} width={1020} height={440} />
		<Composition id="ZooPoint" component={ZooPointDev} durationInFrames={31} fps={30} width={840} height={1040} defaultProps={{amount: 1}} />
		<Composition id="ZooPointSweep" component={ZooPointDev} durationInFrames={31} fps={30} width={840} height={1040} />
		<Composition id="ZooIdle" component={ZooIdleDev} durationInFrames={120} fps={30} width={600} height={1320} />
		<Composition id="ZooMatrix" component={ZooMatrixDev} durationInFrames={1} fps={30} width={1600} height={800} />
		<Composition id="ZooExpressions34" component={ZooExpressions34Dev} durationInFrames={1} fps={30} width={1600} height={400} />
		<Composition id="ZooMouths34" component={ZooMouths34Dev} durationInFrames={1} fps={30} width={1020} height={440} />
		<Composition id="ZooSideHeads" component={ZooSideHeadsDev} durationInFrames={1} fps={30} width={1500} height={600} />
		<Composition id="ZooTurnaround" component={ZooTurnaroundDev} durationInFrames={1} fps={30} width={1900} height={700} />
		<Composition id="ZooViewsMatrix" component={ZooViewsMatrixDev} durationInFrames={1} fps={30} width={1600} height={800} />
		<Composition id="ZooTypingLayers" component={ZooTypingLayersDev} durationInFrames={30} fps={30} width={1040} height={1000} />
		<Composition id="ZooTyping" component={ZooTypingDev} durationInFrames={90} fps={30} width={1040} height={1000} />
		<Composition id="Zoo34" component={ZooViewDev} durationInFrames={1} fps={30} width={640} height={1320} defaultProps={{view: 'threeQuarter' as const}} />
		<Composition id="ZooSide" component={ZooViewDev} durationInFrames={1} fps={30} width={560} height={1320} defaultProps={{view: 'side' as const}} />
		<Composition id="ZooBack" component={ZooViewDev} durationInFrames={1} fps={30} width={640} height={1320} defaultProps={{view: 'back' as const}} />
	</>
);
