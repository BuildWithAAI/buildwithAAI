// node --test scripts/farm/tests/kokoro.test.ts
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {kokoroCacheKey, kokoroPins} from '../kokoro.ts';

const SETUP = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'voice', 'setup.sh');

test('the cache key is made of the model sha256s pinned in scripts/voice/setup.sh', () => {
	const text = readFileSync(SETUP, 'utf8');
	const pins = kokoroPins(text);
	assert.deepEqual(pins.map((p) => p.file), ['kokoro-v1.0.int8.onnx', 'voices-v1.0.bin']);
	// CLAUDE.md records the pins as ae315a79…ee9c and bca610b8…f7d.
	assert.match(pins[0].sha256, /^ae315a79[0-9a-f]{52}ee9c$/);
	assert.match(pins[1].sha256, /^bca610b8[0-9a-f]{53}f7d$/);
	assert.equal(kokoroCacheKey(text), `kokoro-models-${pins[0].sha256}-${pins[1].sha256}`);
});

test('a changed pin changes the key; no pins is an error', () => {
	const a = `pinned_sha() {\n  case "$1" in\n    a.onnx) echo "${'1'.repeat(64)}" ;;\n  esac\n}`;
	const b = a.replace('1'.repeat(64), '2'.repeat(64));
	assert.notEqual(kokoroCacheKey(a), kokoroCacheKey(b));
	assert.throws(() => kokoroCacheKey('#!/bin/sh\necho hi\n'), /pins no model sha256/);
});
