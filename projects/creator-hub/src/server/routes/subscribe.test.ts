/**
 * Tests for /subscribe: the Kit form, word-for-word consent text, escaping, page_events logging and the
 * guarantee that our server never accepts an email address. Unit tests drive the handlers through the
 * Router/Ctx contract against an in-memory database; one test runs the real hub on an ephemeral port.
 */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import type {IncomingMessage, ServerResponse} from 'node:http';
import {DatabaseSync} from 'node:sqlite';
import {describe, it} from 'node:test';
import {esc} from '../html.ts';
import type {Ctx, Handler, HubConfig, Router} from '../http.ts';
import {startTestHub} from '../test-helpers.ts';
import {CONSENT_TEXT, register, SUBSCRIBE_PATH, SUBSCRIBE_THANKS_PATH} from './subscribe.ts';

const SCHEMA = readFileSync(new URL('../../db/schema.sql', import.meta.url), 'utf8');
const KIT_ACTION = 'https://app.kit.com/forms/10168331/subscriptions';

type Reply = {status: number; body: string};

const harness = (overrides: Partial<HubConfig> = {}) => {
	const routes = new Map<string, Handler>();
	const router: Router = {
		get: (path, handler) => void routes.set(`GET ${path}`, handler),
		post: (path, handler) => void routes.set(`POST ${path}`, handler),
	};
	register(router);
	const db = new DatabaseSync(':memory:');
	db.exec(SCHEMA);
	const config: HubConfig = {
		publicBaseUrl: 'https://go.example.test',
		brandName: 'Zoora AI',
		offers: {version: 1, offers: []},
		studio: null,
		kitFormAction: KIT_ACTION,
		contactEmail: 'hello@example.test',
		adminUser: '',
		adminPasswordHash: '',
		hashSecret: 'test-secret-0123456789abcdef0123456789',
		...overrides,
	};
	const get = async (path: string, extra: Partial<Pick<Ctx, 'country' | 'isBot'>> = {}): Promise<Reply> => {
		const url = new URL(path, config.publicBaseUrl);
		const handler = routes.get(`GET ${url.pathname}`);
		assert.ok(handler, `no route for GET ${url.pathname}`);
		const reply: Reply = {status: 0, body: ''};
		const fail = (): never => assert.fail('handler must answer with ctx.html');
		const ctx: Ctx = {
			req: {method: 'GET', headers: {}} as IncomingMessage,
			res: {setHeader: () => undefined} as unknown as ServerResponse,
			url,
			params: {},
			country: 'DE',
			visitorHash: '0123456789abcdef',
			isBot: false,
			db,
			config,
			form: async () => new URLSearchParams(),
			html: (status, body) => {
				reply.status = status;
				reply.body = body;
			},
			json: fail,
			redirect: fail,
			...extra,
		};
		await handler(ctx);
		return reply;
	};
	const lastEvent = () => db.prepare('SELECT * FROM page_events ORDER BY id DESC LIMIT 1').get();
	return {routes, get, lastEvent};
};

describe('GET /subscribe', () => {
	it('registers only GET routes: there is no POST, so an email address can never reach our server', () => {
		assert.deepEqual([...harness().routes.keys()].sort(), [`GET ${SUBSCRIBE_PATH}`, `GET ${SUBSCRIBE_THANKS_PATH}`]);
	});

	it('renders the Kit form with the configured action, the email_address field and the consent text', async () => {
		const {status, body} = await harness().get('/subscribe?s=yt&v=dQw4w9WgXcQ');
		assert.equal(status, 200);
		assert.match(body, new RegExp(`<form method="post" action="${KIT_ACTION}"`));
		assert.match(body, /<label for="email">Email address<\/label>/);
		assert.match(body, /<input id="email" name="email_address" type="email" autocomplete="email"[^>]* required aria-describedby="consent">/);
		assert.equal(
			CONSENT_TEXT,
			"You'll get new episodes and occasional recommendations. Some links are affiliate links and are always labelled. Unsubscribe any time.",
		);
		assert.ok(body.includes(`<p id="consent">${esc(CONSENT_TEXT)}</p>`), 'consent text sits right above the button');
		assert.match(body, /<button class="button" type="submit">Subscribe<\/button>/);
		assert.doesNotMatch(body, /<script|\sstyle=|\son[a-z]+=/i, 'no scripts or inline styles (the CSP blocks both)');
	});

	it('logs a page_events row with the validated source and video, and the visitor fields', async () => {
		const h = harness();
		await h.get('/subscribe?s=shorts&v=ep-01_fake-support');
		const row = h.lastEvent();
		assert.equal(row?.page, 'subscribe');
		assert.equal(row?.source, 'shorts');
		assert.equal(row?.video_id, 'ep-01_fake-support');
		assert.equal(row?.country, 'DE');
		assert.equal(row?.visitor_hash, '0123456789abcdef');
		assert.equal(row?.is_bot, 0);
		assert.ok(Math.abs(Number(row?.ts) - Date.now()) < 60_000);
	});

	it('drops invalid s and v values instead of logging or reflecting them', async () => {
		const h = harness();
		const {body} = await h.get('/subscribe?s=%3Cscript%3Ealert(1)%3C%2Fscript%3E&v=%22%3E%3Cimg%20src%3Dx%20onerror%3Dalert(1)%3E');
		assert.equal(h.lastEvent()?.source, null);
		assert.equal(h.lastEvent()?.video_id, null);
		assert.doesNotMatch(body, /alert\(1\)|<img/);
	});

	it('escapes the brand name and the form action from config', async () => {
		const h = harness({
			brandName: 'Zoo <script>alert(1)</script> "AI"',
			kitFormAction: 'https://app.kit.com/forms/1/subscriptions?x="><script>alert(2)</script>',
		});
		const {body} = await h.get('/subscribe');
		assert.doesNotMatch(body, /<script>/);
		assert.match(body, /Zoo &lt;script&gt;alert\(1\)&lt;\/script&gt; &quot;AI&quot;/);
		assert.match(body, /action="https:\/\/app\.kit\.com\/forms\/1\/subscriptions\?x=&quot;&gt;&lt;script&gt;alert\(2\)&lt;\/script&gt;"/);
	});

	it('logs bots as bots and an unknown country as null', async () => {
		const h = harness();
		await h.get('/subscribe?s=x', {isBot: true, country: null});
		assert.equal(h.lastEvent()?.is_bot, 1);
		assert.equal(h.lastEvent()?.country, null);
	});
});

describe('GET /subscribe/thanks', () => {
	it('tells people to confirm by email, is not indexed and logs a subscribe-thanks view', async () => {
		const h = harness();
		const {status, body} = await h.get('/subscribe/thanks');
		assert.equal(status, 200);
		assert.match(body, /Almost done: check your inbox/);
		assert.match(body, /<meta name="robots" content="noindex, nofollow">/);
		assert.match(body, /never asks for a password, a wallet connection or your seed phrase/);
		assert.equal(h.lastEvent()?.page, 'subscribe-thanks');
	});
});

describe('/subscribe on the real hub', () => {
	it('serves the page, lets the CSP post forms to Kit, refuses POST and sets no cookie', async () => {
		const t = await startTestHub();
		try {
			const res = await t.request('/subscribe?s=email&v=ep1');
			assert.equal(res.status, 200);
			assert.equal(res.headers.get('set-cookie'), null);
			assert.match(res.headers.get('content-security-policy') ?? '', /form-action 'self' https:\/\/app\.kit\.com/);
			assert.match(await res.text(), /name="email_address"/);
			const row = t.hub.db.prepare("SELECT source, video_id FROM page_events WHERE page = 'subscribe'").get();
			assert.deepEqual({...row}, {source: 'email', video_id: 'ep1'});

			const post = await t.request('/subscribe', {
				method: 'POST',
				headers: {'content-type': 'application/x-www-form-urlencoded'},
				body: 'email_address=someone%40example.com',
			});
			assert.equal(post.status, 405);
			assert.equal(post.headers.get('allow'), 'GET, HEAD');
			const stored = t.hub.db.prepare("SELECT COUNT(*) AS n FROM page_events WHERE page LIKE 'subscribe%'").get();
			assert.equal(stored?.n, 1, 'the refused POST logs nothing');
		} finally {
			await t.close();
		}
	});
});
