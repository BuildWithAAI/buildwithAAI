/**
 * SFX cues: which library file plays, on which frame, at what gain. Pure functions over the SFX
 * manifest (public/audio/sfx/manifest.json, typed by scripts/audio/sfx/sfx.ts), so a plan is the same
 * in every render tab and testable in Node.
 *
 * Sync contract (scripts/audio/sfx/README.md): every file's sync point (an impact, a whoosh's pass-by,
 * the top of a rise) is a whole number of 30 fps frames from its start; placing it at
 * `at - syncFrames` lands that point exactly on frame `at`.
 */
import {sfx as entryById, syncFrames, durationInFrames as fileFrames, type SfxEntry, type SfxManifest} from '../../../scripts/audio/sfx/sfx.ts';
import {hash32, prng, variationIndex} from './variation.ts';

export type {SfxEntry, SfxManifest};

export type SfxCue = {
	/** sound id, e.g. "pop_03" */
	id: string;
	/** file under public/ */
	file: string;
	/** the frame the sound's sync point lands on */
	at: number;
	/** the frame the file starts on (at - its sync offset) */
	from: number;
	durationInFrames: number;
	/** suggested gain + trims, dB */
	gainDb: number;
	/** what placed it, for the cue sheet: "transition:slide", "bullet:2", "key" */
	label: string;
};

export type Pick = {
	/** scene id: seeds the variation order (with the group) */
	scene?: string;
	/** which use within the scene: consecutive indexes never repeat a file */
	index?: number;
	/** force a variation, 1-based as in the file names (pop_02 = 2) */
	variant?: number;
};

/** The ids of a group in variation order (pop_01, pop_02, ...). */
export const groupIds = (lib: SfxManifest, group: string): string[] => {
	const g = lib.groups[group];
	if (!g) throw new Error(`no SFX group "${group}" (known: ${Object.keys(lib.groups).join(', ')})`);
	return g.ids;
};

/** A sound by exact id, or a group's variation chosen by scene and index (deterministic, no back-to-back repeat). */
export const resolveSound = (lib: SfxManifest, ref: string, pick: Pick = {}): SfxEntry => {
	if (lib.groups[ref]) {
		const ids = groupIds(lib, ref);
		if (pick.variant !== undefined) {
			if (!Number.isInteger(pick.variant) || pick.variant < 1 || pick.variant > ids.length) throw new Error(`${ref} has variations 1-${ids.length}, not ${pick.variant}`);
			return entryById(lib, ids[pick.variant - 1]);
		}
		return entryById(lib, ids[variationIndex(ref, ids.length, pick.scene ?? '', pick.index ?? 0)]);
	}
	if (pick.variant !== undefined) throw new Error(`variant applies to a group; "${ref}" is not one`);
	return entryById(lib, ref);
};

export type CueOptions = Pick & {
	/** extra gain on top of the suggested gain, dB */
	gainDb?: number;
	/** Zoo is speaking over it: add the role's under-speech trim (ui: -3 dB) */
	underSpeech?: boolean;
	label?: string;
	fps?: number;
};

/** One cue: `ref` (an id or a group) with its sync point on frame `at`. */
export const cue = (lib: SfxManifest, ref: string, at: number, o: CueOptions = {}): SfxCue => {
	const e = resolveSound(lib, ref, o);
	const fps = o.fps ?? 30;
	if (fps !== lib.fps) throw new Error(`the SFX library is cut at ${lib.fps} fps; this composition runs at ${fps}`);
	const gainDb = e.suggestedGainDb + (o.underSpeech ? e.underSpeechTrimDb ?? 0 : 0) + (o.gainDb ?? 0);
	if (!Number.isFinite(gainDb)) throw new Error(`${e.id}: gain is not finite`);
	return {id: e.id, file: e.file, at, from: at - syncFrames(e, fps), durationInFrames: fileFrames(e, fps), gainDb, label: o.label ?? ref};
};

export type TransitionType = 'cut' | 'fade' | 'slide' | 'wipe' | 'chapter' | 'reverse';

/** Which whoosh a transition gets, and where its sync point lands within the transition. */
export const TRANSITION_SFX: Record<TransitionType, {group: string; land: 'mid' | 'end'} | null> = {
	cut: null, // a hard cut inside a sequence stays dry (ART_GUIDE MO16)
	fade: null, // a time jump: silence reads better than air
	slide: {group: 'whoosh_medium', land: 'mid'}, // pass-by at the push's fastest point
	wipe: {group: 'whoosh_short', land: 'mid'},
	chapter: {group: 'whoosh_long', land: 'mid'},
	reverse: {group: 'whoosh_reverse', land: 'end'}, // the swell lands on the cut
};

/**
 * The whoosh for a transition that starts on frame `at` and lasts `frames`, or null (cuts and fades).
 * The pass-by lands mid-transition (where a push or wipe moves fastest); a reverse swell lands on the cut.
 */
export const sfxForTransition = (lib: SfxManifest, type: TransitionType, o: {at: number; frames: number} & CueOptions): SfxCue | null => {
	const t = TRANSITION_SFX[type];
	if (t === undefined) throw new Error(`unknown transition type "${type}"`);
	if (!t) return null;
	const land = t.land === 'end' ? o.at + o.frames : o.at + Math.round(o.frames / 2);
	return cue(lib, t.group, land, {...o, label: o.label ?? `transition:${type}`});
};

/**
 * The pop for bullet `index` (0-based) of `count` revealed on frame `at`. 'rise' (default for up to 4
 * bullets) climbs D5-G5-A5-D6 (pop_rise_01-04, an ordered set); 'same' uses the pitch-stable D5 pops
 * with a seeded, non-repeating variation. A pop under Zoo's voice gets the ui under-speech trim.
 */
export const sfxForBulletReveal = (lib: SfxManifest, o: {at: number; index: number; count: number; style?: 'rise' | 'same'} & CueOptions): SfxCue => {
	const rise = lib.groups['pop_rise']?.ids ?? [];
	const style = o.style ?? (o.count <= rise.length ? 'rise' : 'same');
	if (style === 'rise') {
		if (o.index >= rise.length) throw new Error(`pop_rise has ${rise.length} steps; bullet ${o.index + 1} needs style 'same'`);
		return cue(lib, rise[o.index], o.at, {...o, variant: undefined, label: o.label ?? `bullet:${o.index + 1}`});
	}
	return cue(lib, 'pop', o.at, {...o, label: o.label ?? `bullet:${o.index + 1}`});
};

export type TypingOptions = {
	/** seeds the rhythm and the key variations */
	scene?: string;
	/** type exactly this text: one key per character (' ' = space bar, '\n' = Enter); else random words */
	text?: string;
	/** press Enter as the last key (random words only) */
	enterAtEnd?: boolean;
	/** a frame predicate (e.g. Zoo's finger strikes): each key moves at most 1 frame to land on one */
	isStrike?: (frame: number) => boolean;
	/** key velocity spread: each key plays 0..2 x this many dB under the suggested gain (default 1.5) */
	velocityDb?: number;
	gainDb?: number;
	fps?: number;
};

export type TypingCue = SfxCue & {
	key: 'alpha' | 'space' | 'enter';
	/** index of the character typed (with `text`), else of the key */
	char: number;
};

/**
 * Keyboard clicks from `fromFrame` to `toFrame` (exclusive) at about `density` keys per second, each on
 * a whole frame. Inter-key intervals are log-normal (a human roll, never under 2 frames); words end in
 * a space bar; with `text`, one key per character. Letters cycle the 10 key positions without a
 * back-to-back repeat. Deterministic from `scene`.
 */
export const typingClicks = (lib: SfxManifest, fromFrame: number, toFrame: number, density: number, o: TypingOptions = {}): TypingCue[] => {
	if (!(density > 0)) throw new Error('density must be keys per second > 0');
	if (!(toFrame > fromFrame)) return [];
	const fps = o.fps ?? 30;
	const rnd = prng(hash32(`typing|${o.scene ?? ''}|${fromFrame}|${toFrame}|${density}|${o.text ?? ''}`));
	const gauss = () => {
		const u = Math.max(rnd(), 1e-9);
		return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd());
	};
	const mean = fps / density; // frames per key
	const sigma = 0.35;
	const mu = Math.log(mean) - (sigma * sigma) / 2;
	const keys: Array<{frame: number; key: TypingCue['key']; char: number}> = [];
	const chars = o.text !== undefined ? Array.from(o.text) : null;
	let f = fromFrame;
	let wordLeft = 2 + Math.floor(rnd() * 6);
	for (let i = 0; ; i++) {
		if (chars && i >= chars.length) break;
		let key: TypingCue['key'];
		if (chars) key = chars[i] === ' ' ? 'space' : chars[i] === '\n' ? 'enter' : 'alpha';
		else if (wordLeft <= 0) {
			key = 'space';
			wordLeft = 2 + Math.floor(rnd() * 6);
		} else {
			key = 'alpha';
			wordLeft--;
		}
		let frame = Math.round(f);
		if (o.isStrike && !o.isStrike(frame)) {
			if (o.isStrike(frame + 1)) frame += 1;
			else if (frame - 1 > (keys[keys.length - 1]?.frame ?? -Infinity) && o.isStrike(frame - 1)) frame -= 1;
		}
		if (keys.length && frame <= keys[keys.length - 1].frame) frame = keys[keys.length - 1].frame + 2;
		if (frame >= toFrame) break;
		keys.push({frame, key, char: i});
		// the next key: a log-normal interval; a word starts a little later; sometimes a thinking pause
		let gap = Math.exp(mu + sigma * gauss());
		if (key === 'space') gap *= 1.25 + 0.35 * rnd();
		if (key === 'space' && rnd() < 0.1) gap += 6 + rnd() * 6;
		f = frame + Math.max(2, gap);
	}
	if (!chars && o.enterAtEnd && keys.length) keys[keys.length - 1].key = 'enter';
	const groupOf = {alpha: 'key', space: 'key_space', enter: 'key_enter'} as const;
	const counters = {alpha: 0, space: 0, enter: 0};
	return keys.map((k) => {
		// each key kind walks its own seeded order, so neither letters nor space bars repeat a file back to back
		const index = counters[k.key]++;
		// velocity: up to 2 x velocityDb UNDER the suggested gain (never over it: the gain already sits at the -6 dBTP cap)
		const velocity = -rnd() * 2 * (o.velocityDb ?? 1.5);
		const c = cue(lib, groupOf[k.key], k.frame, {scene: `${o.scene ?? ''}|typing`, index, gainDb: (o.gainDb ?? 0) + velocity, label: k.key, fps});
		return {...c, key: k.key, char: k.char};
	});
};

/** Zoo's finger strikes as a frame predicate, from the rig's own fingerLift (src/characters/zoo, never copied). */
export const strikePredicate = (fingerLift: (frame: number, hand: 0 | 1, finger: number) => number): ((frame: number) => boolean) => (frame) => {
	for (const hand of [0, 1] as const) for (let finger = 0; finger < 4; finger++) if (fingerLift(frame, hand, finger) === 0 && fingerLift(frame - 1, hand, finger) > 0) return true;
	return false;
};

/** Cues that overlap in time with the same file, for checks: a file never plays twice at once. */
export const overlappingRepeats = (cues: readonly SfxCue[]): Array<[SfxCue, SfxCue]> => {
	const out: Array<[SfxCue, SfxCue]> = [];
	const sorted = [...cues].sort((a, b) => a.from - b.from);
	for (let i = 1; i < sorted.length; i++) {
		const a = sorted[i - 1];
		const b = sorted[i];
		if (a.id === b.id && b.from < a.from + a.durationInFrames) out.push([a, b]);
	}
	return out;
};
