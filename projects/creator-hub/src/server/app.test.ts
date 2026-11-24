/** Server core behaviour that depends on the deployment (production settings, proxies, example configs). */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {describe, it} from 'node:test';
import {HUMAN_UA, startTestHub} from './test-helpers.ts';

const PRODUCTION = {
	NODE_ENV: 'production',
	PUBLIC_BASE_URL: 'https://hub.test',
	KIT_FORM_ACTION: 'https://app.kit.com/forms/123/subscriptions',
	RATE_LIMIT_BURST: '2',
	RATE_LIMIT_PER_MINUTE: '1',
};

describe('production behind a proxy with TRUST_PROXY=none', () => {
	it('does not let one client exhaust a per-IP bucket that every visitor shares, and tells the owner once', async () => {
		const warnings: string[] = [];
		const warn = console.warn;
		console.warn = (...args: unknown[]) => void warnings.push(args.join(' '));
		const t = await startTestHub({env: PRODUCTION});
		try {
			// 25 visitors (different browsers) arrive through the same proxy address (127.0.0.1 here).
			// The per-IP bucket (burst 20) would have answered 429 to everyone after the 20th.
			const statuses = await Promise.all(
				Array.from({length: 25}, (_, i) => t.request('/', {headers: {'user-agent': `${HUMAN_UA} visitor/${i}`}}).then((r) => r.status)),
			);
			assert.deepEqual([...new Set(statuses)], [200]);
			// each visitor still has their own limit
			const same = [];
			for (let i = 0; i < 3; i++) same.push((await t.request('/', {headers: {'user-agent': `${HUMAN_UA} visitor/0`}})).status);
			assert.deepEqual(same, [200, 429, 429]);
			assert.equal(warnings.filter((w) => /private address .* TRUST_PROXY=none/.test(w)).length, 1);
		} finally {
			console.warn = warn;
			await t.close();
		}
	});

	it('keeps the per-IP limit outside production (development and tests use loopback directly)', async () => {
		const t = await startTestHub({env: {RATE_LIMIT_BURST: '2', RATE_LIMIT_PER_MINUTE: '1'}});
		try {
			const statuses = [];
			for (let i = 0; i < 25; i++) statuses.push((await t.request('/', {headers: {'user-agent': `${HUMAN_UA} visitor/${i}`}})).status);
			assert.equal(statuses.filter((s) => s === 429).length, 5, 'the 10x per-IP bucket (20) still applies');
		} finally {
			await t.close();
		}
	});
});

describe('production with only the example studio config', () => {
	it('answers /studio with 503 and noindex instead of publishing the unreviewed example offer', async () => {
		const example = JSON.parse(readFileSync(new URL('../../config/studio.example.json', import.meta.url), 'utf8')) as unknown;
		const t = await startTestHub({env: {...PRODUCTION, RATE_LIMIT_BURST: '100'}, configFiles: {'studio.example.json': example}});
		try {
			const res = await t.request('/studio');
			assert.equal(res.status, 503);
			const html = await res.text();
			assert.match(html, /<meta name="robots" content="noindex">/);
			assert.doesNotMatch(html, /rel="canonical"|Explainer 60/);
		} finally {
			await t.close();
		}
		const dev = await startTestHub({configFiles: {'studio.example.json': example}});
		try {
			assert.equal((await dev.request('/studio')).status, 200, 'development still previews the example');
		} finally {
			await dev.close();
		}
	});
});
