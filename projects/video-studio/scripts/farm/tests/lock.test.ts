// node --test scripts/farm/tests/lock.test.ts
// The farm's hash-locked voice installs must pin exactly the versions the voice step pins, with a sha256 per file.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';

const FARM = join(dirname(fileURLToPath(import.meta.url)), '..');
const VOICE = join(FARM, '..', 'voice');

const pins = (file: string): Map<string, string> => {
	const out = new Map<string, string>();
	for (const raw of readFileSync(file, 'utf8').split('\n')) {
		const line = raw.replace(/#.*$/, '').trim();
		if (!line) continue;
		const m = /^([A-Za-z0-9_.-]+)==(\S+)/.exec(line);
		assert.ok(m, `${file}: "${line.slice(0, 60)}" is not an exact pin`);
		out.set(m[1].toLowerCase().replace(/[-_.]+/g, '-'), m[2]);
	}
	return out;
};

for (const [lock, reqs] of [
	['voice-lock.txt', 'requirements.txt'],
	['voice-lock-cjk.txt', 'requirements-cjk.txt'],
] as const) {
	test(`${lock} pins exactly scripts/voice/${reqs}, every line with sha256 hashes`, () => {
		const want = pins(join(VOICE, reqs));
		const got = pins(join(FARM, lock));
		assert.deepEqual([...got.entries()].sort(), [...want.entries()].sort(), `regenerate: python3 scripts/farm/mklock.py scripts/voice/${reqs}${lock.includes('cjk') ? ' sdist' : ''}`);
		for (const raw of readFileSync(join(FARM, lock), 'utf8').split('\n')) {
			const line = raw.replace(/#.*$/, '').trim();
			if (!line) continue;
			const hashes = line.match(/--hash=sha256:[0-9a-f]{64}/g) ?? [];
			assert.ok(hashes.length >= 1, `${line.split(' ')[0]} has no sha256 hash`);
			assert.equal(line.split(/\s+/).length, 1 + hashes.length, `${line.split(' ')[0]}: only --hash options may follow the pin`);
		}
	});
}
