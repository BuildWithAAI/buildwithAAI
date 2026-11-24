/**
 * Test support only: an in-process fake of the parts of YouTube and Google OAuth the uploader talks to, used as the
 * uploader's Transport. It keeps resumable sessions (bytes received, 308 + Range, 201 + the video resource), checks
 * headers the way the docs describe them, and can inject faults: lost connections, 5xx, partial chunks, expired
 * sessions, 401s, quota errors, a video reported as public. No test ever reaches Google.
 */
import {createHash} from 'node:crypto';
import {GOOGLE, SCOPE_FORCE_SSL, SCOPE_UPLOAD} from './contracts.ts';
import type {HttpRequest, HttpResponse, Transport} from './http.ts';

export type Recorded = {method: string; url: URL; headers: Record<string, string>; body: Buffer; label: string};

type Session = {id: string; total: number; mimeType: string; received: Buffer; metadata: Record<string, unknown>; videoId: string | null; response: Record<string, unknown> | null; expired: boolean};

export type Fault = {
	/** Which request: matched against the request label (e.g. "upload.chunk", "videos.insert", "captions.insert"). */
	on: string;
	/** Apply on the nth matching request (1-based). */
	nth: number;
	/**
	 * network: nothing reaches the server; the client sees a connection error.
	 * lost-answer: the server applies the request, the answer never arrives.
	 * partial: the server keeps only `keep` bytes of the chunk, then the connection drops.
	 * status: the server answers `status` (with `reason`) without applying anything.
	 */
	kind: 'network' | 'lost-answer' | 'partial' | 'status';
	status?: number;
	reason?: string;
	keep?: number;
	retryAfter?: string;
};

export type FakeYouTube = {
	transport: Transport;
	requests: Recorded[];
	sessions: Session[];
	faults: Fault[];
	channel: {id: string; title: string; handle: string};
	playlists: Map<string, string>;
	playlistItems: {id: string; playlistId: string; videoId: string}[];
	captions: {id: string; videoId: string; language: string; name: string; body: Buffer}[];
	thumbnails: {videoId: string; mimeType: string; body: Buffer}[];
	videos: Map<string, {bytes: Buffer; metadata: Record<string, unknown>; privacyStatus: string}>;
	/** Answer privacy as this value after an upload (simulates YouTube not honouring "private"). */
	reportPrivacy: string | null;
	/** Drop snippet.defaultAudioLanguage from the answer (simulates a field YouTube does not keep). */
	dropAudioLanguage: boolean;
	processing: string[];
	thumbnailError: {status: number; reason: string} | null;
	quotaExceeded: Set<string>;
	expiredAccessTokens: Set<string>;
	revokedRefreshTokens: Set<string>;
	grantedScope: string;
	/** Set from the consent URL's code_challenge: the token endpoint then checks the PKCE verifier against it. */
	pkceChallenge: string | null;
	issued: string[];
	count(label: string): number;
	byLabel(label: string): Recorded[];
};

const res = (status: number, body: unknown, headers: Record<string, string> = {}): HttpResponse => {
	const h = new Headers({'content-type': 'application/json; charset=UTF-8', ...headers});
	return {status, headers: {get: (name: string) => h.get(name)}, text: body === undefined ? '' : typeof body === 'string' ? body : JSON.stringify(body)};
};

const apiError = (status: number, reason: string, message = reason, headers: Record<string, string> = {}): HttpResponse => res(status, {error: {code: status, message, errors: [{reason, message}]}}, headers);

/** Splits a multipart/related body into its parts' headers and bytes. */
export const parseMultipart = (contentType: string, body: Buffer): {headers: string; body: Buffer}[] => {
	const boundary = /boundary=([^;]+)/.exec(contentType)?.[1];
	if (!boundary) throw new Error('no multipart boundary');
	const delimiter = Buffer.from(`--${boundary}`);
	const parts: {headers: string; body: Buffer}[] = [];
	let at = body.indexOf(delimiter);
	while (at !== -1) {
		const start = at + delimiter.length;
		if (body.subarray(start, start + 2).toString() === '--') break;
		const next = body.indexOf(delimiter, start);
		if (next === -1) break;
		const chunk = body.subarray(start + 2, next - 2); // skip CRLF after the delimiter and before the next one
		const split = chunk.indexOf('\r\n\r\n');
		parts.push({headers: chunk.subarray(0, split).toString(), body: chunk.subarray(split + 4)});
		at = next;
	}
	return parts;
};

export const createFakeYouTube = (opts: {channelId?: string; playlists?: Record<string, string>} = {}): FakeYouTube => {
	let n = 0;
	const id = (prefix: string) => `${prefix}${String(++n).padStart(4, '0')}`;
	const fake: FakeYouTube = {
		transport: async () => res(500, {}),
		requests: [],
		sessions: [],
		faults: [],
		channel: {id: opts.channelId ?? 'UCzooraFakeChannel000001', title: 'Zoora AI (test)', handle: '@zooratest'},
		playlists: new Map(Object.entries(opts.playlists ?? {})),
		playlistItems: [],
		captions: [],
		thumbnails: [],
		videos: new Map(),
		reportPrivacy: null,
		dropAudioLanguage: false,
		processing: [],
		thumbnailError: null,
		quotaExceeded: new Set(),
		expiredAccessTokens: new Set(),
		revokedRefreshTokens: new Set(),
		grantedScope: `${SCOPE_UPLOAD} ${SCOPE_FORCE_SSL}`,
		pkceChallenge: null,
		issued: ['at-0'],
		count: (label) => fake.requests.filter((r) => r.label === label).length,
		byLabel: (label) => fake.requests.filter((r) => r.label === label),
	};
	const seen = new Map<string, number>();

	const label = (r: HttpRequest, url: URL): string => {
		if (url.href.startsWith(GOOGLE.token)) return 'oauth.token';
		if (url.href.startsWith(GOOGLE.revoke)) return 'oauth.revoke';
		const path = url.pathname;
		if (path === '/upload/youtube/v3/videos' && url.searchParams.get('upload_id')) return (r.headers['content-range'] ?? '').startsWith('bytes */') ? 'upload.status' : 'upload.chunk';
		if (path === '/upload/youtube/v3/videos') return 'videos.insert';
		if (path === '/upload/youtube/v3/thumbnails/set') return 'thumbnails.set';
		if (path === '/upload/youtube/v3/captions') return 'captions.insert';
		if (path === '/youtube/v3/channels') return 'channels.list';
		if (path === '/youtube/v3/playlists') return 'playlists.list';
		if (path === '/youtube/v3/playlistItems') return r.method === 'POST' ? 'playlistItems.insert' : 'playlistItems.list';
		if (path === '/youtube/v3/videos') return r.method === 'PUT' ? 'videos.update' : 'videos.list';
		if (path === '/youtube/v3/videoCategories') return 'videoCategories.list';
		return 'unknown';
	};

	const videoResource = (s: Session): Record<string, unknown> => {
		const meta = s.metadata;
		const snippet: Record<string, unknown> = {...((meta.snippet as Record<string, unknown>) ?? {}), channelId: fake.channel.id};
		if (fake.dropAudioLanguage) delete snippet.defaultAudioLanguage;
		const status = {...((meta.status as Record<string, unknown>) ?? {})};
		status.privacyStatus = fake.reportPrivacy ?? status.privacyStatus ?? 'public'; // the real API defaults to public
		status.uploadStatus = 'uploaded';
		return {kind: 'youtube#video', id: s.videoId, snippet, status, ...(meta.localizations ? {localizations: meta.localizations} : {})};
	};

	const handle = (r: HttpRequest, url: URL, name: string, body: Buffer, fault: Fault | null): HttpResponse => {
		if (name === 'oauth.token') {
			const form = new URLSearchParams(body.toString());
			if (form.get('grant_type') === 'refresh_token') {
				if (fake.revokedRefreshTokens.has(form.get('refresh_token') ?? '')) return res(400, {error: 'invalid_grant', error_description: 'Token has been expired or revoked.'});
				const token = id('at-');
				fake.issued.push(token);
				return res(200, {access_token: token, expires_in: 3599, scope: fake.grantedScope, token_type: 'Bearer'});
			}
			if (form.get('grant_type') === 'authorization_code') {
				const verifier = form.get('code_verifier') ?? '';
				const expected = fake.pkceChallenge;
				if (form.get('code') !== 'test-code' || !verifier || (expected && createHash('sha256').update(verifier).digest('base64url') !== expected)) return res(400, {error: 'invalid_grant'});
				const token = id('at-');
				fake.issued.push(token);
				return res(200, {access_token: token, expires_in: 3599, refresh_token: 'rt-new', scope: fake.grantedScope, token_type: 'Bearer'});
			}
			return res(400, {error: 'unsupported_grant_type'});
		}
		if (name === 'oauth.revoke') return res(200, {});

		const token = (r.headers.authorization ?? '').replace(/^Bearer /, '');
		if (!fake.issued.includes(token) || fake.expiredAccessTokens.has(token)) return apiError(401, 'authError', 'Request had invalid authentication credentials.');
		if (fake.quotaExceeded.has(name)) return apiError(403, 'quotaExceeded', 'The request cannot be completed because you have exceeded your quota.');
		if (fault?.kind === 'status') return apiError(fault.status ?? 503, fault.reason ?? 'backendError', 'injected', fault.retryAfter ? {'retry-after': fault.retryAfter} : {});

		switch (name) {
			case 'channels.list':
				return res(200, {kind: 'youtube#channelListResponse', items: [{kind: 'youtube#channel', id: fake.channel.id, snippet: {title: fake.channel.title, customUrl: fake.channel.handle}}]});
			case 'playlists.list': {
				const pid = url.searchParams.get('id') ?? '';
				const owner = fake.playlists.get(pid);
				return res(200, {items: owner ? [{id: pid, snippet: {channelId: owner, title: 'Test playlist'}}] : []});
			}
			case 'videos.insert': {
				if (url.searchParams.get('uploadType') !== 'resumable') return apiError(400, 'badRequest');
				const total = Number(r.headers['x-upload-content-length']);
				const mimeType = r.headers['x-upload-content-type'] ?? '';
				if (!Number.isInteger(total) || total <= 0 || !mimeType || !(r.headers['content-type'] ?? '').startsWith('application/json')) return apiError(400, 'badRequest', 'missing upload headers');
				const metadata = JSON.parse(body.toString('utf8')) as Record<string, unknown>;
				const sid = id('sess');
				fake.sessions.push({id: sid, total, mimeType, received: Buffer.alloc(0), metadata, videoId: null, response: null, expired: false});
				return res(200, '', {location: `${GOOGLE.upload}/videos?uploadType=resumable&upload_id=${sid}&part=${url.searchParams.get('part')}`});
			}
			case 'upload.status':
			case 'upload.chunk': {
				const s = fake.sessions.find((x) => x.id === url.searchParams.get('upload_id'));
				if (!s || s.expired) return apiError(404, 'notFound', 'upload session not found');
				if (s.response) return res(201, s.response);
				const range = r.headers['content-range'] ?? '';
				const incomplete = () => res(308, '', s.received.length ? {range: `bytes=0-${s.received.length - 1}`} : {});
				if (name === 'upload.status') {
					if (range !== `bytes */${s.total}`) return apiError(400, 'badContentRange');
					return incomplete();
				}
				const m = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(range);
				if (!m || Number(m[3]) !== s.total || Number(m[2]) - Number(m[1]) + 1 !== body.length) return apiError(400, 'badContentRange', `bad Content-Range ${range}`);
				if (r.headers['content-type'] !== s.mimeType) return apiError(400, 'badContentType');
				if (Number(m[1]) !== s.received.length) return incomplete(); // non-contiguous: nothing stored, per the docs
				const keep = fault?.kind === 'partial' ? Math.min(fault.keep ?? 0, body.length) : body.length;
				s.received = Buffer.concat([s.received, body.subarray(0, keep)]);
				if (s.received.length === s.total) {
					s.videoId = id('vid').padEnd(11, 'x').slice(0, 11);
					s.response = videoResource(s);
					fake.videos.set(s.videoId, {bytes: s.received, metadata: s.metadata, privacyStatus: String((s.response.status as Record<string, unknown>).privacyStatus)});
					fake.processing.length || fake.processing.push('succeeded');
					return res(201, s.response);
				}
				return incomplete();
			}
			case 'thumbnails.set': {
				const vid = url.searchParams.get('videoId') ?? '';
				if (!fake.videos.has(vid)) return apiError(404, 'videoNotFound');
				if (fake.thumbnailError) return apiError(fake.thumbnailError.status, fake.thumbnailError.reason);
				fake.thumbnails.push({videoId: vid, mimeType: r.headers['content-type'] ?? '', body});
				return res(200, {kind: 'youtube#thumbnailSetResponse', items: [{default: {url: 'https://i.ytimg.com/x.jpg'}}]});
			}
			case 'captions.insert': {
				const parts = parseMultipart(r.headers['content-type'] ?? '', body);
				const meta = JSON.parse(parts[0]?.body.toString('utf8') ?? '{}') as {snippet?: {videoId?: string; language?: string; name?: string}};
				const sn = meta.snippet ?? {};
				if (!sn.videoId || !fake.videos.has(sn.videoId)) return apiError(404, 'videoNotFound');
				if (!sn.language || !sn.name) return apiError(400, 'invalidMetadata');
				if (fake.captions.some((c) => c.videoId === sn.videoId && c.language === sn.language && c.name === sn.name)) return apiError(409, 'captionExists');
				const cid = id('cap');
				fake.captions.push({id: cid, videoId: sn.videoId, language: sn.language, name: sn.name, body: parts[1]?.body ?? Buffer.alloc(0)});
				return res(200, {kind: 'youtube#caption', id: cid, snippet: sn});
			}
			case 'playlistItems.insert': {
				const b = JSON.parse(body.toString('utf8')) as {snippet: {playlistId: string; resourceId: {videoId: string}}};
				if (!fake.playlists.has(b.snippet.playlistId)) return apiError(404, 'playlistNotFound');
				const pid = id('pli');
				fake.playlistItems.push({id: pid, playlistId: b.snippet.playlistId, videoId: b.snippet.resourceId.videoId});
				return res(200, {kind: 'youtube#playlistItem', id: pid, snippet: b.snippet});
			}
			case 'playlistItems.list': {
				const found = fake.playlistItems.filter((p) => p.playlistId === url.searchParams.get('playlistId') && p.videoId === url.searchParams.get('videoId'));
				return res(200, {items: found.map((p) => ({id: p.id}))});
			}
			case 'videos.list': {
				const status = fake.processing.length > 1 ? (fake.processing.shift() ?? 'succeeded') : (fake.processing[0] ?? 'succeeded');
				return res(200, {items: [{id: url.searchParams.get('id'), processingDetails: {processingStatus: status}}]});
			}
			case 'videos.update': {
				const b = JSON.parse(body.toString('utf8')) as {id: string; status: {privacyStatus?: string}};
				const video = fake.videos.get(b.id);
				if (!video) return apiError(404, 'videoNotFound');
				video.privacyStatus = b.status.privacyStatus ?? 'public';
				return res(200, {id: b.id, status: {privacyStatus: video.privacyStatus}});
			}
			case 'videoCategories.list':
				return res(200, {items: [{id: '28', snippet: {title: 'Science & Technology', assignable: true}}, {id: '19', snippet: {title: 'Travel & Events', assignable: true}}, {id: '18', snippet: {title: 'Short Movies', assignable: false}}]});
			default:
				return apiError(404, 'notFound', `fake has no ${r.method} ${url.pathname}`);
		}
	};

	fake.transport = async (r) => {
		const url = new URL(r.url);
		const body = r.body === null ? Buffer.alloc(0) : typeof r.body === 'string' ? Buffer.from(r.body) : Buffer.from(r.body);
		const headers = Object.fromEntries(Object.entries(r.headers).map(([k, v]) => [k.toLowerCase(), v]));
		const name = label(r, url);
		fake.requests.push({method: r.method, url, headers, body, label: name});
		const count = (seen.get(name) ?? 0) + 1;
		seen.set(name, count);
		const faultIndex = fake.faults.findIndex((f) => f.on === name && f.nth === count);
		const fault = faultIndex >= 0 ? (fake.faults.splice(faultIndex, 1)[0] ?? null) : null;
		if (fault?.kind === 'network') throw new TypeError('fetch failed (injected: connection reset)');
		const answer = handle({...r, headers}, url, name, body, fault);
		if (fault?.kind === 'lost-answer' || fault?.kind === 'partial') throw new TypeError('fetch failed (injected: connection lost before the answer)');
		return answer;
	};
	return fake;
};
