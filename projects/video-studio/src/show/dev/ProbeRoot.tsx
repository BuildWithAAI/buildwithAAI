import React from 'react';
import {Composition} from 'remotion';
import {Probe} from './Probe';
export const ProbeRoot: React.FC = () => (
	<>
		<Composition id="ShowProbe" component={Probe} durationInFrames={1} fps={30} width={1920} height={1080} defaultProps={{format: 'landscape' as const, shot: 'wide' as const}} />
		<Composition id="ShowProbeV" component={Probe} durationInFrames={1} fps={30} width={1080} height={1920} defaultProps={{format: 'vertical' as const, shot: 'two' as const}} />
	</>
);
