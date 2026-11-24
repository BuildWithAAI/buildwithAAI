/**
 * Typed access to the SFX library (public/audio/sfx/manifest.json) for Remotion scenes.
 *
 * Pure functions with no Remotion import, so they run in compositions, in Node scripts and in
 * tests alike. In a composition:
 *
 *   import manifest from '../../public/audio/sfx/manifest.json';
 *   import {asManifest, sfx, startFrame, volume, pick} from '../../scripts/audio/sfx/sfx.ts';
 *   const lib = asManifest(manifest);
 *   const w = pick(lib, 'whoosh_medium', `scene-${index}`);          // deterministic, never Math.random
 *   <Sequence from={startFrame(w, cutFrame)}>                          // its pass-by lands on cutFrame
 *     <Audio src={staticFile(w.file)} volume={volume(w)} />            // suggested gain (+ your trim)
 *   </Sequence>
 *
 * Sync contract (scripts/audio/sfx/README.md): every syncMs and event time is a whole number of
 * 30 fps frames (1600 samples at 48 kHz). startFrame(entry, f) places a file so that its sync
 * point (an impact, a whoosh's pass-by, the top of a rise) is exactly on frame f.
 */

export type SyncKind = 'transient' | 'hit' | 'peak' | 'end' | 'start';
export type Role = 'transition' | 'meter' | 'notify' | 'ui' | 'foley';

export type SfxEvent = {ms: number; frame: number; kind: string; [key: string]: unknown};

export type SfxSource = {kind: string; licence: string; path?: string; commit?: string; url?: string; [key: string]: unknown};

export type SfxEntry = {
	id: string;
	file: string;
	group: string;
	variation: number;
	category: string;
	role: Role;
	tags: string[];
	description: string;
	durationMs: number;
	onsetMs: number | null;
	transientMs: number;
	peakMs: number;
	loudPeakMs: number;
	syncKind: SyncKind;
	syncMs: number;
	syncFrame30: number;
	suggestedGainDb: number;
	suggestedVolume: number;
	/** Extra trim (dB, <= 0) when the sound plays while Zoo speaks: ui -3, others 0. Better: nearestGapFrame. */
	underSpeechTrimDb?: number;
	/** lufs200Max is the gain basis (K-weighted, 200 ms window); gainCapped: the gain was limited so the true peak stays <= -6 dBTP;
	 * phoneLossDb: what the file loses on a phone-speaker model (narration loses about 5.4). */
	loudness: {samplePeakDbfs: number; truePeakDbtp: number; lufs200Max: number; lufsMomentaryMax: number; lufs100Max: number; targetLufs: number; gainCapped: boolean; phoneLossDb?: number};
	pitch: string | null;
	loop: boolean;
	events: SfxEvent[];
	sources: SfxSource[];
	sha256: string;
	rig?: {source: string; period: number; startRigFrameMod36: number; note: string};
	extra?: Record<string, unknown>;
};

export type SfxManifest = {
	version: number;
	fps: number;
	frameSamples: number;
	groups: Record<string, {category: string; role: Role; ids: string[]}>;
	sounds: SfxEntry[];
	[key: string]: unknown;
};

const SYNC_KINDS: readonly SyncKind[] = ['transient', 'hit', 'peak', 'end', 'start'];
const ROLES: readonly Role[] = ['transition', 'meter', 'notify', 'ui', 'foley'];

/** Problems in a manifest-shaped value (empty when it is valid). */
export const validateManifest = (m: unknown): string[] => {
	const errors: string[] = [];
	if (typeof m !== 'object' || m === null) return ['manifest must be an object'];
	const man = m as Partial<SfxManifest>;
	if (man.version !== 1) errors.push('version must be 1');
	if (man.fps !== 30 || man.frameSamples !== 1600) errors.push('fps must be 30 and frameSamples 1600');
	if (!Array.isArray(man.sounds)) return [...errors, 'sounds must be an array'];
	const seen = new Set<string>();
	man.sounds.forEach((e, i) => {
		const at = `sounds[${i}]${e && typeof e.id === 'string' ? ` (${e.id})` : ''}`;
		if (!e || typeof e.id !== 'string' || !/^[a-z][a-z0-9_]*_\d{2}$/.test(e.id)) errors.push(`${at}: id must be snake_case ending in _NN`);
		else if (seen.has(e.id)) errors.push(`${at}: duplicate id`);
		else seen.add(e.id);
		if (typeof e?.file !== 'string' || !e.file.startsWith('audio/sfx/') || !e.file.endsWith('.wav')) errors.push(`${at}: file must be audio/sfx/....wav`);
		if (!SYNC_KINDS.includes(e?.syncKind as SyncKind)) errors.push(`${at}: unknown syncKind`);
		if (!ROLES.includes(e?.role as Role)) errors.push(`${at}: unknown role`);
		if (typeof e?.syncMs !== 'number' || Math.round(e.syncMs * 48) % 1600 !== 0) errors.push(`${at}: syncMs must be a whole 30 fps frame`);
		if (typeof e?.suggestedGainDb !== 'number' || !Number.isFinite(e.suggestedGainDb)) errors.push(`${at}: suggestedGainDb must be a number`);
		if (!Array.isArray(e?.events)) errors.push(`${at}: events must be an array`);
	});
	for (const [g, info] of Object.entries(man.groups ?? {})) {
		if (info.ids.length < 3) errors.push(`group ${g} has fewer than 3 variations`);
		for (const id of info.ids) if (!seen.has(id)) errors.push(`group ${g} lists unknown id ${id}`);
	}
	return errors;
};

/** Narrow an imported JSON value to the manifest type (throws with every problem found). */
export const asManifest = (m: unknown): SfxManifest => {
	const errors = validateManifest(m);
	if (errors.length) throw new Error(`invalid SFX manifest:\n${errors.join('\n')}`);
	return m as SfxManifest;
};

export const sfx = (m: SfxManifest, id: string): SfxEntry => {
	const e = m.sounds.find((s) => s.id === id);
	if (!e) throw new Error(`no SFX "${id}"`);
	return e;
};

export const variations = (m: SfxManifest, group: string): SfxEntry[] => {
	const info = m.groups[group];
	if (!info) throw new Error(`no SFX group "${group}"; known: ${Object.keys(m.groups).join(', ')}`);
	return info.ids.map((id) => sfx(m, id));
};

/** FNV-1a 32-bit: a stable hash for deterministic picks (Remotion renders frames in parallel). */
export const hash = (key: string): number => {
	let h = 0x811c9dc5;
	for (let i = 0; i < key.length; i++) {
		h ^= key.charCodeAt(i);
		h = Math.imul(h, 0x01000193) >>> 0;
	}
	return h >>> 0;
};

/** One variation of a group, chosen by a key (a scene id, a bullet index): the same key always
 * gives the same file, different keys spread across the variations. */
export const pick = (m: SfxManifest, group: string, key: string | number): SfxEntry => {
	const all = variations(m, group);
	return all[hash(`${group}:${key}`) % all.length];
};

/** `count` variations for repeated hits (bullets, steps) with no file twice in a row. */
export const pickSequence = (m: SfxManifest, group: string, count: number, key: string): SfxEntry[] => {
	const all = variations(m, group);
	const out: SfxEntry[] = [];
	for (let i = 0; i < count; i++) {
		let e = all[hash(`${group}:${key}:${i}`) % all.length];
		if (all.length > 1 && out.length && e.id === out[out.length - 1].id) e = all[(all.indexOf(e) + 1) % all.length];
		out.push(e);
	}
	return out;
};

/** Frames from the file start to its sync point at `fps` (whole at 30 and 60 fps). */
export const syncFrames = (e: SfxEntry, fps = 30): number => Math.round((e.syncMs * fps) / 1000);

/** The frame to start a file on so its sync point lands on `alignFrame`. */
export const startFrame = (e: SfxEntry, alignFrame: number, fps = 30): number => alignFrame - syncFrames(e, fps);

/** Linear volume for <Audio volume>: the suggested gain plus a trim in dB. */
export const volume = (e: SfxEntry, trimDb = 0): number => 10 ** ((e.suggestedGainDb + trimDb) / 20);

/** Linear volume for a sound that plays while Zoo speaks: also its role's under-speech trim (ui: -3 dB). */
export const volumeUnderSpeech = (e: SfxEntry, trimDb = 0): number => volume(e, (e.underSpeechTrimDb ?? 0) + trimDb);

/** A per-frame speech mask (true = Zoo speaks) from [start, end] spans in seconds, e.g. word timings.
 * scripts/audio/sfx/speech_mask.py makes the same mask from the narration audio. */
export const speechMaskFromSpans = (spans: ReadonlyArray<readonly [number, number]>, frames: number, fps = 30): boolean[] => {
	const mask = new Array<boolean>(Math.max(0, frames)).fill(false);
	for (const [a, b] of spans) {
		if (!(b > a)) continue;
		for (let f = Math.max(0, Math.floor(a * fps)); f < Math.min(frames, Math.ceil(b * fps)); f++) mask[f] = true;
	}
	return mask;
};

/** The frame nearest `frame` (at most `maxShift` frames away, earlier first on a tie) where nobody
 * speaks for `holdFrames` frames from it: where a pop or tick will not land on a consonant (critic
 * round 1: UI ticks sit at 1.7-2.2 kHz, on Zoo's consonants). Frames past the mask's end count as
 * silent. Returns null when no gap is that close: keep the frame and use volumeUnderSpeech. */
export const nearestGapFrame = (speech: readonly boolean[], frame: number, maxShift = 6, holdFrames = 2): number | null => {
	const quiet = (f: number): boolean => {
		if (f < 0) return false;
		for (let k = 0; k < holdFrames; k++) if (speech[f + k]) return false;
		return true;
	};
	for (let d = 0; d <= maxShift; d++) {
		if (quiet(frame - d)) return frame - d;
		if (d > 0 && quiet(frame + d)) return frame + d;
	}
	return null;
};

export const durationInFrames = (e: SfxEntry, fps = 30): number => Math.ceil((e.durationMs * fps) / 1000);

/** Frames (relative to the file start) of its timed events, e.g. the keys of a typing burst. */
export const eventFrames = (e: SfxEntry, kind?: string, fps = 30): number[] =>
	e.events.filter((ev) => kind === undefined || ev.kind === kind).map((ev) => Math.round((ev.ms * fps) / 1000));

/** For rig-synced typing: the typing-pose frame to start on, at or after `fromFrame`, so every key
 * lands on a frame where one of Zoo's fingers strikes (fingerLift repeats every 36 frames). */
export const rigStartFrame = (e: SfxEntry, fromFrame: number): number => {
	if (!e.rig) throw new Error(`${e.id} is not rig-synced`);
	const p = e.rig.period;
	const want = ((e.rig.startRigFrameMod36 % p) + p) % p;
	const have = ((fromFrame % p) + p) % p;
	return fromFrame + ((want - have + p) % p);
};
