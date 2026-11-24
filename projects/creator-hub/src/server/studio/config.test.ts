import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {loadStudioConfig, StudioConfigError} from './config.ts';

const exampleJson = (): Record<string, unknown> =>
	JSON.parse(readFileSync(new URL('../../../config/studio.example.json', import.meta.url), 'utf8')) as Record<string, unknown>;

/** Example config with `edit` applied to a deep copy. */
const variant = (edit: (c: any) => void): unknown => {
	const config = structuredClone(exampleJson());
	edit(config);
	return config;
};

const rejects = (config: unknown, message: RegExp): void => {
	assert.throws(() => loadStudioConfig(config), (error: unknown) => {
		assert.ok(error instanceof StudioConfigError, `expected StudioConfigError, got ${String(error)}`);
		assert.match(error.message, message);
		return true;
	});
};

test('the committed example config is valid and invents no prices, timelines or portfolio', () => {
	const config = loadStudioConfig(exampleJson());
	assert.deepEqual(
		config.packages.map((p) => p.id),
		['explainer-60-90', 'explainer-3-5-min', 'shorts-pack-3'],
	);
	for (const pkg of config.packages) {
		assert.equal(pkg.priceUsd, null, `${pkg.id} must not ship with a price`);
		assert.equal(pkg.turnaroundDays, null);
		assert.equal(pkg.revisions, null);
		assert.ok(pkg.deliverables.length > 0);
	}
	assert.deepEqual(config.portfolio, []);
	assert.deepEqual(config.stripePaymentLinks, {});
	assert.ok(config.faq.length > 0);
	assert.ok(config.budgetRanges.length > 0);
});

test('decided values, notes, a portfolio and Stripe links are accepted', () => {
	const config = loadStudioConfig(
		variant((c) => {
			c.packages[0].priceUsd = 1499.5;
			c.packages[0].turnaroundDays = 10;
			c.packages[0].revisions = 0;
			c.packages[0]._note = 'notes are ignored';
			c.portfolio = [{title: 'Episode 1', url: 'https://www.youtube.com/watch?v=abc', client: 'Own channel'}];
			c.stripePaymentLinks = {'shorts-pack-3': 'https://buy.stripe.com/test_123', _note: 'ignored'};
		}),
	);
	assert.equal(config.packages[0]?.priceUsd, 1499.5);
	assert.equal(config.packages[0]?.turnaroundDays, 10);
	assert.equal(config.packages[0]?.revisions, 0);
	assert.equal(config.portfolio[0]?.url, 'https://www.youtube.com/watch?v=abc');
	assert.deepEqual(config.stripePaymentLinks, {'shorts-pack-3': 'https://buy.stripe.com/test_123'});
});

test('bad configs are rejected with the path of the first bad setting', () => {
	rejects(null, /missing: copy config\/studio\.example\.json/);
	rejects([], /root must be an object/);
	rejects(variant((c) => (c.version = 2)), /version must be 1/);
	rejects(variant((c) => (c.packages = [])), /packages must have 1 to 12 entries/);
	rejects(variant((c) => (c.packages[1].id = c.packages[0].id)), /duplicate entry "explainer-60-90"/);
	rejects(variant((c) => (c.packages[0].id = 'custom')), /reserved/);
	rejects(variant((c) => (c.packages[0].id = 'Bad_ID')), /packages\[0\]\.id must be 2-40 characters/);
	rejects(variant((c) => (c.packages[0].priceUsd = -5)), /packages\[0\]\.priceUsd/);
	rejects(variant((c) => (c.packages[0].priceUsd = 10.555)), /at most 2 decimals/);
	rejects(variant((c) => (c.packages[0].priceUsd = '500')), /packages\[0\]\.priceUsd/);
	rejects(variant((c) => delete c.packages[0].priceUsd), /packages\[0\]\.priceUsd is required \(use null/);
	rejects(variant((c) => (c.packages[0].turnaroundDays = 2.5)), /turnaroundDays must be null or a whole number/);
	rejects(variant((c) => (c.packages[0].revisions = 99)), /revisions must be null or a whole number from 0 to 10/);
	rejects(variant((c) => (c.packages[0].deliverables = [])), /deliverables must have 1 to 15 entries/);
	rejects(variant((c) => (c.packages[0].priceUSD = 5)), /packages\[0\]\.priceUSD is not a known setting/);
	rejects(variant((c) => (c.budgetRanges = ['a', 'a'])), /budgetRanges has a duplicate entry/);
	rejects(variant((c) => (c.faq = [{q: 'Question?', a: ''}])), /faq\[0\]\.a must be a non-empty string/);
	rejects(variant((c) => (c.portfolio = [{title: 'T', url: 'http://example.com'}])), /portfolio\[0\]\.url must be an https URL/);
	rejects(variant((c) => (c.portfolio = [{title: 'T', url: 'javascript:alert(1)'}])), /portfolio\[0\]\.url must be an https URL/);
	rejects(variant((c) => (c.stripePaymentLinks = {nope: 'https://buy.stripe.com/x'})), /stripePaymentLinks\.nope is not a known setting/);
	rejects(
		variant((c) => (c.stripePaymentLinks = {'shorts-pack-3': 'https://user:pw@buy.stripe.com/x'})),
		/stripePaymentLinks\.shorts-pack-3 must be an https URL without a username or password/,
	);
});
