import assert from 'node:assert/strict';
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {describe, it} from 'node:test';
import {percentEncode, signOAuth1} from './oauth1.ts';
import {checkVideo, messageBody, sendMessage, sendVideo, telegramConfigFromEnv, TelegramApiError} from './telegram.ts';
import {createPost, X_CREATE_POST_URL, XApiError, xCredentialsFromEnv} from './x-api.ts';

type Call = {url: string; init: RequestInit};
const mockFetch = (status: number, body: unknown, headers: Record<string, string> = {}) => {
	const calls: Call[] = [];
	const fetchFn: typeof fetch = async (input, init) => {
		calls.push({url: String(input), init: init ?? {}});
		return new Response(typeof body === 'string' ? body : JSON.stringify(body), {status, headers});
	};
	return {calls, fetchFn};
};
const failingFetch: typeof fetch = async () => Promise.reject(Object.assign(new Error('timed out'), {name: 'TimeoutError'}));

const credentials = {consumerKey: 'ck', consumerSecret: 'cs', token: 'tok', tokenSecret: 'ts'};

describe('OAuth 1.0a signing', () => {
	it("reproduces the worked example in X's \"Creating a signature\" guide", () => {
		const signed = signOAuth1({
			method: 'post',
			url: 'https://api.twitter.com/1.1/statuses/update.json?include_entities=true',
			bodyParams: {status: 'Hello Ladies + Gentlemen, a signed OAuth request!'},
			credentials: {
				consumerKey: 'xvz1evFS4wEEPTGEFPHBog',
				consumerSecret: 'kAcSOqF21Fu85e7zjz7ZN2U4ZRhfV3WpwPAoE3Z7kBw',
				token: '370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb',
				tokenSecret: 'LswwdoUaIvS8ltyTt5jkRh4J50vUPVVHtR2YPi5kE',
			},
			nonce: 'kYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg',
			timestampSec: 1318622958,
		});
		assert.equal(signed.signature, 'hCtSmYh+iHYCEqBWrE7C7hYmtUk=');
		assert.match(signed.baseString, /^POST&https%3A%2F%2Fapi\.twitter\.com%2F1\.1%2Fstatuses%2Fupdate\.json&include_entities%3Dtrue%26oauth_consumer_key/);
		assert.match(signed.authorization, /^OAuth oauth_consumer_key="xvz1evFS4wEEPTGEFPHBog", oauth_nonce="kYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg", oauth_signature="hCtSmYh%2BiHYCEqBWrE7C7hYmtUk%3D", oauth_signature_method="HMAC-SHA1", oauth_timestamp="1318622958", oauth_token="370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb", oauth_version="1\.0"$/);
	});
	it('percent-encodes per RFC 3986 and signs only oauth parameters for a JSON body', () => {
		assert.equal(percentEncode("a b!*'()~-._"), 'a%20b%21%2A%27%28%29~-._');
		const signed = signOAuth1({method: 'POST', url: X_CREATE_POST_URL, credentials, nonce: 'n', timestampSec: 1});
		assert.equal(signed.baseString, 'POST&https%3A%2F%2Fapi.x.com%2F2%2Ftweets&oauth_consumer_key%3Dck%26oauth_nonce%3Dn%26oauth_signature_method%3DHMAC-SHA1%26oauth_timestamp%3D1%26oauth_token%3Dtok%26oauth_version%3D1.0');
		assert.notEqual(signOAuth1({method: 'POST', url: X_CREATE_POST_URL, credentials}).authorization, signOAuth1({method: 'POST', url: X_CREATE_POST_URL, credentials}).authorization, 'fresh nonce per request');
	});
});

describe('X API: create post', () => {
	it('sends one signed JSON request and returns the post id and link', async () => {
		const {calls, fetchFn} = mockFetch(201, {data: {id: '1861111111111111111', text: 'hello'}});
		const post = await createPost('hello', {credentials, fetch: fetchFn, nonce: 'n', timestampSec: 1});
		assert.deepEqual(post, {id: '1861111111111111111', text: 'hello', url: 'https://x.com/i/web/status/1861111111111111111'});
		assert.equal(calls.length, 1);
		assert.equal(calls[0]?.url, 'https://api.x.com/2/tweets');
		assert.equal(calls[0]?.init.method, 'POST');
		assert.equal(calls[0]?.init.body, '{"text":"hello"}');
		assert.equal(calls[0]?.init.redirect, 'error');
		const headers = calls[0]?.init.headers as Record<string, string>;
		assert.match(headers.Authorization ?? '', /^OAuth oauth_consumer_key="ck", oauth_nonce="n", oauth_signature="[^"]+", oauth_signature_method="HMAC-SHA1", oauth_timestamp="1", oauth_token="tok", oauth_version="1\.0"$/);
		assert.equal(headers['Content-Type'], 'application/json');
	});
	it('a refusal is definite (nothing posted); a lost answer or a 5xx is not', async () => {
		const dup = mockFetch(403, {title: 'Forbidden', detail: 'You are not allowed to create a Tweet with duplicate content.'});
		await assert.rejects(createPost('x', {credentials, fetch: dup.fetchFn}), (e: unknown) => e instanceof XApiError && e.definite && e.status === 403 && /duplicate content/.test(e.message) && /Read and write/.test(e.message));
		const limited = mockFetch(429, {title: 'Too Many Requests'}, {'x-rate-limit-reset': '1764000000'});
		await assert.rejects(createPost('x', {credentials, fetch: limited.fetchFn}), (e: unknown) => e instanceof XApiError && e.definite && /resets at 2025-11-24T16:00:00\.000Z/.test(e.message));
		const credits = mockFetch(402, {errors: [{message: 'Payment required'}]});
		await assert.rejects(createPost('x', {credentials, fetch: credits.fetchFn}), (e: unknown) => e instanceof XApiError && /credits/.test(e.message));
		const down = mockFetch(503, 'Service Unavailable');
		await assert.rejects(createPost('x', {credentials, fetch: down.fetchFn}), (e: unknown) => e instanceof XApiError && !e.definite);
		await assert.rejects(createPost('x', {credentials, fetch: failingFetch}), (e: unknown) => e instanceof XApiError && !e.definite && /no answer in time/.test(e.message));
		const noId = mockFetch(201, {data: {}});
		await assert.rejects(createPost('x', {credentials, fetch: noId.fetchFn}), (e: unknown) => e instanceof XApiError && !e.definite);
		await assert.rejects(createPost('  ', {credentials, fetch: noId.fetchFn}), (e: unknown) => e instanceof XApiError && e.definite);
	});
	it('reads the four OAuth values from the environment', () => {
		assert.deepEqual(xCredentialsFromEnv({}).missing, ['X_API_KEY', 'X_API_SECRET', 'X_ACCESS_TOKEN', 'X_ACCESS_TOKEN_SECRET']);
		assert.deepEqual(xCredentialsFromEnv({X_API_KEY: 'a', X_API_SECRET: 'b', X_ACCESS_TOKEN: 'c', X_ACCESS_TOKEN_SECRET: 'd'}).credentials, {consumerKey: 'a', consumerSecret: 'b', token: 'c', tokenSecret: 'd'});
	});
});

describe('Telegram Bot API', () => {
	const token = '123456789:AAEhBOweik6ad9r_QXMENQjcrGbqCr4K-ab';
	const config = {token, chatId: '@zoo_fixture_channel'};

	it('validates the token and chat id from the environment', () => {
		assert.deepEqual(telegramConfigFromEnv({}).missing, ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID']);
		assert.equal(telegramConfigFromEnv({TELEGRAM_BOT_TOKEN: 'nope', TELEGRAM_CHAT_ID: '@zoo_fixture_channel'}).problems.length, 1);
		assert.equal(telegramConfigFromEnv({TELEGRAM_BOT_TOKEN: token, TELEGRAM_CHAT_ID: 'channel'}).problems.length, 1);
		assert.deepEqual(telegramConfigFromEnv({TELEGRAM_BOT_TOKEN: token, TELEGRAM_CHAT_ID: '-1001234567890'}).config, {token, chatId: '-1001234567890'});
	});

	it('sendMessage posts plain text with the video as the link preview', async () => {
		const {calls, fetchFn} = mockFetch(200, {ok: true, result: {message_id: 42, chat: {id: -100, username: 'zoo_fixture_channel'}}});
		const sent = await sendMessage('Hello', 'https://youtu.be/Zb7xq2Ph0aA', {config, fetch: fetchFn});
		assert.deepEqual(sent, {messageId: 42, chatId: '@zoo_fixture_channel', url: 'https://t.me/zoo_fixture_channel/42'});
		assert.equal(calls[0]?.url, `https://api.telegram.org/bot${token}/sendMessage`);
		assert.deepEqual(JSON.parse(String(calls[0]?.init.body)), messageBody('@zoo_fixture_channel', 'Hello', 'https://youtu.be/Zb7xq2Ph0aA'));
		assert.deepEqual(JSON.parse(String(calls[0]?.init.body)).link_preview_options, {url: 'https://youtu.be/Zb7xq2Ph0aA', prefer_large_media: true});
		assert.equal(JSON.parse(String(calls[0]?.init.body)).parse_mode, undefined, 'plain text: nothing can break entity parsing');
	});

	it('errors never contain the token; refusals are definite, lost answers are not', async () => {
		const notFound = mockFetch(400, {ok: false, error_code: 400, description: `Bad Request: chat not found for bot${token}`});
		await assert.rejects(sendMessage('x', null, {config, fetch: notFound.fetchFn}), (e: unknown) => e instanceof TelegramApiError && e.definite && !e.message.includes(token) && /TELEGRAM_CHAT_ID/.test(e.message));
		const flood = mockFetch(429, {ok: false, error_code: 429, description: 'Too Many Requests: retry after 31', parameters: {retry_after: 31}});
		await assert.rejects(sendMessage('x', null, {config, fetch: flood.fetchFn}), (e: unknown) => e instanceof TelegramApiError && e.definite && e.retryAfterSec === 31);
		const down = mockFetch(502, '<html>Bad Gateway</html>');
		await assert.rejects(sendMessage('x', null, {config, fetch: down.fetchFn}), (e: unknown) => e instanceof TelegramApiError && !e.definite);
		await assert.rejects(sendMessage('x', null, {config, fetch: failingFetch}), (e: unknown) => e instanceof TelegramApiError && !e.definite);
		await assert.rejects(sendMessage('x'.repeat(4097), null, {config, fetch: down.fetchFn}), (e: unknown) => e instanceof TelegramApiError && /4096/.test(e.message));
	});

	it('a 2xx it cannot confirm is never a refusal: the message may have been posted', async () => {
		const undecided = async (fetchFn: typeof fetch, detail: RegExp): Promise<void> =>
			assert.rejects(sendMessage('x', null, {config, fetch: fetchFn}), (e: unknown) => e instanceof TelegramApiError && !e.definite && e.status === 200 && /may have been posted/.test(e.message) && detail.test(e.message));
		await undecided(mockFetch(200, '{"ok":true,"result":{"message_id":5').fetchFn, /not JSON/);
		const broken: typeof fetch = async () =>
			new Response(
				new ReadableStream({
					start(c) {
						c.error(new Error('ECONNRESET'));
					},
				}),
				{status: 200},
			);
		await undecided(broken, /broke off/);
		await undecided(mockFetch(200, {ok: true, result: {}}).fetchFn, /no message id/);
		await undecided(mockFetch(200, '<html>proxy</html>').fetchFn, /not JSON/);
		await undecided(mockFetch(200, {ok: false, error_code: 502, description: 'Bad Gateway'}).fetchFn, /./);
		// Telegram's own explicit refusal is definite even on a 2xx; so is any 4xx status, readable or not
		const said = mockFetch(200, {ok: false, error_code: 400, description: 'Bad Request: message text is empty'});
		await assert.rejects(sendMessage('x', null, {config, fetch: said.fetchFn}), (e: unknown) => e instanceof TelegramApiError && e.definite && e.status === 400);
		const plain4xx = mockFetch(400, 'Bad Request');
		await assert.rejects(sendMessage('x', null, {config, fetch: plain4xx.fetchFn}), (e: unknown) => e instanceof TelegramApiError && e.definite && e.status === 400);
	});

	it('sendVideo uploads the MP4 as multipart with a caption of at most 1024 characters', async () => {
		const dir = mkdtempSync(join(tmpdir(), 'announcer-video-'));
		try {
			const path = join(dir, 'short-1.mp4');
			writeFileSync(path, Buffer.from('fake mp4 bytes'));
			const {video, problem} = checkVideo(path);
			assert.equal(problem, null);
			const {calls, fetchFn} = mockFetch(200, {ok: true, result: {message_id: 7, chat: {id: -100123}}});
			const sent = await sendVideo(video!, 'Caption', {config: {token, chatId: '-1001234567890'}, fetch: fetchFn});
			assert.equal(sent.url, null, 'a private channel has no public message link');
			assert.equal(calls[0]?.url, `https://api.telegram.org/bot${token}/sendVideo`);
			const form = calls[0]?.init.body as FormData;
			assert.equal(form.get('chat_id'), '-1001234567890');
			assert.equal(form.get('caption'), 'Caption');
			assert.equal(form.get('supports_streaming'), 'true');
			const file = form.get('video') as File;
			assert.equal(file.name, 'short-1.mp4');
			assert.equal(file.type, 'video/mp4');
			await assert.rejects(sendVideo(video!, 'c'.repeat(1025), {config, fetch: fetchFn}), /1024/);
			assert.match(checkVideo(join(dir, 'missing.mp4')).problem ?? '', /not found/);
			writeFileSync(join(dir, 'clip.mov'), 'x');
			assert.match(checkVideo(join(dir, 'clip.mov')).problem ?? '', /\.mp4/);
			writeFileSync(join(dir, 'empty.mp4'), '');
			assert.match(checkVideo(join(dir, 'empty.mp4')).problem ?? '', /empty/);
		} finally {
			rmSync(dir, {recursive: true, force: true});
		}
	});
});
