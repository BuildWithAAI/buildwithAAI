/**
 * Optional "new order" ping to a webhook (NOTIFY_WEBHOOK_URL). Best effort: it runs after the order
 * is stored and the visitor is redirected, never throws, and gives up after the timeout.
 *
 * Privacy: the payload carries ONLY the order id, package id and timestamp. Never the name, email,
 * company, project link, budget or message. `text` repeats those three facts so the same URL works
 * as a Slack incoming webhook (Slack reads `text`), or a Discord webhook with "/slack" appended.
 * The webhook URL is a secret (Slack/Discord URLs embed a token), so it is never logged.
 */

export type OrderNotice = {id: string; packageId: string; ts: number};
export type NotifyResult = 'skipped' | 'sent' | 'failed';
export type NotifyOptions = {
	webhookUrl: string | undefined;
	timeoutMs?: number; // default 3000
	fetchImpl?: typeof fetch;
	log?: (line: string) => void;
};

export const NOTIFY_TIMEOUT_MS = 3000;

export const orderNoticePayload = (notice: OrderNotice): {id: string; packageId: string; ts: string; text: string} => {
	const ts = new Date(notice.ts).toISOString();
	return {
		id: notice.id,
		packageId: notice.packageId,
		ts,
		text: `New studio order ${notice.id} (package: ${notice.packageId}) at ${ts}`,
	};
};

/** https only; plain http is allowed for loopback so a local relay or test server can listen. */
export const webhookTarget = (value: string): URL | null => {
	let url: URL;
	try {
		url = new URL(value.trim());
	} catch {
		return null;
	}
	const loopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]';
	return url.protocol === 'https:' || (url.protocol === 'http:' && loopback) ? url : null;
};

const reason = (error: unknown): string => {
	if (!(error instanceof Error)) return 'unknown error';
	if (error.name === 'TimeoutError' || error.name === 'AbortError') return 'timed out';
	const code = (error.cause as {code?: unknown} | undefined)?.code;
	return typeof code === 'string' ? `${error.name}: ${code}` : error.name;
};

export const notifyNewOrder = async (notice: OrderNotice, options: NotifyOptions): Promise<NotifyResult> => {
	const log = options.log ?? ((line: string) => console.log(line));
	const configured = options.webhookUrl?.trim() ?? '';
	if (configured === '') return 'skipped';
	const target = webhookTarget(configured);
	if (!target) {
		log('[studio] NOTIFY_WEBHOOK_URL is not a valid https URL; order notification skipped');
		return 'skipped';
	}
	try {
		const response = await (options.fetchImpl ?? fetch)(target, {
			method: 'POST',
			headers: {'content-type': 'application/json', 'user-agent': 'creator-hub-studio'},
			body: JSON.stringify(orderNoticePayload(notice)),
			redirect: 'error',
			signal: AbortSignal.timeout(options.timeoutMs ?? NOTIFY_TIMEOUT_MS),
		});
		await response.body?.cancel().catch(() => undefined);
		if (!response.ok) {
			log(`[studio] order ${notice.id}: notification webhook answered HTTP ${response.status}`);
			return 'failed';
		}
		return 'sent';
	} catch (error) {
		log(`[studio] order ${notice.id}: notification failed (${reason(error)}); the order is stored`);
		return 'failed';
	}
};
