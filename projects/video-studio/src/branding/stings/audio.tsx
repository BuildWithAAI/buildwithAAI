/**
 * The stings' audio hook. The branding kit ships the stings SILENT (empty audio track); the audio workflow
 * supplies the jingle. Contract:
 *  - pass `jingle` = a path under public/ (e.g. "audio/zoora-ai/sting.wav"); it plays from frame 0 (+ jingleOffsetSec);
 *  - the composition's duration follows the jingle (calculateMetadata), clamped to 3-5 s; the animation's build is
 *    fixed and only the final hold stretches, so the visual hits below stay at the same times;
 *  - visual hits (frame numbers at 30 fps) are exported in STING_HITS for the composer to land accents on.
 */
import React from 'react';
import {Html5Audio, Sequence, staticFile, type CalculateMetadataFunction} from 'remotion';
import {getAudioDurationInSeconds} from '@remotion/media-utils';
import {STING} from '../spec';

export type StingAudioProps = {
	/** Path of the jingle under public/ (omit for a silent sting). */
	jingle?: string;
	/** Start the jingle this many seconds after frame 0 (may be negative to skip a lead-in). */
	jingleOffsetSec?: number;
	/** Jingle gain, 0..1 (default 1: the jingle should arrive mastered). */
	jingleVolume?: number;
};

export const stingFramesFor = (seconds: number | null): number => {
	const sec = seconds === null || !Number.isFinite(seconds) ? STING.defaultSec : seconds;
	const clamped = Math.min(STING.maxSec, Math.max(STING.minSec, sec));
	return Math.round(clamped * STING.fps);
};

/** Duration from the jingle when one is given; otherwise the 4 s default. */
export const stingMetadata: CalculateMetadataFunction<StingAudioProps & Record<string, unknown>> = async ({props}) => {
	if (!props.jingle) return {durationInFrames: stingFramesFor(null)};
	const sec = await getAudioDurationInSeconds(staticFile(props.jingle));
	return {durationInFrames: stingFramesFor(sec + (props.jingleOffsetSec ?? 0))};
};

export const StingAudio: React.FC<StingAudioProps> = ({jingle, jingleOffsetSec = 0, jingleVolume = 1}) => {
	if (!jingle) return null;
	const skip = Math.max(0, Math.round(-jingleOffsetSec * STING.fps));
	const from = Math.max(0, Math.round(jingleOffsetSec * STING.fps));
	return (
		<Sequence from={from} layout="none" name="jingle">
			<Html5Audio src={staticFile(jingle)} trimBefore={skip || undefined} volume={jingleVolume} name="jingle" />
		</Sequence>
	);
};
