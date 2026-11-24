/**
 * Call to action: subscribe by default. The button label is onScreen.button or the localized ui.subscribe. When the
 * storyboard has offers, the disclosure line (onScreen.disclosure) is on screen for the WHOLE scene, high contrast,
 * and the validator has already required the narration to say it (FTC 16 CFR 255: spoken and on screen).
 * The button presses once on its cue word; ZOO points at it (landscape) or glances up (vertical).
 */
import React from 'react';
import {useCurrentFrame} from 'remotion';
import {C, OUTLINE, R} from '../theme';
import {LAYOUTS, type Box} from '../layout/specs';
import {Lines, useFit} from '../text/FitText';
import {CharacterLayer, Card, entry, SceneBg, useDirection, type SceneCtx} from './parts';
import {BadgerInsert, inInsert} from './Insert';
import {str} from '../validate';
import {uiLabel} from '../i18n/ui';
import {EASE, track} from '../motion';

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

	const press = dir.press ?? 30;
	const pressScale = track(frame, [[press, 1], [press + 3, 0.94], [press + 10, 1]], [EASE.quadOut, EASE.inOut]);
	const pressed = frame >= press + 3;
	const cardIn = entry(frame, 0, 10);
	const btnIn = entry(frame, 6, 10);
	const btn: Box = L.button;
	return (
		<SceneBg>
			<CharacterLayer
				format={ctx.format}
				zoo={ctx.sc.zoo?.present === false ? null : {place: L.zoo, schedule: dir.zoo}}
				badger={badgerPlace && !vertical ? {place: badgerPlace, schedule: dir.badger} : null}
			/>
			<div style={{position: 'absolute', inset: 0, transform: `translateY(${(1 - cardIn) * 24}px)`, clipPath: `inset(${(1 - cardIn) * 100}% 0 0 0)`}}>
				{L.card ? <Card box={L.card} /> : null}
				{title ? <Lines fit={tFit} spec={L.title} lang={ctx.lang} color={C.ink} /> : null}
			</div>
			{button ? (
				<div
					style={{
						position: 'absolute',
						left: btn.x,
						top: btn.y,
						width: btn.w,
						height: btn.h,
						transform: `translateY(${(1 - btnIn) * 30}px) scale(${pressScale})`,
						clipPath: `inset(${(1 - btnIn) * 100}% 0 0 0)`,
					}}
				>
					<div
						style={{
							position: 'absolute',
							inset: 0,
							boxSizing: 'border-box',
							borderRadius: btn.h / 2,
							backgroundColor: pressed ? C.ink : C.slate,
							border: `${OUTLINE}px solid ${C.ink}`,
						}}
					/>
					<Lines fit={bFit} spec={L.buttonLabel} lang={ctx.lang} color={C.onDark} box={{x: 0, y: 0, w: btn.w, h: btn.h}} />
				</div>
			) : null}
			{disclosure ? (
				vertical ? (
					<>
						<Card box={{x: 54, y: L.disclosure.box.y - 12, w: 972, h: L.disclosure.box.h + 24}} radius={R.m} />
						<Lines fit={dFit} spec={L.disclosure} lang={ctx.lang} color={C.ink} />
					</>
				) : (
					<Lines fit={dFit} spec={L.disclosure} lang={ctx.lang} color={C.ink} />
				)
			) : null}
		</SceneBg>
	);
};
