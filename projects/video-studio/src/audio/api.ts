/**
 * The audio integration's public API: what the episode and show templates import (src/audio/README.md
 * shows the calls). src/audio/index.ts is only the Remotion entry point of the AudioDemo.
 *
 *   import {MusicBed, Sfx, SfxCues, SfxScene, Stinger, sfxForTransition, sfxForBulletReveal, typingClicks,
 *     placeStinger, stingerRest, speechSpansFromTimeline} from '../audio/api';
 */
export {MusicBed, resolveBed, speechOf, type MusicBedDuck, type MusicBedProps} from './components/MusicBed.tsx';
export {Sfx, SfxCues, SfxPlay, SfxScene, useSfxScene, type SfxProps} from './components/Sfx.tsx';
export {Stinger, type StingerProps} from './components/Stinger.tsx';
export {PcmTrack, useAbsoluteStart, type PcmTrackProps} from './components/PcmTrack.tsx';
export {narrationSpans, useNarrationSpans, type NarrationSource} from './components/narration.ts';
export {MUSIC, SFX, bedFor, musicCue, placeStinger, sfxCue, sfxForBulletReveal, sfxForTransition, typingClicks} from './components/library.ts';
export {strikePredicate, overlappingRepeats, TRANSITION_SFX, type SfxCue, type TransitionType, type TypingCue, type TypingOptions} from './core/sfx.ts';
export {stingerRest, PEAK_BUDGET_DBTP, type BedMood, type BedChannel, type StingerPlacement} from './core/music.ts';
export {speechSpansFromAudio, speechSpansFromScenes, speechSpansFromTimeline, type TimelineLike} from './core/speech.ts';
export {DUCK_DEFAULTS, planBed, type DuckSpec, type LiftSpec} from './core/bed.ts';
export {mergeSpans, shiftSpans, type Rest, type Span} from './core/envelope.ts';
