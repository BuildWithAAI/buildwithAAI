import assert from 'node:assert/strict';
import {after, before, describe, it} from 'node:test';
import {RISK_LINE} from '../offers.ts';
import {startTestHub, testRegistry, type TestHub} from '../test-helpers.ts';

const escapedRisk = RISK_LINE.replace(/'/g, '&#39;');

describe('link in bio page', () => {
	let t: TestHub;
	before(async () => {
		t = await startTestHub({env: {TRUST_PROXY: 'cloudflare'}});
	});
	after(() => t.close());

	const bio = async (path: string, country?: string): Promise<string> => {
		const res = await t.request(path, {headers: country ? {'CF-IPCountry': country} : {}});
		assert.equal(res.status, 200);
		assert.equal(res.headers.get('set-cookie'), null);
		return res.text();
	};

	it('lists only the live offers available in the visitor region, each with its disclosure next to the link', async () => {
		const gb = await bio('/', 'GB');
		assert.match(gb, /Test Wallet/);
		assert.match(gb, /<p class="disclosure" id="disclosure-wallet"><span>Affiliate link: I may earn a commission if you buy\.<\/span><\/p>\n<a class="button" href="\/go\/wallet\?s=bio" aria-describedby="disclosure-wallet">/);
		assert.doesNotMatch(gb, /Test Exchange|EU Course/);
		assert.doesNotMatch(gb, /Old Deal|Paused Tool/, 'expired and inactive offers are hidden');
		assert.match(gb, /Some links are only available in certain countries/);

		const de = await bio('/', 'DE');
		assert.match(de, /Test Exchange/);
		assert.match(de, /EU Course/);
		assert.ok(de.includes(escapedRisk), 'risk line added to the exchange disclosure');

		const unknown = await bio('/');
		assert.match(unknown, /Test Wallet/);
		assert.doesNotMatch(unknown, /Test Exchange|EU Course/);
	});

	it('never shows destination URLs, and links to the studio and newsletter', async () => {
		const html = await bio('/', 'DE');
		assert.doesNotMatch(html, /shop\.wallet\.test|exchange\.test|course\.test/);
		assert.match(html, /href="\/studio"/);
		assert.match(html, /href="\/subscribe"/);
		assert.match(html, /never DM you first or ask for your seed phrase/);
	});

	it('carries ?v= and ?s= into the offer links and logs the page view', async () => {
		const html = await bio('/?v=abc123&s=tiktok', 'DE');
		assert.match(html, /href="\/go\/wallet\?v=abc123&amp;s=tiktok"/);
		const event = t.hub.db.prepare('SELECT * FROM page_events ORDER BY id DESC LIMIT 1').get();
		assert.equal(event?.page, 'bio');
		assert.equal(event?.source, 'tiktok');
		assert.equal(event?.video_id, 'abc123');
		assert.equal(event?.country, 'DE');
		assert.equal(event?.is_bot, 0);
	});
});

describe('HTML escaping', () => {
	let t: TestHub;
	before(async () => {
		const registry = testRegistry();
		registry.offers.push({
			id: 'xss',
			name: '<script>alert("name")</script>',
			url: 'https://xss.test/',
			category: 'tools',
			relationship: 'affiliate',
			disclosure: '"><img src=x onerror=alert(1)>',
			blockedCountries: ['GB'],
			unknownCountry: 'block',
			restrictedReason: '<b onclick="alert(2)">reason</b>',
			active: true,
		});
		t = await startTestHub({registry, env: {TRUST_PROXY: 'cloudflare', BRAND_NAME: 'Zoora <i>AI</i>'}});
	});
	after(() => t.close());

	const unsafe = /<script>alert|<img src=x|<b onclick|<i>AI<\/i>/;

	it('escapes registry text on the bio page', async () => {
		const html = await (await t.request('/', {headers: {'CF-IPCountry': 'DE'}})).text();
		assert.doesNotMatch(html, unsafe);
		assert.match(html, /&lt;script&gt;alert\(&quot;name&quot;\)&lt;\/script&gt;/);
		assert.match(html, /&quot;&gt;&lt;img src=x onerror=alert\(1\)&gt;/);
		assert.match(html, /Zoora &lt;i&gt;AI&lt;\/i&gt;/);
	});

	it('escapes the restricted reason on the blocked page and the disclosures page', async () => {
		const blocked = await (await t.request('/go/xss', {headers: {'CF-IPCountry': 'GB'}})).text();
		assert.doesNotMatch(blocked, unsafe);
		assert.match(blocked, /&lt;b onclick=&quot;alert\(2\)&quot;&gt;reason&lt;\/b&gt;/);
		const disclosures = await (await t.request('/disclosures', {headers: {'CF-IPCountry': 'DE'}})).text();
		assert.doesNotMatch(disclosures, unsafe);
	});

	it('does not reflect query input', async () => {
		const html = await (await t.request('/?v=%3Cscript%3Ealert(1)%3C/script%3E&s=%22%3E%3Csvg%3E')).text();
		assert.doesNotMatch(html, /<script>alert\(1\)|<svg>/);
	});
});

describe('information pages and core responses', () => {
	let t: TestHub;
	before(async () => {
		t = await startTestHub({env: {TRUST_PROXY: 'cloudflare'}});
		t.hub.router.post('/test-form', async (ctx) => {
			const form = await ctx.form();
			ctx.json(200, {name: form.get('name')});
		});
	});
	after(() => t.close());

	it('/disclosures explains every live relationship, without promoting offers blocked in the region', async () => {
		const html = await (await t.request('/disclosures', {headers: {'CF-IPCountry': 'GB'}})).text();
		assert.match(html, /Test Wallet/);
		assert.match(html, /Affiliate: we may earn a commission/);
		assert.match(html, /Test Exchange<\/h3>\n<p>Referral: [^<]+<\/p>\n<p class="disclosure">Not shown in your region\.<\/p>/);
		assert.doesNotMatch(html, /share of fees if you sign up and trade/);
		assert.doesNotMatch(html, /href="\/go\//, 'the disclosures page links to no offers');
		assert.doesNotMatch(html, /Paused Tool|Old Deal/);
		assert.match(html, /hello@hub\.test/);
	});

	it('/privacy describes what is logged and the 13-month retention', async () => {
		const html = await (await t.request('/privacy')).text();
		for (const text of [/set no cookies/, /13 months/, /We never store your IP address/, /visitor code/, /studio order form/, /Kit/]) {
			assert.match(html, text);
		}
	});

	it('/healthz reports ok as JSON', async () => {
		const res = await t.request('/healthz');
		assert.equal(res.status, 200);
		assert.deepEqual(await res.json(), {ok: true});
		assert.equal(res.headers.get('cache-control'), 'no-store');
	});

	it('serves robots.txt, the favicon and a cacheable stylesheet', async () => {
		assert.match(await (await t.request('/robots.txt')).text(), /Disallow: \/go\//);
		assert.equal((await t.request('/favicon.svg')).headers.get('content-type'), 'image/svg+xml');
		const home = await (await t.request('/')).text();
		const href = /<link rel="stylesheet" href="([^"]+)">/.exec(home)?.[1] ?? '';
		const css = await t.request(href);
		assert.equal(css.headers.get('content-type'), 'text/css; charset=utf-8');
		assert.match(css.headers.get('cache-control') ?? '', /immutable/);
		assert.match(await css.text(), /prefers-reduced-motion/);
	});

	it('answers unknown paths with a 404 page and other methods with 405', async () => {
		const missing = await t.request('/nope');
		assert.equal(missing.status, 404);
		assert.match(await missing.text(), /Page not found/);
		assert.match(missing.headers.get('content-security-policy') ?? '', /default-src 'self'/);
		const put = await t.request('/', {method: 'PUT'});
		assert.equal(put.status, 405);
		assert.equal(put.headers.get('allow'), 'GET, HEAD');
		const head = await t.request('/', {method: 'HEAD'});
		assert.equal(head.status, 200);
		assert.equal(await head.text(), '');
	});

	it('sends the security headers on every response, without HSTS on plain http', async () => {
		for (const path of ['/', '/go/wallet', '/nope', '/healthz']) {
			const res = await t.request(path);
			assert.match(res.headers.get('content-security-policy') ?? '', /form-action 'self' https:\/\/app\.kit\.com; frame-ancestors 'none'/, path);
			assert.equal(res.headers.get('x-content-type-options'), 'nosniff', path);
			assert.equal(res.headers.get('referrer-policy'), 'strict-origin-when-cross-origin', path);
			assert.equal(res.headers.get('strict-transport-security'), null, path);
		}
	});

	it('limits form bodies to 16 KB and accepts only urlencoded forms', async () => {
		const post = (body: string, type = 'application/x-www-form-urlencoded'): Promise<Response> =>
			t.request('/test-form', {method: 'POST', headers: {'content-type': type}, body});
		const ok = await post('name=Zoora');
		assert.equal(ok.status, 200);
		assert.deepEqual(await ok.json(), {name: 'Zoora'});
		assert.equal((await post(`name=${'a'.repeat(17 * 1024)}`)).status, 413);
		assert.equal((await post('{"name":"x"}', 'application/json')).status, 415);
	});
});

describe('https deployments', () => {
	let t: TestHub;
	before(async () => {
		t = await startTestHub({env: {PUBLIC_BASE_URL: 'https://go.zoora.test', FORM_ACTION_ORIGINS: 'https://zoora.test'}});
	});
	after(() => t.close());

	it('adds Strict-Transport-Security when PUBLIC_BASE_URL is https', async () => {
		assert.equal((await t.request('/')).headers.get('strict-transport-security'), 'max-age=31536000');
	});

	it('adds FORM_ACTION_ORIGINS to the CSP form-action list', async () => {
		const csp = (await t.request('/')).headers.get('content-security-policy') ?? '';
		assert.match(csp, /form-action 'self' https:\/\/app\.kit\.com https:\/\/zoora\.test;/);
	});
});
