/**
 * The upload plan: exactly what "upload --apply" will send for one approved render, its quota cost, the digest the
 * approval record binds, and the YouTube Studio steps that stay manual. Pure: no network, no clock.
 */
import {type ApiMethod, type Endpoints, QUOTA} from './contracts.ts';
import type {UploadInputs} from './inputs.ts';
import {addToPlaylist, channelCheck, insertCaption, type InsertQuery, playlistCheck, processingStatus, type RequestSpec, setThumbnail, startUpload, uploadChunk} from './requests.ts';
import {formatInZone} from './time.ts';
import {canonicalJson, formatBytes, sha256Hex} from './util.ts';

/** The video resource sent when the upload starts. privacyStatus is a literal: there is no code path that sends another value. */
export type VideoResourceBody = {
	snippet: {title: string; description: string; tags?: string[]; categoryId: string; defaultLanguage: string; defaultAudioLanguage: string};
	status: {
		privacyStatus: 'private';
		publishAt?: string;
		selfDeclaredMadeForKids: boolean;
		containsSyntheticMedia: boolean;
		embeddable?: boolean;
		license?: 'youtube' | 'creativeCommon';
		publicStatsViewable?: boolean;
	};
	localizations?: Record<string, {title: string; description: string}>;
};

export const DIGEST_PARTS = ['video', 'insert', 'thumbnail', 'captions', 'playlist', 'storyboard'] as const;
export type DigestPart = (typeof DIGEST_PARTS)[number];

export type UploadPlan = {
	version: 1;
	channel: string;
	slug: string;
	renderId: string;
	renderKind: 'long' | 'short';
	publishAt: string | null;
	insert: {query: InsertQuery; body: VideoResourceBody};
	video: {rel: string; bytes: number; sha256: string; mimeType: string};
	thumbnail: {rel: string; bytes: number; sha256: string; mimeType: 'image/png' | 'image/jpeg'; width: number; height: number; afterProcessing: boolean} | null;
	captions: {language: string; name: string; source: 'kit' | 'file'; rel: string | null; bytes: number; sha256: string}[];
	playlistId: string | null;
	storyboard: {rel: string; version: number; sha256: string};
	digest: {sha256: string; parts: Record<DigestPart, string>};
	quota: {defaultUnits: number; uploadCalls: number; lines: {method: ApiMethod; calls: number; units: number; note: string}[]};
	paidPromotion: boolean;
	settingsReasons: string[];
	studioSteps: string[];
	warnings: string[];
};

export type PlanOptions = {
	/** UTC ISO publish time from the approval record (or approve --publish-at); null keeps the video private. */
	publishAt: string | null;
	/** Most processing checks before a Short's thumbnail (1 unit each). */
	processingPolls: number;
};

export const buildInsertBody = (inputs: UploadInputs, publishAt: string | null): VideoResourceBody => {
	const hasLocalizations = Object.keys(inputs.localizations).length > 0;
	return {
		snippet: {
			title: inputs.title,
			description: inputs.description,
			...(inputs.tags.length ? {tags: inputs.tags} : {}),
			categoryId: inputs.categoryId,
			defaultLanguage: inputs.defaultLanguage,
			defaultAudioLanguage: inputs.audioLanguage,
		},
		status: {
			privacyStatus: 'private',
			...(publishAt ? {publishAt} : {}),
			selfDeclaredMadeForKids: inputs.kit.settings.madeForKids,
			containsSyntheticMedia: inputs.kit.settings.containsSyntheticMedia,
			...(inputs.extras.embeddable !== undefined ? {embeddable: inputs.extras.embeddable} : {}),
			...(inputs.extras.license !== undefined ? {license: inputs.extras.license} : {}),
			...(inputs.extras.publicStatsViewable !== undefined ? {publicStatsViewable: inputs.extras.publicStatsViewable} : {}),
		},
		...(hasLocalizations ? {localizations: inputs.localizations} : {}),
	};
};

const studioSteps = (inputs: UploadInputs, plan: Pick<UploadPlan, 'publishAt' | 'thumbnail' | 'renderKind'>): string[] => {
	const steps: string[] = [];
	const settings = inputs.kit.settings;
	const paidReason = (settings.reasons.find((r) => r.startsWith('paidPromotion=')) ?? `paidPromotion=${settings.paidPromotion}`).replace(/\.+$/, '');
	steps.push(
		settings.paidPromotion
			? `Paid promotion: in Studio > Content > this video > Details > Paid promotion, tick "My video contains paid promotion like a product placement, sponsorship, or endorsement" BEFORE it goes public (${paidReason}). The uploader does not send paidProductPlacementDetails because YouTube's docs disagree on whether it can be set.`
			: `Paid promotion: confirm the Studio "Paid promotion" box is unticked (${paidReason}). The uploader does not send paidProductPlacementDetails; since 2026-11-16 an upload that omits it is not declared free of paid placement.`,
	);
	steps.push(
		plan.publishAt
			? `Scheduled: YouTube publishes it at ${formatInZone(Date.parse(plan.publishAt))} unless you change it in Studio. Every Studio step above it must be done first.`
			: 'It stays private: publish or schedule it in Studio when you are ready.',
	);
	if (plan.renderKind === 'long') {
		steps.push('End screen and cards: add them in Studio (no API). End screens need a video of 25 s or more and are not allowed on made-for-kids videos.');
		steps.push("Pinned comment: post pinned-comment.txt from the publish kit and pin it (Studio or the watch page); the uploader doesn't post comments.");
		const variants = inputs.kit.renders.filter((r) => r.kind === 'thumbnail').length;
		if (plan.thumbnail && variants > 1) steps.push(`Test & Compare: the API sets one thumbnail (${plan.thumbnail.rel}); add the other ${variants - 1} variant(s) in Studio if you want an A/B test. Changing the title or thumbnail later stops a running test.`);
	} else {
		steps.push('Related video: in Studio, link this Short to the full episode (links in Shorts descriptions are not clickable).');
	}
	if (!plan.thumbnail) steps.push('Thumbnail: none is uploaded; pick one in Studio.');
	if (Object.keys(inputs.localizations).length) {
		steps.push('Dubbed audio: upload each language track in Studio > Languages > this video > Add language > Dub > Add (desktop only; the API has no audio-track method). Delete YouTube\'s auto-dub for that language first.');
		steps.push('Localized thumbnails: Studio > Languages > language > Thumbnail > Add (no API).');
	}
	return steps;
};

export const buildPlan = (inputs: UploadInputs, opts: PlanOptions): UploadPlan => {
	const body = buildInsertBody(inputs, opts.publishAt);
	const query: InsertQuery = {part: body.localizations ? 'snippet,status,localizations' : 'snippet,status', ...(inputs.extras.notifySubscribers !== undefined ? {notifySubscribers: inputs.extras.notifySubscribers} : {})};
	const video = {rel: inputs.video.rel, bytes: inputs.video.bytes, sha256: inputs.video.sha256, mimeType: inputs.video.mimeType};
	const thumbnail = inputs.thumbnail
		? {rel: inputs.thumbnail.rel, bytes: inputs.thumbnail.bytes, sha256: inputs.thumbnail.sha256, mimeType: inputs.thumbnail.mimeType, width: inputs.thumbnail.width, height: inputs.thumbnail.height, afterProcessing: inputs.render.kind === 'short'}
		: null;
	const captions = inputs.captions.map((c) => ({language: c.language, name: c.name, source: c.source, rel: c.rel, bytes: c.bytes, sha256: c.sha256}));
	const storyboard = {rel: inputs.storyboard.rel, version: inputs.storyboard.version, sha256: inputs.storyboard.sha256};

	const partValues: Record<DigestPart, unknown> = {
		video: {sha256: video.sha256, bytes: video.bytes, mimeType: video.mimeType},
		insert: {query, body},
		thumbnail: thumbnail ? {sha256: thumbnail.sha256, bytes: thumbnail.bytes, mimeType: thumbnail.mimeType, afterProcessing: thumbnail.afterProcessing} : null,
		captions: captions.map((c) => ({language: c.language, name: c.name, sha256: c.sha256, bytes: c.bytes})),
		playlist: inputs.playlistId ? {playlistId: inputs.playlistId} : null,
		storyboard: {version: storyboard.version, sha256: storyboard.sha256},
	};
	const parts = Object.fromEntries(DIGEST_PARTS.map((p) => [p, sha256Hex(canonicalJson(partValues[p]))])) as Record<DigestPart, string>;
	const digest = {sha256: sha256Hex(canonicalJson(parts)), parts};

	const lines: UploadPlan['quota']['lines'] = [];
	const add = (method: ApiMethod, calls: number, note: string) => {
		if (calls > 0) lines.push({method, calls, units: QUOTA[method].cost * calls, note});
	};
	add('channels.list', 1, 'check the signed-in channel');
	add('playlists.list', inputs.playlistId ? 1 : 0, 'check the playlist exists on this channel');
	add('videos.insert', 1, 'the upload itself, from the separate Video Uploads bucket of 100 calls a day');
	add('videos.list', thumbnail?.afterProcessing ? opts.processingPolls : 0, "at most; waits for a Short's processing before its thumbnail");
	add('thumbnails.set', thumbnail ? 1 : 0, 'custom thumbnail');
	add('captions.insert', captions.length, 'one per caption track');
	add('playlistItems.insert', inputs.playlistId ? 1 : 0, 'add to the playlist');
	const defaultUnits = lines.filter((l) => QUOTA[l.method].bucket === 'default').reduce((n, l) => n + l.units, 0);
	const uploadCalls = lines.filter((l) => QUOTA[l.method].bucket === 'uploads').reduce((n, l) => n + l.calls, 0);

	const plan: UploadPlan = {
		version: 1,
		channel: inputs.channel,
		slug: inputs.slug,
		renderId: inputs.render.id,
		renderKind: inputs.render.kind,
		publishAt: opts.publishAt,
		insert: {query, body},
		video,
		thumbnail,
		captions,
		playlistId: inputs.playlistId,
		storyboard,
		digest,
		quota: {defaultUnits, uploadCalls, lines},
		paidPromotion: inputs.kit.settings.paidPromotion,
		settingsReasons: inputs.kit.settings.reasons,
		studioSteps: [],
		warnings: [...inputs.warnings],
	};
	plan.studioSteps = studioSteps(inputs, plan);
	return plan;
};

/* ------------------------------------------------------------------ printing */

const VIDEO_ID = '<new video id>';
const SESSION = '<upload session URI from the Location header>';

const showRequest = (request: RequestSpec, bodyNote?: string): string[] => {
	const lines = [`  ${request.method} ${request.url.replace(/%3C(.+?)%3E/g, (_, inner: string) => `<${decodeURIComponent(inner.replace(/\+/g, ' '))}>`)}`, '  authorization: Bearer <access token>'];
	for (const [name, value] of Object.entries(request.headers)) lines.push(`  ${name}: ${value}`);
	if (bodyNote) lines.push(`  body: ${bodyNote}`);
	else if (typeof request.body === 'string' && request.body) {
		lines.push('  body:');
		lines.push(...JSON.stringify(JSON.parse(request.body), null, 2).split('\n').map((l) => `    ${l}`));
	}
	return lines;
};

/** The plan as the owner reads it: every request with its headers and body, the quota, and the Studio steps. */
export const renderPlan = (plan: UploadPlan, ep: Endpoints, opts: {chunkBytes: number; header: string[]}): string => {
	const out: string[] = [...opts.header, ''];
	let n = 0;
	const step = (title: string, method: ApiMethod, request: RequestSpec, bodyNote?: string) => {
		n++;
		const q = QUOTA[method];
		out.push(`${n}. ${title}  [${method}: ${q.bucket === 'uploads' ? '1 call of the 100-a-day upload bucket' : `${q.cost} unit${q.cost === 1 ? '' : 's'}`}]`);
		out.push(...showRequest(request, bodyNote), '');
	};
	step('Confirm the signed-in channel', 'channels.list', channelCheck(ep));
	if (plan.playlistId) step(`Confirm playlist ${plan.playlistId} belongs to that channel`, 'playlists.list', playlistCheck(ep, plan.playlistId));
	step('Start the resumable upload (always private)', 'videos.insert', startUpload(ep, plan.insert.query, JSON.stringify(plan.insert.body), plan.video.bytes, plan.video.mimeType));
	const chunks = Math.max(1, Math.ceil(plan.video.bytes / opts.chunkBytes));
	const first = uploadChunk(SESSION, plan.video.mimeType, 0, Math.min(opts.chunkBytes, plan.video.bytes) - 1, plan.video.bytes, Buffer.alloc(0));
	out.push(`   then ${chunks} PUT request${chunks === 1 ? '' : 's'} of up to ${formatBytes(opts.chunkBytes)} to the session URI, e.g.`);
	out.push(...showRequest(first, `bytes 0-${Math.min(opts.chunkBytes, plan.video.bytes) - 1} of ${plan.video.rel}`).map((l) => ` ${l}`));
	out.push(`   file: ${plan.video.rel} (${formatBytes(plan.video.bytes)}, sha256 ${plan.video.sha256})`, '');
	if (plan.thumbnail) {
		if (plan.thumbnail.afterProcessing) {
			n++;
			out.push(`${n}. Wait until YouTube finishes processing the Short (thumbnails.set needs it)  [videos.list: 1 unit per check]`);
			out.push(...showRequest(processingStatus(ep, VIDEO_ID)), '');
		}
		step('Set the custom thumbnail', 'thumbnails.set', setThumbnail(ep, VIDEO_ID, plan.thumbnail.mimeType, Buffer.alloc(0)), `${plan.thumbnail.rel} (${plan.thumbnail.width}x${plan.thumbnail.height}, ${formatBytes(plan.thumbnail.bytes)}, sha256 ${plan.thumbnail.sha256})`);
	}
	for (const c of plan.captions) {
		const request = insertCaption(ep, {videoId: VIDEO_ID, language: c.language, name: c.name}, Buffer.alloc(0), '<boundary>');
		step(`Add the ${c.language} captions "${c.name}"`, 'captions.insert', request, `multipart/related: {"snippet":{"videoId":"${VIDEO_ID}","language":"${c.language}","name":"${c.name}","isDraft":false}} then ${c.rel ?? 'kit.json captions.srt'} (${formatBytes(c.bytes)}, sha256 ${c.sha256})`);
	}
	if (plan.playlistId) step(`Add the video to playlist ${plan.playlistId}`, 'playlistItems.insert', addToPlaylist(ep, plan.playlistId, VIDEO_ID));

	out.push(`Quota: ${plan.quota.defaultUnits} units of the 10,000-a-day bucket (at most) and ${plan.quota.uploadCalls} upload call of 100 a day.`);
	for (const l of plan.quota.lines) out.push(`  ${l.method} x${l.calls} = ${QUOTA[l.method].bucket === 'uploads' ? `${l.calls} upload call${l.calls === 1 ? '' : 's'}` : `${l.units} unit${l.units === 1 ? '' : 's'}`}: ${l.note}`);
	out.push('  Only if YouTube ever reports the video as not private: videos.update (50 units) sets it back to private at once.');
	out.push('', 'Settings sent: privacyStatus "private" (always); ' + (plan.publishAt ? `publishAt ${plan.publishAt} (${formatInZone(Date.parse(plan.publishAt))})` : 'no publishAt (stays private)') + `; selfDeclaredMadeForKids ${plan.insert.body.status.selfDeclaredMadeForKids}; containsSyntheticMedia ${plan.insert.body.status.containsSyntheticMedia}.`);
	for (const reason of plan.settingsReasons) out.push(`  ${reason}`);
	out.push('', 'Not sent: do these in YouTube Studio');
	plan.studioSteps.forEach((s, i) => out.push(`  ${i + 1}. ${s}`));
	if (plan.warnings.length) {
		out.push('', 'Warnings');
		for (const w of plan.warnings) out.push(`  - ${w}`);
	}
	out.push('', `Plan digest ${plan.digest.sha256} (storyboard v${plan.storyboard.version} ${plan.storyboard.sha256.slice(0, 12)}…, render ${plan.video.sha256.slice(0, 12)}…)`);
	return `${out.join('\n')}\n`;
};
