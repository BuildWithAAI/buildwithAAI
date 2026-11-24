/**
 * YouTube Data API v3 and Google OAuth contracts the uploader relies on. Every value below was read directly on
 * 2026-11-24 from the official pages (developers.google.com and support.google.com answered through the session
 * proxy that day), plus the live discovery document. Page dates are the "Last updated" line of each page.
 *
 * - videos.insert (updated 2026-11-23): https://developers.google.com/youtube/v3/docs/videos/insert
 *   POST https://www.googleapis.com/upload/youtube/v3/videos, max 256 GB, video/* or application/octet-stream.
 *   "Quota impact: 100 calls per day. A call to this method has a quota cost of 1 unit in the Video Uploads quota
 *   bucket." Settable on insert: snippet.title, .description, .tags[], .categoryId, .defaultLanguage,
 *   localizations.(key).title/.description, status.embeddable, .license, .privacyStatus, .publicStatsViewable,
 *   .publishAt, .selfDeclaredMadeForKids, .containsSyntheticMedia, recordingDetails.recordingDate.
 *   "status.privacyStatus: If you don't specify a value for this property, the uploaded video's privacy status
 *   defaults to public." Error defaultLanguageNotSet: localizations need snippet.defaultLanguage.
 * - video resource (updated 2026-11-23): https://developers.google.com/youtube/v3/docs/videos
 *   status.publishAt: ISO 8601, "can be set only if the privacy status of the video is private", only for a video
 *   that was never published; a time in the past publishes the video right away. snippet.tags[]: 500 characters,
 *   commas count, a tag with a space counts its quotation marks. snippet.defaultAudioLanguage: "the language spoken in
 *   the video's default audio track" (described, but NOT in the insert/update "you can set" lists: we send it and
 *   read it back). paidProductPlacementDetails.hasPaidProductPlacement: described as "Set to true if ...", a valid
 *   videos.insert part name but absent from the insert/update "you can set" lists, while the revision history
 *   (November 16, 2026, read again 2026-11-24) says "If you don't specify a value for the property in a
 *   videos.insert or videos.update request, the video isn't declared as free of paid product placement". The pages
 *   disagree, so the uploader never sends it (CLAUDE.md keeps it a Studio step) and never schedules a video with paid
 *   promotion: it would go public undeclared if the Studio step were missed (approval.ts paidScheduleReason).
 * - playlistItems.list (updated 2026-11-12, read 2026-11-24): 1 unit; maxResults 0-50 (default 5); parts
 *   contentDetails, id, snippet, status. The official "my uploads" sample reads channels.list (mine=true,
 *   part=contentDetails) relatedPlaylists.uploads, then playlistItems.list on it with maxResults 50: the uploader's
 *   duplicate check before a new upload session.
 * - videos.update (updated 2026-11-12): https://developers.google.com/youtube/v3/docs/videos/update , 50 units.
 *   A part that is sent but omits a mutable property DELETES it ("the existing privacy setting will be removed and the
 *   video will revert to the default privacy setting"), except selfDeclaredMadeForKids and containsSyntheticMedia.
 *   The uploader calls it only to force a video back to private, always with privacyStatus "private".
 * - Resumable uploads (updated 2026-11-12): https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol
 *   Start: POST .../upload/youtube/v3/videos?uploadType=resumable&part=..., JSON body, headers X-Upload-Content-Length
 *   and X-Upload-Content-Type; 200 with a Location header (the session URI). Upload: PUT the bytes; 201 = done. Resume
 *   after a lost connection or 500/502/503/504 with exponential backoff: PUT with Content-Length 0 and a
 *   Content-Range of "bytes", a star, then "/TOTAL"; 308 with "Range: bytes=0-N" (no Range = nothing stored); honour
 *   Retry-After; 404 = the session expired, start over. Chunks must be multiples of 256 KB (except the last).
 * - Upload guide sample (updated 2026-11-23): https://developers.google.com/youtube/v3/guides/uploading_a_video
 *   MAX_RETRIES 10, retriable 500/502/503/504, sleep random() * 2^retry seconds.
 * - thumbnails.set (updated 2026-11-12): https://developers.google.com/youtube/v3/docs/thumbnails/set
 *   POST https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=..., 50 MB, image/jpeg or image/png,
 *   about 50 units. For a Short, call it only after processingDetails.processingStatus is "succeeded". 403 forbidden
 *   when the account may not set custom thumbnails; 429 uploadRateLimitExceeded. Custom thumbnails need a verified
 *   account (YouTube Help 72431, https://support.google.com/youtube/answer/72431).
 * - captions.insert (updated 2026-11-12): https://developers.google.com/youtube/v3/docs/captions/insert
 *   POST https://www.googleapis.com/upload/youtube/v3/captions?part=snippet, 400 units, 100 MB, scopes
 *   youtube.force-ssl or youtubepartner only. Required snippet.videoId, .language (BCP-47), .name (<= 150 chars).
 *   409 captionExists for a second track with the same language and name. SRT must be plain UTF-8 (Help 2734698).
 * - playlistItems.insert (updated 2026-11-12): https://developers.google.com/youtube/v3/docs/playlistItems/insert
 *   POST https://www.googleapis.com/youtube/v3/playlistItems?part=snippet, 50 units.
 * - Quota calculator (updated 2026-11-12): https://developers.google.com/youtube/v3/determine_quota_cost
 *   10,000 units a day for all methods except search.list and videos.insert, which have their own buckets of 100
 *   calls a day at 1 per call; reset at midnight Pacific Time; invalid requests cost at least 1. This settles the
 *   earlier 1600-unit conflict (revision history 2025-12-04: ~1600 -> ~100; 2026-06-01: separate buckets).
 * - Revision history: https://developers.google.com/youtube/v3/revision_history (2026-11-02: omitted privacyStatus
 *   = public, unverified projects are no longer locked to private).
 * - Discovery document rev 20261123: https://www.googleapis.com/discovery/v1/apis/youtube/v3/rest . 83 methods and
 *   none uploads audio tracks: multi-language audio is a Studio step (Help 13338784, desktop Studio only).
 *   channels.list, playlists.list, videos.list and videos.update accept youtube.force-ssl but not youtube.upload.
 * - OAuth for installed apps (updated 2026-11-19): https://developers.google.com/identity/protocols/oauth2/native-app
 *   loopback redirect http://127.0.0.1:<port>, PKCE S256, refresh tokens always returned, users may grant only some
 *   scopes (check the "scope" field). Refresh-token expiry (updated 2026-11-19):
 *   https://developers.google.com/identity/protocols/oauth2#expiration : External + "Testing" = 7 days.
 *   App audience (https://support.google.com/cloud/answer/15549945): "Personal" apps have no 7-day expiry, no
 *   verification and no unverified-app screen, for the one Google Account that created the app.
 */

export type Endpoints = {upload: string; api: string; auth: string; token: string; revoke: string};

export const GOOGLE: Endpoints = {
	upload: 'https://www.googleapis.com/upload/youtube/v3',
	api: 'https://www.googleapis.com/youtube/v3',
	auth: 'https://accounts.google.com/o/oauth2/v2/auth',
	token: 'https://oauth2.googleapis.com/token',
	revoke: 'https://oauth2.googleapis.com/revoke',
};

export const SCOPE_UPLOAD = 'https://www.googleapis.com/auth/youtube.upload';
export const SCOPE_FORCE_SSL = 'https://www.googleapis.com/auth/youtube.force-ssl';
/** Requested together. youtube.force-ssl is required: captions.insert, channels.list, playlists.list and videos.list need it. */
export const SCOPES = [SCOPE_UPLOAD, SCOPE_FORCE_SSL] as const;

export type Bucket = 'default' | 'uploads';

/** Quota per call (Quota Calculator, updated 2026-11-12). */
export const QUOTA = {
	'videos.insert': {bucket: 'uploads', cost: 1},
	'videos.list': {bucket: 'default', cost: 1},
	'videos.update': {bucket: 'default', cost: 50},
	'thumbnails.set': {bucket: 'default', cost: 50},
	'captions.insert': {bucket: 'default', cost: 400},
	'playlistItems.insert': {bucket: 'default', cost: 50},
	'playlistItems.list': {bucket: 'default', cost: 1},
	'playlists.list': {bucket: 'default', cost: 1},
	'channels.list': {bucket: 'default', cost: 1},
	'videoCategories.list': {bucket: 'default', cost: 1},
} as const satisfies Record<string, {bucket: Bucket; cost: number}>;
export type ApiMethod = keyof typeof QUOTA;

/** Project defaults (Quota Calculator). Raise them in channels.json only if Google granted more. */
export const DAILY_LIMITS = {defaultUnits: 10_000, uploadCalls: 100} as const;

export const LIMITS = {
	titleChars: 100, // same limit the publish kit applies (scripts/publish-kit/limits.ts)
	descriptionBytes: 5000,
	tagsChars: 500,
	captionNameChars: 150,
	videoMaxBytes: 274_877_906_944, // 256 GiB (discovery maxSize)
	thumbnailMaxBytes: 52_428_800, // 50 MiB since 2026-09-14
	thumbnailMinWidth: 640, // Help 72431
	captionMaxBytes: 104_857_600, // 100 MiB
	chunkMultiple: 262_144, // 256 KiB
} as const;

/** Retry policy from the official upload sample: up to 10 retries, full-jitter backoff of random() * 2^n seconds. */
export const RETRY = {maxRetries: 10, retriableStatus: [500, 502, 503, 504], maxDelayMs: 120_000} as const;

/** The pipeline's language codes (src/episode/types.ts Lang) as BCP-47 tags for YouTube. Override per upload in the spec. */
export const LANGUAGE_TAGS: Record<string, string> = {
	en: 'en',
	es: 'es',
	'pt-br': 'pt-BR',
	hi: 'hi',
	it: 'it',
	zh: 'zh-Hans',
	ja: 'ja',
};

/** The owner's time zone (CLAUDE.md, 2026-11-24): publish times without an offset are read in it. */
export const OWNER_TIME_ZONE = 'America/Chicago';
/** YouTube's daily quota resets at midnight Pacific Time. */
export const QUOTA_TIME_ZONE = 'America/Los_Angeles';
