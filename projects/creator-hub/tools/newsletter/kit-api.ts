/**
 * Kit (formerly ConvertKit) API v4 client that creates a broadcast DRAFT and nothing else. It cannot
 * send or schedule: every request has send_at null and public false, and no other call exists here.
 * The owner reviews the draft, picks the recipients and sends it from Kit.
 *
 * Contract (current Kit v4 docs, checked 2026-11-24):
 *   https://developers.kit.com/api-reference/broadcasts/create-a-broadcast
 *   POST https://api.kit.com/v4/broadcasts, JSON body; a draft is saved with send_at null and public
 *   false. The success response is {"broadcast": {"id": ..., "subject": ..., "send_at": null, ...}}.
 *   Auth: a v4 API key in the X-Kit-Api-Key header. Keys are made in Kit under Settings > Developer
 *   (https://app.kit.com/account_settings/developer_settings).
 * developers.kit.com could not be opened from the machine this was built on (blocked), so the
 * request shape was confirmed against Kit's official PHP SDK, github.com/Kit/ConvertKitSDK-PHP
 * (src/ConvertKit_API.php get_request_headers: X-Kit-Api-Key; src/ConvertKit_API_Traits.php
 * create_broadcast: "send_at ... leave blank to create a draft broadcast"; its tests expect
 * broadcast.send_at === null for a draft) and the search-index text of the docs page above.
 *
 * Recipients: the create-broadcast body takes an optional subscriber_filter, an array of groups such as
 * [{"all": [{"type": "tag", "ids": [123]}]}] ("all" = the subscriber must match every listed tag or segment).
 * According to the same docs page (search-index text, not opened directly), a broadcast without a filter goes
 * to all subscribers, which is why the CLI makes the owner choose (KIT_SUBSCRIBER_FILTER or --all-subscribers).
 *
 * NOT CALLED LIVE: api.kit.com is not reachable from the build machine. This client is tested only
 * against a mocked fetch (kit-api.test.ts). Try it once on the real account before relying on it.
 */

export const KIT_API_BASE = 'https://api.kit.com/v4';
export const KIT_DOCS_URL = 'https://developers.kit.com/api-reference/broadcasts/create-a-broadcast';
const TIMEOUT_MS = 15_000;

/** Who a draft is for: subscribers with every one of these Kit tags or segments. */
export type SubscriberFilter = {type: 'tag' | 'segment'; ids: number[]};

export type BroadcastDraftInput = {
	subject: string;
	content: string; // email HTML; Kit wraps it in the account's default email template
	previewText: string;
	description: string; // internal note shown only in Kit
	/** Sent as subscriber_filter. Omitted: Kit's default audience (all subscribers, per its docs). */
	subscriberFilter?: SubscriberFilter | null;
};

/**
 * Parses KIT_SUBSCRIBER_FILTER: "tag:123", "segment:7" or "tag:12,34" (the subscriber must have every listed
 * tag). Returns null when the value is malformed.
 */
export const parseSubscriberFilter = (value: string): SubscriberFilter | null => {
	const match = /^\s*(tag|segment)\s*:\s*(\d{1,15}(?:\s*,\s*\d{1,15})*)\s*$/i.exec(value);
	if (!match?.[1] || !match[2]) return null;
	const ids = match[2].split(',').map((id) => Number(id.trim()));
	if (!ids.every((id) => Number.isSafeInteger(id) && id > 0)) return null;
	return {type: match[1].toLowerCase() as 'tag' | 'segment', ids: [...new Set(ids)]};
};

export type CreatedDraft = {id: number; subject: string; createdAt: string | null};

export type KitClientOptions = {
	apiKey: string;
	fetch?: typeof fetch; // injected in tests
	timeoutMs?: number;
};

export class KitApiError extends Error {
	readonly status: number | null;
	constructor(status: number | null, message: string) {
		super(message);
		this.name = 'KitApiError';
		this.status = status;
	}
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

/** Kit's error bodies look like {"errors": ["..."]}; anything else falls back to the status. */
const errorText = (body: unknown, status: number): string => {
	const errors = isRecord(body) && Array.isArray(body.errors) ? body.errors.filter((e): e is string => typeof e === 'string') : [];
	const hint =
		status === 401 ? ' Check KIT_API_KEY (a v4 API key from Kit > Settings > Developer).'
		: status === 403 ? ' The account or key may not be allowed to create broadcasts.'
		: status === 429 ? ' Kit rate limit reached: wait a minute and try again.'
		: '';
	return `Kit answered ${status}${errors.length > 0 ? `: ${errors.join('; ').slice(0, 500)}` : ''}.${hint}`;
};

/** Creates one draft broadcast. Never retried automatically: a retry could create a duplicate draft. */
export const createBroadcastDraft = async (input: BroadcastDraftInput, options: KitClientOptions): Promise<CreatedDraft> => {
	const apiKey = options.apiKey.trim();
	if (!apiKey) throw new KitApiError(null, 'KIT_API_KEY is not set.');
	if (/[\s\0-\x1f]/.test(apiKey)) throw new KitApiError(null, 'KIT_API_KEY contains spaces or control characters.');
	if (!input.subject.trim() || !input.content.trim()) throw new KitApiError(null, 'A broadcast needs a subject and content.');

	const body: Record<string, unknown> = {
		subject: input.subject,
		content: input.content,
		description: input.description,
		preview_text: input.previewText,
		public: false, // not published to the Kit web archive
		send_at: null, // null = save as a draft; this client never schedules or sends
	};
	if (input.subscriberFilter) body.subscriber_filter = [{all: [{type: input.subscriberFilter.type, ids: input.subscriberFilter.ids}]}];
	let response: Response;
	try {
		response = await (options.fetch ?? fetch)(`${KIT_API_BASE}/broadcasts`, {
			method: 'POST',
			headers: {
				Accept: 'application/json',
				'Content-Type': 'application/json; charset=utf-8',
				'X-Kit-Api-Key': apiKey,
			},
			body: JSON.stringify(body),
			redirect: 'error', // never forward the key header to another host
			signal: AbortSignal.timeout(options.timeoutMs ?? TIMEOUT_MS),
		});
	} catch (err) {
		const reason = err instanceof Error && err.name === 'TimeoutError' ? 'no answer in time' : 'the request failed';
		throw new KitApiError(null, `Could not reach Kit (${reason}). A draft may still have been created: check your Kit broadcasts before running this again.`);
	}

	const raw = await response.text();
	let parsed: unknown = null;
	try {
		parsed = raw ? JSON.parse(raw) : null;
	} catch {
		parsed = null;
	}
	if (!response.ok) throw new KitApiError(response.status, errorText(parsed, response.status));
	const broadcast = isRecord(parsed) && isRecord(parsed.broadcast) ? parsed.broadcast : null;
	if (!broadcast || typeof broadcast.id !== 'number') {
		throw new KitApiError(response.status, 'Kit answered without a broadcast id. Check your Kit broadcasts for a new draft.');
	}
	if (broadcast.send_at !== null && broadcast.send_at !== undefined) {
		throw new KitApiError(
			response.status,
			`Kit reports broadcast ${broadcast.id} as scheduled (send_at ${String(broadcast.send_at)}), which this tool never asks for. Open Kit now and unschedule it.`,
		);
	}
	return {
		id: broadcast.id,
		subject: typeof broadcast.subject === 'string' ? broadcast.subject : input.subject,
		createdAt: typeof broadcast.created_at === 'string' ? broadcast.created_at : null,
	};
};
