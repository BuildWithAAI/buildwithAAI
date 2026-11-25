/**
 * <Stinger id at?/>: a theme sting, channel intro sting or segment bumper from the music manifest, with
 * its first downbeat on frame `at` of the parent sequence (cues with a pre-roll start that many frames
 * earlier, e.g. theme-5s and the bumpers: 2 frames).
 *
 * Level: the cue as mastered (-16 LUFS-I), trimmed so its true peak sits at or under PEAK_BUDGET_DBTP
 * (-2 dBTP): Remotion mixes without a bus limiter and the AAC encode overshoots, so this keeps the
 * delivered mix under -1 dBTP. Pass `levelDb` to override. Pair it with the bed's rest
 * (stingerRest(placeStinger(id, at))) so the bed steps out while it plays.
 */
import React from 'react';
import {Html5Audio, Sequence, staticFile, useVideoConfig} from 'remotion';
import {peakBudgetTrimDb} from '../core/music.ts';
import {placeStinger} from './library.ts';

export type StingerProps = {
	/** cue id: "intro-sting-show", "theme-5s", "bumper-rekt-meter", ... */
	id: string;
	/** the frame its first downbeat lands on (default 0) */
	at?: number;
	/** level trim in dB; default: the peak-budget trim */
	levelDb?: number;
	name?: string;
};

export const Stinger: React.FC<StingerProps> = ({id, at = 0, levelDb, name}) => {
	const {fps} = useVideoConfig();
	const p = placeStinger(id, at, fps);
	const trim = levelDb ?? peakBudgetTrimDb(p.cue);
	return (
		<Sequence from={p.from} durationInFrames={p.durationInFrames} name={name ?? `stinger ${id}`} layout="none">
			<Html5Audio src={staticFile(p.cue.file)} volume={10 ** (trim / 20)} />
		</Sequence>
	);
};
