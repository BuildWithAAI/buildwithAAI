/**
 * Call to action: subscribe by default. The button label is onScreen.button or the localized ui.subscribe. When the
 * storyboard has offers, the disclosure line (onScreen.disclosure) is on screen for the WHOLE scene, high contrast,
 * and the validator has already required the narration to say it (FTC 16 CFR 255: spoken and on screen).
 * The button presses once on its cue word; ZOO points at it (landscape) or glances up (vertical).
 */
import React from 'react';
import {useCurrentFrame} from 'remotion';
import {C, OUTLINE, R} from '../theme';
import {FRAME, LAYOUTS, type Box} from '../layout/specs';
import {Lines, useFit} from '../text/FitText';
import {CharacterLayer, Card, entry, SceneBg, useDirection, type SceneCtx} from './parts';
import {BadgerInsert, inInsert} from './Insert';
import {str} from '../validate';
import {uiLabel} from '../i18n/ui';
import {EASE, track} from '../motion';

/** Block geometry: title, button, disclosure, stacked and centred (pure, shared with the fit test). */
export const ctaBlock = (
	L: {column: {top: number; bottom: number}; pad: number; button: {h: number}},
	h: {title: number; disclosure: number},
	centred: boolean,
): {top: number; height: number; titleY: number; buttonY: number; disclosureY: number; fits: boolean} => {
	const t = Math.ceil(h.title);
	const d = Math.ceil(h.disclosure);
	const inner = t + (t ? 40 : 0) + L.button.h + (d ? 44 + d : 0);
	const height = inner + 2 * L.pad;
	const room = L.column.bottom - L.column.top;
	const top = centred ? Math.round(L.column.top + Math.max(0, (room - height) / 2)) : L.column.top;
	const titleY = top + L.pad;
	const buttonY = titleY + t + (t ? 40 : 0);
	const disclosureY = buttonY + L.button.h + 44;
	return {top, height, titleY, buttonY, disclosureY, fits: height <= room + 0.5};
};

export const CtaScene: React.FC<{ctx: SceneCtx}> = ({ctx}) => {
	const frame = useCurrentFrame();
	const L = LAYOUTS.cta[ctx.format];
	const vertical = ctx.format === 'vertical';
	const badgerPlace = ctx.sc.badger?.present ? L.badger : null;
	const dir = useDirection(ctx, {zooView: 'front', badgerPlace, badgerInsert: vertical});
	const offers = (ctx.sb.offers ?? []).length > 0;
	const title = str(ctx.sc, 'title') ?? '';
	const button = str(ctx.sc, 'button') ?? uiLabel(ctx.sb, 'subscribe') ?? '';
	const disclosure = offers ? (str(ctx.sc, 'disclosure') ?? '') : '';
	const tFit = useFit(title, L.title, ctx.lang);
	const bFit = useFit(button, L.buttonLabel, ctx.lang);
	const dFit = useFit(disclosure, L.disclosure, ctx.lang);
	if (inInsert(dir, frame)) return <BadgerInsert ctx={ctx} dir={dir} />;

	const g = ctaBlock(L, {title: title ? tFit.height : 0, disclosure: disclosure ? dFit.height : 0}, !vertical);
	if (!g.fits) throw new Error(`cta ${ctx.sc.id}: the CTA block needs ${g.height}px; the column has ${L.column.bottom - L.column.top}px. Shorten the title or disclosure.`);
	const centreX = L.card ? L.card.x + L.card.w / 2 : FRAME[ctx.format].width / 2;
	const btn: Box = {x: Math.round(centreX - L.button.w / 2), y: g.buttonY, w: L.button.w, h: L.button.h};
	const press = dir.press ?? 30;
	const pressScale = track(frame, [[press, 1], [press + 3, 0.94], [press + 10, 1]], [EASE.quadOut, EASE.inOut]);
	const pressed = frame >= press + 3;
	// with a disclosure the card and its text are on screen from frame 0 (no entry), so the disclosure is never partial
	const cardIn = disclosure ? 1 : entry(frame, 0, 12);
	const btnIn = disclosure ? 1 : entry(frame, 6, 10);
	const reveal = (y: number) => ({clipPath: `inset(0 0 ${Math.max(0, FRAME[ctx.format].height - y)}px 0)`});
	const cardBottom = g.top + g.height * cardIn;
	return (
		<SceneBg>
			<CharacterLayer
				format={ctx.format}
				zoo={ctx.sc.zoo?.present === false ? null : {place: L.zoo, schedule: dir.zoo}}
				badger={badgerPlace && !vertical ? {place: badgerPlace, schedule: dir.badger} : null}
			/>
			{L.card ? (
				<div style={{position: 'absolute', left: L.card.x, top: g.top, width: L.card.w, height: g.height, clipPath: `inset(0 0 ${(1 - cardIn) * 100}% 0)`}}>
					<Card box={{x: 0, y: 0, w: L.card.w, h: g.height}} />
				</div>
			) : null}
			{title ? (
				<div style={{position: 'absolute', inset: 0, ...reveal(L.card ? cardBottom : g.titleY + tFit.height * cardIn + 8)}}>
					<Lines fit={tFit} spec={L.title} lang={ctx.lang} color={C.ink} box={{...L.title.box, y: g.titleY, h: Math.ceil(tFit.height)}} />
				</div>
			) : null}
			{button ? (
				<div
					style={{
						position: 'absolute',
						left: btn.x,
						top: btn.y,
						width: btn.w,
						height: btn.h,
						transform: `translateY(${(1 - btnIn) * 24}px) scale(${pressScale})`,
						clipPath: `inset(${(1 - btnIn) * 100}% 0 0 0)`,
					}}
				>
					<div style={{position: 'absolute', inset: 0, boxSizing: 'border-box', borderRadius: btn.h / 2, backgroundColor: pressed ? C.ink : C.slate, border: `${OUTLINE}px solid ${C.ink}`}} />
					<Lines fit={bFit} spec={L.buttonLabel} lang={ctx.lang} color={C.onDark} box={{x: 0, y: 0, w: btn.w, h: btn.h}} />
				</div>
			) : null}
			{disclosure ? (
				<>
					{/* on screen for the whole scene: no entry animation */}
					{vertical ? <Card box={{x: 54, y: g.disclosureY - 16, w: 972, h: Math.ceil(dFit.height) + 32}} radius={R.m} /> : null}
					<Lines fit={dFit} spec={L.disclosure} lang={ctx.lang} color={C.ink} box={{...L.disclosure.box, y: g.disclosureY, h: Math.ceil(dFit.height)}} />
				</>
			) : null}
		</SceneBg>
	);
};
