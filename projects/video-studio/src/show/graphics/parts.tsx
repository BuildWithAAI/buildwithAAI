/**
 * Shared show graphics: cards, the segment tag, the persistent DEVELOPING badge, the per-scene source line and the
 * review badges. Flat plates with the house outline (ART_GUIDE SL4), no opacity, glow or blur (P1). Names keep their
 * case: "Zoo" is never upper-cased (owner rule), so no text-transform is applied to anything that may contain it.
 */
import React from 'react';
import {useCurrentFrame} from 'remotion';
import type {Lang} from '../types';
import {G, OUTLINE, R} from './theme';
import {FitText, t, useFit} from './text';
import {fontFor} from '../../episode/i18n/fonts';
import {EASE} from '../../episode/motion';

export type Box = {x: number; y: number; w: number; h: number};

/** Entry progress (0..1) of a graphic that starts entering at frame `at` (decelerate: UI entering, ART_GUIDE MO2). */
export const enter = (frame: number, at: number, len = 10): number => (frame < at ? 0 : frame >= at + len ? 1 : EASE.decel((frame - at) / len));

export type From = 'left' | 'right' | 'top' | 'bottom';

/**
 * Slides its content in from just outside the frame edge on `from` (no opacity: P1/CV1). `box` is where the content
 * rests; `frameSize` the composition size.
 */
export const Enter: React.FC<{at: number; from: From; box: Box; frameSize: {width: number; height: number}; len?: number; children: React.ReactNode}> = ({at, from, box, frameSize, len = 10, children}) => {
	const frame = useCurrentFrame();
	const p = enter(frame, at, len);
	if (p <= 0) return null;
	const d =
		from === 'left' ? -(box.x + box.w + 24) : from === 'right' ? frameSize.width - box.x + 24 : from === 'top' ? -(box.y + box.h + 24) : frameSize.height - box.y + 24;
	const off = (1 - p) * d;
	const tr = from === 'left' || from === 'right' ? `translateX(${off}px)` : `translateY(${off}px)`;
	return <div style={{position: 'absolute', inset: 0, transform: p >= 1 ? undefined : tr}}>{children}</div>;
};

export const Card: React.FC<{box: Box; fill?: string; radius?: number; children?: React.ReactNode; style?: React.CSSProperties}> = ({box, fill = G.card, radius = R.l, children, style}) => (
	<div
		style={{
			position: 'absolute',
			left: box.x,
			top: box.y,
			width: box.w,
			height: box.h,
			boxSizing: 'border-box',
			backgroundColor: fill,
			border: `${OUTLINE}px solid ${G.ink}`,
			borderRadius: radius,
			...style,
		}}
	>
		{children}
	</div>
);

/** The recurring segment's name on a slate tag with a small teal mark (decoration only). */
export const SegmentTag: React.FC<{label: string; x: number; y: number; lang: Lang; at?: number; maxW?: number}> = ({label, x, y, lang, at = 0, maxW = 760}) => {
	const frame = useCurrentFrame();
	const fit = useFit(label, t('heading', 900, 34, 26, 1, 1.0), lang, maxW - 76, 40, 'segment tag');
	const font = fontFor(lang, 'heading', 900);
	const w = Math.ceil(fit.width) + 76;
	const p = enter(frame, at, 8);
	if (p <= 0) return null;
	return (
		<div style={{position: 'absolute', left: x, top: y, width: w, height: 60, clipPath: p >= 1 ? undefined : `inset(0 ${(1 - p) * 100}% 0 0)`}}>
			<div style={{position: 'absolute', inset: 0, backgroundColor: G.slate, border: `${OUTLINE}px solid ${G.ink}`, borderRadius: R.m, boxSizing: 'border-box'}} />
			<div style={{position: 'absolute', left: 22, top: 24, width: 14, height: 14, backgroundColor: G.teal, borderRadius: 3}} />
			<div style={{position: 'absolute', left: 50, top: 0, height: 60, lineHeight: '60px', fontFamily: font.fontFamily, fontWeight: font.fontWeight, fontSize: fit.fontSize, color: G.onDark, whiteSpace: 'pre'}}>
				{fit.lines[0]}
			</div>
		</div>
	);
};

/**
 * The persistent DEVELOPING label (owner rule: developing stories are labelled "developing"): an off-white plate with
 * the house outline, the label in near-black and the "as of" time under it. Drawn on every frame of the render.
 */
export const DevelopingBadge: React.FC<{label: string; asOf: string | null; right: number; y: number; lang: Lang}> = ({label, asOf, right, y, lang}) => {
	const main = useFit(label, t('heading', 900, 30, 24, 1, 1.0, {letterSpacing: 0.06}), lang, 520, 34, 'DEVELOPING label');
	const sub = useFit(asOf ?? '', t('body', 600, 24, 24, 1, 1.0), lang, 520, 28, 'DEVELOPING as-of');
	const fm = fontFor(lang, 'heading', 900);
	const fs = fontFor(lang, 'body', 600);
	const w = Math.ceil(Math.max(main.width + main.fontSize * 0.06 * Array.from(main.text).length, asOf ? sub.width : 0)) + 64;
	const h = asOf ? 84 : 56;
	return (
		<div data-badge="developing" style={{position: 'absolute', left: right - w, top: y, width: w, height: h}}>
			<div style={{position: 'absolute', inset: 0, backgroundColor: G.card, border: `${OUTLINE}px solid ${G.ink}`, borderRadius: R.m, boxSizing: 'border-box'}} />
			<div style={{position: 'absolute', left: 20, top: 21, width: 14, height: 14, backgroundColor: G.ink, borderRadius: 7}} />
			<div style={{position: 'absolute', left: 44, top: 10, height: 36, lineHeight: '36px', fontFamily: fm.fontFamily, fontWeight: fm.fontWeight, fontSize: main.fontSize, letterSpacing: '0.06em', color: G.ink, whiteSpace: 'pre'}}>
				{main.lines[0]}
			</div>
			{asOf ? (
				<div style={{position: 'absolute', left: 44, top: 46, height: 28, lineHeight: '28px', fontFamily: fs.fontFamily, fontWeight: fs.fontWeight, fontSize: sub.fontSize, color: G.inkMuted, whiteSpace: 'pre'}}>
					{sub.lines[0]}
				</div>
			) : null}
		</div>
	);
};

/** "Source: The Block · DL News": who reported what this scene says (owner rule: attribute every fact). */
export const SourceLine: React.FC<{label: string; publishers: string[]; box: Box; lang: Lang; align?: 'left' | 'right'}> = ({label, publishers, box, lang, align = 'left'}) => {
	const text = `${label}: ${publishers.join(' · ')}`;
	const fit = useFit(text, t('body', 600, 26, 24, 1, 1.0, {ellipsis: true}), lang, box.w - 32, 32, 'source line');
	const font = fontFor(lang, 'body', 600);
	const w = Math.ceil(fit.width) + 32;
	return (
		<div data-part="sourceLine" style={{position: 'absolute', left: align === 'left' ? box.x : box.x + box.w - w, top: box.y, width: w, height: 44}}>
			<div style={{position: 'absolute', inset: 0, backgroundColor: G.slate, borderRadius: R.m}} />
			<div style={{position: 'absolute', left: 16, top: 0, height: 44, lineHeight: '44px', fontFamily: font.fontFamily, fontWeight: font.fontWeight, fontSize: fit.fontSize, color: G.onDark, whiteSpace: 'pre'}}>
				{fit.lines[0]}
			</div>
		</div>
	);
};

/** Review badges: never part of a published video (a mock timeline, a dev fixture or an unreviewed translation). */
export const ReviewBadges: React.FC<{items: string[]; right: number; bottom: number; frameWidth: number}> = ({items, right, bottom, frameWidth}) => (
	<>
		{items.map((label, i) => (
			<div
				key={label}
				data-badge="review"
				style={{
					position: 'absolute',
					right: frameWidth - right,
					top: bottom - 44 - i * 52,
					height: 44,
					lineHeight: '44px',
					padding: '0 16px',
					backgroundColor: G.ink,
					color: G.onDark,
					borderRadius: R.m,
					fontFamily: 'Inter',
					fontWeight: 800,
					fontSize: 24,
					whiteSpace: 'nowrap',
				}}
			>
				{label}
			</div>
		))}
	</>
);

/** A slate header strip inside a card (the segment's own title). */
export const CardHeader: React.FC<{text: string; box: Box; lang: Lang}> = ({text, box, lang}) => (
	<div style={{position: 'absolute', left: box.x, top: box.y, width: box.w, height: box.h, backgroundColor: G.slate, borderRadius: `${R.l - OUTLINE}px ${R.l - OUTLINE}px 0 0`}}>
		<FitText text={text} spec={t('heading', 900, 40, 28, 1, 1.0)} lang={lang} box={{x: 28, y: 0, w: box.w - 56, h: box.h}} color={G.onDark} valign="center" what="card header" />
	</div>
);
