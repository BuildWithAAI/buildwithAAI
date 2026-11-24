/**
 * <ProductSpot/>: one spot illustration for the product PDFs, drawn by the approved rigs (src/characters, unchanged).
 *
 * The composition renders the art on a transparent canvas (the PNG is only a preview). Two passes happen inside one
 * still render, held with delayRender:
 *   1. measure the art's geometry box (getBBox, world units) and derive points per unit from the spot's printed
 *      height, then the rigs' lineScale for the house print outline (catalog OUTLINE_PT);
 *   2. re-render with that lineScale, then serialize the art as a standalone SVG cropped to its box and write it to
 *      the browser console in chunks, which the Node build (../lib/spots.ts) collects through onBrowserLog.
 * Flat fills and outlines only: no filters, gradients, patterns or opacity tints (ART_GUIDE P1, CV1).
 */
import React, {useLayoutEffect, useRef, useState} from 'react';
import {continueRender, delayRender} from 'remotion';
import {Badger} from '../../../src/characters/badger/Badger';
import {BRAND} from '../../../src/characters/palette';
import {ZooRig} from '../../../src/characters/zoo/Zoo';
import {Chair, Desk, Keyboard, Monitor} from '../../../src/characters/zoo/props';
import {TYPING_LAYOUT} from '../../../src/characters/zoo/views/Typing';
import {LineScaleContext} from '../../../src/characters/zoo/parts/Shape';
import {ART_MARGIN_UNITS, lineScaleForPrint, OUTLINE_PT, ptPerUnit, spotById, type SpotCharacter, type SpotDef} from './catalog';
import {encodeSpotChunks} from './protocol';

/** ART_GUIDE CV2 contact-shadow tone (flat, no blur, no opacity). */
const CONTACT_SHADOW = '#CFD3D8';

export const SPOT_CANVAS = {width: 1800, height: 1200, groundY: 1120} as const;

export type ProductSpotProps = {spotId: string};

type Box = {x: number; y: number; w: number; h: number};

/** Contact-shadow half-widths (world units) per character and pose, measured by eye against the rigs' footprints. */
const shadowRx = (c: SpotCharacter): number => {
	if (c.kind === 'zoo') return c.props.pose === 'typing' ? 0 : 112;
	const pose = c.props.pose ?? 'stand';
	const view = c.props.view ?? 'left';
	if (pose === 'lie') return 240;
	if (pose === 'sit') return 135;
	if (view === 'front' || view === 'back') return 82;
	return 190;
};

const Character: React.FC<{c: SpotCharacter; lineScale: number}> = ({c, lineScale}) => {
	if (c.kind === 'badger') {
		return <Badger {...c.props} x={c.x} y={0} scale={1} breathe={false} lineScale={lineScale} />;
	}
	if (c.props.pose === 'typing') {
		const L = TYPING_LAYOUT;
		return (
			<LineScaleContext.Provider value={lineScale}>
				<g transform={`translate(${c.x} 0)`}>
					<Chair x={L.chair.x} y={L.chair.y} />
					<ZooRig
						{...c.props}
						pose="typing"
						breathe={false}
						lineScale={lineScale}
						between={
							<>
								<Desk x={L.desk.x} y={L.desk.y} />
								<Monitor x={L.monitor.x} y={L.monitor.y} />
								<Keyboard x={L.keyboard.x} y={L.keyboard.y} />
							</>
						}
					/>
				</g>
			</LineScaleContext.Provider>
		);
	}
	return <ZooRig {...c.props} x={c.x} y={0} scale={1} breathe={false} lineScale={lineScale} />;
};

/** The art in world units (origin = the spot's ground origin). */
const Art: React.FC<{spot: SpotDef; lineScale: number; outlineUnits: number}> = ({spot, lineScale, outlineUnits}) => {
	const shadows = (spot.contactShadows ?? !spot.frame) ? spot.characters.filter((c) => shadowRx(c) > 0) : [];
	const inner = (
		<>
			{shadows.map((c, i) => (
				<ellipse key={`s${i}`} data-role="contact-shadow" cx={c.x} cy={0} rx={shadowRx(c)} ry={14} fill={CONTACT_SHADOW} />
			))}
			{spot.characters.map((c, i) => (
				<Character key={i} c={c} lineScale={lineScale} />
			))}
		</>
	);
	if (!spot.frame) return inner;
	const f = spot.frame;
	const clipId = `spot-${spot.id}-frame`;
	return (
		<>
			<defs>
				<clipPath id={clipId}>
					<rect x={f.x} y={f.y} width={f.w} height={f.h} rx={f.radius} />
				</clipPath>
			</defs>
			<rect x={f.x} y={f.y} width={f.w} height={f.h} rx={f.radius} fill={BRAND.background} />
			<g clipPath={`url(#${clipId})`}>{inner}</g>
			{/* outline last, the same shape with no fill (ART_GUIDE SL4) */}
			<rect x={f.x} y={f.y} width={f.w} height={f.h} rx={f.radius} fill="none" stroke={BRAND.nearBlack} strokeWidth={outlineUnits} />
		</>
	);
};

/** Standalone SVG markup for the art: viewBox in world units, width/height in CSS px at 96 dpi from the printed size. */
export const standaloneSvg = (inner: string, box: Box, pointsPerUnit: number, title: string): string => {
	const r = (n: number) => Math.round(n * 100) / 100;
	const wPx = r(box.w * pointsPerUnit * (96 / 72));
	const hPx = r(box.h * pointsPerUnit * (96 / 72));
	const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
	return (
		`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${r(box.x)} ${r(box.y)} ${r(box.w)} ${r(box.h)}" width="${wPx}" height="${hPx}" role="img">` +
		`<title>${esc(title)}</title>${inner}</svg>`
	);
};

const stripDataAttributes = (el: Element): void => {
	for (const a of Array.from(el.attributes)) if (a.name.startsWith('data-')) el.removeAttribute(a.name);
	for (const child of Array.from(el.children)) stripDataAttributes(child);
};

export const ProductSpot: React.FC<ProductSpotProps> = ({spotId}) => {
	const spot = spotById(spotId);
	const [handle] = useState(() => delayRender(`product spot ${spotId}`));
	const [pass, setPass] = useState<{lineScale: number; k: number} | null>(null);
	const artRef = useRef<SVGGElement>(null);

	useLayoutEffect(() => {
		if (!spot) {
			console.error(`[product-spot] unknown spot id "${spotId}"`);
			continueRender(handle);
			return;
		}
		const g = artRef.current;
		if (!g) return;
		const bb = g.getBBox();
		if (!pass) {
			// pass 1: printed size -> points per world unit -> lineScale for the house outline
			const artH = spot.frame ? spot.frame.h : bb.height + 2 * ART_MARGIN_UNITS;
			const k = ptPerUnit(spot, artH);
			setPass({lineScale: lineScaleForPrint(k), k});
			return;
		}
		// pass 2: crop and serialize
		const outlineUnits = OUTLINE_PT / pass.k;
		const m = ART_MARGIN_UNITS + outlineUnits;
		const box: Box = spot.frame
			? {x: spot.frame.x - outlineUnits, y: spot.frame.y - outlineUnits, w: spot.frame.w + 2 * outlineUnits, h: spot.frame.h + 2 * outlineUnits}
			: {x: bb.x - m, y: bb.y - m, w: bb.width + 2 * m, h: bb.height + 2 * m};
		const clone = g.cloneNode(true) as SVGGElement;
		clone.removeAttribute('transform');
		stripDataAttributes(clone);
		const inner = new XMLSerializer().serializeToString(clone);
		const svg = standaloneSvg(inner, box, pass.k, spot.alt);
		for (const line of encodeSpotChunks(spot.id, svg)) console.log(line);
		continueRender(handle);
	}, [pass, spot, spotId, handle]);

	if (!spot) return null;
	const lineScale = pass?.lineScale ?? 1;
	const outlineUnits = pass ? OUTLINE_PT / pass.k : 3.5;
	const xs = spot.characters.map((c) => c.x);
	const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
	return (
		<svg width={SPOT_CANVAS.width} height={SPOT_CANVAS.height} viewBox={`0 0 ${SPOT_CANVAS.width} ${SPOT_CANVAS.height}`} style={{position: 'absolute', inset: 0}}>
			<g transform={`translate(${SPOT_CANVAS.width / 2 - cx} ${SPOT_CANVAS.groundY})`}>
				<g ref={artRef} data-spot={spot.id}>
					<Art spot={spot} lineScale={lineScale} outlineUnits={outlineUnits} />
				</g>
			</g>
		</svg>
	);
};
