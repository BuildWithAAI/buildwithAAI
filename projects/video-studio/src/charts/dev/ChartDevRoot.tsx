// Dev compositions for the chart system (not part of the main Root.tsx registry). Entry: src/charts/dev/index.ts
//   npx remotion still src/charts/dev/index.ts ChartTest out/charts/chart-test.png --frame=0
//   npx remotion render src/charts/dev/index.ts ChartReveal out/charts/chart-reveal.mp4
import React, {useMemo} from 'react';
import {AbsoluteFill, Composition, useCurrentFrame, type CalculateMetadataFunction} from 'remotion';
import {BRAND} from '../../characters/palette';
import {CandlestickChart} from '../CandlestickChart';
import {assertChartData, refLabel, type ChartData} from '../chartData.ts';
import {layoutChart, type Box} from '../chartLayout.ts';
import {flickerIssues, planReveal, revealStateAt, type RevealSegment} from '../revealPlan.ts';
import {demoData, demoOptions, BOX_TEST, REVEAL_FRAMES, REVEAL_START, revealSegments} from './demoData.ts';

type DemoProps = {
	data: ChartData;
	box: Box;
	surface: 'dark' | 'light';
	showVolume: boolean;
	callout: {candlesBack: number; label: string} | null;
	draft: boolean;
	plan: {segments: RevealSegment[]; startFrame: number} | null;
};

const ChartDemo: React.FC<DemoProps> = ({plan, ...chart}) => {
	const frame = useCurrentFrame();
	const rp = useMemo(() => (plan ? planReveal(plan.segments, plan.startFrame, chart.data.candles.length) : null), [plan, chart.data]);
	const st = rp ? revealStateAt(rp, frame) : null;
	return (
		<AbsoluteFill style={{backgroundColor: BRAND.background}}>
			<CandlestickChart {...chart} reveal={st ? st.spec : null} calloutVisible={st ? st.calloutVisible : true} />
		</AbsoluteFill>
	);
};

/**
 * Validate before frame 0 (CHART_SPEC 2): the data, the reveal plan, the layout of every frame of the shot (each throws
 * on a broken rule), and for a reveal, that no drawn element has a 1-frame state (A4, A8).
 */
const validateDemo: CalculateMetadataFunction<DemoProps> = ({props, compositionId}) => {
	const data = assertChartData(props.data);
	const frames = compositionId === 'ChartReveal' ? REVEAL_FRAMES : 1;
	const rp = props.plan ? planReveal(props.plan.segments, props.plan.startFrame, data.candles.length) : null;
	if (rp && rp.endFrame > frames) throw new Error(`reveal ends at frame ${rp.endFrame}, after the ${frames}-frame shot`);
	const models = [];
	for (let f = 0; f < frames; f++) {
		const st = rp ? revealStateAt(rp, f) : null;
		models.push(layoutChart({...props, data, reveal: st ? st.spec : null, calloutVisible: st ? st.calloutVisible : true}, f));
	}
	const flicker = rp ? flickerIssues(models) : [];
	if (flicker.length) throw new Error(`reveal has 1-frame states: ${flicker.slice(0, 5).join('; ')}`);
	return {props};
};

const opts = demoOptions();
const asProps = (o: (typeof opts)['ChartTest']): DemoProps => ({
	data: o.data,
	box: o.box,
	surface: o.surface ?? 'dark',
	showVolume: o.showVolume ?? true,
	callout: o.callout ?? null,
	draft: o.draft ?? false,
	plan: null,
});
const revealData = demoData();

export const ChartDevRoot: React.FC = () => (
	<>
		{/* Full synthetic story, all candles, dark panel on the default background. */}
		<Composition id="ChartTest" component={ChartDemo} durationInFrames={30} fps={30} width={1920} height={1080} defaultProps={asProps(opts.ChartTest)} calculateMetadata={validateDemo} />
		{/* Small inline diagram on the light card: a 24-candle pump-and-rug close-up, no volume pane. */}
		<Composition id="ChartLight" component={ChartDemo} durationInFrames={30} fps={30} width={1920} height={1080} defaultProps={asProps(opts.ChartLight)} calculateMetadata={validateDemo} />
		{/* The full story revealed left to right in 11 s: step history at 2 f/candle, live pump and rug, 18 f hold on the rug, end hold. */}
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
				showVolume: true,
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
