/**
 * <MusicBed src|mood duck={{timeline, depthDb, attackMs, releaseMs}} loop/>: a music bed that ducks
 * under Zoo's narration, sample-accurately, and loops on its exact loop points.
 *
 *   <MusicBed mood="neutral" duck={{timeline}} />                          // the show's neutral underscore, 2/12/4 dB split duck
 *   <MusicBed src="bed-story-tension" duck={{timeline, depthDb: 9, split: false}} levelDb={-2} />
 *   <MusicBed mood="tension" duck={{narration: {src: 'generated/zoora-security/<slug>/en/narration.wav'}}} />  // speech RMS
 *   <MusicBed mood="tension" duck={{speech: spans}} rests={[stingerRest(placeStinger('bumper-red-flag', 900))]} />
 *
 * The duck is computed per sample (core/envelope.ts through core/pcm.ts, rendered by PcmTrack), so
 * there is no zipper noise; with `split` (default) the bed is split at 700 Hz and 5 kHz and only Zoo's
 * consonant band ducks the full depth (the engine's band-split duck, reproduced to the 16-bit floor:
 * src/audio/README.md). All times in `duck` and `rests` are ABSOLUTE composition seconds; the component
 * may sit inside any <Sequence>.
 */
import React, {useMemo} from 'react';
import {useVideoConfig} from 'remotion';
import {planBed, type DuckSpec, type LiftSpec} from '../core/bed.ts';
import type {Rest, Span} from '../core/envelope.ts';
import {loopOf, type BedChannel, type BedMood, type MusicCue} from '../core/music.ts';
import {speechSpansFromLevels, speechSpansFromTimeline, type TimelineLike, type WordPadding} from '../core/speech.ts';
import {bedFor, MUSIC, musicCue} from './library.ts';
import {useNarrationSpans, type NarrationSource} from './narration.ts';
import {PcmTrack, useAbsoluteStart} from './PcmTrack.tsx';

export type MusicBedDuck = Omit<DuckSpec, 'speech'> &
	WordPadding & {
		/** the voice step's timeline: word timings drive the duck */
		timeline?: TimelineLike;
		/** absolute composition seconds of the timeline's 0 (default 0) */
		timelineOffsetSec?: number;
		/** or explicit speech spans (absolute seconds) */
		speech?: readonly Span[];
		/** or the narration's level track (dBFS per hop), for audio without word timings */
		levels?: {db: ArrayLike<number>; hopSec: number; offsetSec?: number};
		/** or the narration audio itself: its speech RMS, read during the render (WAV under public/) */
		narration?: NarrationSource;
	};

export type MusicBedProps = {
	/** a bed's cue id ("bed-show-neutral-underscore") or its file under public/ */
	src?: string;
	/** or a mood: show neutral | tension | light; story curious | tension | ominous | resolve */
	mood?: BedMood;
	channel?: BedChannel;
	/** with `mood`: the -underscore version (motif muted, made for under speech). Default: true when ducking. */
	underscore?: boolean;
	/** duck under narration; false or omitted: no duck */
	duck?: MusicBedDuck | false;
	/** "music up" in long pauses (e.g. {db: 6}); off by default (it raises the bed's peaks: pair it with the master step) */
	lift?: LiftSpec | false;
	/** loop on the cue's loop points (default: when it has them); false plays the file once */
	loop?: boolean;
	/** frames to play (default: to the end of the enclosing Sequence, else of the composition) */
	durationInFrames?: number;
	/** level trim, dB (default 0: the bed as mastered, -26 LUFS-S, sits under -14 LUFS narration) */
	levelDb?: number;
	fadeInMs?: number;
	fadeOutMs?: number;
	/** spans where the bed steps out (stingers, bumpers): absolute seconds */
	rests?: readonly Rest[];
	/** start this far into the bed */
	startAtSec?: number;
	name?: string;
};

/** The speech spans a duck spec names (timeline, spans or level track; `narration` is resolved by the component). */
export const speechOf = (d: MusicBedDuck): Span[] => {
	if (d.speech) return [...d.speech];
	if (d.timeline) return speechSpansFromTimeline(d.timeline, {offsetSec: d.timelineOffsetSec ?? 0, padEndMs: d.padEndMs, padStartMs: d.padStartMs});
	if (d.levels) return speechSpansFromLevels(d.levels.db, d.levels.hopSec, {offsetSec: d.levels.offsetSec});
	throw new Error('MusicBed duck needs `timeline`, `speech`, `levels` or `narration`');
};

export const resolveBed = (p: Pick<MusicBedProps, 'src' | 'mood' | 'channel' | 'underscore' | 'duck'>): MusicCue => {
	if (p.src) return musicCue(p.src);
	if (p.mood) return bedFor(p.mood, {channel: p.channel, underscore: p.underscore ?? Boolean(p.duck)});
	throw new Error('MusicBed needs `src` or `mood`');
};

export const MusicBed: React.FC<MusicBedProps> = (p) => {
	const {fps, durationInFrames: compFrames} = useVideoConfig();
	const absStart = useAbsoluteStart();
	const cue = resolveBed(p);
	if (cue.cueType !== 'bed' && cue.profile !== 'bed') throw new Error(`MusicBed plays beds; ${cue.id} is a ${cue.cueType}`);
	// default length: inside a <Sequence>, useVideoConfig() reports that sequence's duration (and our local frame 0 is
	// its start); at the root, the composition's
	const frames = p.durationInFrames ?? Math.max(0, compFrames);
	const narrationSpans = useNarrationSpans(p.duck ? p.duck.narration : null);
	const waiting = Boolean(p.duck && p.duck.narration) && narrationSpans === null;
	// a bed loops on its own loop points; loop={true} on a cue without them loops the whole file
	const loopKind = p.loop === false ? 'none' : cue.loop ? 'cue' : p.loop ? 'file' : 'none';
	const loop = useMemo(() => (loopKind === 'cue' ? loopOf(cue) : loopKind === 'file' ? {startSample: 0, endSample: cue.durationSamples} : null), [loopKind, cue]);
	const duckKey = p.duck ? JSON.stringify({...p.duck, timeline: undefined, levels: undefined, speech: undefined}) : '';
	const liftKey = p.lift ? JSON.stringify(p.lift) : '';
	const plan = useMemo(() => {
		if (waiting) return null;
		const d = p.duck || null;
		return planBed({
			start: absStart / fps,
			end: (absStart + frames) / fps,
			duck: d ? {...d, speech: d.narration ? (narrationSpans ?? []) : speechOf(d)} : null,
			lift: p.lift || null,
			rests: p.rests,
			fadeInMs: p.fadeInMs,
			fadeOutMs: p.fadeOutMs,
		});
		// the settings are dependencies through their JSON; timeline, spans and levels by identity (stable per render)
	}, [waiting, absStart, frames, fps, duckKey, p.duck && p.duck.timeline, p.duck && p.duck.speech, p.duck && p.duck.levels, narrationSpans, liftKey, p.rests, p.fadeInMs, p.fadeOutMs]);
	if (!plan) return null; // the narration is still loading (useNarrationSpans holds the frame)
	return (
		<PcmTrack
			src={cue.file}
			gain={plan.gain}
			loop={loop}
			crossovers={plan.crossovers}
			offsetSamples={Math.round((p.startAtSec ?? 0) * MUSIC.sampleRate)}
			trim={10 ** ((p.levelDb ?? 0) / 20)}
			durationInFrames={frames}
			name={p.name ?? `bed ${cue.id}`}
		/>
	);
};
