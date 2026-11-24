/**
 * The Rekt Meter: a flat half dial of one reported loss, on a log scale from $100K to $10B (one step per x10, labelled
 * on the dial and noted in words), the figure as the source states it, and "reported by <outlet>". A second outlet's
 * different figure gets its own marker and line; the two are never averaged (owner rule).
 * Data colours stay off the brand teal (CV5): the filled band is slate, the track off-white and shadow grey, the
 * needle near-black. The needle sweeps once with no overshoot, so it never passes through a wrong value.
 */
import React from 'react';
import {useCurrentFrame} from 'remotion';
import type {Lang} from '../types';
import {meterReading, meterTicks, tickLabel} from '../money';
import {bandPath, dialPoint, markerPath, needlePath, SWEEP_FRAMES} from './meterGeometry';
import {G} from './theme';
import {FitText, t} from './text';
import type {Box} from './parts';
import {EASE, track} from '../../episode/motion';
import {fontFor} from '../../episode/i18n/fonts';

export type RektReading = {usd: number; display: string; publisher: string};

export type RektMeterProps = {
	box: Box;
	layout: 'stack' | 'side';
	main: RektReading;
	alt?: RektReading | null;
	/** Frame the needle starts its sweep (scene-local). */
	start: number;
	lang: Lang;
	labels: {reportedBy: string; alsoReported: string; logScale: string};
};

export const RektMeter: React.FC<RektMeterProps> = ({box, layout, main, alt, start, lang, labels}) => {
	const frame = useCurrentFrame();
	const target = meterReading(main.usd).fraction;
	const p = track(frame, [[start, 0], [start + SWEEP_FRAMES, 1]], EASE.inOut);
	const f = target * p;
	// layout: the dial's tick labels need a ring of room above it; the figure, attribution and notes stack under it
	// ('stack') or beside it ('side', for the narrow vertical card)
	const side = layout === 'side';
	const tickSize = side && box.w > 700 ? 26 : 24;
	const ring = 22 + tickSize * 1.6; // tick + label room outside the band
	const lineH = 36;
	const amountH = side ? 104 : 100;
	const textH = amountH + lineH * 2 + (alt ? lineH * 2 : 0);
	const dialW = side ? box.w * 0.52 : box.w;
	const hubR = (rr: number) => rr * 0.11;
	const noteH = 30;
	// below the dial centre: the hub, then the scale note, then (stack) the figure block
	const under = (rr: number) => hubR(rr) + 8 + noteH + 6;
	const r = side ? Math.min(dialW / 2 - ring, (box.h - ring - 50) / 1.11) : Math.min(box.w * 0.34, (box.h - ring - textH - 50) / 1.11);
	// side: centre the dial and the text column vertically in the box
	const dialBlock = ring + r + under(r);
	const top = side ? box.y + Math.max(0, (box.h - Math.max(dialBlock, textH)) / 2) : box.y;
	const cx = box.x + dialW / 2;
	const cy = top + ring + r;
	const r1 = r;
	const r0 = r * 0.7;
	const ticks = meterTicks();
	const tickFont = fontFor(lang, 'body', 700);
	const altReading = alt ? meterReading(alt.usd).fraction : null;
	const segs = ticks.slice(0, -1).map((tk, i) => ({f0: tk.fraction, f1: ticks[i + 1].fraction, fill: i % 2 === 0 ? G.card : G.shadow}));
	const textBox = side
		? {x: box.x + dialW + 16, y: top + Math.max(0, (Math.max(dialBlock, textH) - textH) / 2), w: box.w - dialW - 16, h: textH}
		: {x: box.x, y: cy + under(r), w: box.w, h: textH};
	return (
		<div data-part="rektMeter" style={{position: 'absolute', inset: 0}}>
			<svg width="100%" height="100%" style={{position: 'absolute', left: 0, top: 0, overflow: 'visible'}}>
				{segs.map((s, i) => (
					<path key={i} d={bandPath(cx, cy, r0, r1, s.f0, s.f1)} fill={s.fill} />
				))}
				{f > 0.002 ? <path d={bandPath(cx, cy, r0, r1, 0, f)} fill={G.slate} /> : null}
				{segs.map((s, i) => (
					<path key={`o${i}`} d={bandPath(cx, cy, r0, r1, s.f0, s.f1)} fill="none" stroke={G.ink} strokeWidth={3} strokeLinejoin="round" />
				))}
				{ticks.map((tk) => {
					const a = dialPoint(cx, cy, r1 + 4, tk.fraction);
					const b = dialPoint(cx, cy, r1 + 16, tk.fraction);
					const l = dialPoint(cx, cy, r1 + 22 + tickSize * 0.9, tk.fraction);
					return (
						<g key={tk.exp}>
							<path d={`M ${a.x} ${a.y} L ${b.x} ${b.y}`} stroke={G.ink} strokeWidth={4} strokeLinecap="round" />
							<text x={l.x} y={l.y} textAnchor="middle" dominantBaseline="central" fontFamily={tickFont.fontFamily} fontWeight={tickFont.fontWeight} fontSize={tickSize} fill={G.inkMuted}>
								{tickLabel(tk.usd, lang)}
							</text>
						</g>
					);
				})}
				{altReading !== null && p >= 1 ? <path d={markerPath(cx, cy, r1 + 2, altReading, 13)} fill={G.ink} /> : null}
				<path d={needlePath(cx, cy, r1 - 6, f, 9, 3)} fill={G.ink} />
				<circle cx={cx} cy={cy} r={hubR(r)} fill={G.slate} stroke={G.ink} strokeWidth={4} />
			</svg>
			<FitText text={main.display} spec={t('display', 400, side ? 96 : 104, 56, 1, 1.0)} lang={lang} box={{x: textBox.x, y: textBox.y, w: textBox.w, h: amountH}} color={G.ink} align={side ? 'left' : 'center'} valign="center" what="Rekt Meter figure" />
			<FitText
				text={`${labels.reportedBy} ${main.publisher}`}
				spec={t('body', 700, 30, 24, 2, 1.1)}
				lang={lang}
				box={{x: textBox.x, y: textBox.y + amountH, w: textBox.w, h: lineH * 2}}
				color={G.ink}
				align={side ? 'left' : 'center'}
				what="Rekt Meter attribution"
			/>
			{alt ? (
				<FitText
					text={`${labels.alsoReported}: ${alt.display} (${alt.publisher})`}
					spec={t('body', 600, 26, 24, 2, 1.1)}
					lang={lang}
					box={{x: textBox.x, y: textBox.y + amountH + lineH * 2, w: textBox.w, h: lineH * 2}}
					color={G.inkMuted}
					align={side ? 'left' : 'center'}
					what="Rekt Meter second report"
				/>
			) : null}
			<FitText
				text={labels.logScale}
				spec={t('body', 600, 24, 24, 1, 1.0)}
				lang={lang}
				box={{x: cx - dialW / 2, y: cy + hubR(r) + 8, w: dialW, h: noteH}}
				color={G.inkMuted}
				align="center"
				what="Rekt Meter scale note"
			/>
		</div>
	);
};
