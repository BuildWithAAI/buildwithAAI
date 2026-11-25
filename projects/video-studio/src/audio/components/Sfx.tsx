/**
 * <Sfx id at variant? gainDb?/>: one library sound with its sync point (impact, pass-by, top of a rise)
 * on frame `at` of the parent sequence. `id` is an exact sound ("pop_03") or a group ("pop"); a group
 * picks its variation from the scene (an <SfxScene> around it, or `scene`) and `index`, so the same
 * place always plays the same file and consecutive indexes never repeat one.
 *
 * Constant gain per sound, so Remotion's own mixer is exact here (the per-frame volume problem only
 * affects automation; see PcmTrack).
 */
import React, {createContext, useContext} from 'react';
import {Html5Audio, Sequence, staticFile} from 'remotion';
import type {SfxCue} from '../core/sfx.ts';
import {sfxCue} from './library.ts';

const SceneContext = createContext<string>('');

/** Seeds variation choice for every <Sfx> inside (use the storyboard scene id). */
export const SfxScene: React.FC<{id: string; children: React.ReactNode}> = ({id, children}) => <SceneContext.Provider value={id}>{children}</SceneContext.Provider>;

export const useSfxScene = (): string => useContext(SceneContext);

/** Plays a planned cue (from sfxForTransition, sfxForBulletReveal, typingClicks or sfxCue). */
export const SfxPlay: React.FC<{cue: SfxCue}> = ({cue}) => (
	<Sequence from={cue.from} durationInFrames={cue.durationInFrames} name={`sfx ${cue.id} (${cue.label})`} layout="none">
		<Html5Audio src={staticFile(cue.file)} volume={10 ** (cue.gainDb / 20)} />
	</Sequence>
);

/** Plays a list of planned cues. */
export const SfxCues: React.FC<{cues: readonly SfxCue[]}> = ({cues}) => (
	<>
		{cues.map((c, i) => (
			<SfxPlay key={`${c.id}-${c.from}-${i}`} cue={c} />
		))}
	</>
);

export type SfxProps = {
	/** an exact sound id ("whoosh_medium_02") or a group ("whoosh_medium") */
	id: string;
	/** the frame (of the parent sequence) the sound's sync point lands on */
	at: number;
	/** force a variation, 1-based as in the file names */
	variant?: number;
	/** which use within the scene (0, 1, 2 ...): consecutive indexes never repeat a file */
	index?: number;
	/** overrides the surrounding <SfxScene> */
	scene?: string;
	/** extra gain on top of the library's suggested gain */
	gainDb?: number;
	/** Zoo speaks over it: apply the role's under-speech trim (ui -3 dB) */
	underSpeech?: boolean;
};

export const Sfx: React.FC<SfxProps> = ({id, at, variant, index, scene, gainDb, underSpeech}) => {
	const ctxScene = useSfxScene();
	const c = sfxCue(id, at, {variant, index, scene: scene ?? ctxScene, gainDb, underSpeech});
	return <SfxPlay cue={c} />;
};
