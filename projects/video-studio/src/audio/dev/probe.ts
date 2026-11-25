/**
 * The AudioProbe's settings and gain law, pure (no Remotion import), so the probe tool
 * (src/audio/tools/probe_duck.sh) and the tests rebuild exactly the curve the composition plays.
 */
import {BedGain, DuckCurve} from '../core/envelope.ts';
import {SPLIT_DEPTH_RATIOS} from '../core/bed.ts';

export type ProbeProps = {
	mode: 'html5' | 'pcm';
	src: string;
	/** loop length in samples (0 = no loop) */
	loopSamples: number;
	depthDb: number;
	attackMs: number;
	releaseMs: number;
	/** speech spans, seconds */
	speech: [number, number][];
	trimDb: number;
	/** band-split duck (depths depth/6, depth, depth/3 at 700 Hz and 5 kHz) instead of broadband */
	split: boolean;
	/** start this many samples into the bed (e.g. just before the loop seam) */
	offsetSamples: number;
};

export const PROBE_DEFAULTS: ProbeProps = {
	mode: 'pcm',
	src: 'audio/music/bed-show-neutral-underscore.flac',
	loopSamples: 3072000,
	depthDb: 12,
	attackMs: 120,
	releaseMs: 450,
	speech: [
		[1.0, 2.5],
		[3.2, 5.0],
		[6.4, 8.0],
	],
	trimDb: 0,
	split: false,
	offsetSamples: 0,
};

export const PROBE_FRAMES = 300;
export const PROBE_FPS = 30;

/** The probe's gain law (gaps are not filled: minGapMs 0, so every span ducks on its own). */
export const probeGain = (p: ProbeProps, durationSec: number): BedGain =>
	new BedGain({
		bands: p.split ? 3 : 1,
		start: 0,
		end: durationSec,
		sources: [
			{
				curve: new DuckCurve(
					p.speech.map(([start, end]) => ({start, end})),
					{attackMs: p.attackMs, releaseMs: p.releaseMs, minGapMs: 0},
				),
				depthsDb: p.split ? SPLIT_DEPTH_RATIOS.map((r) => p.depthDb * r) : [p.depthDb],
			},
		],
	});
