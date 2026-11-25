import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {cue, groupIds, overlappingRepeats, resolveSound, sfxForBulletReveal, sfxForTransition, strikePredicate, TRANSITION_SFX, typingClicks, type TransitionType} from '../core/sfx.ts';
import {hash32, permutation, prng, variationIndex, variationSequence} from '../core/variation.ts';
import {hash as sfxHash, sfx as entry, syncFrames} from '../../../scripts/audio/sfx/sfx.ts';
import {sfxLib} from './helpers.ts';

const lib = sfxLib();

describe('seeded variation', () => {
	it('uses the same FNV-1a hash as the SFX library', () => {
		for (const k of ['', 'pop|scene-1', 'whoosh_medium:7']) assert.equal(hash32(k), sfxHash(k));
	});
	it('prng is deterministic and uniform enough', () => {
		const a = prng(42);
		const b = prng(42);
		let sum = 0;
		for (let i = 0; i < 10000; i++) {
			const v = a();
			assert.equal(v, b());
			assert.ok(v >= 0 && v < 1);
			sum += v;
		}
		assert.ok(Math.abs(sum / 10000 - 0.5) < 0.02);
	});
	it('a permutation holds every index once', () => {
		for (const n of [1, 3, 4, 10]) assert.deepEqual([...permutation(n, `p${n}`)].sort((x, y) => x - y), Array.from({length: n}, (_, i) => i));
	});
	it('never repeats a file back to back, uses every variation before any repeat, and depends on the scene', () => {
		for (const count of [2, 3, 4, 5, 10]) {
			for (const scene of ['s01', 's02', 'hook', '']) {
				const seq = variationSequence('pop', count, scene, 3 * count + 1);
				for (let i = 1; i < seq.length; i++) assert.notEqual(seq[i], seq[i - 1], `${count}/${scene}: repeat at ${i}`);
				assert.equal(new Set(seq.slice(0, count)).size, count);
			}
		}
		const starts = new Set(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((s) => variationIndex('key', 10, s, 0)));
		assert.ok(starts.size >= 4, 'different scenes should start on different files');
		assert.equal(variationIndex('pop', 1, 'x', 5), 0);
		assert.throws(() => variationIndex('pop', 0, 'x', 0), /no variations/);
		assert.throws(() => variationIndex('pop', 3, 'x', -1), /index/);
	});
});

describe('resolving sounds', () => {
	it('an exact id resolves to itself; a group picks deterministically by scene and index', () => {
		assert.equal(resolveSound(lib, 'pop_03').id, 'pop_03');
		const a = resolveSound(lib, 'whoosh_medium', {scene: 's04', index: 2});
		assert.equal(a.group, 'whoosh_medium');
		assert.equal(resolveSound(lib, 'whoosh_medium', {scene: 's04', index: 2}).id, a.id);
	});
	it('variant forces a file (1-based, as in the file names)', () => {
		assert.equal(resolveSound(lib, 'pop', {variant: 2}).id, groupIds(lib, 'pop')[1]);
		assert.throws(() => resolveSound(lib, 'pop', {variant: 9}), /variations 1-4/);
		assert.throws(() => resolveSound(lib, 'pop_01', {variant: 1}), /group/);
		assert.throws(() => resolveSound(lib, 'nope'), /no SFX/);
	});
	it('a cue lands the sync point on `at` and carries the suggested gain plus trims', () => {
		const w = cue(lib, 'whoosh_medium_02', 100);
		const e = entry(lib, 'whoosh_medium_02');
		assert.equal(w.from, 100 - syncFrames(e));
		assert.equal(w.from, 90); // pass-by 333 ms = 10 frames into the file
		assert.equal(w.gainDb, e.suggestedGainDb);
		const p = cue(lib, 'pop_01', 50, {underSpeech: true, gainDb: -1});
		assert.equal(p.gainDb, entry(lib, 'pop_01').suggestedGainDb - 3 - 1);
		assert.throws(() => cue(lib, 'pop_01', 0, {fps: 25}), /30 fps/);
	});
});

describe('sfxForTransition', () => {
	it('cuts and fades stay dry; a slide or wipe gets its pass-by mid-transition', () => {
		assert.equal(sfxForTransition(lib, 'cut', {at: 10, frames: 0}), null);
		assert.equal(sfxForTransition(lib, 'fade', {at: 10, frames: 12}), null);
		const s = sfxForTransition(lib, 'slide', {at: 100, frames: 18, scene: 's02'});
		assert.ok(s);
		assert.equal(s.at, 109);
		assert.match(s.id, /^whoosh_medium_/);
		assert.equal(s.label, 'transition:slide');
		const w = sfxForTransition(lib, 'wipe', {at: 100, frames: 18});
		assert.match(w?.id ?? '', /^whoosh_short_/);
		const r = sfxForTransition(lib, 'reverse', {at: 100, frames: 18});
		assert.equal(r?.at, 118); // the swell tops out on the cut
		assert.throws(() => sfxForTransition(lib, 'spin' as TransitionType, {at: 0, frames: 10}), /unknown/);
		for (const t of Object.values(TRANSITION_SFX)) if (t) assert.ok(lib.groups[t.group], `group ${t.group} exists`);
	});
});

describe('sfxForBulletReveal', () => {
	it('up to four bullets climb the ordered pop_rise set; more use pitch-stable pops without repeats', () => {
		const rise = [0, 1, 2].map((index) => sfxForBulletReveal(lib, {at: 200 + index * 20, index, count: 3}));
		assert.deepEqual(
			rise.map((c) => c.id),
			['pop_rise_01', 'pop_rise_02', 'pop_rise_03'],
		);
		assert.deepEqual(
			rise.map((c) => c.at),
			[200, 220, 240],
		);
		const many = Array.from({length: 7}, (_, index) => sfxForBulletReveal(lib, {at: index * 15, index, count: 7, scene: 's05'}));
		for (const c of many) assert.match(c.id, /^pop_0\d$/);
		for (let i = 1; i < many.length; i++) assert.notEqual(many[i].id, many[i - 1].id);
		assert.throws(() => sfxForBulletReveal(lib, {at: 0, index: 5, count: 6, style: 'rise'}), /style 'same'/);
		assert.equal(sfxForBulletReveal(lib, {at: 0, index: 0, count: 3, underSpeech: true}).gainDb, entry(lib, 'pop_rise_01').suggestedGainDb - 3);
	});
});

describe('typingClicks', () => {
	it('places every key on a whole frame inside [from, to), at least 2 frames apart, at about the density asked', () => {
		const keys = typingClicks(lib, 100, 100 + 30 * 60, 6.5, {scene: 's07'});
		assert.ok(keys.length > 0);
		for (const k of keys) {
			assert.ok(Number.isInteger(k.at) && k.at >= 100 && k.at < 1900);
			assert.equal(k.from, k.at); // keys sync on their transient: frame 0 of the file
		}
		for (let i = 1; i < keys.length; i++) assert.ok(keys[i].at - keys[i - 1].at >= 2);
		const rate = keys.length / 60;
		assert.ok(rate > 6.5 * 0.7 && rate < 6.5 * 1.1, `rate ${rate.toFixed(2)} keys/s`);
		assert.ok(keys.some((k) => k.key === 'space'), 'words end in a space bar');
	});
	it('never plays the same key file twice in a row, and never above the suggested gain', () => {
		const keys = typingClicks(lib, 0, 900, 8, {scene: 'x'});
		const letters = keys.filter((k) => k.key === 'alpha');
		for (let i = 1; i < letters.length; i++) assert.notEqual(letters[i].id, letters[i - 1].id);
		for (const k of keys) assert.ok(k.gainDb <= entry(lib, k.id).suggestedGainDb + 1e-9 && k.gainDb >= entry(lib, k.id).suggestedGainDb - 3 - 1e-9);
	});
	it('with text: one key per character, space bar and Enter where the text has them', () => {
		const keys = typingClicks(lib, 0, 300, 6, {scene: 't', text: 'ab c\n'});
		assert.deepEqual(
			keys.map((k) => k.key),
			['alpha', 'alpha', 'space', 'alpha', 'enter'],
		);
		assert.deepEqual(
			keys.map((k) => k.char),
			[0, 1, 2, 3, 4],
		);
		assert.match(keys[4].id, /^key_enter_/);
		assert.match(keys[2].id, /^key_space_/);
		// text that does not fit stops at `to`
		const cut = typingClicks(lib, 0, 20, 6, {text: 'a long sentence that will not fit'});
		assert.ok(cut.length < 10 && cut.every((k) => k.at < 20));
	});
	it('is deterministic per scene and differs between scenes', () => {
		const a = typingClicks(lib, 0, 300, 7, {scene: 'a'});
		assert.deepEqual(typingClicks(lib, 0, 300, 7, {scene: 'a'}), a);
		assert.notDeepEqual(
			typingClicks(lib, 0, 300, 7, {scene: 'b'}).map((k) => k.at),
			a.map((k) => k.at),
		);
		assert.throws(() => typingClicks(lib, 0, 10, 0), /density/);
		assert.deepEqual(typingClicks(lib, 10, 10, 5), []);
	});
	it('moves keys by at most one frame onto the rig strike frames (strikePredicate of a fingerLift)', () => {
		// a rig-shaped fingerLift (lifted for 3 frames, down again on the 4th) with per-finger periods of 9-13 frames,
		// the same shape src/characters/zoo/views/Typing.tsx exports; templates pass the real one
		const lift = (frame: number, hand: 0 | 1, finger: number) => {
			const period = 9 + ((finger * 5 + hand * 3) % 5);
			const t = (((frame + ((finger * 7 + hand * 11) % period)) % period) + period) % period;
			return t < 4 ? Math.sin((Math.PI * t) / 4) * 16 : 0;
		};
		const isStrike = strikePredicate(lift);
		const strikes = Array.from({length: 600}, (_, f) => isStrike(f)).filter(Boolean).length;
		assert.ok(strikes > 200, `${strikes} strike frames in 600`);
		const free = typingClicks(lib, 0, 600, 6, {scene: 'r'});
		const locked = typingClicks(lib, 0, 600, 6, {scene: 'r', isStrike});
		const onStrike = locked.filter((k) => isStrike(k.at)).length / locked.length;
		const onStrikeFree = free.filter((k) => isStrike(k.at)).length / free.length;
		assert.ok(onStrike > 0.9, `${(onStrike * 100).toFixed(0)}% of keys on strike frames`);
		assert.ok(onStrike > onStrikeFree);
	});
});

describe('overlappingRepeats', () => {
	it('flags the same file starting again while it still plays', () => {
		const a = cue(lib, 'pop_01', 10);
		const b = cue(lib, 'pop_01', 12);
		const c = cue(lib, 'pop_02', 12);
		assert.equal(overlappingRepeats([a, b]).length, 1);
		assert.equal(overlappingRepeats([a, c]).length, 0);
		assert.equal(overlappingRepeats([a, cue(lib, 'pop_01', 30)]).length, 0);
	});
});
