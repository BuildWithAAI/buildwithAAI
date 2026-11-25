/**
 * Music cues for the mix: which bed a mood means, where a sting or bumper starts so its downbeat lands
 * on a frame, how much it is trimmed to keep the mix's true peak in budget, and the rest it asks of the
 * bed. Pure functions over the music manifest (public/audio/music/manifest.json, typed and validated by
 * scripts/audio/music/manifest.ts).
 */
import {cueById, downbeatStartFrame, type MusicCue, type MusicManifest} from '../../../scripts/audio/music/manifest.ts';
import type {Rest} from './envelope.ts';
import type {LoopPoints} from './pcm.ts';

export type {MusicCue, MusicManifest};

export type BedChannel = 'show' | 'story';
export type BedMood = 'neutral' | 'tension' | 'light' | 'curious' | 'ominous' | 'resolve';

const MOODS: Record<BedChannel, readonly BedMood[]> = {
	show: ['neutral', 'tension', 'light'],
	story: ['curious', 'tension', 'ominous', 'resolve'],
};

/**
 * The bed for a mood. Under narration the default is the `-underscore` version (motif and lead lines
 * muted, made for under speech: scripts/audio/music/README.md).
 */
export const bedFor = (m: MusicManifest, mood: BedMood, opts: {channel?: BedChannel; underscore?: boolean} = {}): MusicCue => {
	const channel = opts.channel ?? 'show';
	if (!MOODS[channel].includes(mood)) throw new Error(`no ${channel} bed for mood "${mood}" (have: ${MOODS[channel].join(', ')})`);
	const id = `bed-${channel}-${mood}${opts.underscore === false ? '' : '-underscore'}`;
	return cueById(m, id);
};

/** A cue by id, or by its file path under public/ (audio/music/<id>.flac). */
export const resolveCue = (m: MusicManifest, ref: string): MusicCue => {
	const byFile = m.cues.find((c) => c.file === ref.replace(/^\/+/, ''));
	return byFile ?? cueById(m, ref);
};

/** A cue's loop points in samples (null for one-shots). */
export const loopOf = (c: MusicCue): LoopPoints | null => (c.loop ? {startSample: c.loop.startSample, endSample: c.loop.endSample} : null);

/**
 * True-peak budget for cues the mix does not limit. Remotion sums tracks with no bus limiter, and the
 * AAC encode adds its own overshoot (critic: +0.3 to +1 dB at 128 kb/s with ffmpeg's encoder), so a cue
 * is trimmed until its own true peak is at most this. -2 dBTP keeps a 1 dB margin under the -1 dBTP
 * delivery ceiling.
 */
export const PEAK_BUDGET_DBTP = -2.0;

/** The trim (dB, <= 0) that brings a cue's measured true peak into the budget. */
export const peakBudgetTrimDb = (c: MusicCue, budgetDbtp = PEAK_BUDGET_DBTP): number => {
	if (c.truePeakDbtp === null) throw new Error(`${c.id} has no measured true peak; measure it before mixing`);
	return Math.min(0, budgetDbtp - c.truePeakDbtp);
};

export type StingerPlacement = {
	cue: MusicCue;
	/** frame the file starts on (its pre-roll before the downbeat included) */
	from: number;
	/** the frame its first downbeat lands on */
	downbeat: number;
	durationInFrames: number;
	/** frames of its hits (sting/bumper metadata), absolute in the same clock as `downbeat` */
	hits: Array<{frame: number; what: string}>;
};

/** Where a sting/bumper plays so its downbeat lands on frame `at`. */
export const placeStinger = (c: MusicCue, at: number, fps = 30): StingerPlacement => {
	if (c.cueType === 'bed') throw new Error(`${c.id} is a bed; use MusicBed`);
	const from = downbeatStartFrame(c, at, fps);
	const scale = fps / 30;
	return {
		cue: c,
		from,
		downbeat: at,
		durationInFrames: Math.ceil(c.durationSec * fps - 1e-9),
		hits: c.hits.map((h) => ({frame: from + Math.round(h.frame30 * scale), what: h.what})),
	};
};

/**
 * The rest a bed takes for a stinger (absolute seconds): out before the stinger's first sound, back in
 * over its decaying tail, so two pieces of music in different tempos never play over each other.
 */
export const stingerRest = (p: StingerPlacement, fps = 30, o: {fadeOutMs?: number; fadeInMs?: number; tailOverlapSec?: number} = {}): Rest => {
	const start = p.from / fps;
	const end = Math.max(start, (p.from + p.durationInFrames) / fps - (o.tailOverlapSec ?? 0.35));
	return {start, end, fadeOutMs: o.fadeOutMs ?? 350, fadeInMs: o.fadeInMs ?? 900};
};
