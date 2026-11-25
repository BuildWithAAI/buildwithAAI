/**
 * The bundled SFX and music manifests, validated once per render tab, and the plan helpers bound to
 * them. Import from here in compositions; the core modules (src/audio/core) take the manifest as an
 * argument so Node tests can pass their own.
 */
import sfxJson from '../../../public/audio/sfx/manifest.json';
import musicJson from '../../../public/audio/music/manifest.json';
import {asManifest} from '../../../scripts/audio/sfx/sfx.ts';
import {parseManifest} from '../../../scripts/audio/music/manifest.ts';
import * as sfxCore from '../core/sfx.ts';
import * as musicCore from '../core/music.ts';

export const SFX: sfxCore.SfxManifest = asManifest(sfxJson);
export const MUSIC: musicCore.MusicManifest = parseManifest(musicJson);

/** The whoosh for a transition starting on frame `at` and lasting `frames` (null for cuts and fades). */
export const sfxForTransition = (type: sfxCore.TransitionType, o: {at: number; frames: number} & sfxCore.CueOptions): sfxCore.SfxCue | null =>
	sfxCore.sfxForTransition(SFX, type, o);

/** The pop for bullet `index` of `count`, revealed on frame `at`. */
export const sfxForBulletReveal = (o: {at: number; index: number; count: number; style?: 'rise' | 'same'} & sfxCore.CueOptions): sfxCore.SfxCue =>
	sfxCore.sfxForBulletReveal(SFX, o);

/** Keyboard clicks on whole frames from `fromFrame` to `toFrame` at about `density` keys per second. */
export const typingClicks = (fromFrame: number, toFrame: number, density: number, o: sfxCore.TypingOptions = {}): sfxCore.TypingCue[] =>
	sfxCore.typingClicks(SFX, fromFrame, toFrame, density, o);

/** One SFX cue: an id or a group, its sync point on frame `at`. */
export const sfxCue = (ref: string, at: number, o: sfxCore.CueOptions = {}): sfxCore.SfxCue => sfxCore.cue(SFX, ref, at, o);

export const bedFor = (mood: musicCore.BedMood, o: {channel?: musicCore.BedChannel; underscore?: boolean} = {}): musicCore.MusicCue => musicCore.bedFor(MUSIC, mood, o);
export const musicCue = (ref: string): musicCore.MusicCue => musicCore.resolveCue(MUSIC, ref);
export const placeStinger = (ref: string, at: number, fps = 30): musicCore.StingerPlacement => musicCore.placeStinger(musicCore.resolveCue(MUSIC, ref), at, fps);
