/**
 * Deterministic variation choice. Remotion renders frames in parallel tabs that share no state, so a
 * sound's variation must be a pure function of where it is used: here, of a scene id and an index
 * (the 1st, 2nd, 3rd pop of that scene). Never Math.random.
 *
 * Each (group, scene) gets its own seeded permutation of the group's variations and walks it in order,
 * so consecutive indexes never repeat a file (also across the wrap from the last to the first), every
 * variation is used before any repeats, and different scenes start from different files.
 */

/** FNV-1a 32-bit (the same hash as scripts/audio/sfx/sfx.ts). */
export const hash32 = (key: string): number => {
	let h = 0x811c9dc5;
	for (let i = 0; i < key.length; i++) {
		h ^= key.charCodeAt(i);
		h = Math.imul(h, 0x01000193) >>> 0;
	}
	return h >>> 0;
};

/** mulberry32: a small seeded PRNG, uniform in [0, 1). */
export const prng = (seed: number): (() => number) => {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
};

/** A seeded Fisher-Yates permutation of 0..n-1. */
export const permutation = (n: number, seed: string): number[] => {
	const p = Array.from({length: n}, (_, i) => i);
	const r = prng(hash32(seed));
	for (let i = n - 1; i > 0; i--) {
		const j = Math.floor(r() * (i + 1));
		[p[i], p[j]] = [p[j], p[i]];
	}
	return p;
};

/** Position (0-based) of the variation for use `index` of `group` in `scene`; never equal to index - 1's. */
export const variationIndex = (group: string, count: number, scene: string, index: number): number => {
	if (!Number.isInteger(count) || count < 1) throw new Error(`group ${group} has no variations`);
	if (!Number.isInteger(index) || index < 0) throw new Error(`index must be a whole number >= 0 (got ${index})`);
	if (count === 1) return 0;
	return permutation(count, `${group}|${scene}`)[index % count];
};

/** Variations for indexes 0..n-1 of a scene (convenience for tests and plans). */
export const variationSequence = (group: string, count: number, scene: string, n: number): number[] =>
	Array.from({length: n}, (_, i) => variationIndex(group, count, scene, i));
