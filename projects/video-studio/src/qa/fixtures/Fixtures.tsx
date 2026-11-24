/**
 * Visual QA fixtures: small compositions with one planted defect class each, plus a clean control. They are the
 * checker's regression suite (scripts/qa/selftest.ts) and never part of a published video. Characters are the
 * canonical assets from src/characters; every defect is planted by the scene around them, the way real scene
 * code would introduce it.
 */
import React, {useEffect, useState} from 'react';
import {AbsoluteFill, continueRender, delayRender, useCurrentFrame} from 'remotion';
import {Badger} from '../../characters/badger/Badger';
import {ZooRig} from '../../characters/zoo/Zoo';
import {BRAND} from '../../characters/palette';
import {FONTS, loadBrandFonts} from '../../brand/fonts';
import {BADGER_X, GROUND_Y, PAIR_SCALE, ZOO_X} from '../../compositions/characters/stage';

const useFonts = () => {
	const [h] = useState(() => delayRender('qa fixture fonts'));
	useEffect(() => {
		loadBrandFonts().then(() => continueRender(h));
	}, [h]);
};

const Stage: React.FC<{children?: React.ReactNode; bg?: string}> = ({children, bg = BRAND.background}) => {
	useFonts();
	return <AbsoluteFill style={{backgroundColor: bg}}>{children}</AbsoluteFill>;
};

/** Zoo and Badger as Preview10s stages them (one svg, one scale, one ground line). */
const Pair: React.FC<{zoo?: React.ReactNode; badger?: React.ReactNode; width?: number; height?: number}> = ({zoo, badger, width = 1920, height = 1080}) => (
	<svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{position: 'absolute', left: 0, top: 0}}>
		{zoo ?? <ZooRig x={ZOO_X} y={GROUND_Y} scale={PAIR_SCALE} view="front" />}
		{badger ?? <Badger x={BADGER_X} y={GROUND_Y} scale={PAIR_SCALE} view="left" head="front" />}
	</svg>
);

const label = (extra: React.CSSProperties): React.CSSProperties => ({position: 'absolute', fontFamily: FONTS.heading, fontWeight: 800, color: BRAND.nearBlack, ...extra});

/** A caption plate (its component name marks it as a caption for the checker, like the episode's Captions). */
const FixtureCaption: React.FC<{x: number; y: number; w: number; text: string}> = ({x, y, w, text}) => (
	<div style={{position: 'absolute', left: x, top: y, width: w, padding: '14px 28px', boxSizing: 'border-box', backgroundColor: BRAND.offWhite, border: `3px solid ${BRAND.nearBlack}`, borderRadius: 16}}>
		<div style={{fontFamily: FONTS.heading, fontWeight: 900, fontSize: 48, lineHeight: '56px', textAlign: 'center', color: BRAND.nearBlack}}>{text}</div>
	</div>
);

/** Control: nothing wrong. */
export const QaFxClean: React.FC = () => (
	<Stage>
		<Pair />
		<div style={label({left: 120, top: 110, fontSize: 60})}>Clean control</div>
		<FixtureCaption x={1180} y={880} w={600} text="Nothing to see here." />
	</Stage>
);

/**
 * Text: a clipped headline, a label running off its card, a label off the frame edge, tiny text, and the host's name painted
 * in capitals by a CSS uppercase style (the source string is title case).
 */
export const QaFxText: React.FC = () => (
	<Stage>
		<div style={{position: 'absolute', left: 160, top: 160, width: 320, height: 70, overflow: 'hidden'}}>
			<div style={label({position: 'static', fontSize: 52, whiteSpace: 'nowrap'})}>This headline is far too long</div>
		</div>
		{/* a fixed-width card whose label runs off its right edge */}
		<div style={{position: 'absolute', left: 160, top: 340, width: 300, padding: '12px 20px', boxSizing: 'border-box', backgroundColor: BRAND.offWhite, border: `3px solid ${BRAND.nearBlack}`, borderRadius: 8}}>
			<div style={label({position: 'static', fontSize: 44, whiteSpace: 'nowrap'})}>Spills off its card</div>
		</div>
		<div style={label({left: 1640, top: 560, fontSize: 56, whiteSpace: 'nowrap'})}>Cut by the edge</div>
		<div style={label({left: 160, top: 760, fontSize: 16, fontFamily: FONTS.body, fontWeight: 600})}>Tiny legal line nobody can read</div>
		<div style={label({left: 160, top: 880, fontSize: 44, textTransform: 'uppercase'})}>Hosted by Zoo</div>
		{/* a title and its source line laid out on top of each other */}
		<div style={label({left: 760, top: 300, fontSize: 56, whiteSpace: 'nowrap'})}>Bridge drained overnight</div>
		<div style={label({left: 980, top: 318, fontSize: 40, fontFamily: FONTS.body, fontWeight: 600, whiteSpace: 'nowrap'})}>Source: Example Wire</div>
	</Stage>
);

/** Safe area (16:9): a label in the corner and Zoo's head against the left edge. */
export const QaFxSafe: React.FC = () => (
	<Stage>
		<Pair zoo={<ZooRig x={70} y={GROUND_Y} scale={PAIR_SCALE} view="front" />} badger={<Badger x={1300} y={GROUND_Y} scale={PAIR_SCALE} view="left" head="front" />} />
		<div style={label({left: 24, top: 18, fontSize: 40})}>Corner label</div>
	</Stage>
);

/** Shorts (9:16): a caption in the bottom overlay and a label under the action buttons. */
export const QaFxShorts: React.FC = () => (
	<Stage>
		<div style={label({left: 160, top: 420, width: 760, fontSize: 72, textAlign: 'center'})}>Safe headline</div>
		<FixtureCaption x={140} y={1640} w={800} text="Caption under the UI" />
		<div style={label({left: 700, top: 1180, width: 370, fontSize: 40, textAlign: 'right'})}>Under the buttons</div>
	</Stage>
);

/** Captions and text over faces, and artwork covering a face. */
export const QaFxFaces: React.FC = () => (
	<Stage>
		<Pair />
		{/* Zoo's head spans about x 604-742, y 126-292 at this placement */}
		<FixtureCaption x={420} y={180} w={520} text="Over his face" />
		{/* Badger's head spans about x 934-1107, y 514-645 */}
		<div style={label({left: 930, top: 560, fontSize: 40, whiteSpace: 'nowrap'})}>Label on Badger</div>
	</Stage>
);

/** A grey prop panel painted over Zoo's face (no text): the face-coverage check. */
export const QaFxOccluded: React.FC = () => (
	<Stage>
		<Pair />
		<div style={{position: 'absolute', left: 590, top: 150, width: 170, height: 150, backgroundColor: BRAND.silver, border: `3px solid ${BRAND.nearBlack}`, borderRadius: 8}} />
	</Stage>
);

/** Contrast: silver on the light background fails, near-black passes. */
export const QaFxContrast: React.FC = () => (
	<Stage>
		<div style={label({left: 200, top: 300, fontSize: 64, color: BRAND.silver})}>Pale and unreadable</div>
		<div style={label({left: 200, top: 520, fontSize: 64})}>Dark and readable</div>
	</Stage>
);

/** Off-model: Zoo and Badger mirrored to fake the other view (det < 0, pin and ear cap on the wrong side). */
export const QaFxMirror: React.FC = () => (
	<Stage>
		<svg width={1920} height={1080} viewBox="0 0 1920 1080" style={{position: 'absolute', left: 0, top: 0}}>
			<g transform={`translate(${2 * ZOO_X} 0) scale(-1 1)`}>
				<ZooRig x={ZOO_X} y={GROUND_Y} scale={PAIR_SCALE} view="front" />
			</g>
			<g transform={`translate(${2 * BADGER_X} 0) scale(-1 1)`}>
				<Badger x={BADGER_X} y={GROUND_Y} scale={PAIR_SCALE} view="front" />
			</g>
		</svg>
	</Stage>
);

/** Off-model: Badger stretched 25% wide. */
export const QaFxStretch: React.FC = () => (
	<Stage>
		<svg width={1920} height={1080} viewBox="0 0 1920 1080" style={{position: 'absolute', left: 0, top: 0}}>
			<ZooRig x={ZOO_X} y={GROUND_Y} scale={PAIR_SCALE} view="front" />
			<g transform={`translate(${BADGER_X} 0) scale(1.25 1) translate(${-BADGER_X} 0)`}>
				<Badger x={BADGER_X} y={GROUND_Y} scale={PAIR_SCALE} view="left" head="front" />
			</g>
		</svg>
	</Stage>
);

/** Off-model: a "night look" hue filter on Zoo (recolours the asset; also a banned technique). */
export const QaFxFilter: React.FC = () => (
	<Stage>
		<svg width={1920} height={1080} viewBox="0 0 1920 1080" style={{position: 'absolute', left: 0, top: 0}}>
			<g style={{filter: 'hue-rotate(150deg) saturate(1.6)'}}>
				<ZooRig x={ZOO_X} y={GROUND_Y} scale={PAIR_SCALE} view="front" />
			</g>
			<Badger x={BADGER_X} y={GROUND_Y} scale={PAIR_SCALE} view="left" head="front" />
		</svg>
	</Stage>
);

/** Off-model: Badger cropped by a clip path (half his coat markings gone). */
export const QaFxClip: React.FC = () => (
	<Stage>
		<svg width={1920} height={1080} viewBox="0 0 1920 1080" style={{position: 'absolute', left: 0, top: 0}}>
			<defs>
				<clipPath id="qa-fx-clip">
					<rect x={0} y={0} width={BADGER_X + 20} height={1080} />
				</clipPath>
			</defs>
			<ZooRig x={ZOO_X} y={GROUND_Y} scale={PAIR_SCALE} view="front" />
			<g clipPath="url(#qa-fx-clip)">
				<Badger x={BADGER_X} y={GROUND_Y} scale={PAIR_SCALE} view="left" head="front" />
			</g>
		</svg>
	</Stage>
);

/** Off-model: a scene-drawn stand-in that claims to be Zoo (not the canonical asset). */
export const QaFxForgery: React.FC = () => (
	<Stage>
		<svg width={1920} height={1080} viewBox="0 0 1920 1080" style={{position: 'absolute', left: 0, top: 0}}>
			<g data-character="zoo" data-view="front" transform={`translate(${ZOO_X} ${GROUND_Y}) scale(${PAIR_SCALE})`}>
				<rect x={-120} y={-740} width={240} height={740} rx={30} fill={BRAND.slate} stroke={BRAND.nearBlack} strokeWidth={4} />
				<circle cx={0} cy={-820} r={80} fill="#F3BE9B" stroke={BRAND.nearBlack} strokeWidth={4} />
			</g>
			<Badger x={BADGER_X} y={GROUND_Y} scale={PAIR_SCALE} view="left" head="front" />
		</svg>
	</Stage>
);

/** Banding and blotches: a dark gradient background and a turbulence-noise panel. */
export const QaFxBanding: React.FC = () => (
	<AbsoluteFill style={{backgroundImage: `linear-gradient(180deg, #2A2B31 0%, ${BRAND.nearBlack} 100%)`}}>
		<svg width={1920} height={1080} style={{position: 'absolute', left: 0, top: 0}}>
			<defs>
				<filter id="qa-fx-noise" x="0" y="0" width="100%" height="100%">
					<feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves={2} seed={7} />
					<feColorMatrix type="saturate" values="0" />
				</filter>
			</defs>
			<rect x={1200} y={200} width={520} height={520} filter="url(#qa-fx-noise)" />
		</svg>
	</AbsoluteFill>
);

/** Card top per frame: hidden above the frame, a fast drop (up to 170 px per frame) from frame 6, settled at 12. */
const CARD_TOPS = [-420, -420, -420, -420, -420, -420, -250, -80, 60, 140, 180, 196, 200];
const cardTop = (f: number) => CARD_TOPS[Math.min(f, CARD_TOPS.length - 1)];

/**
 * Clean control for motion (must report nothing): the talk-show staging that once produced false positives.
 *  - A card the colour of the wall behind it drops in fast (frames 6-12): the 3-frame flicker test alone sees
 *    one-frame states where its text passes over wall-coloured pixels.
 *  - Zoo stands behind a desk with his hands below the bottom safe margin: hidden hands are not on screen.
 */
export const QaFxMotion: React.FC = () => {
	const f = useCurrentFrame();
	return (
		<Stage>
			<svg width={1920} height={1080} viewBox="0 0 1920 1080" style={{position: 'absolute', left: 0, top: 0}}>
				<rect x={900} y={0} width={1020} height={930} fill={BRAND.offWhite} />
				<rect x={1400} y={0} width={4} height={930} fill={BRAND.nearBlack} />
				<ZooRig x={520} y={1340} scale={PAIR_SCALE} view="front" />
				<rect x={0} y={930} width={1920} height={150} fill={BRAND.nearBlack} />
			</svg>
			<div style={{position: 'absolute', left: 980, top: cardTop(f), width: 820, height: 300, boxSizing: 'border-box', padding: '48px 56px', backgroundColor: BRAND.offWhite, border: `4px solid ${BRAND.nearBlack}`, borderRadius: 16}}>
				<div style={{fontFamily: FONTS.heading, fontWeight: 800, fontSize: 56, lineHeight: '64px', color: BRAND.nearBlack}}>One key can upgrade the contract</div>
			</div>
		</Stage>
	);
};

/** Flicker by a jump: a label sits still but is drawn 14 px lower on exactly one frame (15). */
export const QaFxJump: React.FC = () => {
	const f = useCurrentFrame();
	return (
		<Stage>
			<Pair />
			{/* top right, clear of both faces */}
			<div style={label({left: 1150, top: f === 15 ? 124 : 110, fontSize: 56})}>Holds still, mostly</div>
		</Stage>
	);
};

/** Flicker: a label shown for exactly one frame (15) and a one-frame white flash (frame 22). */
export const QaFxFlicker: React.FC = () => {
	const f = useCurrentFrame();
	return (
		<Stage>
			<Pair />
			{f === 15 ? <div style={label({left: 120, top: 120, fontSize: 56})}>GLITCH</div> : null}
			{f === 22 ? <AbsoluteFill style={{backgroundColor: BRAND.offWhite}} /> : null}
		</Stage>
	);
};
