/**
 * Chart reveal: the CandlestickChart (src/charts, read-only) revealed left to right on the narration (history steps
 * on, the pump and the rug form live, the rug completes on its word and holds 18 f). ZOO watches it in 3/4, then turns
 * to camera on a blink for the deadpan beat; Badger, if present, sits beside him (landscape) or cuts in (vertical).
 * Synthetic data always carries the chart's own "Illustrative · fictional token" footer; a localized chip outside the
 * panel repeats it in the episode's language (and shows onScreen.label when given).
 */
import React, {useMemo} from 'react';
import {useCurrentFrame} from 'remotion';
import {CandlestickChart} from '../../charts/CandlestickChart';
import {planReveal, revealStateAt} from '../../charts/revealPlan';
import {C, R} from '../theme';
import {LAYOUTS, type BadgerPlace, type ZooPlace} from '../layout/specs';
import {Lines, useFit} from '../text/FitText';
import {CharacterLayer, SceneBg, entry, useDirection, type SceneCtx} from './parts';
import {sceneCast} from './direction';
import {BadgerInsert, inInsert} from './Insert';
import {str} from '../validate';
import {uiLabel} from '../i18n/ui';

export const ChartScene: React.FC<{ctx: SceneCtx}> = ({ctx}) => {
	const frame = useCurrentFrame();
	const L = LAYOUTS.chart[ctx.format];
	const plan = ctx.chart;
	const badgerOn = !!ctx.sc.badger?.present;
	const pair = badgerOn && L.pair ? L.pair : null;
	const zooPlace: ZooPlace = pair ? pair.zoo : L.solo.zoo;
	const badgerPlace: BadgerPlace | null = badgerOn ? (pair ? pair.badger : LAYOUTS.hook[ctx.format].badger) : null;
	const dir = useDirection(ctx, sceneCast(ctx.sc, ctx.format));
	const label = str(ctx.sc, 'label') ?? (ctx.sc.chart?.illustrative && ctx.lang !== 'en' ? uiLabel(ctx.sb, 'illustrative') : null) ?? '';
	const chipFit = useFit(label, L.chip, ctx.lang);
	const rp = useMemo(() => (plan?.segments ? planReveal(plan.segments, plan.startFrame, plan.data.candles.length) : null), [plan]);
	if (!plan) throw new Error(`chart scene ${ctx.sc.id}: no chart plan (calculateMetadata did not resolve it)`);
	if (inInsert(dir, frame)) return <BadgerInsert ctx={ctx} dir={dir} />;
	const st = rp ? revealStateAt(rp, frame) : null;
	const panelIn = entry(frame, 0, 10);
	const chipW = Math.ceil(chipFit.width) + 2 * 22;
	// the chip sits in its box on the spec's side (vertical: left, clear of the Shorts button column)
	const chipLeft = L.chip.align === 'left' ? L.chip.box.x : L.chip.align === 'center' ? Math.round(L.chip.box.x + (L.chip.box.w - chipW) / 2) : L.chip.box.x + L.chip.box.w - chipW;
	return (
		<SceneBg>
			<CharacterLayer
				format={ctx.format}
				zoo={ctx.sc.zoo?.present === false ? null : {place: zooPlace, schedule: dir.zoo}}
				badger={pair && badgerPlace ? {place: badgerPlace, schedule: dir.badger} : null}
			/>
			{/* integer translate only on the panel (CHART_SPEC L1/A9) */}
			<div style={{position: 'absolute', inset: 0, transform: `translateY(${Math.round((1 - panelIn) * 30)}px)`, clipPath: `inset(${(1 - panelIn) * 100}% 0 0 0)`}}>
				<CandlestickChart
					data={plan.data}
					box={plan.box}
					surface={ctx.sc.chart?.surface ?? 'dark'}
					callout={plan.callout}
					reveal={st ? st.spec : null}
					calloutVisible={st ? st.calloutVisible : true}
				/>
			</div>
			{label ? (
				<div style={{position: 'absolute', left: chipLeft, top: L.chip.box.y, width: chipW, height: L.chip.box.h}}>
					<div style={{position: 'absolute', inset: 0, backgroundColor: C.slate, borderRadius: R.m}} />
					<Lines fit={chipFit} spec={{...L.chip, align: 'center', valign: 'center'}} lang={ctx.lang} color={C.onDark} box={{x: 0, y: 0, w: chipW, h: L.chip.box.h}} />
				</div>
			) : null}
		</SceneBg>
	);
};
