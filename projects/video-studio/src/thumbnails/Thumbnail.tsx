/**
 * <Thumbnail>: one 1280x720 Test & Compare variant. calculateMetadata (compositions.tsx) has already loaded and
 * validated the storyboard text into props.resolved; this component waits for the language's fonts (delayRender),
 * fits the headline with the real glyph metrics and draws everything as flat SVG: solid fills only, no effects.
 * During a render it prints its final geometry once (LAYOUT_LOG_TAG) so scripts/thumbnails.ts can check contrast and
 * legibility on the exact pixels of the headline.
 */
import React, {useEffect, useMemo, useRef, useState} from 'react';
import {AbsoluteFill, getRemotionEnvironment, useDelayRender} from 'remotion';
import {Badger, BRAND, ZooRig} from '../characters';
import type {Expression} from '../characters/types';
import {fontFor, loadLangFonts} from '../episode/i18n/fonts';
import {fitHeadline} from './fit';
import {headlineFont, inkMeasure} from './measure';
import {layoutFor, textStyle, THUMB, type Rect} from './layout';
import {compose, LAYOUT_LOG_TAG} from './compose';
import {displayText, type BadgerReaction, type ResolvedThumb, type ThumbInput} from './spec';
import {contrast, MIN_TEXT_CONTRAST} from './contrast';

export type ThumbProps = ThumbInput & {
	/** Filled by calculateMetadata; never pass it yourself. */
	resolved?: ResolvedThumb | null;
};

/** Badger's face: 'judge' is his neutral face with the quietly judging lids and brow (rig control `judge`). */
const badgerFace = (r: BadgerReaction): {expression: Expression; judge: number} =>
	r === 'judge' ? {expression: 'neutral', judge: 1} : {expression: r, judge: 0};

/**
 * The drawn head groups' boxes in frame px (geometry, strokes excluded). The render script compares them with the
 * layout's predicted boxes (layout.ts RIG), so a changed character rig is caught instead of silently mis-framed.
 */
const measureHeads = (svg: SVGSVGElement): {zooHead: Rect | null; badgerHead: Rect | null} => {
	const box = (sel: string): Rect | null => {
		const el = svg.querySelector<SVGGraphicsElement>(sel);
		const m = el?.getCTM();
		if (!el || !m) return null;
		const b = el.getBBox();
		const pts = [
			[b.x, b.y],
			[b.x + b.width, b.y],
			[b.x, b.y + b.height],
			[b.x + b.width, b.y + b.height],
		].map(([x, y]) => new DOMPoint(x, y).matrixTransform(m));
		const x0 = Math.min(...pts.map((p) => p.x));
		const y0 = Math.min(...pts.map((p) => p.y));
		return {x: x0, y: y0, w: Math.max(...pts.map((p) => p.x)) - x0, h: Math.max(...pts.map((p) => p.y)) - y0};
	};
	return {zooHead: box('[data-character="zoo"] [data-part="head"]'), badgerHead: box('[data-character="badger"] [data-head]')};
};

/** Owner-facing marker (English on purpose): an unreviewed translation must not be uploaded. */
const MachineBadge: React.FC = () => {
	const f = fontFor('en', 'body', 800);
	const label = 'MACHINE TRANSLATION · needs native review';
	const size = 22;
	const w = useMemo(() => inkMeasure(f)(label, size).w, [f]);
	return (
		<g data-part="review-badge">
			<rect x={16} y={16} width={w + 36} height={44} rx={8} fill={BRAND.nearBlack} stroke={BRAND.offWhite} strokeWidth={3} />
			<text x={34} y={46} fontFamily={f.fontFamily} fontWeight={f.fontWeight} fontSize={size} fill={BRAND.offWhite}>
				{label}
			</text>
		</g>
	);
};

const ThumbnailBody: React.FC<{r: ResolvedThumb}> = ({r}) => {
	const L = useMemo(() => layoutFor(r.variant, r.badger), [r.variant, r.badger]);
	const font = headlineFont(r.lang);
	const text = displayText(r.text, r.lang);
	const c = useMemo(() => {
		const style = textStyle(r.lang);
		const fit = fitHeadline(text, {w: L.text.box.w, h: L.text.box.h, ...style}, inkMeasure(font));
		if (!fit)
			throw new Error(
				`Thumbnail v${r.variant} (${r.lang}): "${text.replace(/\n/g, ' / ')}" does not fit the ${Math.round(L.text.box.w)}x${L.text.box.h} px headline box at the ${style.minSize} px legibility floor. Shorten it in the storyboard.`,
			);
		return compose(L, fit);
	}, [text, r.lang, r.variant, L, font]);
	const ratio = contrast(c.textColor, c.behind);
	if (ratio < MIN_TEXT_CONTRAST) throw new Error(`Thumbnail v${r.variant}: text contrast ${ratio.toFixed(2)}:1 is below ${MIN_TEXT_CONTRAST}:1`);
	const svgRef = useRef<SVGSVGElement>(null);
	useEffect(() => {
		if (!getRemotionEnvironment().isRendering) return;
		const measured = svgRef.current ? measureHeads(svgRef.current) : null;
		console.log(`${LAYOUT_LOG_TAG} ${JSON.stringify({variant: r.variant, lang: r.lang, layout: L.name, ...c, measured})}`);
	}, [c, r.variant, r.lang, L.name]);
	const face = badgerFace(r.badgerReaction);
	const win = L.panels.find((p) => p.clip);
	const clipId = `thumb-win-${r.variant}`;
	const a = c.accent;
	return (
		<AbsoluteFill style={{backgroundColor: L.bg}}>
			<svg ref={svgRef} width={THUMB.width} height={THUMB.height} viewBox={`0 0 ${THUMB.width} ${THUMB.height}`}>
				{win ? (
					<defs>
						<clipPath id={clipId}>
							<rect x={win.x} y={win.y} width={win.w} height={win.h} rx={win.r} />
						</clipPath>
					</defs>
				) : null}
				{L.panels.map((p, i) => (
					<rect key={i} x={p.x} y={p.y} width={p.w} height={p.h} rx={p.r} fill={p.color} />
				))}
				<g data-part="characters" clipPath={win ? `url(#${clipId})` : undefined}>
					<ZooRig
						x={L.zoo.x}
						y={L.zoo.y}
						scale={L.zoo.scale}
						expression={r.expression}
						lookX={L.zoo.lookX}
						lookY={L.zoo.lookY}
						headTilt={L.zoo.headTilt}
						breathe={false}
					/>
					{L.badger ? (
						<Badger x={L.badger.x} y={L.badger.y} scale={L.badger.scale} view="front" expression={face.expression} judge={face.judge} breathe={false} />
					) : null}
				</g>
				{c.plate && L.plate ? <rect data-part="plate" x={c.plate.x} y={c.plate.y} width={c.plate.w} height={c.plate.h} rx={L.plate.r} fill={L.plate.color} /> : null}
				<rect data-part="accent" x={a.x} y={a.y} width={a.w} height={a.h} rx={Math.min(a.w, a.h) / 2} fill={BRAND.teal} />
				<g data-part="headline">
					{c.lines.map((line, i) => (
						<text key={i} x={line.x} y={line.baseline} fontFamily={font.fontFamily} fontWeight={font.fontWeight} fontSize={c.size} fill={c.textColor}>
							{line.text}
						</text>
					))}
				</g>
				{r.machine ? <MachineBadge /> : null}
			</svg>
		</AbsoluteFill>
	);
};

/** Fonts gate: blocks the still until the language's faces are loaded, then measures and draws. */
export const Thumbnail: React.FC<ThumbProps> = (props) => {
	const r = props.resolved;
	const lang = r?.lang ?? props.lang;
	const {delayRender, continueRender, cancelRender} = useDelayRender();
	const [handle] = useState(() => delayRender(`Loading thumbnail fonts for ${lang}`));
	const [ready, setReady] = useState(false);
	useEffect(() => {
		loadLangFonts(lang)
			.then(() => setReady(true))
			.catch((err) => cancelRender(err));
	}, [lang, cancelRender]);
	useEffect(() => {
		if (ready) continueRender(handle);
	}, [ready, handle, continueRender]);
	if (!r) throw new Error('Thumbnail: props.resolved is missing (calculateMetadata did not run)');
	if (!ready) return <AbsoluteFill style={{backgroundColor: BRAND.background}} />;
	return <ThumbnailBody r={r} />;
};
