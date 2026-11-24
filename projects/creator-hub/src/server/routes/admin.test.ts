import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {after, before, describe, it} from 'node:test';
import {hashPassword} from '../auth.ts';
import {mailtoHref} from './admin.ts';
import {startTestHub, type TestHub} from '../test-helpers.ts';

const PASSWORD = 'correct horse battery staple';
const basic = (user: string, password: string): string => `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;
const OWNER = basic('owner', PASSWORD);
const DAY = 86_400_000;

const adminEnv = async (extra: Record<string, string> = {}): Promise<Record<string, string>> => ({
	ADMIN_USER: 'owner',
	ADMIN_PASSWORD_HASH: await hashPassword(PASSWORD, 16384),
	...extra,
});

/** GET /admin as the owner; returns the CSRF cookie pair and the form token. */
const signIn = async (t: TestHub): Promise<{cookie: string; token: string; html: string}> => {
	const res = await t.request('/admin', {headers: {authorization: OWNER}});
	assert.equal(res.status, 200);
	const cookie = (res.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
	const html = await res.text();
	const token = /name="csrf" value="([0-9a-f]{64})"/.exec(html)?.[1] ?? '';
	return {cookie, token, html};
};

const insertOrder = (t: TestHub, fields: Record<string, string | number> = {}): string => {
	const id = randomUUID();
	const o = {name: 'Ada', email: 'ada@client.test', message: 'We need a 60s explainer.', status: 'new', ...fields};
	t.hub.db
		.prepare(
			`INSERT INTO orders (id, ts, name, email, company, project_url, package_id, budget, deadline, message, consent, status, visitor_hash)
			 VALUES (?, ?, ?, ?, 'Client Ltd', 'https://client.test', 'explainer-60', 'placeholder', NULL, ?, 1, ?, 'h')`,
		)
		.run(id, Date.now(), o.name, o.email, o.message, o.status);
	return id;
};

describe('admin authentication', () => {
	let t: TestHub;
	before(async () => {
		t = await startTestHub({env: await adminEnv()});
	});
	after(() => t.close());

	it('asks for Basic credentials', async () => {
		const res = await t.request('/admin');
		assert.equal(res.status, 401);
		assert.match(res.headers.get('www-authenticate') ?? '', /^Basic realm=/);
		assert.equal(res.headers.get('cache-control'), 'no-store');
	});

	it('rejects a wrong password or user', async () => {
		assert.equal((await t.request('/admin', {headers: {authorization: basic('owner', 'wrong password!')}})).status, 401);
		assert.equal((await t.request('/admin', {headers: {authorization: basic('admin', PASSWORD)}})).status, 401);
	});

	it('admits the owner and sets an HttpOnly SameSite=Strict CSRF cookie', async () => {
		const res = await t.request('/admin', {headers: {authorization: OWNER}});
		assert.equal(res.status, 200);
		const cookie = res.headers.get('set-cookie') ?? '';
		assert.match(cookie, /^hub_csrf=[0-9a-f]{64}; Path=\/; HttpOnly; SameSite=Strict$/);
		assert.match(await res.text(), /<h1>Admin<\/h1>/);
		assert.equal(res.headers.get('x-robots-tag'), 'noindex, nofollow');
	});

	it('protects every admin path, including exports', async () => {
		for (const path of ['/admin/links', '/admin/export/clicks.csv', '/admin/export/orders.csv', '/admin/export/video-clicks.csv']) {
			assert.equal((await t.request(path)).status, 401, path);
		}
	});
});

describe('admin sign-in rate limit', () => {
	let t: TestHub;
	before(async () => {
		t = await startTestHub({env: await adminEnv()});
	});
	after(() => t.close());

	it('locks out a client after 10 failures, even with the right password', async () => {
		for (let i = 0; i < 10; i++) {
			assert.equal((await t.request('/admin', {headers: {authorization: basic('owner', `guess-${i}-xxxxxxx`)}})).status, 401);
		}
		const locked = await t.request('/admin', {headers: {authorization: OWNER}});
		assert.equal(locked.status, 429);
		assert.ok(Number(locked.headers.get('retry-after')) > 0);
	});
});

describe('admin sign-in under concurrent guessing', () => {
	it('checks at most 10 passwords when 50 wrong guesses arrive at once, and still locks the client out', async () => {
		const t = await startTestHub({env: await adminEnv()});
		try {
			const guesses = await Promise.all(
				Array.from({length: 50}, (_, i) => t.request('/admin', {headers: {authorization: basic('owner', `parallel-guess-${i}`)}})),
			);
			const statuses = guesses.map((r) => r.status);
			assert.ok(statuses.every((s) => s === 401 || s === 429), String(statuses));
			assert.ok(statuses.filter((s) => s === 401).length <= 10, `${statuses.filter((s) => s === 401).length} passwords were checked`);
			// keep guessing one at a time until the client's 10 failures are used up
			for (let i = 0; i < 10; i++) await t.request('/admin', {headers: {authorization: basic('owner', `serial-guess-${i}`)}});
			assert.equal((await t.request('/admin', {headers: {authorization: OWNER}})).status, 429);
		} finally {
			await t.close();
		}
	});

	it('gives the failure token back after a right password, and skips scrypt for a header it already checked', async () => {
		const t = await startTestHub({env: await adminEnv()});
		try {
			for (let i = 0; i < 9; i++) assert.equal((await t.request('/admin', {headers: {authorization: basic('owner', `typo-${i}`)}})).status, 401);
			assert.equal((await t.request('/admin', {headers: {authorization: OWNER}})).status, 200);
			// the owner's success did not use up the last token
			assert.equal((await t.request('/admin', {headers: {authorization: basic('owner', 'typo-9')}})).status, 401);
			// parallel requests with the already-checked header are not held up by the password-check limit
			const parallel = await Promise.all(Array.from({length: 6}, () => t.request('/admin/links', {headers: {authorization: OWNER}})));
			assert.deepEqual(parallel.map((r) => r.status), [200, 200, 200, 200, 200, 200]);
		} finally {
			await t.close();
		}
	});

	it('locks admin for everyone after 50 failures from many clients, and logs it once', async () => {
		const t = await startTestHub({env: await adminEnv({TRUST_PROXY: 'header', IP_HEADER: 'X-Test-Client'})});
		const warnings: string[] = [];
		const warn = console.warn;
		console.warn = (...args: unknown[]) => void warnings.push(args.join(' '));
		try {
			for (let client = 0; client < 6; client++) {
				for (let i = 0; i < 10; i++) {
					await t.request('/admin', {headers: {authorization: basic('owner', `spray-${client}-${i}`), 'x-test-client': `198.51.100.${client + 1}`}});
				}
			}
			const owner = await t.request('/admin', {headers: {authorization: OWNER, 'x-test-client': '203.0.113.9'}});
			assert.equal(owner.status, 429);
			assert.match(await owner.text(), /Sign-in is locked/);
			assert.equal(warnings.filter((w) => /admin sign-in locked/.test(w)).length, 1);
		} finally {
			console.warn = warn;
			await t.close();
		}
	});
});

describe('admin pages', () => {
	let t: TestHub;
	before(async () => {
		t = await startTestHub({env: await adminEnv()});
	});
	after(() => t.close());

	it('is switched off without credentials configured', async () => {
		const off = await startTestHub();
		try {
			assert.equal((await off.request('/admin', {headers: {authorization: OWNER}})).status, 503);
		} finally {
			await off.close();
		}
	});

	it('counts human redirects once per visitor, offer and day, by offer, video and source', async () => {
		const now = Date.now();
		const add = t.hub.db.prepare(
			'INSERT INTO clicks (ts, offer_id, video_id, source, country, visitor_hash, is_bot, outcome) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
		);
		add.run(now - 3000, 'wallet', 'vid-a', 'yt', 'DE', 'visitor1', 0, 'redirected'); // first of the day: counts for vid-a
		add.run(now - 2000, 'wallet', 'vid-b', 'tiktok', 'DE', 'visitor1', 0, 'redirected'); // same visitor, offer, day: ignored
		add.run(now - 1000, 'wallet', 'vid-b', 'tiktok', 'FR', 'visitor2', 0, 'redirected');
		add.run(now - 1000, 'wallet', 'vid-b', 'tiktok', null, 'bot1', 1, 'redirected'); // bot: ignored
		add.run(now - 1000, 'exchange', 'vid-b', 'yt', 'GB', 'visitor3', 0, 'blocked_region'); // not a redirect
		add.run(now - 20 * DAY, 'wallet', 'vid-old', 'email', 'DE', 'visitor4', 0, 'redirected'); // 30-day window only
		const html = await (await t.request('/admin', {headers: {authorization: OWNER}})).text();
		const row = (key: string, d7: number, d30: number): RegExp => new RegExp(`<tr><td>${key}</td><td class="num">${d7}</td><td class="num">${d30}</td></tr>`);
		assert.match(html, row('wallet', 2, 3));
		assert.match(html, row('vid-a', 1, 1));
		assert.match(html, row('vid-b', 1, 1));
		assert.match(html, row('vid-old', 0, 1));
		assert.match(html, row('yt', 1, 1));
		assert.match(html, row('tiktok', 1, 1));
		assert.match(html, row('email', 0, 1));
		assert.doesNotMatch(html, row('exchange', 0, 1));
		assert.match(html, /<tr><td>exchange<\/td><td>GB<\/td><td class="num">1<\/td><\/tr>/, 'blocked clicks are listed separately');
		assert.match(html, /Bot requests: 1\./);
	});

	it('escapes order data', async () => {
		insertOrder(t, {name: '<script>alert(1)</script>', message: '<img src=x onerror=alert(2)>'});
		const html = await (await t.request('/admin', {headers: {authorization: OWNER}})).text();
		assert.doesNotMatch(html, /<script>alert|<img src=x/);
		assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
	});

	it('percent-encodes reply links, so an address cannot add cc, bcc or body fields', async () => {
		assert.equal(mailtoHref('ada@client.test'), 'mailto:ada@client.test');
		assert.equal(mailtoHref('x?cc=attacker@evil.example'), 'mailto:x%3Fcc%3Dattacker@evil.example');
		insertOrder(t, {email: 'sales%40real-client.com?bcc=spy%40evil.example&x=@evil.example'});
		const html = await (await t.request('/admin', {headers: {authorization: OWNER}})).text();
		assert.match(html, /href="mailto:sales%2540real-client\.com%3Fbcc%3Dspy%2540evil\.example%26x%3D@evil\.example"/);
		assert.doesNotMatch(html, /href="mailto:[^"]*[?&]bcc=/);
	});

	it('builds tracked links with each disclosure next to its link, and never names a restricted offer in them', async () => {
		const html = await (await t.request('/admin/links?v=dQw4w9WgXcQ&s=x', {headers: {authorization: OWNER}})).text();
		const text = /<textarea id="out" readonly>([\s\S]*?)<\/textarea>/.exec(html)?.[1] ?? '';
		assert.match(text, /^Disclosure: some links for this video are affiliate or referral links\. If you use them, I may earn money\./);
		assert.match(text, /Test Wallet: http:\/\/hub\.test\/go\/wallet\?v=dQw4w9WgXcQ&amp;s=x\nAffiliate link: I may earn a commission if you buy\./);
		// the exchange (blocked in US and GB) and the EU-only course are visible only through the region-filtered page
		assert.doesNotMatch(text, /Test Exchange|\/go\/exchange|EU Course|\/go\/eu-course|sign up and trade/);
		assert.match(text, /More partner links, only where they are available in your country: http:\/\/hub\.test\/\?v=dQw4w9WgXcQ&amp;s=x\nSome of them are affiliate or referral links/);
		assert.match(html, /Hub page only: do not name these/);
		assert.match(html, /<li>Test Exchange <span class="muted small">\(blocked in US GB; hidden when the country is unknown\)<\/span><\/li>/);
		assert.doesNotMatch(html, /Paused Tool: http/);
		assert.match(html, /<td>old-deal<\/td><td>Old Deal<\/td><td>expired<\/td>/);
		const invalid = await (await t.request('/admin/links?v=%3Cx%3E', {headers: {authorization: OWNER}})).text();
		assert.match(invalid, /That video ID is not valid/);
		assert.doesNotMatch(invalid, /<x>/);
	});
});

describe('order status changes (CSRF)', () => {
	let t: TestHub;
	before(async () => {
		t = await startTestHub({env: await adminEnv()});
	});
	after(() => t.close());

	const post = (id: string, body: Record<string, string>, headers: Record<string, string>): Promise<Response> =>
		t.request(`/admin/orders/${id}/status`, {
			method: 'POST',
			headers: {authorization: OWNER, 'content-type': 'application/x-www-form-urlencoded', ...headers},
			body: new URLSearchParams(body).toString(),
		});
	const status = (id: string): unknown => t.hub.db.prepare('SELECT status FROM orders WHERE id = ?').get(id)?.status;

	it('changes the status with a valid token and cookie, then redirects back', async () => {
		const id = insertOrder(t);
		const {cookie, token} = await signIn(t);
		const res = await post(id, {csrf: token, status: 'won'}, {cookie});
		assert.equal(res.status, 303);
		assert.equal(res.headers.get('location'), '/admin#orders');
		assert.equal(status(id), 'won');
	});

	it('rejects missing, mismatched or forged tokens and cross-site posts', async () => {
		const id = insertOrder(t);
		const {cookie, token} = await signIn(t);
		const other = await signIn(t);
		const cases: [string, Record<string, string>, Record<string, string>][] = [
			['no token', {status: 'spam'}, {cookie}],
			['no cookie', {csrf: token, status: 'spam'}, {}],
			['token for another cookie', {csrf: other.token, status: 'spam'}, {cookie}],
			['forged token', {csrf: 'f'.repeat(64), status: 'spam'}, {cookie}],
			['cross-origin', {csrf: token, status: 'spam'}, {cookie, origin: 'https://evil.test'}],
			['cross-site fetch', {csrf: token, status: 'spam'}, {cookie, 'sec-fetch-site': 'cross-site'}],
		];
		for (const [label, body, headers] of cases) {
			assert.equal((await post(id, body, headers)).status, 403, label);
		}
		assert.equal(status(id), 'new');
	});

	it('requires authentication and validates the status and order id', async () => {
		const id = insertOrder(t);
		const {cookie, token} = await signIn(t);
		const anonymous = await t.request(`/admin/orders/${id}/status`, {
			method: 'POST',
			headers: {cookie, 'content-type': 'application/x-www-form-urlencoded'},
			body: `csrf=${token}&status=won`,
		});
		assert.equal(anonymous.status, 401);
		assert.equal((await post(id, {csrf: token, status: 'hacked'}, {cookie})).status, 400);
		assert.equal((await post(randomUUID(), {csrf: token, status: 'won'}, {cookie})).status, 404);
		assert.equal((await post('not-a-uuid', {csrf: token, status: 'won'}, {cookie})).status, 404);
		assert.equal(status(id), 'new');
	});

	it('uses a __Host- Secure cookie on https deployments', async () => {
		const https = await startTestHub({env: await adminEnv({PUBLIC_BASE_URL: 'https://go.zoora.test'})});
		try {
			const res = await https.request('/admin', {headers: {authorization: OWNER}});
			assert.match(res.headers.get('set-cookie') ?? '', /^__Host-hub_csrf=[0-9a-f]{64}; Path=\/; HttpOnly; SameSite=Strict; Secure$/);
		} finally {
			await https.close();
		}
	});
});

describe('CSV exports', () => {
	let t: TestHub;
	before(async () => {
		t = await startTestHub({env: await adminEnv()});
		const add = t.hub.db.prepare(
			'INSERT INTO clicks (ts, offer_id, video_id, source, country, visitor_hash, is_bot, outcome, referrer_host) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
		);
		const now = Date.now();
		add.run(now - 5000, 'wallet', 'vid-a', 'yt', 'DE', 'v1', 0, 'redirected', '=HYPERLINK("http://evil.test")');
		add.run(now - 4000, 'wallet', 'vid-a', 'yt', 'DE', 'v1', 0, 'redirected', null);
		add.run(now - 3000, 'wallet', 'vid-a', 'shorts', 'DE', 'v2', 0, 'redirected', null);
		add.run(now - 3000, 'wallet', 'vid-a', 'shorts', 'DE', 'bot', 1, 'redirected', null);
		add.run(now - 40 * DAY, 'wallet', 'vid-old', 'yt', 'DE', 'v3', 0, 'redirected', null);
		insertOrder(t, {name: 'Bob "the client"', message: '+cmd|calc'});
	});
	after(() => t.close());

	const csv = async (path: string): Promise<{res: Response; lines: string[]}> => {
		const res = await t.request(path, {headers: {authorization: OWNER}});
		return {res, lines: (await res.text()).trimEnd().split('\r\n')};
	};

	it('exports the click log with a header row and formula-safe cells', async () => {
		const {res, lines} = await csv('/admin/export/clicks.csv');
		assert.equal(res.status, 200);
		assert.equal(res.headers.get('content-type'), 'text/csv; charset=utf-8');
		assert.match(res.headers.get('content-disposition') ?? '', /^attachment; filename="clicks-\d{4}-\d{2}-\d{2}\.csv"$/);
		assert.equal(lines[0], '"ts","time_utc","offer_id","video_id","source","country","visitor_hash","is_bot","outcome","referrer_host"');
		assert.equal(lines.length, 6);
		assert.ok(lines.some((l) => l.endsWith(`,"'=HYPERLINK(""http://evil.test"")"`)), 'formula neutralised and quotes doubled');
		assert.equal((await csv('/admin/export/clicks.csv?days=7')).lines.length, 5);
		assert.equal((await t.request('/admin/export/clicks.csv?days=abc', {headers: {authorization: OWNER}})).status, 400);
	});

	it('exports de-duplicated human clicks per video, offer and source', async () => {
		const {lines} = await csv('/admin/export/video-clicks.csv?days=30');
		assert.deepEqual(lines, ['"video_id","offer_id","source","hub_clicks"', '"vid-a","wallet","shorts",1', '"vid-a","wallet","yt",1']);
	});

	it('exports orders', async () => {
		const {lines} = await csv('/admin/export/orders.csv');
		assert.equal(lines[0], '"id","time_utc","name","email","company","project_url","package_id","budget","deadline","message","consent","status"');
		assert.match(lines[1] ?? '', /"Bob ""the client""","bob@client\.test"|"Bob ""the client""","ada@client\.test"/);
		assert.match(lines[1] ?? '', /"'\+cmd\|calc",1,"new"$/);
	});
});
