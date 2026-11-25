/**
 * AudioDuckRms: a bed ducked under a narration WITHOUT word timings, two ways that must render the same
 * samples (src/audio/tools/rms_check.sh compares them byte for byte):
 *  - mode 'narration': <MusicBed duck={{narration: {src, offsetSec}}}>, the speech RMS read in the render tab;
 *  - mode 'speech': <MusicBed duck={{speech}}> with the spans computed in Node by the same TypeScript
 *    (src/audio/tools/rms_spans.ts), the path the AudioDemo's measurements already prove.
 * Audio only, 320x180. `withVoice` adds the narration itself (for listening).
 */
import React from 'react';
import {AbsoluteFill, Html5Audio, Sequence, staticFile, useVideoConfig} from 'remotion';
import {BRAND} from '../../characters/palette';
import {MusicBed} from '../components/MusicBed.tsx';
import type {Span} from '../core/envelope.ts';

export type DuckRmsProps = {
	mode: 'narration' | 'speech';
	/** narration WAV under public/ */
	narration: string;
	/** where the narration starts (composition seconds) */
	offsetSec: number;
	/** mode 'speech': the spans (composition seconds) */
	speech: Span[];
	bed: string;
	withVoice: boolean;
};

export const DUCK_RMS_DEFAULTS: DuckRmsProps = {
	mode: 'narration',
	narration: 'generated/zoora-security/_audio-demo/en/narration.wav',
	offsetSec: 1,
	speech: [],
	bed: 'bed-show-tension-underscore',
	withVoice: false,
};

export const DUCK_RMS_FRAMES = 390;

export const AudioDuckRms: React.FC<DuckRmsProps> = (p) => {
	const {fps} = useVideoConfig();
	const duck = p.mode === 'narration' ? {narration: {src: p.narration, offsetSec: p.offsetSec}} : {speech: p.speech};
	return (
		<AbsoluteFill style={{backgroundColor: BRAND.background}}>
			<MusicBed src={p.bed} duck={duck} fadeInMs={300} fadeOutMs={800} name="rms-check bed" />
			{p.withVoice ? (
				<Sequence from={Math.round(p.offsetSec * fps)} layout="none" name="narration">
					<Html5Audio src={staticFile(p.narration)} />
				</Sequence>
			) : null}
		</AbsoluteFill>
	);
};
