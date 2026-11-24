/**
 * Telegram Bot API: sendMessage and sendVideo to a channel.
 *
 * Contract (checked 2026-11-24; core.telegram.org could not be opened from the build machine, so this rests on
 * search-index extracts of the official pages, cited in README.md):
 * - https://core.telegram.org/bots/api/methods/sendmessage: POST https://api.telegram.org/bot<token>/sendMessage,
 *   chat_id (a number, or "@channelusername" for a public channel), text of 1-4096 characters after entities parsing,
 *   link_preview_options (Bot API 7.0+), disable_notification.
 * - https://core.telegram.org/bots/api/methods/sendvideo: video as multipart/form-data upload; caption of 0-1024
 *   characters after entities parsing; "Bots can currently send video files of up to 50 MB in size";
 *   supports_streaming.
 * - Every answer is JSON {"ok": true, "result": Message} or {"ok": false, "error_code", "description",
 *   "parameters": {"retry_after"}}.
 * - https://core.telegram.org/bots/faq: no more than 20 messages per minute in one group, and about one per second in
 *   one chat. The announcer sends one message per kit.
 * The bot must be an administrator of the channel with permission to post.
 *
 * Text is sent as plain text (no parse_mode), so nothing in it can break entity parsing. The token is part of the URL
 * path, so it never appears in messages, logs or errors from this module.
 */
import {readFileSync, statSync} from 'node:fs';
import {basename} from 'node:path';

export const TELEGRAM_API = 'https://api.telegram.org';
export const TELEGRAM_TEXT_LIMIT = 4096;
export const TELEGRAM_CAPTION_LIMIT = 1024;
export const TELEGRAM_UPLOAD_LIMIT_BYTES = 50 * 1024 * 1024;
export const TELEGRAM_ENV = ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID'] as const;
const TIMEOUT_MS = 30_000;
const UPLOAD_TIMEOUT_MS = 300_000;

const TOKEN = /^\d{5,15}:[A-Za-z0-9_-]{30,64}$/;
const CHAT_ID = /^(?:-?\d{5,20}|@[A-Za-z][A-Za-z0-9_]{4,31})$/;

export type TelegramConfig = {token: string; chatId: string};

export const telegramConfigFromEnv = (env: Record<string, string | undefined>): {config: TelegramConfig | null; missing: string[]; problems: string[]} => {
	const token = (env.TELEGRAM_BOT_TOKEN ?? '').trim();
	const chatId = (env.TELEGRAM_CHAT_ID ?? '').trim();
	const missing = TELEGRAM_ENV.filter((k) => !(env[k] ?? '').trim());
	const problems: string[] = [];
	if (token && !TOKEN.test(token)) problems.push('TELEGRAM_BOT_TOKEN does not look like a bot token from @BotFather ("123456:ABC...")');
	if (chatId && !CHAT_ID.test(chatId)) problems.push('TELEGRAM_CHAT_ID must be "@channelusername" or the channel\'s numeric id (e.g. -1001234567890)');
	return {config: missing.length === 0 && problems.length === 0 ? {token, chatId} : null, missing, problems};
};

export const isChatId = (value: string): boolean => CHAT_ID.test(value);

export class TelegramApiError extends Error {
	readonly status: number | null;
	/** True when Telegram answered with a refusal: nothing was posted, so a later run may try again. */
	readonly definite: boolean;
	readonly retryAfterSec: number | null;
	constructor(status: number | null, definite: boolean, message: string, retryAfterSec: number | null = null) {
		super(message);
		this.name = 'TelegramApiError';
		this.status = status;
		this.definite = definite;
		this.retryAfterSec = retryAfterSec;
	}
}

export type TelegramMessage = {messageId: number; chatId: string; url: string | null};

export type TelegramClientOptions = {config: TelegramConfig; fetch?: typeof fetch; timeoutMs?: number};

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

const call = async (method: 'sendMessage' | 'sendVideo', body: string | FormData, options: TelegramClientOptions, timeoutMs: number): Promise<TelegramMessage> => {
	const url = `${TELEGRAM_API}/bot${options.config.token}/${method}`;
	let response: Response;
	try {
		response = await (options.fetch ?? fetch)(url, {
			method: 'POST',
			headers: typeof body === 'string' ? {'Content-Type': 'application/json', Accept: 'application/json'} : {Accept: 'application/json'},
			body,
			redirect: 'error',
			signal: AbortSignal.timeout(options.timeoutMs ?? timeoutMs),
		});
	} catch (err) {
		const reason = err instanceof Error && err.name === 'TimeoutError' ? 'no answer in time' : 'the request failed';
		throw new TelegramApiError(null, false, `Could not reach Telegram (${reason}). The message may still have been sent: check the channel before running again.`);
	}
	// Read the answer. A 2xx means Telegram may have sent the message: only {"ok": true, result.message_id} confirms
	// it, and only an explicit {"ok": false, "error_code": 4xx} refuses it. A 2xx whose body breaks off, does not parse
	// or has no message id is NOT a refusal: it stays undecided ("pending" in the ledger) so a later run never posts it
	// twice. Only a non-2xx status below 500 is a definite refusal.
	let raw = '';
	let unreadable = false;
	try {
		raw = await response.text();
	} catch {
		unreadable = true;
	}
	let parsed: unknown = null;
	try {
		parsed = raw ? JSON.parse(raw) : null;
	} catch {
		parsed = null;
	}
	const answer = isRecord(parsed) ? parsed : {};
	const result = isRecord(answer.result) ? answer.result : null;
	const messageId = result && typeof result.message_id === 'number' ? result.message_id : null;
	if (response.ok && answer.ok === true && messageId !== null) {
		const chat = result && isRecord(result.chat) ? result.chat : {};
		const username = typeof chat.username === 'string' ? chat.username : options.config.chatId.startsWith('@') ? options.config.chatId.slice(1) : null;
		return {messageId, chatId: options.config.chatId, url: username ? `https://t.me/${username}/${messageId}` : null};
	}
	const errorCode = typeof answer.error_code === 'number' && Number.isInteger(answer.error_code) ? answer.error_code : null;
	const refused = answer.ok === false && errorCode !== null && errorCode >= 400 && errorCode < 500;
	if (response.ok && !refused) {
		const why = unreadable ? 'the answer broke off' : parsed === null ? 'the answer was not JSON' : 'the answer had no message id';
		throw new TelegramApiError(response.status, false, `Telegram answered ${response.status} but ${why}, so the message may have been posted: check the channel before running again.`);
	}
	const code = errorCode ?? response.status;
	const definite = refused || (!response.ok && response.status < 500);
	const description = typeof answer.description === 'string' ? answer.description.split(options.config.token).join('<token>').slice(0, 300) : '';
	const retry = isRecord(answer.parameters) && typeof answer.parameters.retry_after === 'number' ? answer.parameters.retry_after : null;
	const hint =
		code === 401 || code === 404 ? ' Check TELEGRAM_BOT_TOKEN.'
		: code === 400 && /chat not found/i.test(description) ? ' Check TELEGRAM_CHAT_ID, and add the bot to the channel.'
		: code === 403 ? ' Make the bot an administrator of the channel with permission to post messages.'
		: code === 413 ? ` The file is too large (bots may send up to ${TELEGRAM_UPLOAD_LIMIT_BYTES / 1024 / 1024} MB).`
		: code === 429 ? ` Too many requests${retry ? `: retry after ${retry} s` : ''}.`
		: '';
	throw new TelegramApiError(code, definite, `Telegram answered ${code}${description ? `: ${description}` : ''}.${hint}`, retry);
};

/** Plain-text message. `previewUrl` picks the link shown as the preview card (the video link). */
export const sendMessage = async (text: string, previewUrl: string | null, options: TelegramClientOptions): Promise<TelegramMessage> => {
	if (!text.trim()) throw new TelegramApiError(null, true, 'Refusing to send an empty message.');
	if (text.length > TELEGRAM_TEXT_LIMIT) throw new TelegramApiError(null, true, `The message is ${text.length} characters; Telegram allows ${TELEGRAM_TEXT_LIMIT}.`);
	return call('sendMessage', JSON.stringify(messageBody(options.config.chatId, text, previewUrl)), options, TIMEOUT_MS);
};

/** The exact JSON body of sendMessage (also printed by the dry run). */
export const messageBody = (chatId: string, text: string, previewUrl: string | null): Record<string, unknown> => ({
	chat_id: chatId,
	text,
	...(previewUrl ? {link_preview_options: {url: previewUrl, prefer_large_media: true}} : {}),
});

export type VideoFile = {path: string; bytes: number};

/** Checks a local video for sendVideo: an existing .mp4 of at most 50 MB. */
export const checkVideo = (path: string): {video: VideoFile | null; problem: string | null} => {
	let bytes: number;
	try {
		const st = statSync(path);
		if (!st.isFile()) return {video: null, problem: `${path} is not a file`};
		bytes = st.size;
	} catch {
		return {video: null, problem: `video not found: ${path}`};
	}
	if (!/\.mp4$/i.test(path)) return {video: null, problem: 'the video must be an .mp4 file'};
	if (bytes === 0) return {video: null, problem: 'the video file is empty'};
	if (bytes > TELEGRAM_UPLOAD_LIMIT_BYTES) return {video: null, problem: `the video is ${(bytes / 1024 / 1024).toFixed(1)} MB; Telegram bots may send at most 50 MB`};
	return {video: {path, bytes}, problem: null};
};

/** The form fields of sendVideo other than the file (also printed by the dry run). */
export const videoFields = (chatId: string, caption: string): Record<string, string> => ({chat_id: chatId, caption, supports_streaming: 'true'});

/** Uploads a local MP4 with a plain-text caption (at most 1024 characters). */
export const sendVideo = async (video: VideoFile, caption: string, options: TelegramClientOptions): Promise<TelegramMessage> => {
	if (caption.length > TELEGRAM_CAPTION_LIMIT) throw new TelegramApiError(null, true, `The caption is ${caption.length} characters; Telegram allows ${TELEGRAM_CAPTION_LIMIT}.`);
	const form = new FormData();
	for (const [key, value] of Object.entries(videoFields(options.config.chatId, caption))) form.append(key, value);
	form.append('video', new Blob([readFileSync(video.path)], {type: 'video/mp4'}), basename(video.path));
	return call('sendVideo', form, options, UPLOAD_TIMEOUT_MS);
};
