/**
 * AudioProbe: renders one bed under a fixed duck pattern, either through <Html5Audio volume={f => ...}>
 * (Remotion's per-frame volume) or through PcmTrack (per-sample gain), so src/audio/tools/probe_duck.sh
 * can compare both renders with the ideal per-sample result. Audio only; 320x180.
 *
 *   npx remotion render src/audio/index.ts AudioProbe out/audio/integration/probe/pcm.wav --codec=wav \
 *     --config=src/audio/remotion.wav.config.ts --props='{"mode":"pcm"}'
 */
import React, {useMemo} from 'react';
import {AbsoluteFill, Html5Audio, staticFile, useVideoConfig} from 'remotion';
import {BRAND} from '../../characters/palette';
import {PcmTrack} from '../components/PcmTrack.tsx';
import {probeGain, type ProbeProps} from './probe.ts';

export {PROBE_DEFAULTS, PROBE_FRAMES, type ProbeProps} from './probe.ts';

export const AudioProbe: React.FC<ProbeProps> = (p) => {
	const {fps, durationInFrames} = useVideoConfig();
	const key = JSON.stringify(p);
	// the gain law and loop depend on the settings only (not on the props object's identity)
	const gain = useMemo(() => probeGain(JSON.parse(key) as ProbeProps, durationInFrames / fps), [key, durationInFrames, fps]);
	const loop = useMemo(() => (p.loopSamples > 0 ? {startSample: 0, endSample: p.loopSamples} : null), [p.loopSamples]);
	const trim = 10 ** (p.trimDb / 20);
	return (
		<AbsoluteFill style={{backgroundColor: BRAND.background}}>
			{p.mode === 'html5' ? (
				<Html5Audio src={staticFile(p.src)} loop={p.loopSamples > 0} volume={(f) => trim * gain.gain(f / fps)} name="probe-html5" />
			) : (
				<PcmTrack
					src={p.src}
					gain={gain}
					loop={loop}
					crossovers={p.split ? [700, 5000] : undefined}
					offsetSamples={p.offsetSamples}
					trim={trim}
					durationInFrames={durationInFrames}
					name="probe-pcm"
				/>
			)}
		</AbsoluteFill>
	);
};
