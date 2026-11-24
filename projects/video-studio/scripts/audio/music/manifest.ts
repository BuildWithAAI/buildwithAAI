/**
 * The music manifest (public/audio/music/manifest.json), typed and validated for Remotion code.
 *
 *   import {parseManifest, cueById, loopFrames, nextBarFrame} from '../../scripts/audio/music/manifest.ts';
 *   const music = parseManifest(manifestJson);
 *   const bed = cueById(music, 'bed-show-neutral');      // <Audio src={staticFile(bed.file)} loop />
 *   loopFrames(bed);                                      // 1920 frames at 30 fps (64.0 s)
 *   nextBarFrame(bed, 100);                               // 160: cut or cross-fade on the next bar line
 *
 * Written by scripts/audio/music/build.py; see scripts/audio/music/README.md.
 */

export type CueType = 'theme' | 'sting' | 'bumper' | 'bed' | 'endscreen' | 'intro-sting';
export type Channel = 'zoora-security' | 'zoora-ai' | 'both';

export type MusicLoop = {
	seamless: true;
	startSample: number;
	endSample: number;
	startSec: number;
	endSec: number;
	frames30: number;
};

export type MusicHit = {sec: number; frame30: number; what: string};

export type MusicCue = {
	id: string;
	title: string;
	channel: Channel;
	cueType: CueType;
	mood: string;
	key: string;
	bpm: number;
	durationSec: number;
	durationSamples: number;
	/** Seconds from the file start to the music's first downbeat (the sync point); 0 unless the file has a pre-roll. */
	downbeatSec?: number;
	loop: MusicLoop | null;
	hits: MusicHit[];
	/** Path relative to public/, for staticFile(). */
	file: string;
	format: string;
	integratedLufs: number | null;
	shortTermMedianLufs: number | null;
	truePeakDbtp: number | null;
	profile: 'standalone' | 'sting' | 'bed' | 'endscreen';
	/** Path relative to public/ of the cue's full metadata JSON. */
	metadata: string;
};

export type MusicManifest = {schema: 1; sampleRate: 48000; cues: MusicCue[]};

const CUE_TYPES: readonly string[] = ['theme', 'sting', 'bumper', 'bed', 'endscreen', 'intro-sting'];
const CHANNELS: readonly string[] = ['zoora-security', 'zoora-ai', 'both'];
const PROFILES: readonly string[] = ['standalone', 'sting', 'bed', 'endscreen'];

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Validate a parsed manifest; throws one Error listing every problem. */
export const parseManifest = (json: unknown): MusicManifest => {
	const errors: string[] = [];
	if (!isObj(json)) throw new Error('music manifest: not an object');
	if (json.schema !== 1) errors.push(`schema ${String(json.schema)} is not 1`);
	if (json.sampleRate !== 48000) errors.push(`sampleRate ${String(json.sampleRate)} is not 48000`);
	if (!Array.isArray(json.cues)) throw new Error(`music manifest: ${[...errors, 'cues is not a list'].join('; ')}`);
	const seen = new Set<string>();
	json.cues.forEach((c: unknown, i: number) => {
		const at = `cues[${i}]`;
		if (!isObj(c)) return void errors.push(`${at} is not an object`);
		const id = typeof c.id === 'string' ? c.id : `#${i}`;
		if (typeof c.id !== 'string' || !/^[a-z0-9-]+$/.test(c.id)) errors.push(`${at}: bad id`);
		if (seen.has(id)) errors.push(`${id}: duplicate id`);
		seen.add(id);
		if (!CUE_TYPES.includes(String(c.cueType))) errors.push(`${id}: unknown cueType ${String(c.cueType)}`);
		if (!CHANNELS.includes(String(c.channel))) errors.push(`${id}: unknown channel ${String(c.channel)}`);
		if (!PROFILES.includes(String(c.profile))) errors.push(`${id}: unknown profile ${String(c.profile)}`);
		for (const k of ['bpm', 'durationSec', 'durationSamples'] as const) if (!num(c[k]) || (c[k] as number) <= 0) errors.push(`${id}: ${k} must be a positive number`);
		if (typeof c.file !== 'string' || !/^audio\/music\/[a-z0-9-]+\.(wav|flac)$/.test(c.file)) errors.push(`${id}: file must be audio/music/<id>.wav|flac`);
		if (num(c.durationSec) && num(c.durationSamples) && Math.abs(c.durationSec * 48000 - c.durationSamples) > 1) errors.push(`${id}: durationSec and durationSamples disagree`);
		if (c.downbeatSec !== undefined && (!num(c.downbeatSec) || c.downbeatSec < 0 || (num(c.durationSec) && c.downbeatSec >= c.durationSec))) errors.push(`${id}: downbeatSec must be in [0, durationSec)`);
		if (c.loop !== null) {
			if (!isObj(c.loop)) errors.push(`${id}: loop must be null or an object`);
			else {
				if (c.loop.startSample !== 0) errors.push(`${id}: loops start at sample 0`);
				if (c.loop.endSample !== c.durationSamples) errors.push(`${id}: loop.endSample must equal durationSamples`);
				if (c.cueType !== 'bed') errors.push(`${id}: only beds loop`);
			}
		} else if (c.cueType === 'bed') errors.push(`${id}: a bed must loop`);
		if (!Array.isArray(c.hits) || !c.hits.every((h: unknown) => isObj(h) && num(h.sec) && num(h.frame30) && typeof h.what === 'string')) errors.push(`${id}: hits must be [{sec, frame30, what}]`);
	});
	if (errors.length) throw new Error(`music manifest: ${errors.join('; ')}`);
	return json as unknown as MusicManifest;
};

export const cueById = (m: MusicManifest, id: string): MusicCue => {
	const c = m.cues.find((x) => x.id === id);
	if (!c) throw new Error(`no music cue "${id}" (have: ${m.cues.map((x) => x.id).join(', ')})`);
	return c;
};

/** Frames per beat at `fps`: 18 at 100 BPM, 20 at 90, 24 at 75 (all whole numbers at 30 fps). */
export const framesPerBeat = (bpm: number, fps = 30): number => (fps * 60) / bpm;

export const framesPerBar = (bpm: number, fps = 30, beatsPerBar = 4): number => framesPerBeat(bpm, fps) * beatsPerBar;

/** The loop length in frames (beds); throws for cues that do not loop. */
export const loopFrames = (c: MusicCue, fps = 30): number => {
	if (!c.loop) throw new Error(`${c.id} does not loop`);
	return Math.round(((c.loop.endSample - c.loop.startSample) / 48000) * fps);
};

/** The frame to start a cue on so its first downbeat lands on `alignFrame` (theme-5s has a 2-frame pre-roll). */
export const downbeatStartFrame = (c: MusicCue, alignFrame: number, fps = 30): number => alignFrame - Math.round((c.downbeatSec ?? 0) * fps);

/**
 * The file to play under Zoo's narration, checked. Music under speech must be a bed DUCKED for that
 * episode by scripts/audio/duck.py (the band-split duck: a Remotion volume callback applies one gain to
 * every band and cannot reproduce it, and critic round 2 measured a raw or broadband-ducked bed under
 * the 0.75 voice gate on 6 of 15 beds). So this refuses any delivered cue (`audio/music/...`) and any file
 * not named `<name>.ducked.wav|flac`; it returns `src` unchanged otherwise. Every renderer that plays
 * music under narration must pass the path through it:
 *   <Audio src={staticFile(underNarration('generated/zoora-ai/<slug>/en/bed.ducked.wav'))} />
 */
export const underNarration = (src: string): string => {
	const path = src.replace(/^\/+/, '');
	if (/(^|\/)audio\/music\//.test(path)) {
		throw new Error(`${src}: a raw music cue under narration; duck it for this episode first (scripts/audio/duck.py --out <name>.ducked.wav)`);
	}
	if (!/\.ducked\.(wav|flac)$/.test(path)) {
		throw new Error(`${src}: not a ducked bed; music under narration must come from scripts/audio/duck.py as <name>.ducked.wav`);
	}
	return src;
};

/** The first bar line at or after `frame` (counting from the cue's start), for in-time cuts and cross-fades. */
export const nextBarFrame = (c: MusicCue, frame: number, fps = 30): number => {
	const bar = framesPerBar(c.bpm, fps);
	return Math.max(0, Math.ceil(frame / bar - 1e-9)) * bar;
};
