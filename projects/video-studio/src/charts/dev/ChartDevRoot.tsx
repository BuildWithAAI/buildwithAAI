// Dev compositions for the chart system (not part of the main Root.tsx registry). Entry: src/charts/dev/index.ts
//   npx remotion still src/charts/dev/index.ts ChartTest out/charts/chart-test.png --frame=0
//   npx remotion render src/charts/dev/index.ts ChartReveal out/charts/chart-reveal.mp4
import React, {useMemo} from 'react';
import {AbsoluteFill, Composition, useCurrentFrame, type CalculateMetadataFunction} from 'remotion';
import {BRAND} from '../../characters/palette';
import {CandlestickChart} from '../CandlestickChart';
import {assertChartData, refLabel, type ChartData} from '../chartData.ts';
import {layoutChart, type Box} from '../chartLayout.ts';
import {planReveal, revealSpecAt, type RevealSegment} from '../revealPlan.ts';
import {demoData, demoOptions, BOX_TEST, REVEAL_FRAMES, REVEAL_START, revealSegments} from './demoData.ts';

type DemoProps = {
	data: ChartData;
	box: Box;
	surface: 'dark' | 'light';
	callout: {candlesBack: number; label: string} | null;
	draft: boolean;
	plan: {segments: RevealSegment[]; startFrame: number} | null;
};

const ChartDemo: React.FC<DemoProps> = ({plan, ...chart}) => {
	const frame = useCurrentFrame();
	const rp = useMemo(() => (plan ? planReveal(plan.segments, plan.startFrame, chart.data.candles.length) : null), [plan, chart.data]);
	return (
		<AbsoluteFill style={{backgroundColor: BRAND.background}}>
			<CandlestickChart {...chart} reveal={rp ? revealSpecAt(rp, frame) : null} />
		</AbsoluteFill>
	);
};

/** Validate before frame 0 (CHART_SPEC 2): the data, the reveal plan, and the layout of every frame of the shot. */
const validateDemo: CalculateMetadataFunction<DemoProps> = ({props, compositionId}) => {
	const data = assertChartData(props.data);
	const frames = compositionId === 'ChartReveal' ? REVEAL_FRAMES : 1;
	const rp = props.plan ? planReveal(props.plan.segments, props.plan.startFrame, data.candles.length) : null;
	if (rp && rp.endFrame > frames) throw new Error(`reveal ends at frame ${rp.endFrame}, after the ${frames}-frame shot`);
	for (let f = 0; f < frames; f++) layoutChart({...props, data, reveal: rp ? revealSpecAt(rp, f) : null}, f);
	return {props};
};

const opts = demoOptions();
const asProps = (o: (typeof opts)['ChartTest']): DemoProps => ({
	data: o.data,
	box: o.box,
	surface: o.surface ?? 'dark',
	callout: o.callout ?? null,
	draft: o.draft ?? false,
	plan: null,
});
const revealData = demoData();

export const ChartDevRoot: React.FC = () => (
	<>
		{/* Full synthetic story, all candles, dark panel on the default background. */}
		<Composition id="ChartTest" component={ChartDemo} durationInFrames={30} fps={30} width={1920} height={1080} defaultProps={asProps(opts.ChartTest)} calculateMetadata={validateDemo} />
		{/* Same data on the light card, in a smaller box. */}
		<Composition id="ChartLight" component={ChartDemo} durationInFrames={30} fps={30} width={1920} height={1080} defaultProps={asProps(opts.ChartLight)} calculateMetadata={validateDemo} />
		{/* Same story revealed left to right in 10 s: step history, live pump and rug, 18 f hold on the rug. */}
		<Composition
			id="ChartReveal"
			component={ChartDemo}
			durationInFrames={REVEAL_FRAMES}
			fps={30}
			width={1920}
			height={1080}
			defaultProps={{
				data: revealData,
				box: BOX_TEST,
				surface: 'dark',
				callout: {candlesBack: 12, label: refLabel(12, revealData.intervalSec)},
				draft: true,
				plan: {segments: revealSegments(revealData), startFrame: REVEAL_START},
			}}
			calculateMetadata={validateDemo}
		/>
		{/* Shorts: 1080x1920, the panel laid out again for its own box (10m candles, two-row header). */}
		<Composition id="ChartShort" component={ChartDemo} durationInFrames={30} fps={30} width={1080} height={1920} defaultProps={asProps(opts.ChartShort)} calculateMetadata={validateDemo} />
	</>
);
