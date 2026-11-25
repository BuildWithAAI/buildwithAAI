/**
 * Entry root for the audio integration (src/audio/index.ts), separate from src/Root.tsx and from the
 * episode and show entry points.
 *  - AudioDemo: the 30-45 s demo mix (narration, theme sting, ducked bed, bumper, whooshes, pops, typing).
 *  - AudioProbe: one bed under a fixed duck pattern, rendered through Html5Audio or PcmTrack (dev).
 *  - AudioDuckRms: a bed ducked by the narration's speech RMS, or by the same spans computed in Node (dev).
 */
import React from 'react';
import {Composition} from 'remotion';
import {AudioProbe, PROBE_DEFAULTS, PROBE_FRAMES} from './dev/Probe.tsx';
import {AUDIO_DEMO_DEFAULTS, AudioDemo, calculateAudioDemo} from './demo/AudioDemo.tsx';
import {AudioDuckRms, DUCK_RMS_DEFAULTS, DUCK_RMS_FRAMES} from './dev/DuckRms.tsx';

export const AudioRoot: React.FC = () => (
	<>
		<Composition id="AudioDemo" component={AudioDemo} durationInFrames={990} fps={30} width={1920} height={1080} defaultProps={AUDIO_DEMO_DEFAULTS} calculateMetadata={calculateAudioDemo} />
		<Composition id="AudioProbe" component={AudioProbe} durationInFrames={PROBE_FRAMES} fps={30} width={320} height={180} defaultProps={PROBE_DEFAULTS} />
		<Composition id="AudioDuckRms" component={AudioDuckRms} durationInFrames={DUCK_RMS_FRAMES} fps={30} width={320} height={180} defaultProps={DUCK_RMS_DEFAULTS} />
	</>
);
