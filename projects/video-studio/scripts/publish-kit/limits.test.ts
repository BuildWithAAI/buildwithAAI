import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {countHashtags, LIMITS, utf8Bytes, xWeightedLength, youtubeTagsLength} from './limits.ts';

describe('youtubeTagsLength', () => {
	it('counts quotes around tags with spaces and the commas between tags (API reference example)', () => {
		assert.equal(youtubeTagsLength(['Foo-Baz']), 7);
		assert.equal(youtubeTagsLength(['Foo Baz']), 9);
		assert.equal(youtubeTagsLength(['Foo-Baz', 'Foo Baz']), 7 + 9 + 1);
		assert.equal(youtubeTagsLength([]), 0);
	});
});

describe('utf8Bytes', () => {
	it('counts bytes, not characters', () => {
		assert.equal(utf8Bytes('abc'), 3);
		assert.equal(utf8Bytes('é'), 2);
		assert.equal(utf8Bytes('🐶'), 4);
	});
});

describe('countHashtags', () => {
	it('finds hashtags but not URL fragments or HTML entities', () => {
		assert.equal(countHashtags('#One #Two\n#Three'), 3);
		assert.equal(countHashtags('see https://a.test/#frag and &#39;'), 0);
		assert.equal(countHashtags('word#notatag'), 0);
	});
});

describe('xWeightedLength (twitter-text v3)', () => {
	it('counts ASCII as 1 and every URL as 23', () => {
		assert.equal(xWeightedLength('hello'), 5);
		assert.equal(xWeightedLength('https://go.zoora.ai/go/hardware-wallet?v=_example&s=x'), LIMITS.xUrlWeight);
		assert.equal(xWeightedLength('a https://youtu.be/x b'), 2 + 2 + 23);
	});
	it('keeps trailing punctuation out of the URL', () => {
		assert.equal(xWeightedLength('Watch https://youtu.be/abc.'), 6 + 23 + 1);
	});
	it('counts emoji (also ZWJ sequences) and CJK as 2', () => {
		assert.equal(xWeightedLength('🐶'), 2);
		assert.equal(xWeightedLength('👨‍👩‍👧'), 2);
		assert.equal(xWeightedLength('安全'), 4);
		assert.equal(xWeightedLength('é'), 1);
	});
	it('counts bare domains X would link as at least 23', () => {
		assert.equal(xWeightedLength('go.zoora.ai'), 23);
	});
});
