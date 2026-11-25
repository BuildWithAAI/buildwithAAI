/**
 * Shared test helpers: the real SFX and music manifests read from disk (Node cannot import JSON the way
 * the Remotion bundle does), paths, and small numeric helpers.
 *   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test "src/audio/tests/*.test.ts"
 */
import {existsSync, readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {asManifest, type SfxManifest} from '../../../scripts/audio/sfx/sfx.ts';
import {parseManifest, type MusicManifest} from '../../../scripts/audio/music/manifest.ts';

export const STUDIO = fileURLToPath(new URL('../../../', import.meta.url));
export const pub = (rel: string): string => `${STUDIO}public/${rel}`;
export const readJson = <T>(rel: string): T => JSON.parse(readFileSync(pub(rel), 'utf8')) as T;

export const sfxLib = (): SfxManifest => asManifest(readJson('audio/sfx/manifest.json'));
export const musicLib = (): MusicManifest => parseManifest(readJson('audio/music/manifest.json'));

/** The AudioDemo's narration timeline when the voice step has made it (public/generated is not in git). */
export const DEMO_NARRATION = 'generated/zoora-security/_audio-demo/en';
export const hasDemoNarration = (): boolean => existsSync(pub(`${DEMO_NARRATION}/timeline.json`));

export const db = (g: number): number => 20 * Math.log10(g);
export const near = (a: number, b: number, tol: number): boolean => Math.abs(a - b) <= tol;

/** A deterministic sine (+ optional second partial), for filters and meters. */
export const sine = (n: number, freq: number, sr: number, amp = 0.5, phase = 0): Float64Array => {
	const x = new Float64Array(n);
	for (let i = 0; i < n; i++) x[i] = amp * Math.sin((2 * Math.PI * freq * i) / sr + phase);
	return x;
};

/** Deterministic white noise in [-amp, amp) (xorshift32). */
export const noise = (n: number, amp = 0.5, seed = 12345): Float64Array => {
	let s = seed >>> 0 || 1;
	const x = new Float64Array(n);
	for (let i = 0; i < n; i++) {
		s ^= s << 13;
		s >>>= 0;
		s ^= s >>> 17;
		s ^= s << 5;
		s >>>= 0;
		x[i] = amp * (2 * (s / 4294967296) - 1);
	}
	return x;
};

export const rms = (x: ArrayLike<number>, from = 0, to = x.length): number => {
	let e = 0;
	for (let i = from; i < to; i++) e += x[i] * x[i];
	return Math.sqrt(e / Math.max(1, to - from));
};
