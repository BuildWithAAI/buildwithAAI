/**
 * Every HTTP request the uploader can send, built in one place. The plan prints these builders' output and the
 * executor sends it, so "plan" shows exactly what "upload --apply" sends (the Authorization header is added at send
 * time with a fresh access token; a caption's multipart boundary is random per request).
 * Endpoints and parameters: see contracts.ts.
 */
import {randomBytes} from 'node:crypto';
import type {ApiMethod, Endpoints} from './contracts.ts';

export type HttpMethod = 'GET' | 'POST' | 'PUT';

export type RequestSpec = {
	apiMethod: ApiMethod | 'upload.chunk' | 'upload.status';
	method: HttpMethod;
	url: string;
	headers: Record<string, string>;
	body: Buffer | string | null;
};

const q = (params: Record<string, string>): string => new URLSearchParams(params).toString();

export const channelCheck = (ep: Endpoints): RequestSpec => ({
	apiMethod: 'channels.list',
	method: 'GET',
	url: `${ep.api}/channels?${q({part: 'id,snippet', mine: 'true'})}`,
	headers: {accept: 'application/json'},
	body: null,
});

export const playlistCheck = (ep: Endpoints, playlistId: string): RequestSpec => ({
	apiMethod: 'playlists.list',
	method: 'GET',
	url: `${ep.api}/playlists?${q({part: 'snippet', id: playlistId})}`,
	headers: {accept: 'application/json'},
	body: null,
});

export type InsertQuery = {part: string; notifySubscribers?: boolean};

/** Step 1 of the resumable protocol: the video resource as JSON; the answer's Location header is the session URI. */
export const startUpload = (ep: Endpoints, query: InsertQuery, bodyJson: string, bytes: number, mimeType: string): RequestSpec => ({
	apiMethod: 'videos.insert',
	method: 'POST',
	url: `${ep.upload}/videos?${q({uploadType: 'resumable', part: query.part, ...(query.notifySubscribers === undefined ? {} : {notifySubscribers: String(query.notifySubscribers)})})}`,
	headers: {
		accept: 'application/json',
		'content-type': 'application/json; charset=UTF-8',
		'x-upload-content-length': String(bytes),
		'x-upload-content-type': mimeType,
	},
	body: bodyJson,
});

/** Step 3: one chunk of the file (Content-Range bytes start-end/total; end inclusive). */
export const uploadChunk = (sessionUri: string, mimeType: string, start: number, end: number, total: number, body: Buffer): RequestSpec => ({
	apiMethod: 'upload.chunk',
	method: 'PUT',
	url: sessionUri,
	headers: {'content-type': mimeType, 'content-range': `bytes ${start}-${end}/${total}`},
	body,
});

/** Step 4.1: ask how many bytes YouTube has (308 + Range), or get the finished upload's answer again (200/201). */
export const uploadStatus = (sessionUri: string, total: number): RequestSpec => ({
	apiMethod: 'upload.status',
	method: 'PUT',
	url: sessionUri,
	headers: {'content-range': `bytes */${total}`},
	body: Buffer.alloc(0),
});

export const setThumbnail = (ep: Endpoints, videoId: string, mimeType: string, content: Buffer): RequestSpec => ({
	apiMethod: 'thumbnails.set',
	method: 'POST',
	url: `${ep.upload}/thumbnails/set?${q({videoId, uploadType: 'media'})}`,
	headers: {accept: 'application/json', 'content-type': mimeType},
	body: content,
});

export type CaptionMeta = {videoId: string; language: string; name: string};

export const captionMetadata = (meta: CaptionMeta): {snippet: {videoId: string; language: string; name: string; isDraft: false}} => ({
	snippet: {videoId: meta.videoId, language: meta.language, name: meta.name, isDraft: false},
});

/** multipart/related: the caption resource as JSON, then the SRT bytes (uploadType=multipart). */
export const insertCaption = (ep: Endpoints, meta: CaptionMeta, content: Buffer, boundary = `uploader_${randomBytes(12).toString('hex')}`): RequestSpec => {
	if (content.includes(Buffer.from(boundary))) return insertCaption(ep, meta, content, `uploader_${randomBytes(12).toString('hex')}`);
	const body = Buffer.concat([
		Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(captionMetadata(meta))}\r\n--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`),
		content,
		Buffer.from(`\r\n--${boundary}--\r\n`),
	]);
	return {
		apiMethod: 'captions.insert',
		method: 'POST',
		url: `${ep.upload}/captions?${q({part: 'snippet', uploadType: 'multipart'})}`,
		headers: {accept: 'application/json', 'content-type': `multipart/related; boundary=${boundary}`},
		body,
	};
};

export const playlistItemBody = (playlistId: string, videoId: string) => ({snippet: {playlistId, resourceId: {kind: 'youtube#video', videoId}}});

export const addToPlaylist = (ep: Endpoints, playlistId: string, videoId: string): RequestSpec => ({
	apiMethod: 'playlistItems.insert',
	method: 'POST',
	url: `${ep.api}/playlistItems?${q({part: 'snippet'})}`,
	headers: {accept: 'application/json', 'content-type': 'application/json; charset=UTF-8'},
	body: JSON.stringify(playlistItemBody(playlistId, videoId)),
});

/** Checks whether the video is already in the playlist (used before retrying an insert whose answer was lost). */
export const findInPlaylist = (ep: Endpoints, playlistId: string, videoId: string): RequestSpec => ({
	apiMethod: 'playlistItems.list',
	method: 'GET',
	url: `${ep.api}/playlistItems?${q({part: 'id', playlistId, videoId})}`,
	headers: {accept: 'application/json'},
	body: null,
});

export const processingStatus = (ep: Endpoints, videoId: string): RequestSpec => ({
	apiMethod: 'videos.list',
	method: 'GET',
	url: `${ep.api}/videos?${q({part: 'processingDetails', id: videoId})}`,
	headers: {accept: 'application/json'},
	body: null,
});

export type ForcePrivateStatus = {selfDeclaredMadeForKids: boolean; containsSyntheticMedia: boolean};

/**
 * Emergency only: sets a video back to private when YouTube reports any other privacy after the upload. videos.update
 * deletes omitted status fields (publishAt included), which is the point here: nothing goes public on a timer.
 */
export const forcePrivate = (ep: Endpoints, videoId: string, status: ForcePrivateStatus): RequestSpec => ({
	apiMethod: 'videos.update',
	method: 'PUT',
	url: `${ep.api}/videos?${q({part: 'status'})}`,
	headers: {accept: 'application/json', 'content-type': 'application/json; charset=UTF-8'},
	body: JSON.stringify({id: videoId, status: {privacyStatus: 'private', selfDeclaredMadeForKids: status.selfDeclaredMadeForKids, containsSyntheticMedia: status.containsSyntheticMedia}}),
});

export const listCategories = (ep: Endpoints, regionCode: string): RequestSpec => ({
	apiMethod: 'videoCategories.list',
	method: 'GET',
	url: `${ep.api}/videoCategories?${q({part: 'snippet', regionCode})}`,
	headers: {accept: 'application/json'},
	body: null,
});

/**
 * The last line of defence: refuses to send any videos.insert or videos.update whose JSON does not say
 * privacyStatus "private" (an omitted value makes an inserted video public; an omitted value on update resets it).
 */
export class PrivacyGuardError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'PrivacyGuardError';
	}
}

export const assertPrivate = (request: RequestSpec): void => {
	if (request.apiMethod !== 'videos.insert' && request.apiMethod !== 'videos.update') return;
	let body: unknown;
	try {
		body = JSON.parse(typeof request.body === 'string' ? request.body : (request.body?.toString('utf8') ?? ''));
	} catch {
		throw new PrivacyGuardError(`Refusing ${request.apiMethod}: its body is not JSON, so its privacy cannot be checked.`);
	}
	const status = typeof body === 'object' && body !== null ? (body as {status?: {privacyStatus?: unknown}}).status : undefined;
	if (!status || status.privacyStatus !== 'private') {
		throw new PrivacyGuardError(`Refusing ${request.apiMethod}: status.privacyStatus must be "private" (it is ${JSON.stringify(status?.privacyStatus ?? null)}). An omitted value would make the video public.`);
	}
	if (request.apiMethod === 'videos.update' && !/[?&]part=status(?:&|$)/.test(request.url)) {
		throw new PrivacyGuardError('Refusing videos.update without part=status: the uploader only uses it to set a video back to private.');
	}
};
