/**
 * MOCK timeline for show dev fixtures (pure). Thin adapter over the episode engine's mock (src/episode/dev/mockTimeline.ts):
 * words spread by length, a letter-pattern mouth, NO audio, `mock: true`. The show draws a SILENT PREVIEW badge on it,
 * and it must never be called lip-synced (PROJECT_INSTRUCTIONS). Real renders use the voice step's timeline.json
 * (scripts/voice/build.py ... --voice im_nicola); only the "_dev" channel may fall back to this.
 */
import type {Storyboard, Timeline} from '../../episode/types.ts';
import {mockTimeline} from '../../episode/dev/mockTimeline.ts';
import type {ShowStoryboard} from '../types.ts';

export const showMockTimeline = (sb: ShowStoryboard, o: {fps?: number} = {}): Timeline => {
	const tl = mockTimeline(sb as unknown as Storyboard, {fps: o.fps ?? 30});
	return {
		...tl,
		voice: 'mock (no audio)',
		warnings: [...tl.warnings, 'show: silent preview from src/show/dev/mockTimeline.ts; Zoo speaks with Kokoro im_nicola once the voice step has run.'],
	};
};
