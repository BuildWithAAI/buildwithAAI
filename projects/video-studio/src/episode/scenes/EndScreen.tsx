/**
 * End screen: the last 20 s. The outro line, ZOO and Badger in a wide pair shot (a moving hold: breathing, blinks, one
 * glance, Badger looks up at ZOO), and EMPTY safe zones for YouTube's end-screen elements: two 16:9 zones for video or
 * playlist elements and one circle for the subscribe element. The zones are drawn as plain designed frames so the
 * render still looks finished where YouTube shows no elements (e.g. mobile web). Shorts have no end-screen elements:
 * the vertical version is an outro card.
 */
import React from 'react';
import {useCurrentFrame} from 'remotion';
import {C, OUTLINE, R} from '../theme';
import {LAYOUTS} from '../layout/specs';
import {Lines, useFit} from '../text/FitText';
import {CharacterLayer, entry, SceneBg, useDirection, type SceneCtx} from './parts';
import {BadgerInsert, inInsert} from './Insert';
import {str} from '../validate';
import {uiLabel} from '../i18n/ui';

export const EndScreenScene: React.FC<{ctx: SceneCtx}> = ({ctx}) => {
	const frame = useCurrentFrame();
	const L = LAYOUTS.endscreen[ctx.format];
	const vertical = ctx.format === 'vertical';
	const badgerPlace = ctx.sc.badger?.present ? L.badger : null;
	const dir = useDirection(ctx, {zooView: 'front', badgerPlace, badgerInsert: vertical});
	const outro = str(ctx.sc, 'title') ?? str(ctx.sc, 'outro') ?? '';
	const oFit = useFit(outro, L.outro, ctx.lang);
	const slotLabel = L.slotLabel ? (uiLabel(ctx.sb, 'watchNext') ?? '') : '';
	const subLabel = L.subscribeLabel ? (uiLabel(ctx.sb, 'subscribeSlot') ?? '') : '';
	const slFit = useFit(slotLabel, L.slotLabel ?? L.outro, ctx.lang);
	const suFit = useFit(subLabel, L.subscribeLabel ?? L.outro, ctx.lang);
	if (inInsert(dir, frame)) return <BadgerInsert ctx={ctx} dir={dir} />;
	const zonesIn = entry(frame, 4, 12);
	return (
		<SceneBg>
			<CharacterLayer
				format={ctx.format}
				zoo={ctx.sc.zoo?.present === false ? null : {place: L.zoo, schedule: dir.zoo}}
				badger={badgerPlace && !vertical ? {place: badgerPlace, schedule: dir.badger} : null}
			/>
			{outro ? <Lines fit={oFit} spec={L.outro} lang={ctx.lang} color={C.ink} style={{clipPath: `inset(0 ${(1 - entry(frame, 2, 14)) * 100}% 0 0)`}} /> : null}
			<div style={{position: 'absolute', inset: 0, transform: `translateX(${(1 - zonesIn) * 40}px)`, clipPath: `inset(0 0 0 ${(1 - zonesIn) * 100}%)`}}>
				{L.slots.map((s, i) => (
					<div
						key={i}
						style={{position: 'absolute', left: s.x, top: s.y, width: s.w, height: s.h, boxSizing: 'border-box', backgroundColor: C.card, border: `${OUTLINE}px solid ${C.ink}`, borderRadius: R.l}}
					/>
				))}
				{slotLabel && L.slotLabel ? <Lines fit={slFit} spec={L.slotLabel} lang={ctx.lang} color={C.ink} /> : null}
			</div>
			{L.subscribe ? (
				<div style={{position: 'absolute', inset: 0, transform: `scale(${0.9 + 0.1 * zonesIn})`, transformOrigin: `${L.subscribe.cx}px ${L.subscribe.cy}px`, clipPath: zonesIn < 1 ? `circle(${zonesIn * 100}% at ${L.subscribe.cx}px ${L.subscribe.cy}px)` : undefined}}>
					<div
						style={{
							position: 'absolute',
							left: L.subscribe.cx - L.subscribe.r,
							top: L.subscribe.cy - L.subscribe.r,
							width: 2 * L.subscribe.r,
							height: 2 * L.subscribe.r,
							boxSizing: 'border-box',
							borderRadius: L.subscribe.r,
							backgroundColor: C.card,
							border: `${OUTLINE}px solid ${C.ink}`,
						}}
					/>
					{subLabel && L.subscribeLabel ? <Lines fit={suFit} spec={L.subscribeLabel} lang={ctx.lang} color={C.ink} /> : null}
				</div>
			) : null}
		</SceneBg>
	);
};
