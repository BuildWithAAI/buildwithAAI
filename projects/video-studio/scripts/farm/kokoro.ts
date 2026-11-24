/**
 * The Kokoro model cache key, made from the sha256 pins in scripts/voice/setup.sh. When the voice step pins new model
 * files, the key changes and the farm downloads (and caches) the new files once.
 */

export type KokoroPin = {file: string; sha256: string};

/** Reads `<file>) echo "<sha256>" ;;` lines from setup.sh's pinned_sha() table. */
export const kokoroPins = (setupSh: string): KokoroPin[] => {
	const pins = new Map<string, string>();
	for (const m of setupSh.matchAll(/^\s*([A-Za-z0-9._-]+)\)\s*echo\s+"([0-9a-f]{64})"\s*;;/gm)) pins.set(m[1], m[2]);
	return [...pins].map(([file, sha256]) => ({file, sha256})).sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
};

/** `kokoro-models-<sha256>-<sha256>`, the shas in file-name order. Throws when setup.sh pins nothing readable. */
export const kokoroCacheKey = (setupSh: string): string => {
	const pins = kokoroPins(setupSh);
	if (!pins.length) throw new Error('scripts/voice/setup.sh pins no model sha256 that the farm can read (expected lines like: name) echo "<sha256>" ;;)');
	const key = `kokoro-models-${pins.map((p) => p.sha256).join('-')}`;
	if (key.length > 500) throw new Error('the Kokoro cache key would exceed GitHub\'s 512-character limit');
	return key;
};
