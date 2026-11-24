import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {median, per1k, pooledPer1k, ratio, sum} from './stats.ts';

describe('maths', () => {
	it('per1k scales to 1,000 views and refuses missing or zero views', () => {
		assert.equal(per1k(31.2, 12400), (31.2 / 12400) * 1000);
		assert.equal(per1k(5, 1000), 5);
		assert.equal(per1k(0, 1000), 0);
		assert.equal(per1k(5, 0), null);
		assert.equal(per1k(null, 1000), null);
		assert.equal(per1k(5, null), null);
	});

	it('median handles odd and even counts, ignores nulls and is null when empty', () => {
		assert.equal(median([3, 1, 2]), 2);
		assert.equal(median([4, 1, 3, 2]), 2.5);
		assert.equal(median([null, 7, null]), 7);
		assert.equal(median([]), null);
		assert.equal(median([null]), null);
		assert.equal(median([0.061, 0.074, 0.052, 0.039, 0.068, 0.044, 0.059, 0.031]), (0.052 + 0.059) / 2);
	});

	it('pooledPer1k weights by views and skips items without both numbers', () => {
		const pooled = pooledPer1k([
			{amount: 10, views: 1000}, // 10 per 1K
			{amount: 1, views: 9000}, // 0.11 per 1K
			{amount: null, views: 5000}, // no amount: left out
			{amount: 3, views: 0}, // no views: left out
		]);
		assert.equal(pooled.n, 2);
		assert.equal(pooled.views, 10000);
		assert.equal(pooled.amount, 11);
		assert.equal(pooled.rate, 1.1, 'not the mean of the two rates (5.06)');
		assert.equal(pooledPer1k([]).rate, null);
	});

	it('ratio and sum', () => {
		assert.equal(ratio(3, 2), 1.5);
		assert.equal(ratio(3, 0), null);
		assert.equal(ratio(null, 2), null);
		assert.equal(sum([1, null, 2.5]), 3.5);
	});
});
