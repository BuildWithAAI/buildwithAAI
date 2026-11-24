// Throwaway probe for framing decisions (dev only). npx remotion still src/episode/dev/probe/index.tsx Probe out.png --props='{"v":0}'
import React from 'react';
import {AbsoluteFill, Composition, registerRoot} from 'remotion';
import {Badger, BRAND, ZooRig} from '../../../characters';

type P = {v: number};
const Probe: React.FC<P> = ({v}) => (
	<AbsoluteFill style={{backgroundColor: BRAND.background}}>
		<svg width={1920} height={1080} viewBox="0 0 1920 1080">
			{v === 0 ? (
				<>
					<ZooRig x={470} y={1480} scale={1.5} pose="point" poseAmount={1} />
					<Badger x={860} y={1480} scale={1.5} view="front" />
					<Badger x={1500} y={1480} scale={1.5} view="left" pose="lookUp" />
					<Badger x={1500} y={1480} scale={0.4} view="left" />
				</>
			) : v === 1 ? (
				<>
					<ZooRig x={300} y={980} scale={0.8} view="threeQuarter" />
					<Badger x={700} y={980} scale={0.8} view="right" pose="sit" />
					<ZooRig x={1100} y={980} scale={0.8} view="side" />
					<Badger x={1550} y={980} scale={0.8} view="threeQuarter" />
				</>
			) : (
				<>
					<ZooRig x={400} y={1480} scale={1.5} view="threeQuarter" />
					<Badger x={1000} y={1480} scale={1.5} view="right" pose="lookUp" />
					<Badger x={1500} y={1480} scale={1.5} view="left" head="threeQuarterLeftScreen" />
				</>
			)}
		</svg>
	</AbsoluteFill>
);
registerRoot(() => <Composition id="Probe" component={Probe} durationInFrames={1} fps={30} width={1920} height={1080} defaultProps={{v: 0}} />);
