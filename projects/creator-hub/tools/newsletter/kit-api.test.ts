/**
 * Kit v4 client tests against a mocked fetch. Kit itself is never called: these tests prove the request
 * we send (a draft, never a send) and how answers and failures are reported, not that Kit accepts it.
 */
import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {createBroadcastDraft, KIT_API_BASE, KitApiError, type BroadcastDraftInput} from './kit-api.ts';

const KEY = 'kit_test_key_0123456789';
const INPUT: BroadcastDraftInput = {
	subject: 'Real support never DMs you first',
	content: '<div style="max-width:600px;">Hello</div>',
	previewText: 'How the fake support trick works.',
	description: 'Episode ep1: newsletter draft from creator-hub.',
};

type Call = {url: string; init: RequestInit};

const mockFetch = (respond: (call: Call) => Response | Promise<Response>) => {
	const calls: Call[] = [];
	const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
		const call = {url: String(url), init: init ?? {}};
		calls.push(call);
		return respond(call);
	}) as typeof fetch;
	return {calls, fetchImpl};
};

const json = (status: number, body: unknown): Response =>
	new Response(JSON.stringify(body), {status, headers: {'content-type': 'application/json; charset=utf-8'}});

/** Shaped like the documented v4 create-broadcast response for a draft. */
const created = (overrides: Record<string, unknown> = {}): Response =>
	json(201, {
		broadcast: {
			id: 4242,
			publication_id: 99,
			created_at: '2026-11-24T12:00:00Z',
			subject: INPUT.subject,
			preview_text: INPUT.previewText,
			description: INPUT.description,
			content: INPUT.content,
			public: false,
			published_at: null,
			send_at: null,
			thumbnail_alt: null,
			thumbnail_url: null,
			email_address: null,
			email_template: {id: 1, name: 'Default'},
			subscriber_filter: [{all: [{type: 'all_subscribers'}]}],
			...overrides,
		},
	});

const rejectsWith = async (promise: Promise<unknown>, status: number | null, message: RegExp): Promise<KitApiError> => {
	try {
		await promise;
	} catch (err) {
		assert.ok(err instanceof KitApiError, `expected KitApiError, got ${String(err)}`);
		assert.equal(err.status, status);
		assert.match(err.message, message);
		assert.ok(!err.message.includes(KEY), 'the API key never appears in an error');
		return err;
	}
	assert.fail('expected the call to fail');
};

describe('createBroadcastDraft', () => {
	it('POSTs one draft to /v4/broadcasts with the key header, send_at null and public false', async () => {
		const {calls, fetchImpl} = mockFetch(() => created());
		const draft = await createBroadcastDraft(INPUT, {apiKey: KEY, fetch: fetchImpl});
		assert.deepEqual(draft, {id: 4242, subject: INPUT.subject, createdAt: '2026-11-24T12:00:00Z'});
		assert.equal(calls.length, 1);
		const [call] = calls;
		assert.equal(call?.url, `${KIT_API_BASE}/broadcasts`);
		assert.equal(call?.url, 'https://api.kit.com/v4/broadcasts');
		assert.equal(call?.init.method, 'POST');
		assert.equal(call?.init.redirect, 'error');
		assert.ok(call?.init.signal instanceof AbortSignal);
		const headers = new Headers(call?.init.headers);
		assert.equal(headers.get('x-kit-api-key'), KEY);
		assert.equal(headers.get('content-type'), 'application/json; charset=utf-8');
		assert.equal(headers.get('accept'), 'application/json');
		assert.equal(headers.get('authorization'), null);
		assert.deepEqual(JSON.parse(String(call?.init.body)), {
			subject: INPUT.subject,
			content: INPUT.content,
			description: INPUT.description,
			preview_text: INPUT.previewText,
			public: false,
			send_at: null,
		});
	});

	it('refuses to call Kit without a usable key or content', async () => {
		const {calls, fetchImpl} = mockFetch(() => created());
		await rejectsWith(createBroadcastDraft(INPUT, {apiKey: '  ', fetch: fetchImpl}), null, /KIT_API_KEY is not set/);
		await rejectsWith(createBroadcastDraft(INPUT, {apiKey: 'abc\ndef', fetch: fetchImpl}), null, /spaces or control characters/);
		await rejectsWith(createBroadcastDraft({...INPUT, subject: ' '}, {apiKey: KEY, fetch: fetchImpl}), null, /needs a subject and content/);
		assert.equal(calls.length, 0);
	});

	it('reports Kit errors with their message and a hint, without the key', async () => {
		const unauthorized = mockFetch(() => json(401, {errors: ['The access token is invalid']}));
		await rejectsWith(createBroadcastDraft(INPUT, {apiKey: KEY, fetch: unauthorized.fetchImpl}), 401, /Kit answered 401: The access token is invalid\. Check KIT_API_KEY/);
		const invalid = mockFetch(() => json(422, {errors: ["Subject can't be blank", 'Content is too long']}));
		await rejectsWith(createBroadcastDraft(INPUT, {apiKey: KEY, fetch: invalid.fetchImpl}), 422, /Subject can't be blank; Content is too long/);
		const limited = mockFetch(() => new Response('', {status: 429}));
		await rejectsWith(createBroadcastDraft(INPUT, {apiKey: KEY, fetch: limited.fetchImpl}), 429, /rate limit reached/);
		const broken = mockFetch(() => new Response('<html>Bad gateway</html>', {status: 502}));
		await rejectsWith(createBroadcastDraft(INPUT, {apiKey: KEY, fetch: broken.fetchImpl}), 502, /^Kit answered 502\.$/);
	});

	it('never retries, so a failure cannot create duplicate drafts', async () => {
		const {calls, fetchImpl} = mockFetch(() => new Response('', {status: 500}));
		await rejectsWith(createBroadcastDraft(INPUT, {apiKey: KEY, fetch: fetchImpl}), 500, /Kit answered 500/);
		assert.equal(calls.length, 1);
	});

	it('fails loudly if Kit ever reports the broadcast as scheduled', async () => {
		const {fetchImpl} = mockFetch(() => created({send_at: '2026-11-25T09:00:00Z'}));
		await rejectsWith(createBroadcastDraft(INPUT, {apiKey: KEY, fetch: fetchImpl}), 201, /reports broadcast 4242 as scheduled .* Open Kit now and unschedule it/);
	});

	it('rejects a success answer without a broadcast id', async () => {
		const {fetchImpl} = mockFetch(() => json(200, {ok: true}));
		await rejectsWith(createBroadcastDraft(INPUT, {apiKey: KEY, fetch: fetchImpl}), 200, /without a broadcast id/);
	});

	it('says a draft may exist when the network fails or Kit does not answer in time', async () => {
		const down = mockFetch(() => Promise.reject(new TypeError('fetch failed')));
		await rejectsWith(createBroadcastDraft(INPUT, {apiKey: KEY, fetch: down.fetchImpl}), null, /request failed\)\. A draft may still have been created/);
		// AbortSignal.timeout() is unref'd; a real request's socket keeps the process alive, this timer does here.
		const slow = mockFetch(
			({init}) =>
				new Promise<Response>((_, reject) => {
					const socket = setTimeout(() => reject(new Error('the client never timed out')), 5_000);
					init.signal?.addEventListener('abort', () => {
						clearTimeout(socket);
						reject(init.signal?.reason);
					});
				}),
		);
		await rejectsWith(createBroadcastDraft(INPUT, {apiKey: KEY, fetch: slow.fetchImpl, timeoutMs: 20}), null, /no answer in time/);
	});
});
