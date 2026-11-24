/**
 * <FitText>: a text box that shrinks to its floor, then wraps (fit.ts), measured with the real loaded fonts. A box that
 * still overflows at its floor throws, which fails the render with the text and box named: text is never clipped.
 */
import React, {useMemo} from 'react';
import type {Lang} from '../types';
import {fitGroup, fitText, prepText, type FitResult, type FitSpec} from './fit';
import {measureFor} from './measure';
import {fontFor, lineFactor} from '../i18n/fonts';
import {UNSPACED} from '../markup';
import type {Box, TextSpec} from '../layout/specs';


export const useFit = (text: string, spec: TextSpec, lang: Lang, box: Box = spec.box): FitResult => {
	const font = fontFor(lang, spec.role, spec.weight);
	return useMemo(() => {
		const s = prepText(text, spec, lang);
		const r = fitText(
			s,
			{
				maxWidth: box.w,
				maxHeight: box.h,
				maxSize: spec.maxSize,
				minSize: spec.minSize,
				maxLines: spec.maxLines,
				lineHeight: spec.lineHeight * lineFactor(lang),
				unspaced: UNSPACED.has(lang),
				lang,
				balance: spec.balance,
				ellipsis: spec.ellipsis,
				phrase: spec.phrase,
			},
			measureFor(font),
		);
		if (r.overflow) {
			throw new Error(
				`Text does not fit its ${box.w}x${box.h} px box even at the ${spec.minSize} px floor (${r.lines.length} lines, ${Math.round(r.height)} px): "${s.slice(0, 120)}". Shorten it in the storyboard.`,
			);
		}
		return r;
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [text, lang, box.w, box.h, spec.maxSize, spec.minSize, spec.maxLines, spec.lineHeight, spec.uppercase, spec.balance, spec.ellipsis, spec.phrase, font.fontFamily, font.fontWeight]);
};

const specFor = (spec: TextSpec, box: Box, lang: Lang): FitSpec => ({
	maxWidth: box.w,
	maxHeight: box.h,
	maxSize: spec.maxSize,
	minSize: spec.minSize,
	maxLines: spec.maxLines,
	lineHeight: spec.lineHeight * lineFactor(lang),
	unspaced: UNSPACED.has(lang),
	lang,
	balance: spec.balance,
	ellipsis: spec.ellipsis,
	phrase: spec.phrase,
});

/** A list at one shared size that also fits its block (fit.ts fitGroup); throws when it cannot fit. */
export const useFitGroup = (texts: string[], spec: TextSpec, lang: Lang, blockFits: (rs: FitResult[]) => boolean, what: string): FitResult[] => {
	const font = fontFor(lang, spec.role, spec.weight);
	const key = JSON.stringify(texts);
	return useMemo(() => {
		const rs = fitGroup(
			texts.map((t) => prepText(t, spec, lang)),
			specFor(spec, spec.box, lang),
			measureFor(font),
			blockFits,
		);
		if (rs.some((r) => r.overflow)) throw new Error(`${what}: the ${texts.length} items do not fit their column even at the ${spec.minSize} px floor. Shorten them in the storyboard.`);
		return rs;
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [key, lang, spec, font.fontFamily, font.fontWeight, what]);
};

export type LinesProps = {
	fit: FitResult;
	spec: TextSpec;
	lang: Lang;
	color: string;
	box?: Box;
	/** Per-line style hook (reveal animations). */
	lineStyle?: (i: number) => React.CSSProperties;
	style?: React.CSSProperties;
};

/** Render fitted lines in their box (absolute px). */
export const Lines: React.FC<LinesProps> = ({fit, spec, lang, color, box = spec.box, lineStyle, style}) => {
	const font = fontFor(lang, spec.role, spec.weight);
	const lh = fit.fontSize * fit.lineHeight;
	const valign = spec.valign ?? 'top';
	const top = valign === 'top' ? 0 : valign === 'bottom' ? box.h - fit.height : (box.h - fit.height) / 2;
	return (
		<div style={{position: 'absolute', left: box.x, top: box.y, width: box.w, height: box.h, ...style}}>
			{fit.lines.map((line, i) => (
				<div
					key={i}
					style={{
						position: 'absolute',
						left: 0,
						width: box.w,
						top: top + i * lh,
						height: lh,
						lineHeight: `${lh}px`,
						fontFamily: font.fontFamily,
						fontWeight: font.fontWeight,
						fontSize: fit.fontSize,
						color,
						textAlign: spec.align,
						whiteSpace: 'pre',
						...(lineStyle ? lineStyle(i) : null),
					}}
				>
					{line}
				</div>
			))}
		</div>
	);
};

export const FitText: React.FC<Omit<LinesProps, 'fit'> & {text: string}> = ({text, ...rest}) => {
	const fit = useFit(text, rest.spec, rest.lang, rest.box);
	return <Lines fit={fit} {...rest} />;
};
