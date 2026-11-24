import assert from 'node:assert/strict';
import {after, before, describe, it} from 'node:test';
import {startTestHub, type TestHub} from '../test-helpers.ts';

const WALLET_URL = 'https://shop.wallet.test/buy?ref=abc%20def';
const REGISTRY_URLS = [WALLET_URL, 'https://exchange.test/', 'https://course.test/', 'https://old.test/', 'https://paused.test/'];

describe('GET /go/:offer', () => {
	let t: TestHub;
	before(async () => {
		t = await startTestHub({env: {TRUST_PROXY: 'cloudflare'}});
	});
	after(() => t.close());

	it('302s to the registry URL with the sub-ID, no-store and no cookie, and logs the click', async () => {
		const res = await t.request('/go/wallet?v=dQw4w9WgXcQ&s=yt', {
			headers: {'CF-IPCountry': 'DE', referer: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'},
		});
		assert.equal(res.status, 302);
		assert.equal(res.headers.get('location'), `${WALLET_URL}&subid=dQw4w9WgXcQ.yt`);
		assert.equal(res.headers.get('cache-control'), 'no-store');
		assert.equal(res.headers.get('set-cookie'), null);
		assert.equal(res.headers.get('x-robots-tag'), 'noindex, nofollow');
		assert.match(res.headers.get('content-security-policy') ?? '', /frame-ancestors 'none'/);
		const click = t.lastClick();
		assert.equal(click?.offer_id, 'wallet');
		assert.equal(click?.video_id, 'dQw4w9WgXcQ');
		assert.equal(click?.source, 'yt');
		assert.equal(click?.country, 'DE');
		assert.equal(click?.is_bot, 0);
		assert.equal(click?.outcome, 'redirected');
		assert.equal(click?.referrer_host, 'www.youtube.com');
		assert.match(String(click?.visitor_hash), /^[0-9a-f]{16}$/);
	});

	it('matches offer ids case-insensitively, still only against the registry', async () => {
		const res = await t.request('/go/Wallet?s=bio');
		assert.equal(res.status, 302);
		assert.equal(res.headers.get('location'), `${WALLET_URL}&subid=none.bio`);
		assert.equal(t.lastClick()?.offer_id, 'wallet');
	});

	it('drops invalid v and s values instead of forwarding them', async () => {
		const res = await t.request('/go/wallet?v=%3Cscript%3E&s=evil');
		assert.equal(res.status, 302);
		assert.equal(res.headers.get('location'), WALLET_URL);
		assert.equal(t.lastClick()?.video_id, null);
		assert.equal(t.lastClick()?.source, null);
	});

	it('still redirects bots, but logs them as bots', async () => {
		const curl = await t.request('/go/wallet?s=x', {headers: {'user-agent': 'curl/8.5.0'}});
		assert.equal(curl.status, 302);
		assert.equal(t.lastClick()?.is_bot, 1);
		const head = await t.request('/go/wallet', {method: 'HEAD'});
		assert.equal(head.status, 302);
		assert.equal(t.lastClick()?.is_bot, 1);
	});
});

describe('region policy at /go with TRUST_PROXY=cloudflare', () => {
	let t: TestHub;
	before(async () => {
		t = await startTestHub({env: {TRUST_PROXY: 'cloudflare'}});
	});
	after(() => t.close());

	const go = (path: string, country?: string): Promise<Response> =>
		t.request(path, {headers: country ? {'CF-IPCountry': country} : {}});

	it('blocks the exchange in GB with the reason and in-region alternatives, never the destination', async () => {
		const res = await go('/go/exchange?v=vid1&s=shorts', 'GB');
		assert.equal(res.status, 451);
		const body = await res.text();
		assert.match(body, /Not available in your region/);
		assert.match(body, /This exchange does not serve your country\./);
		assert.match(body, /United Kingdom/);
		assert.match(body, /href="\/go\/wallet\?v=vid1&amp;s=shorts"/, 'alternative keeps attribution');
		assert.match(body, /Affiliate link: I may earn a commission if you buy\./, 'alternative shows its disclosure');
		assert.doesNotMatch(body, /EU Course/, 'alternatives blocked in GB are not offered');
		assert.doesNotMatch(body, /exchange\.test|invite\?code/, 'destination never revealed');
		assert.equal(res.headers.get('location'), null);
		const click = t.lastClick();
		assert.equal(click?.outcome, 'blocked_region');
		assert.equal(click?.country, 'GB');
	});

	it('blocks the exchange in the US too', async () => {
		assert.equal((await go('/go/exchange', 'US')).status, 451);
		assert.equal(t.lastClick()?.outcome, 'blocked_region');
	});

	it('redirects the exchange where it is allowed', async () => {
		const res = await go('/go/exchange?v=vid1&s=x', 'DE');
		assert.equal(res.status, 302);
		assert.equal(res.headers.get('location'), 'https://exchange.test/invite?code=xyz&sub=vid1.x');
	});

	for (const [label, country] of [['missing', undefined], ['XX', 'XX'], ['T1 (Tor)', 'T1'], ['not ISO (UK)', 'UK']] as const) {
		it(`blocks restricted offers when the country is ${label}`, async () => {
			const res = await go('/go/exchange', country);
			assert.equal(res.status, 451);
			const body = await res.text();
			assert.match(body, /could not confirm which country you are in/);
			assert.doesNotMatch(body, /exchange\.test/);
			assert.equal(t.lastClick()?.outcome, 'blocked_unknown_region');
			assert.equal(t.lastClick()?.country, null);
		});
	}

	it('allows unrestricted offers when the country is unknown', async () => {
		assert.equal((await go('/go/wallet', 'XX')).status, 302);
	});

	it('applies allowedCountries', async () => {
		assert.equal((await go('/go/eu-course', 'FR')).status, 302);
		assert.equal((await go('/go/eu-course', 'GB')).status, 451);
		assert.equal(t.lastClick()?.outcome, 'blocked_region');
		assert.equal((await go('/go/eu-course')).status, 451);
		assert.equal(t.lastClick()?.outcome, 'blocked_unknown_region');
	});
});

describe('spoofed proxy headers with TRUST_PROXY=none', () => {
	let t: TestHub;
	before(async () => {
		t = await startTestHub({env: {TRUST_PROXY: 'none'}});
	});
	after(() => t.close());

	it('ignores CF-IPCountry and other country headers', async () => {
		const res = await t.request('/go/exchange', {headers: {'CF-IPCountry': 'DE', 'X-Country': 'DE'}});
		assert.equal(res.status, 451);
		assert.equal(t.lastClick()?.outcome, 'blocked_unknown_region');
		assert.equal(t.lastClick()?.country, null);
	});

	it('ignores CF-Connecting-IP and X-Forwarded-For for the visitor hash', async () => {
		await t.request('/go/wallet', {headers: {'CF-Connecting-IP': '198.51.100.1', 'X-Forwarded-For': '198.51.100.1'}});
		const first = t.lastClick()?.visitor_hash;
		await t.request('/go/wallet', {headers: {'CF-Connecting-IP': '198.51.100.2', 'X-Forwarded-For': '198.51.100.2'}});
		assert.equal(t.lastClick()?.visitor_hash, first);
	});
});

describe('TRUST_PROXY=header with a shared proxy secret', () => {
	const secret = 'origin-secret-0123456789abcdef0123456789';
	let t: TestHub;
	before(async () => {
		t = await startTestHub({env: {TRUST_PROXY: 'header', GEO_HEADER: 'X-Geo-Country', PROXY_SECRET: secret}});
	});
	after(() => t.close());

	it('trusts GEO_HEADER only on requests carrying the secret', async () => {
		assert.equal((await t.request('/go/exchange', {headers: {'X-Geo-Country': 'DE', 'X-Origin-Secret': secret}})).status, 302);
		assert.equal((await t.request('/go/exchange', {headers: {'X-Geo-Country': 'DE'}})).status, 451);
		assert.equal((await t.request('/go/exchange', {headers: {'X-Geo-Country': 'DE', 'X-Origin-Secret': 'guess'}})).status, 451);
		assert.equal((await t.request('/go/exchange', {headers: {'CF-IPCountry': 'DE', 'X-Origin-Secret': secret}})).status, 451);
	});
});

describe('no open redirect', () => {
	let t: TestHub;
	before(async () => {
		t = await startTestHub({env: {TRUST_PROXY: 'cloudflare'}});
	});
	after(() => t.close());

	const attempts = [
		'/go/https%3A%2F%2Fevil.test',
		'/go//evil.test',
		'//evil.test/go/wallet',
		'/go/%2F%2Fevil.test',
		'/go/evil.test',
		'/go/WALLET',
		'/go/wallet%2F..%2F..%2Fevil.test',
		'/go/..%5Cevil.test',
		'/go/wallet@evil.test',
		'/go/wallet%0D%0ALocation:%20https://evil.test',
		'/go/wallet?url=https://evil.test&next=//evil.test&redirect=https%3A%2F%2Fevil.test',
		'/go/wallet?v=a%0D%0ALocation:%20https://evil.test&s=yt',
		'/go/wallet?s=https://evil.test&v=..%2F..%2Fevil.test',
		'/go/wallet/https://evil.test',
	];

	for (const path of attempts) {
		it(`never sends ${path} anywhere but the registry`, async () => {
			const res = await t.request(path, {headers: {'CF-IPCountry': 'DE'}});
			const location = res.headers.get('location');
			if (location !== null) {
				assert.equal(res.status, 302);
				assert.ok(REGISTRY_URLS.some((u) => location.startsWith(u)), location);
			}
			assert.doesNotMatch(location ?? '', /evil/);
			assert.doesNotMatch(await res.text(), /evil\.test/, 'attacker input is not reflected');
		});
	}

	it('logs malformed ids without storing attacker text', async () => {
		await t.request('/go/%3Cscript%3E');
		assert.equal(t.lastClick()?.offer_id, '(invalid)');
		assert.equal(t.lastClick()?.outcome, 'not_found');
	});
});

describe('ended and unknown offers', () => {
	let t: TestHub;
	before(async () => {
		t = await startTestHub({env: {TRUST_PROXY: 'cloudflare'}});
	});
	after(() => t.close());

	it('shows an "offer ended" page for expired offers, with alternatives', async () => {
		const res = await t.request('/go/old-deal?v=abc&s=yt', {headers: {'CF-IPCountry': 'GB'}});
		assert.equal(res.status, 410);
		const body = await res.text();
		assert.match(body, /This offer has ended/);
		assert.match(body, /href="\/go\/wallet\?v=abc&amp;s=yt"/);
		assert.doesNotMatch(body, /old\.test/);
		assert.equal(t.lastClick()?.outcome, 'inactive');
	});

	it('shows the same page for inactive offers', async () => {
		const res = await t.request('/go/paused');
		assert.equal(res.status, 410);
		assert.doesNotMatch(await res.text(), /paused\.test/);
		assert.equal(t.lastClick()?.outcome, 'inactive');
	});

	it('404s and logs unknown offers', async () => {
		const res = await t.request('/go/nope');
		assert.equal(res.status, 404);
		assert.match(await res.text(), /Link not found/);
		assert.equal(t.lastClick()?.offer_id, 'nope');
		assert.equal(t.lastClick()?.outcome, 'not_found');
	});
});

describe('global rate limit', () => {
	let t: TestHub;
	before(async () => {
		t = await startTestHub({env: {RATE_LIMIT_BURST: '5', RATE_LIMIT_PER_MINUTE: '1'}});
	});
	after(() => t.close());

	it('answers 429 with Retry-After once a visitor exceeds the burst, and does not log those requests', async () => {
		const statuses: number[] = [];
		for (let i = 0; i < 8; i++) statuses.push((await t.request('/go/wallet')).status);
		assert.deepEqual(statuses, [302, 302, 302, 302, 302, 429, 429, 429]);
		const limited = await t.request('/go/wallet');
		assert.ok(Number(limited.headers.get('retry-after')) > 0);
		const logged = t.hub.db.prepare('SELECT COUNT(*) AS n FROM clicks').get();
		assert.equal(logged?.n, 5);
		assert.equal((await t.request('/healthz')).status, 200, 'health checks are never limited');
	});
});
