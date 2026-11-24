import assert from 'node:assert/strict';
import {createServer, type IncomingMessage, type ServerResponse} from 'node:http';
import type {AddressInfo} from 'node:net';
import {test} from 'node:test';
import {notifyNewOrder, orderNoticePayload, webhookTarget} from './notify.ts';

const NOTICE = {id: '3f2b6c1e-0000-4000-8000-000000000001', packageId: 'explainer-60-90', ts: Date.UTC(2026, 10, 24, 12)};

/** Local webhook receiver on 127.0.0.1 (no external network). */
const listen = async (handler: (req: IncomingMessage, res: ServerResponse, body: string) => void) => {
	const server = createServer((req, res) => {
		let body = '';
		req.setEncoding('utf8');
		req.on('data', (chunk: string) => (body += chunk));
		req.on('end', () => handler(req, res, body));
	});
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
	const {port} = server.address() as AddressInfo;
	return {
		url: `http://127.0.0.1:${port}/hook`,
		close: () => {
			server.closeAllConnections();
			return new Promise<void>((resolve) => server.close(() => resolve()));
		},
	};
};

test('posts only the id, package and timestamp as JSON', async () => {
	let received: {method?: string; type?: string; body: string} = {body: ''};
	const hook = await listen((req, res, body) => {
		received = {method: req.method, type: req.headers['content-type'], body};
		res.writeHead(204).end();
	});
	try {
		const result = await notifyNewOrder(NOTICE, {webhookUrl: hook.url, log: () => undefined});
		assert.equal(result, 'sent');
		assert.equal(received.method, 'POST');
		assert.equal(received.type, 'application/json');
		const payload = JSON.parse(received.body) as Record<string, unknown>;
		assert.deepEqual(Object.keys(payload).sort(), ['id', 'packageId', 'text', 'ts']);
		assert.deepEqual(payload, orderNoticePayload(NOTICE));
		assert.equal(payload.ts, '2026-11-24T12:00:00.000Z');
	} finally {
		await hook.close();
	}
});

test('skips quietly when unset, and with a log line when the URL is not https', async () => {
	const logs: string[] = [];
	const log = (line: string) => logs.push(line);
	assert.equal(await notifyNewOrder(NOTICE, {webhookUrl: undefined, log}), 'skipped');
	assert.equal(await notifyNewOrder(NOTICE, {webhookUrl: '  ', log}), 'skipped');
	assert.equal(logs.length, 0);
	assert.equal(await notifyNewOrder(NOTICE, {webhookUrl: 'http://hooks.example.com/secret-token', log}), 'skipped');
	assert.equal(await notifyNewOrder(NOTICE, {webhookUrl: 'not a url', log}), 'skipped');
	assert.equal(logs.length, 2);
	assert.ok(logs.every((line) => !line.includes('secret-token')), 'the webhook URL is a secret and is never logged');
});

test('a non-2xx answer is a logged failure', async () => {
	const hook = await listen((_req, res) => res.writeHead(500).end('nope'));
	const logs: string[] = [];
	try {
		assert.equal(await notifyNewOrder(NOTICE, {webhookUrl: hook.url, log: (l) => logs.push(l)}), 'failed');
		assert.match(logs.join('\n'), /HTTP 500/);
		assert.ok(!logs.join('\n').includes(hook.url));
	} finally {
		await hook.close();
	}
});

test('a webhook that never answers is abandoned at the timeout', async () => {
	const hook = await listen(() => undefined); // never responds
	const logs: string[] = [];
	try {
		const started = Date.now();
		assert.equal(await notifyNewOrder(NOTICE, {webhookUrl: hook.url, timeoutMs: 150, log: (l) => logs.push(l)}), 'failed');
		assert.ok(Date.now() - started < 2000, 'gave up promptly');
		assert.match(logs.join('\n'), /timed out/);
	} finally {
		await hook.close();
	}
});

test('a refused connection is a logged failure, not an exception', async () => {
	const hook = await listen((_req, res) => res.end());
	const url = hook.url;
	await hook.close(); // nothing listens on the port now
	const logs: string[] = [];
	assert.equal(await notifyNewOrder(NOTICE, {webhookUrl: url, log: (l) => logs.push(l)}), 'failed');
	assert.match(logs.join('\n'), /notification failed/);
});

test('webhookTarget allows https anywhere and plain http only on loopback', () => {
	assert.ok(webhookTarget('https://hooks.slack.com/services/T/B/X'));
	assert.ok(webhookTarget('http://127.0.0.1:9999/hook'));
	assert.ok(webhookTarget('http://localhost/hook'));
	assert.ok(webhookTarget('http://[::1]:8080/hook'));
	assert.equal(webhookTarget('http://example.com/hook'), null);
	assert.equal(webhookTarget('ftp://example.com/hook'), null);
	assert.equal(webhookTarget('garbage'), null);
});
