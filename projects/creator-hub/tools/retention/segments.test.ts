import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {canonicalSegment, resolveSegment, segmentOrder} from './segments.ts';

describe('segment names', () => {
	it("normalises the show contract's camelCase names and other spellings", () => {
		assert.equal(canonicalSegment('badgerRedFlag'), 'BadgerRedFlag');
		assert.equal(canonicalSegment("Badger's Red Flag"), 'BadgerRedFlag');
		assert.equal(canonicalSegment('red-flag'), 'BadgerRedFlag');
		assert.equal(canonicalSegment('coldOpen'), 'ColdOpen');
		assert.equal(canonicalSegment('zooOneFix'), 'ZooOneFix');
		assert.equal(canonicalSegment("Zoo's One Fix"), 'ZooOneFix');
		assert.equal(canonicalSegment('outroEndScreen'), 'OutroEndScreen');
		assert.equal(canonicalSegment('desk'), 'Desk');
	});
	it('keeps an unknown explicit name, normalised, and rejects non-text', () => {
		assert.equal(canonicalSegment('post-mortem'), 'PostMortem');
		assert.equal(canonicalSegment(''), null);
		assert.equal(canonicalSegment(42), null);
		assert.equal(canonicalSegment('x'.repeat(61)), null);
	});
	it('sorts known segments in running order', () => {
		assert.ok(segmentOrder('ColdOpen') < segmentOrder('BadgerRedFlag'));
		assert.ok(segmentOrder('BadgerRedFlag') < segmentOrder('ZooOneFix'));
		assert.ok(segmentOrder('Unknown') > segmentOrder('OutroEndScreen'));
	});
});

describe('resolveSegment', () => {
	it('uses an explicit segment first (scene.segment or scene.show.segment)', () => {
		assert.deepEqual(resolveSegment({id: 's1', type: 'talk', segment: 'howItWorked'}, undefined), {segment: 'HowItWorked', source: 'explicit'});
		assert.deepEqual(resolveSegment({id: 's1', type: 'talk', show: {segment: 'headline'}}, undefined), {segment: 'Headline', source: 'explicit'});
		assert.deepEqual(resolveSegment({id: 's1', type: 'badgerRedFlag'}, undefined), {segment: 'BadgerRedFlag', source: 'explicit'});
	});
	it("applies the show's own defaults for uploads rendered by the show", () => {
		assert.deepEqual(resolveSegment({id: 's1', type: 'hook'}, undefined, 'show'), {segment: 'ColdOpen', source: 'default'});
		assert.deepEqual(resolveSegment({id: 's1', type: 'talk'}, undefined, 'show'), {segment: 'Desk', source: 'default'});
		assert.deepEqual(resolveSegment({id: 's1', type: 'endscreen'}, undefined, 'show'), {segment: 'OutroEndScreen', source: 'default'});
		assert.deepEqual(resolveSegment({id: 's1', type: 'chart'}, undefined, 'show'), {segment: null, source: null});
	});
	it('infers branded segments from the SOURCE-language title for episode-engine uploads', () => {
		const es = {id: 's4', type: 'steps', onScreen: {title: 'La bandera roja de Badger'}};
		const en = {id: 's4', type: 'steps', onScreen: {title: "Badger's Red Flag: the countdown"}};
		assert.deepEqual(resolveSegment(es, en), {segment: 'BadgerRedFlag', source: 'inferred'});
		assert.deepEqual(resolveSegment({id: 's2', type: 'talk', onScreen: {title: 'How it started'}}, undefined), {segment: null, source: null});
	});
	it('does not infer from a kicker (the episode series label is not a scene segment)', () => {
		assert.deepEqual(resolveSegment({id: 's1', type: 'hook', onScreen: {kicker: 'Scam of the Week', title: 'Support never DMs you first'}}, undefined), {segment: null, source: null});
	});
});
