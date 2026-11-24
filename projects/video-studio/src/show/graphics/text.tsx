/**
 * Fitted text for show graphics. The episode engine's fitter (src/episode/text/fit.ts: shrink to a floor, then wrap)
 * with the browser's real font metrics (measure.ts), after the language's fonts have loaded (Show.tsx gates on that).
 * Text that cannot fit its box even at its floor THROWS and fails the render, naming the text: nothing is clipped.
 */
import React, {useMemo} from 'react';
import type {Lang} from '../types';
import {fitText, prepText, type FitResult} from '../../episode/text/fit';
import {measureFor} from '../../episode/text/measure';
import {fontFor, lineFactor, type FontRole} from '../../episode/i18n/fonts';
import {UNSPACED} from '../../episode/markup';

export type TextSpec = {
	role: FontRole;
	weight: number;
	maxSize: number;
	minSize: number; // never below 24 px (ART_GUIDE SL10)
	maxLines: number;
	lineHeight: number;
	uppercase?: boolean;
	balance?: boolean;
	ellipsis?: boolean; // shorten with "…" instead of failing (source titles only)
	letterSpacing?: number; // em
};

export const t = (role: FontRole, weight: number, maxSize: number, minSize: number, maxLines: number, lineHeight = 1.12, extra: Partial<TextSpec> = {}): TextSpec => ({
	role,
	weight,
	maxSize,
	minSize,
	maxLines,
	lineHeight,
	...extra,
});

export const useFit = (text: string, spec: TextSpec, lang: Lang, w: number, h: number, what: string): FitResult & {text: string} => {
	const font = fontFor(lang, spec.role, spec.weight);
	return useMemo(() => {
		const s = prepText(text, spec, lang);
		// letter spacing widens every glyph: fit against a box narrowed by the same factor
		const ls = spec.letterSpacing ?? 0;
		const measure = measureFor(font);
		const m = ls ? (x: string, size: number) => measure(x, size) + Array.from(x).length * ls * size : measure;
		const r = fitText(
			s,
			{maxWidth: w, maxHeight: h, maxSize: spec.maxSize, minSize: spec.minSize, maxLines: spec.maxLines, lineHeight: spec.lineHeight * lineFactor(lang), unspaced: UNSPACED.has(lang), lang, balance: spec.balance, ellipsis: spec.ellipsis},
			m,
		);
		if (r.overflow) throw new Error(`${what}: text does not fit its ${Math.round(w)}x${Math.round(h)} px box even at ${spec.minSize} px: "${s.slice(0, 120)}". Shorten it in the storyboard.`);
		return {...r, text: s};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [text, lang, w, h, spec.maxSize, spec.minSize, spec.maxLines, spec.lineHeight, spec.uppercase, spec.balance, spec.ellipsis, spec.letterSpacing, font.fontFamily, font.fontWeight, what]);
};

/** A fitted text block, absolutely positioned in its box. */
export const FitText: React.FC<{
	text: string;
	spec: TextSpec;
	lang: Lang;
	box: {x: number; y: number; w: number; h: number};
	color: string;
	align?: 'left' | 'center' | 'right';
	valign?: 'top' | 'center' | 'bottom';
	what: string;
	style?: React.CSSProperties;
}> = ({text, spec, lang, box, color, align = 'left', valign = 'top', what, style}) => {
	const fit = useFit(text, spec, lang, box.w, box.h, what);
	const font = fontFor(lang, spec.role, spec.weight);
	const lh = fit.fontSize * fit.lineHeight;
	const top = valign === 'top' ? 0 : valign === 'center' ? (box.h - fit.height) / 2 : box.h - fit.height;
	return (
		<div style={{position: 'absolute', left: box.x, top: box.y, width: box.w, height: box.h, ...style}}>
			{fit.lines.map((line, i) => (
				<div
					key={i}
					style={{
						position: 'absolute',
						left: 0,
						top: top + i * lh,
						width: box.w,
						height: lh,
						lineHeight: `${lh}px`,
						textAlign: align,
						fontFamily: font.fontFamily,
						fontWeight: font.fontWeight,
						fontSize: fit.fontSize,
						letterSpacing: spec.letterSpacing ? `${spec.letterSpacing}em` : undefined,
						color,
						whiteSpace: 'pre',
					}}
				>
					{line}
				</div>
			))}
		</div>
	);
};

/** Height a fitted block will take (for stacking blocks in a column). */
export const useFitHeight = (text: string, spec: TextSpec, lang: Lang, w: number, h: number, what: string): number => useFit(text, spec, lang, w, h, what).height;
