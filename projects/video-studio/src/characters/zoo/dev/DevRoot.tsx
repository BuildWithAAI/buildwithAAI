/**
 * Dev compositions for the ZOO rig. Each viewBox reproduces the framing of the matching reference
 * crop in reference/crops/ (crop pixel -> world unit mapping measured from the crops), so a render
 * can be compared and overlaid 1:1 with the approved drawing.
 */
import React from 'react';
import {AbsoluteFill, Composition, useCurrentFrame} from 'remotion';
import {BRAND} from '../../palette';
import type {Expression, MouthShape} from '../../types';
import {ZooRig} from '../Zoo';

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
const EXPR34_VB = '-118 -915.38 279.6 279.6';
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

export const ZooFrontDev: React.FC = () => (
	<Bg>
		<svg width="100%" height="100%" viewBox={FRONT_VB}>
			<ZooRig />
		</svg>
	</Bg>
);

const EXPRS: Expression[] = ['neutral', 'happy', 'worried', 'shocked'];
export const ZooExpressionsDev: React.FC = () => (
	<Bg>
		<div style={{display: 'flex', width: '100%', height: '100%'}}>
			{EXPRS.map((e) => (
				<svg key={e} width={400} height={400} viewBox={EXPR_VB}>
					<ZooRig expression={e} />
				</svg>
			))}
		</div>
	</Bg>
);

const MOUTHS: MouthShape[] = ['closed', 'slightlyOpen', 'ah', 'ee', 'oh', 'mbp'];
export const ZooMouthsDev: React.FC = () => (
	<Bg>
		<div style={{display: 'flex', flexWrap: 'wrap', width: '100%', height: '100%'}}>
			{MOUTHS.map((m) => (
				<svg key={m} width={340} height={220} viewBox={MOUTH_VB}>
					<ZooRig mouth={m} />
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

export const ZooDevRoot: React.FC = () => (
	<>
		<Composition id="ZooFront" component={ZooFrontDev} durationInFrames={1} fps={30} width={600} height={1320} />
		<Composition id="ZooExpressions" component={ZooExpressionsDev} durationInFrames={1} fps={30} width={1600} height={400} />
		<Composition id="ZooMouths" component={ZooMouthsDev} durationInFrames={1} fps={30} width={1020} height={440} />
		<Composition id="ZooPoint" component={ZooPointDev} durationInFrames={31} fps={30} width={840} height={1040} defaultProps={{amount: 1}} />
		<Composition id="ZooPointSweep" component={ZooPointDev} durationInFrames={31} fps={30} width={840} height={1040} />
		<Composition id="ZooIdle" component={ZooIdleDev} durationInFrames={120} fps={30} width={600} height={1320} />
		<Composition id="ZooMatrix" component={ZooMatrixDev} durationInFrames={1} fps={30} width={1600} height={800} />
		<Composition id="ZooExpressions34" component={ZooExpressions34Dev} durationInFrames={1} fps={30} width={1600} height={400} />
		<Composition id="ZooMouths34" component={ZooMouths34Dev} durationInFrames={1} fps={30} width={1020} height={440} />
		<Composition id="Zoo34" component={ZooViewDev} durationInFrames={1} fps={30} width={640} height={1320} defaultProps={{view: 'threeQuarter' as const}} />
		<Composition id="ZooSide" component={ZooViewDev} durationInFrames={1} fps={30} width={560} height={1320} defaultProps={{view: 'side' as const}} />
		<Composition id="ZooBack" component={ZooViewDev} durationInFrames={1} fps={30} width={640} height={1320} defaultProps={{view: 'back' as const}} />
	</>
);
