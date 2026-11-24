/**
 * Optional fields the voice step (scripts/voice/build.py) adds to the Timeline contract in
 * src/episode/types.ts. Every field is optional, so code typed against `Timeline` keeps working;
 * code that wants them can type the parsed JSON as `VoiceTimeline`.
 *
 * Recorded additions (2026-11-24):
 * - Timeline.narration: the continuous, loudness-normalized narration track (relative to public/,
 *   use with staticFile()). Each scene's `audio` is a sample-exact cut of it, so playing the scenes
 *   back to back equals this file. Use it as one <Audio> for the whole episode, or mux it as an extra
 *   language track.
 * - TimelineScene.speed: fit-to-master only. The Kokoro speed this scene was synthesized at
 *   (0.85..1.15); the top-level `speed` is the requested starting speed.
 * - TimelineScene.overflowMs: fit-to-master only, present when the dubbed speech did not fit the
 *   master scene even at speed 1.15. The translator must shorten the scene by about this much. The
 *   scene was lengthened (speech + 150 ms, on the 100 ms grid), so the track no longer lines up with
 *   the master video until it is fixed; build.py exits with code 3.
 * - TimelineScene.sentences (added 2026-11-24, VCD fix): scene-relative ms of each sentence's speech,
 *   first phone start to last phone end, split at . ! ? and in narration order. A fit-to-master dub
 *   places each of its sentences at the master's sentence start and fits its length to the master's,
 *   so talking and pauses line up with the master picture (not only the scene's total length).
 */
import type {Timeline, TimelineScene} from '../../src/episode/types';

export type VoiceTimelineAdditions = {
	narration?: string;
};

export type VoiceSceneAdditions = {
	speed?: number;
	overflowMs?: number;
	sentences?: Array<{startMs: number; endMs: number}>;
};

export type VoiceTimelineScene = TimelineScene & VoiceSceneAdditions;

export type VoiceTimeline = Omit<Timeline, 'scenes'> & VoiceTimelineAdditions & {scenes: VoiceTimelineScene[]};

/** Video frames in a scene (durations are whole frames on the 100 ms grid at 30 fps). */
export const sceneFrames = (scene: Pick<TimelineScene, 'durationMs'>, fps: number): number => Math.round((scene.durationMs * fps) / 1000);
