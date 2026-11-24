import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {describe, it} from 'node:test';
import {openDb, purgeBefore} from './db.ts';
import {createRateLimiter, retentionCutoff, securityHeaders} from './security.ts';

describe('token bucket rate limiter', () => {
	it('allows a burst, then refills over time, per key', () => {
		let now = 0;
		const limiter = createRateLimiter({capacity: 3, refillPerSecond: 1, now: () => now});
		assert.deepEqual([1, 2, 3, 4].map(() => limiter.take('a')), [true, true, true, false]);
		assert.equal(limiter.take('b'), true, 'other keys are independent');
		assert.equal(limiter.retryAfter('a'), 1);
		now += 1000;
		assert.equal(limiter.take('a'), true);
		assert.equal(limiter.take('a'), false);
		now += 60_000;
		assert.equal(limiter.available('a'), 3, 'never above capacity');
	});

	it('stays within maxKeys by dropping the least recently used key', () => {
		const limiter = createRateLimiter({capacity: 1, refillPerSecond: 0.001, maxKeys: 2, now: () => 0});
		limiter.take('a');
		limiter.take('b');
		limiter.take('c'); // evicts "a"
		assert.equal(limiter.available('a'), 1);
		assert.equal(limiter.available('c'), 0);
	});
});

describe('security headers', () => {
	it('sends the CSP with Kit as the only external form target, and HSTS only on https', () => {
		const https = new Map(securityHeaders('https://go.zoora.ai', ['https://app.kit.com']));
		assert.equal(
			https.get('Content-Security-Policy'),
			"default-src 'self'; base-uri 'none'; object-src 'none'; form-action 'self' https://app.kit.com; frame-ancestors 'none'",
		);
		assert.equal(https.get('X-Content-Type-Options'), 'nosniff');
		assert.equal(https.get('Referrer-Policy'), 'strict-origin-when-cross-origin');
		assert.equal(https.get('Strict-Transport-Security'), 'max-age=31536000');
		assert.equal(new Map(securityHeaders('http://localhost:8080', [])).has('Strict-Transport-Security'), false);
	});
});

describe('retention', () => {
	it('cuts off 13 calendar months back', () => {
		assert.equal(new Date(retentionCutoff(Date.parse('2026-11-24T00:00:00Z'))).toISOString(), '2025-10-24T00:00:00.000Z');
	});

	it('purges old clicks, page events and orders, but keeps won orders', () => {
		const dir = mkdtempSync(join(tmpdir(), 'hub-retention-'));
		try {
			const db = openDb(dir);
			const now = Date.parse('2026-11-24T00:00:00Z');
			const old = Date.parse('2025-09-01T00:00:00Z');
			for (const ts of [old, now]) {
				db.prepare("INSERT INTO clicks (ts, offer_id, visitor_hash, outcome) VALUES (?, 'x', 'h', 'redirected')").run(ts);
				db.prepare("INSERT INTO page_events (ts, page, visitor_hash) VALUES (?, 'bio', 'h')").run(ts);
			}
			const order = db.prepare(
				"INSERT INTO orders (id, ts, name, email, package_id, message, consent, status, visitor_hash) VALUES (?, ?, 'n', 'e@x.test', 'p', 'm', 1, ?, 'h')",
			);
			order.run('old-new', old, 'new');
			order.run('old-won', old, 'won');
			order.run('recent', now, 'new');
			assert.deepEqual(purgeBefore(db, retentionCutoff(now)), {clicks: 1, pageEvents: 1, orders: 1});
			const ids = db.prepare('SELECT id FROM orders ORDER BY id').all().map((r) => r.id);
			assert.deepEqual(ids, ['old-won', 'recent']);
			db.close();
		} finally {
			rmSync(dir, {recursive: true, force: true});
		}
	});
});
