/**
 * Plays an episode's sound plan (plan.ts): every bed as a <MusicBed> in its own <Sequence> (the per-sample band-split
 * duck, the loop on the shared clock, the planned fades and rests), the brand sting's jingle, and every effect.
 * Nothing here decides anything: the plan is plain JSON computed in calculateMetadata, the same JSON the audio-plan
 * CLI writes and the gate measures the render against.
 *
 * `stems` (measurement renders only): 'music' plays the beds and the stingers, 'sfx' the effects; null plays both.
 * The narration (the 'voice' stem) stays in Episode.tsx.
 */
import React from 'react';
import {Sequence} from 'remotion';
import {MusicBed, SfxPlay, Stinger} from '../../audio/api.ts';
import {bedDuckSpec, type AudioStem, type EpisodeAudioPlan} from './plan.ts';

export const EpisodeAudio: React.FC<{plan: EpisodeAudioPlan; stems: readonly AudioStem[] | null}> = ({plan, stems}) => {
	if (plan.silent) return null;
	const music = !stems || stems.includes('music');
	const effects = !stems || stems.includes('sfx');
	const duck = bedDuckSpec(plan);
	const ms = (frames: number) => (frames * 1000) / plan.fps;
	return (
		<>
			{music
				? plan.beds.map((b) => (
						<Sequence key={b.key} from={b.from} durationInFrames={b.durationInFrames} layout="none" name={`bed ${b.key} ${b.cue}`}>
							<MusicBed
								src={b.cue}
								duck={duck}
								startAtSec={b.startAtSample / plan.sampleRate}
								levelDb={b.levelDb}
								fadeInMs={ms(b.fadeInFrames)}
								fadeOutMs={ms(b.fadeOutFrames)}
								fadeCurve={b.fadeInCurve}
								fadeOutCurve={b.fadeOutCurve}
								rests={b.rests}
								durationInFrames={b.durationInFrames}
								name={`${b.key} ${b.cue}`}
							/>
						</Sequence>
					))
				: null}
			{music ? plan.stingers.map((s) => <Stinger key={`${s.id}-${s.downbeat}`} id={s.id} at={s.downbeat} levelDb={s.levelDb} />) : null}
			{effects ? plan.sfx.map((c, i) => <SfxPlay key={`${c.id}-${c.from}-${i}`} cue={c} />) : null}
		</>
	);
};
