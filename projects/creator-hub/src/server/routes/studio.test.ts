/**
 * Route tests for /studio through the Ctx/Router contract, against the shared schema in an
 * in-memory SQLite database. No network: webhooks go to a stub or a 127.0.0.1 listener.
 */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createServer, type IncomingMessage, type ServerResponse} from 'node:http';
import type {AddressInfo} from 'node:net';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import type {Ctx, Handler, HubConfig, Router} from '../http.ts';
import {STUDIO_CSS, STUDIO_CSS_HREF} from '../studio/styles.ts';
import {registerStudio, STUDIO_RATE_LIMIT, type StudioDeps} from './studio.ts';

const SCHEMA = readFileSync(new URL('../../db/schema.sql', import.meta.url), 'utf8');
const example = (): Record<string, any> =>
	JSON.parse(readFileSync(new URL('../../../config/studio.example.json', import.meta.url), 'utf8')) as Record<string, any>;
const NOW = Date.UTC(2026, 10, 24, 12);

const VALID: Record<string, string> = {
	name: 'Ada Lovelace',
	email: 'ada@example.com',
	company: 'Analytical Engines',
	project_url: 'https://example.com',
	package: 'explainer-60-90',
	budget: '$1,000 to $2,500',
	deadline: '2027-01-15',
	message: 'A 60 second explainer about spotting fake support accounts.',
	consent: 'yes',
};

type Reply = {status: number; body: string; location: string; headers: Record<string, string>};
type CtxOverrides = Partial<Pick<Ctx, 'isBot' | 'visitorHash' | 'country'>>;
/** The part of ServerResponse the studio routes touch directly. */
type FakeResponse = {statusCode: number; setHeader(name: string, value: string | number): void; end(body?: string): void};

const makeApp = (deps: Partial<StudioDeps> = {}, studio: unknown = example()) => {
	const routes = new Map<string, Handler>();
	const router: Router = {
		get: (path, handler) => void routes.set(`GET ${path}`, handler),
		post: (path, handler) => void routes.set(`POST ${path}`, handler),
	};
	const logs: string[] = [];
	const events: string[] = [];
	registerStudio(router, {now: () => NOW, env: {}, log: (line) => logs.push(line), ...deps});
	const db = new DatabaseSync(':memory:');
	db.exec(SCHEMA);
	const config: HubConfig = {
		publicBaseUrl: 'https://go.example.test/',
		brandName: 'Zoora AI',
		offers: {version: 1, offers: []},
		studio,
		kitFormAction: 'https://app.kit.com/forms/1/subscriptions',
		contactEmail: 'studio@example.test',
		adminUser: 'admin',
		adminPasswordHash: 'scrypt$unused',
		hashSecret: 'test-secret',
	};

	const call = async (method: 'GET' | 'POST', path: string, body?: Record<string, string>, extra: CtxOverrides = {}): Promise<Reply> => {
		const url = new URL(path, 'https://go.example.test');
		const handler = routes.get(`${method} ${url.pathname}`);
		assert.ok(handler, `no route for ${method} ${url.pathname}`);
		const reply: Reply = {status: 0, body: '', location: '', headers: {}};
		const res: FakeResponse = {
			statusCode: 200,
			setHeader: (name, value) => {
				reply.headers[name.toLowerCase()] = String(value);
			},
			end: (body) => {
				reply.status = res.statusCode;
				reply.body = body ?? '';
			},
		};
		const ctx: Ctx = {
			req: {method, headers: {}} as IncomingMessage,
			res: res as unknown as ServerResponse,
			url,
			params: {},
			country: 'DE',
			visitorHash: 'visitor-1',
			isBot: false,
			db,
			config,
			form: async () => new URLSearchParams(body ?? {}),
			html: (status, html) => {
				reply.status = status;
				reply.body = html;
				events.push(`html ${status}`);
			},
			json: (status, value) => {
				reply.status = status;
				reply.body = JSON.stringify(value);
			},
			redirect: (status, location) => {
				reply.status = status;
				reply.location = location;
				events.push(`redirect ${status}`);
			},
			...extra,
		};
		await handler(ctx);
		return reply;
	};
	const orders = () => db.prepare('SELECT * FROM orders ORDER BY ts').all();
	const views = () => db.prepare('SELECT * FROM page_events').all();
	return {call, db, logs, events, orders, views};
};

const TERMS = [
	'We do not guarantee views, subscribers, sales or revenue.',
	'You are responsible for the claims you ask us to make about your product, for any regulatory approvals it needs, and for the disclosures required on the platforms where you publish the video.',
	'We do not make videos that promise investment returns, predict prices or promote unlicensed financial products.',
	'We decline crypto financial promotions that will be visible in regions where they are restricted (a public YouTube or social video counts), unless you show us the required approval.',
	'Paid client videos are never posted on our channels without a clear disclosure that they are paid.',
	'We never publish crypto financial promotions for clients on our own channels.',
];

test('GET /studio renders the offer page with every section, binding terms and an accessible form', async () => {
	const app = makeApp();
	const page = await app.call('GET', '/studio');
	assert.equal(page.status, 200);
	const html = page.body;
	assert.match(html, /^<!doctype html>\n<html lang="en">/);
	assert.match(html, /<h1 id="hero-title">/);
	for (const heading of ['What you get', 'How it works', 'Packages', 'Questions', 'Terms in plain language', 'Request a quote']) {
		assert.ok(html.includes(`>${heading}</h2>`), `missing section "${heading}"`);
	}
	for (const feature of ['Code-drawn 2D animation', 'Original characters', 'Research-backed scripts', 'Captions', 'Shorts cuts']) {
		assert.ok(html.includes(`<h3>${feature}</h3>`), feature);
	}
	const steps = ['Brief', 'Script', 'Storyboard', 'Animation', 'Revisions', 'Delivery'].map((s) => html.indexOf(`<li><h3>${s}</h3>`));
	assert.ok(steps.every((pos, i) => pos > 0 && (i === 0 || pos > (steps[i - 1] ?? 0))), 'process steps in order');
	for (const name of ['Explainer 60–90 s', 'Explainer 3–5 min', 'Shorts pack (3)']) assert.ok(html.includes(name), name);
	assert.equal(html.match(/<dd>Contact for a quote<\/dd>/g)?.length, 3, 'no invented prices');
	assert.ok(!/<dd>\$/.test(html));
	for (const term of TERMS) assert.ok(html.includes(term), `missing term: ${term}`);
	assert.ok(!html.includes('id="work"'), 'empty portfolio hides the section');
	assert.ok(!html.includes('Pay online with Stripe'), 'no pay button without a configured link');
	// Every visible control has a label; required/optional is stated in text.
	for (const id of ['name', 'email', 'company', 'projectUrl', 'packageId', 'budget', 'deadline', 'message', 'consent']) {
		assert.ok(html.includes(`id="f-${id}"`), `control f-${id}`);
		assert.ok(html.includes(`<label for="f-${id}">`), `label for f-${id}`);
	}
	assert.match(html, /<input type="checkbox" id="f-consent" name="consent" value="yes" required>/);
	assert.match(html, /<div class="hp" aria-hidden="true">[\s\S]*name="studio_hp" value="" tabindex="-1" autocomplete="off"/);
	assert.match(html, /<input type="date" id="f-deadline"[^>]*min="2026-11-24"/);
	assert.match(html, /<link rel="canonical" href="https:\/\/go\.example\.test\/studio">/);
	assert.ok(html.includes(`<link rel="stylesheet" href="${STUDIO_CSS_HREF}">`));
	// The core CSP is default-src 'self': no inline styles or scripts, nothing loaded from elsewhere.
	assert.ok(!/<script|<style|\sstyle=|\ssrc=/i.test(html), 'no JS, inline CSS or embedded resources');
	for (const [, href] of html.matchAll(/<link rel="(?:stylesheet|icon)" href="([^"]+)"/g)) assert.ok(href?.startsWith('/'), href);
	assert.ok(html.includes('We will never ask for your seed phrase, private keys or wallet access.'));
});

test('GET /studio/style.css serves the stylesheet as a cacheable same-origin file', async () => {
	const css = await makeApp().call('GET', STUDIO_CSS_HREF);
	assert.equal(css.status, 200);
	assert.equal(css.body, STUDIO_CSS);
	assert.equal(css.headers['content-type'], 'text/css; charset=utf-8');
	assert.equal(css.headers['cache-control'], 'public, max-age=31536000, immutable');
	assert.equal(css.headers['content-length'], String(Buffer.byteLength(STUDIO_CSS)));
	assert.match(STUDIO_CSS, /prefers-reduced-motion:reduce/);
	assert.match(STUDIO_CSS, /--bg:#0B0C0F;[^}]*--text:#F4F6F8;[^}]*--accent:#29B8AD/);
	assert.match(STUDIO_CSS_HREF, /^\/studio\/style\.css\?v=[0-9a-f]{10}$/);
});

test('GET /studio records a page view with a validated source and video id', async () => {
	const app = makeApp();
	await app.call('GET', '/studio?s=shorts&v=dQw4w9WgXcQ');
	await app.call('GET', '/studio?s=evil&v=%3Cscript%3E', undefined, {isBot: true, country: null});
	await app.call('GET', '/studio?package=shorts-pack-3'); // internal "Request this package" link: not a new view
	const views = app.views();
	assert.equal(views.length, 2);
	assert.deepEqual(
		{...views[0]},
		{id: 1, ts: NOW, page: 'studio', source: 'shorts', video_id: 'dQw4w9WgXcQ', country: 'DE', visitor_hash: 'visitor-1', is_bot: 0},
	);
	assert.equal(views[1]?.source, null);
	assert.equal(views[1]?.video_id, null);
	assert.equal(views[1]?.is_bot, 1);
});

test('?package= preselects a real package and ignores anything else', async () => {
	const app = makeApp();
	const page = await app.call('GET', '/studio?package=shorts-pack-3');
	assert.match(page.body, /<option value="shorts-pack-3" selected>/);
	const bogus = await app.call('GET', '/studio?package=%22%3E%3Cscript%3E');
	assert.ok(!bogus.body.includes(' selected>Shorts'));
	assert.match(bogus.body, /<option value="" selected>Choose a package<\/option>/);
});

test('decided prices, a portfolio and Stripe links appear only when configured', async () => {
	const studio = example();
	studio.packages[0].priceUsd = 1500;
	studio.packages[0].turnaroundDays = 10;
	studio.packages[0].revisions = 2;
	studio.portfolio = [{title: 'Spot the fake support account', url: 'https://www.youtube.com/watch?v=abc', client: 'Own channel'}];
	studio.stripePaymentLinks = {'explainer-60-90': 'https://buy.stripe.com/test_abc'};
	const html = (await makeApp({}, studio).call('GET', '/studio')).body;
	assert.ok(html.includes('<dd>$1,500 USD</dd>'));
	assert.ok(html.includes('<dd>10 days from an approved brief</dd>'));
	assert.ok(html.includes('<dd>2 rounds included</dd>'));
	assert.ok(html.includes('Prices are in US dollars.'));
	assert.ok(html.includes('id="work"'));
	assert.ok(html.includes('<a href="https://www.youtube.com/watch?v=abc">Spot the fake support account</a>'));
	assert.equal(html.match(/Pay online with Stripe/g)?.length, 1, 'one button, for the one package with a link');
	assert.ok(html.includes('href="https://buy.stripe.com/test_abc"'));
});

test('config text is escaped on the page', async () => {
	const studio = example();
	studio.packages[0].name = '<img src=x onerror=alert(1)>';
	studio.faq[0].q = '<script>alert("faq")</script>';
	studio.budgetRanges[0] = '"><b>budget</b>';
	const html = (await makeApp({}, studio).call('GET', '/studio')).body;
	assert.ok(!html.includes('<img src=x'));
	assert.ok(!html.includes('<script>'));
	assert.ok(!html.includes('"><b>budget'));
	assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
	assert.ok(html.includes('&lt;script&gt;alert(&quot;faq&quot;)&lt;/script&gt;'));
	assert.ok(html.includes('<option value="&quot;&gt;&lt;b&gt;budget&lt;/b&gt;">'));
});

test('POST /studio stores a valid order with prepared statements and redirects to /studio/thanks', async () => {
	const app = makeApp();
	const reply = await app.call('POST', '/studio', VALID);
	assert.equal(reply.status, 303);
	assert.equal(reply.location, '/studio/thanks');
	assert.equal(reply.headers['cache-control'], 'no-store');
	const rows = app.orders();
	assert.equal(rows.length, 1);
	const row = {...rows[0]};
	assert.match(String(row.id), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
	delete row.id;
	assert.deepEqual(row, {
		ts: NOW,
		name: 'Ada Lovelace',
		email: 'ada@example.com',
		company: 'Analytical Engines',
		project_url: 'https://example.com/',
		package_id: 'explainer-60-90',
		budget: '$1,000 to $2,500',
		deadline: '2027-01-15',
		message: 'A 60 second explainer about spotting fake support accounts.',
		consent: 1,
		status: 'new',
		visitor_hash: 'visitor-1',
	});
	assert.ok(app.logs.some((l) => l.includes('stored (package explainer-60-90, status new)')));
	assert.ok(app.logs.every((l) => !l.includes('ada@example.com') && !l.includes('Ada Lovelace')), 'no personal data in logs');
});

test('SQL metacharacters are stored as plain text', async () => {
	const app = makeApp();
	const name = "Robert'); DROP TABLE orders;--";
	await app.call('POST', '/studio', {...VALID, name, company: '" OR 1=1 --'});
	assert.equal(app.orders()[0]?.name, name);
	assert.equal(app.orders()[0]?.company, '" OR 1=1 --');
});

test('honeypot hits get the normal redirect and are dropped quietly', async () => {
	const app = makeApp();
	const reply = await app.call('POST', '/studio', {...VALID, studio_hp: 'https://spam.example'});
	assert.equal(reply.status, 303);
	assert.equal(reply.location, '/studio/thanks');
	assert.equal(app.orders().length, 0);
	assert.ok(app.logs.some((l) => l.includes('honeypot')));
});

test('invalid posts re-show the form with errors and escaped values, and store nothing', async () => {
	const app = makeApp();
	const attack = '<script>alert(1)</script>';
	const reply = await app.call('POST', '/studio', {
		...VALID,
		name: `"><img src=x onerror=alert(1)>`,
		email: 'not-an-email',
		message: `${attack} and more text here`,
		consent: '',
	});
	assert.equal(reply.status, 400);
	assert.equal(app.orders().length, 0);
	const html = reply.body;
	assert.match(html, /<title>Error: Request a quote \| Zoora AI Studio<\/title>/);
	assert.match(html, /<meta name="robots" content="noindex">/);
	assert.match(html, /<div class="error-summary" role="alert"[^>]*autofocus>/);
	assert.ok(html.includes('<a href="#f-email">Enter an email address in the right format, like name@example.com</a>'));
	assert.ok(html.includes('<a href="#f-consent">Tick the box to agree to be contacted and to the studio terms</a>'));
	assert.match(html, /id="f-email" name="email" aria-describedby="f-email-hint f-email-error" aria-invalid="true"/);
	assert.ok(!html.includes('<script>alert'), 'message is escaped');
	assert.ok(!html.includes('<img src=x'), 'name is escaped');
	assert.ok(html.includes('value="&quot;&gt;&lt;img src=x onerror=alert(1)&gt;"'), 'value kept, escaped');
	assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt; and more text here</textarea>'));
	assert.ok(html.includes('value="not-an-email"'), 'the bad email is shown for correction');
	assert.ok(TERMS.every((t) => html.includes(t)), 'terms stay on the page next to the consent box');
});

test('rate limit: too many posts from one client get 429 with Retry-After; others are unaffected', async () => {
	const app = makeApp();
	for (let i = 0; i < STUDIO_RATE_LIMIT.capacity; i++) {
		assert.equal((await app.call('POST', '/studio', {...VALID, email: 'bad'})).status, 400);
	}
	const limited = await app.call('POST', '/studio', VALID);
	assert.equal(limited.status, 429);
	assert.equal(limited.headers['retry-after'], '150', 'one token refills every 150 s');
	assert.ok(limited.body.includes('Too many attempts'));
	assert.ok(limited.body.includes('value="Ada Lovelace"'), 'typed values are kept');
	assert.equal(app.orders().length, 0);
	assert.equal((await app.call('POST', '/studio', VALID, {visitorHash: 'visitor-2'})).status, 303);
	assert.equal(app.orders().length, 1);
});

test('a double submit is stored once', async () => {
	const app = makeApp();
	assert.equal((await app.call('POST', '/studio', VALID)).status, 303);
	assert.equal((await app.call('POST', '/studio', VALID)).status, 303);
	assert.equal(app.orders().length, 1);
	assert.ok(app.logs.some((l) => /repeat of order .+ not stored again/.test(l)));
});

test('self-declared bots are kept as spam for review and trigger no notification', async () => {
	let calls = 0;
	const app = makeApp({
		env: {NOTIFY_WEBHOOK_URL: 'https://hooks.example.test/x'},
		fetch: async () => {
			calls++;
			return new Response(null, {status: 204});
		},
	});
	assert.equal((await app.call('POST', '/studio', VALID, {isBot: true})).status, 303);
	assert.equal(app.orders()[0]?.status, 'spam');
	assert.equal(calls, 0);
});

test('notification: stored first, redirect sent before the webhook call, payload has no personal data', async () => {
	const sent: {url: string; body: string}[] = [];
	let app: ReturnType<typeof makeApp> | undefined;
	app = makeApp({
		env: {NOTIFY_WEBHOOK_URL: 'https://hooks.example.test/T000/B000/secret'},
		fetch: async (input, init) => {
			assert.equal(app?.orders().length, 1, 'the order is stored before the webhook is called');
			app?.events.push('webhook');
			sent.push({url: String(input), body: String(init?.body)});
			return new Response(null, {status: 200});
		},
	});
	await app.call('POST', '/studio', VALID);
	assert.deepEqual(app.events, ['redirect 303', 'webhook']);
	assert.equal(sent.length, 1);
	assert.equal(sent[0]?.url, 'https://hooks.example.test/T000/B000/secret');
	const payload = JSON.parse(sent[0]?.body ?? '{}') as Record<string, string>;
	assert.deepEqual(Object.keys(payload).sort(), ['id', 'packageId', 'text', 'ts']);
	assert.equal(payload.id, app.orders()[0]?.id);
	assert.equal(payload.packageId, 'explainer-60-90');
	assert.equal(payload.ts, '2026-11-24T12:00:00.000Z');
	for (const secret of ['Ada', 'ada@example.com', 'Analytical', 'fake support', 'example.com/']) {
		assert.ok(!sent[0]?.body.includes(secret), `payload leaks "${secret}"`);
	}
});

test('a hanging or failing webhook never loses the order', async () => {
	let mode: 'hang' | 'fail' = 'hang';
	const server = createServer((_req, res) => {
		if (mode === 'fail') res.writeHead(500).end();
	});
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
	const {port} = server.address() as AddressInfo;
	try {
		const app = makeApp({env: {NOTIFY_WEBHOOK_URL: `http://127.0.0.1:${port}/hook`}, notifyTimeoutMs: 150});
		const started = Date.now();
		const reply = await app.call('POST', '/studio', VALID);
		assert.equal(reply.status, 303);
		assert.ok(Date.now() - started < 2000);
		assert.equal(app.orders().length, 1);
		assert.ok(app.logs.some((l) => /notification failed \(timed out\); the order is stored/.test(l)));

		mode = 'fail';
		assert.equal((await app.call('POST', '/studio', {...VALID, message: 'A different request, also long enough.'})).status, 303);
		assert.equal(app.orders().length, 2);
		assert.ok(app.logs.some((l) => l.includes('answered HTTP 500')));
	} finally {
		server.closeAllConnections();
		await new Promise<void>((resolve) => server.close(() => resolve()));
	}
});

test('a database failure re-shows the form with the typed values instead of losing them', async () => {
	let calls = 0;
	const app = makeApp({
		env: {NOTIFY_WEBHOOK_URL: 'https://hooks.example.test/x'},
		fetch: async () => {
			calls++;
			return new Response(null, {status: 204});
		},
	});
	app.db.exec('DROP TABLE orders');
	const reply = await app.call('POST', '/studio', VALID);
	assert.equal(reply.status, 500);
	assert.equal(reply.location, '');
	assert.ok(reply.body.includes('We could not save your request just now'));
	assert.ok(reply.body.includes('studio@example.test'));
	assert.ok(reply.body.includes('A 60 second explainer about spotting fake support accounts.</textarea>'));
	assert.equal(calls, 0, 'no notification for an order that was not stored');
	assert.ok(app.logs.some((l) => l.startsWith('[studio] could not store an order')));
});

test('GET /studio/thanks confirms the request and is not indexed', async () => {
	const reply = await makeApp().call('GET', '/studio/thanks');
	assert.equal(reply.status, 200);
	assert.match(reply.body, /<h1 id="thanks-title">Thanks, your request is in<\/h1>/);
	assert.match(reply.body, /<meta name="robots" content="noindex">/);
	assert.ok(reply.body.includes('<a href="mailto:studio@example.test">studio@example.test</a>'));
});

test('a missing or invalid studio config disables the page with 503 and one log line', async () => {
	const broken = example();
	broken.packages[0].priceUsd = -1;
	const app = makeApp({}, broken);
	assert.equal((await app.call('GET', '/studio')).status, 503);
	assert.equal((await app.call('GET', '/studio')).status, 503);
	assert.equal((await app.call('POST', '/studio', VALID)).status, 503);
	assert.equal(app.orders().length, 0);
	assert.equal(app.logs.filter((l) => l.includes('invalid studio config')).length, 1);
	assert.match(app.logs[0] ?? '', /packages\[0\]\.priceUsd/);

	const missing = makeApp({}, null);
	assert.equal((await missing.call('GET', '/studio')).status, 503);
	assert.ok(missing.logs.some((l) => l.includes('copy config/studio.example.json to config/studio.json')));
});
