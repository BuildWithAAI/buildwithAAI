/**
 * "upload --apply": sends an approved plan, one saved step at a time.
 *
 *   lock -> ledger check -> quota check -> OAuth account and scopes -> channels.list (right channel?) ->
 *   playlists.list (playlist on that channel?) -> resumable videos.insert (always private) -> privacy read-back
 *   (forced back to private if YouTube says otherwise) -> thumbnails.set -> captions.insert per language ->
 *   playlistItems.insert -> ledger "complete" + receipt.
 *
 * Every step is recorded in the job file before the next starts, so running the same command again resumes: the
 * upload continues from YouTube's confirmed byte, finished steps are skipped, and the ledger stops a second upload.
 */
import {join} from 'node:path';
import {createApi} from './api.ts';
import type {Endpoints} from './contracts.ts';
import type {Transport} from './http.ts';
import {ApiError} from './http.ts';
import {acquireLock, ledgerRefusals, openLedger} from './ledger.ts';
import {clientFromEnv, createTokenSource, readOAuthFile, scopeProblem, writeOAuthFile} from './oauth.ts';
import type {Prepared} from './prepare.ts';
import {createQuotaTracker, type Usage} from './quota.ts';
import {startUpload} from './requests.ts';
import {runResumableUpload} from './resumable.ts';
import {type InsertResult, type JobState, jobPath, loadJob, newJob, saveJob} from './state.ts';
import {formatInZone} from './time.ts';
import {isRecord, num, type Reason, Refusal, str, writeJsonAtomic} from './util.ts';

export type ApplyContext = {
	transport: Transport;
	endpoints: Endpoints;
	stateDir: string;
	oauthPath: string;
	env: Record<string, string | undefined>;
	now: () => number;
	sleep: (ms: number) => Promise<void>;
	random: () => number;
	log: (line: string) => void;
};

export type ApplyOptions = {
	chunkBytes: number;
	restartUpload: boolean;
	allowSecondUpload: boolean;
	maxUnitsPerRun: number;
	processingPolls: number;
	processingIntervalMs: number;
	maxRetries?: number;
};

export type Receipt = {
	version: 1;
	channel: string;
	slug: string;
	renderId: string;
	videoId: string;
	watchUrl: string;
	studioUrl: string;
	privacyStatus: string | null;
	publishAt: string | null;
	approvalSha256: string;
	planSha256: string;
	uploadedFile: {path: string; sha256: string; bytes: number};
	steps: {thumbnail: string; captions: string[]; playlist: string};
	studioSteps: string[];
	alerts: string[];
	completedAt: string | null;
};

export type ApplyResult = {complete: boolean; videoId: string | null; receipt: Receipt | null; receiptPath: string | null; alerts: string[]; pending: string[]};

const toInsertResult = (body: unknown): InsertResult => {
	if (!isRecord(body) || !str(body.id)) throw new Error('YouTube finished the upload but its answer has no video id. Check YouTube Studio > Content before running again.');
	const snippet = isRecord(body.snippet) ? body.snippet : {};
	const status = isRecord(body.status) ? body.status : {};
	const bool = (v: unknown): boolean | null => (typeof v === 'boolean' ? v : null);
	return {
		videoId: String(body.id),
		privacyStatus: str(status.privacyStatus),
		publishAt: str(status.publishAt),
		selfDeclaredMadeForKids: bool(status.selfDeclaredMadeForKids),
		containsSyntheticMedia: bool(status.containsSyntheticMedia),
		defaultLanguage: str(snippet.defaultLanguage),
		defaultAudioLanguage: str(snippet.defaultAudioLanguage),
		localizations: isRecord(body.localizations) ? Object.keys(body.localizations) : [],
		uploadStatus: str(status.uploadStatus),
		failureReason: str(status.failureReason),
		rejectionReason: str(status.rejectionReason),
	};
};

/** Quota the unfinished steps can still use (at most). */
export const remainingNeed = (prepared: Prepared, job: JobState, processingPolls: number): Usage => {
	const plan = prepared.plan;
	let units = 1; // channels.list, every run
	if (plan.playlistId && job.playlist.status === 'pending' && job.insert.status !== 'done') units += 1;
	if (job.thumbnail.status === 'pending' && plan.thumbnail) units += 50 + (plan.thumbnail.afterProcessing ? processingPolls : 0);
	units += 400 * job.captions.filter((c) => c.status === 'pending').length;
	if (job.playlist.status === 'pending' && plan.playlistId) units += 50;
	return {default: units, uploads: job.insert.status === 'pending' ? 1 : 0};
};

export const applyUpload = async (prepared: Prepared, ctx: ApplyContext, opts: ApplyOptions): Promise<ApplyResult> => {
	const {plan, inputs} = prepared;
	if (prepared.refusals.length || !prepared.approval || !prepared.approvalSha256) throw new Refusal(prepared.refusals.length ? prepared.refusals : [{code: 'approval-missing', message: 'No verified approval.'}]);
	const approvalSha256 = prepared.approvalSha256;
	const nowIso = () => new Date(ctx.now()).toISOString();
	const release = acquireLock(join(ctx.stateDir, 'locks'), `${plan.channel}__${plan.video.sha256.slice(0, 16)}`, nowIso());
	const alerts: string[] = [];
	const pending: string[] = [];
	try {
		const ledger = openLedger(join(ctx.stateDir, 'ledger.json'));
		const again = ledgerRefusals(ledger, plan, {allowSecondUpload: opts.allowSecondUpload});
		if (again.length) throw new Refusal(again);

		const path = jobPath(ctx.stateDir, plan);
		let job = loadJob(path);
		if (job && job.planSha256 !== plan.digest.sha256) {
			if (job.insert.status === 'done') throw new Refusal({code: 'uploaded-under-other-approval', message: `This file was already uploaded as https://youtu.be/${job.insert.result?.videoId} under an earlier approval. Make metadata changes in Studio.`});
			if (job.insert.status === 'session' && !opts.restartUpload) {
				throw new Refusal({
					code: 'upload-in-progress-other-plan',
					message: `An interrupted upload of this file was started with different metadata (job ${path}). Finish it with its own approval, or run with --restart-upload to abandon that session (it never became a video unless Studio shows one: check first).`,
				});
			}
			job = null;
		}
		job ??= newJob(plan, approvalSha256, nowIso());
		const state = job;
		const save = () => saveJob(path, state, nowIso());
		save();

		const quota = createQuotaTracker({path: join(ctx.stateDir, 'quota.json'), now: ctx.now, limits: inputs.config.dailyLimits, runCap: opts.maxUnitsPerRun});
		const quotaReasons = quota.check(remainingNeed(prepared, state, opts.processingPolls));
		if (quotaReasons.length) throw new Refusal(quotaReasons);

		// OAuth: the account saved for this channel slug
		const file = readOAuthFile(ctx.oauthPath);
		const account = file.accounts[plan.channel];
		const client = clientFromEnv(ctx.env) ?? file.client;
		const authReasons: Reason[] = [];
		if (!account) authReasons.push({code: 'not-authorized', message: `No YouTube authorization for "${plan.channel}". Run: node tools/uploader/cli.ts auth --channel ${plan.channel} --client-secrets <client_secret.json>`});
		if (!client) authReasons.push({code: 'not-authorized', message: 'No OAuth client: run "cli.ts auth" with --client-secrets, or set UPLOADER_CLIENT_ID and UPLOADER_CLIENT_SECRET.'});
		const scopeIssue = account ? scopeProblem(account.tokens.scope) : null;
		if (scopeIssue) authReasons.push({code: 'scope-missing', message: scopeIssue});
		if (authReasons.length || !account || !client) throw new Refusal(authReasons);
		const tokens = createTokenSource({
			client,
			tokens: account.tokens,
			transport: ctx.transport,
			endpoints: ctx.endpoints,
			now: ctx.now,
			onTokens: (fresh) => {
				const current = readOAuthFile(ctx.oauthPath);
				const saved = current.accounts[plan.channel];
				if (saved) {
					saved.tokens = fresh;
					writeOAuthFile(ctx.oauthPath, current);
				}
			},
		});
		const api = createApi({transport: ctx.transport, endpoints: ctx.endpoints, tokens, quota, sleep: ctx.sleep, random: ctx.random, now: ctx.now, log: ctx.log, maxRetries: Math.min(opts.maxRetries ?? 5, 5)});

		// 1. the signed-in channel must be the one this approval is for
		const channel = await api.myChannel();
		const pinned = inputs.channelConfig.youtubeChannelId;
		if (channel.id !== account.channelId || (pinned && channel.id !== pinned)) {
			throw new Refusal({
				code: 'wrong-channel',
				message: `The saved authorization for "${plan.channel}" now signs in as channel ${channel.id} (${channel.title}), but ${pinned ? `channels.json pins ${pinned}` : `it was saved for ${account.channelId}`}. Nothing was sent. Run "cli.ts auth --channel ${plan.channel}" again and pick the right channel.`,
			});
		}
		ctx.log(`Signed in as ${channel.title} (${channel.id}).`);

		// 2. the playlist must exist on that channel (checked before the upload, so a typo cannot leave a half-done job)
		if (plan.playlistId && state.playlist.status === 'pending' && state.insert.status !== 'done') {
			const playlist = await api.playlist(plan.playlistId);
			if (!playlist) throw new Refusal({code: 'playlist-not-found', message: `Playlist ${plan.playlistId} was not found. Fix playlists in channels.json or the spec, then approve again. Nothing was uploaded.`});
			if (playlist.channelId !== channel.id) throw new Refusal({code: 'playlist-other-channel', message: `Playlist ${plan.playlistId} belongs to channel ${playlist.channelId}, not ${channel.id}. Nothing was uploaded.`});
		}

		// 3. the upload itself: always private
		if (state.insert.status !== 'done') {
			if (plan.publishAt && Date.parse(plan.publishAt) < ctx.now() + inputs.config.minLeadMinutes * 60_000) {
				throw new Refusal({code: 'publish-time-too-soon', message: `publishAt ${plan.publishAt} is now less than ${inputs.config.minLeadMinutes} minutes away; YouTube would publish it on arrival. Approve a later time.`});
			}
			if (!ledger.find(plan.channel, plan.video.sha256)) {
				ledger.upsert({channel: plan.channel, slug: plan.slug, renderId: plan.renderId, sha256: plan.video.sha256, bytes: plan.video.bytes, status: 'uploading', videoId: null, planSha256: plan.digest.sha256, approvalSha256, startedAt: nowIso(), updatedAt: nowIso(), completedAt: null});
			}
			ctx.log(`Uploading ${plan.video.rel} (${plan.video.bytes} bytes) as private${plan.publishAt ? `, scheduled for ${formatInZone(Date.parse(plan.publishAt))}` : ''}...`);
			const body = await runResumableUpload(
				{
					api,
					sleep: ctx.sleep,
					random: ctx.random,
					now: ctx.now,
					log: ctx.log,
					persist: () => {
						if (state.insert.sessionUri) state.insert.status = 'session';
						save();
					},
				},
				state.insert,
				{path: inputs.video.path, bytes: inputs.video.bytes, mimeType: inputs.video.mimeType, stamp: inputs.video.stamp},
				{chunkBytes: opts.chunkBytes, restartExpired: opts.restartUpload, startRequest: startUpload(ctx.endpoints, plan.insert.query, JSON.stringify(plan.insert.body), plan.video.bytes, plan.video.mimeType), title: plan.insert.body.snippet.title, maxRetries: opts.maxRetries},
			);
			const result = toInsertResult(body);
			state.insert.status = 'done';
			state.insert.result = result;
			state.insert.confirmedBytes = plan.video.bytes;
			save();
			const entry = ledger.find(plan.channel, plan.video.sha256);
			ledger.upsert({...(entry ?? {channel: plan.channel, slug: plan.slug, renderId: plan.renderId, sha256: plan.video.sha256, bytes: plan.video.bytes, planSha256: plan.digest.sha256, approvalSha256, startedAt: nowIso(), completedAt: null}), status: 'uploaded', videoId: result.videoId, updatedAt: nowIso()});
			ctx.log(`Uploaded: https://youtu.be/${result.videoId}`);
		}
		const result = state.insert.result;
		if (!result) throw new Error(`Job ${path} says the upload is done but has no video id.`);
		const videoId = result.videoId;

		// 4. read-back: privacy first
		if (state.privacy.status === 'pending') {
			if (result.privacyStatus !== 'private') {
				alerts.push(`YouTube reported privacy "${result.privacyStatus}" for ${videoId} although "private" was sent; the uploader set it back to private.`);
				const now = await api.forcePrivate(videoId, {selfDeclaredMadeForKids: plan.insert.body.status.selfDeclaredMadeForKids, containsSyntheticMedia: plan.insert.body.status.containsSyntheticMedia});
				state.privacy = {status: 'forced', detail: `YouTube reported "${result.privacyStatus}"; videos.update set it to "${now}". Any publishAt was cleared: reschedule in Studio.`};
				save();
				if (now !== 'private') throw new Error(`ALERT: ${videoId} is "${now}", not private, and the uploader could not change it. Open https://studio.youtube.com/video/${videoId}/edit now.`);
			} else {
				state.privacy = {status: 'ok', detail: null};
				save();
			}
		}
		const sent = plan.insert.body;
		if (sent.status.publishAt && (result.publishAt === null || Date.parse(result.publishAt) !== Date.parse(sent.status.publishAt)) && state.privacy.status === 'ok') {
			alerts.push(`publishAt: sent ${sent.status.publishAt}, YouTube reports ${result.publishAt ?? 'none'}. Check the schedule in Studio.`);
		}
		if (result.selfDeclaredMadeForKids !== null && result.selfDeclaredMadeForKids !== sent.status.selfDeclaredMadeForKids) alerts.push(`Made for kids: sent ${sent.status.selfDeclaredMadeForKids}, YouTube reports ${result.selfDeclaredMadeForKids}. Fix it in Studio > Audience.`);
		if (result.containsSyntheticMedia !== null && result.containsSyntheticMedia !== sent.status.containsSyntheticMedia) alerts.push(`Altered content: sent ${sent.status.containsSyntheticMedia}, YouTube reports ${result.containsSyntheticMedia}. Fix it in Studio.`);
		const notes: string[] = [];
		if (result.defaultAudioLanguage !== sent.snippet.defaultAudioLanguage) notes.push(`Video language: YouTube did not keep defaultAudioLanguage "${sent.snippet.defaultAudioLanguage}" (it reports ${result.defaultAudioLanguage ?? 'none'}); set "Video language" in Studio > Details.`);
		if (result.uploadStatus === 'rejected' || result.uploadStatus === 'failed') {
			alerts.push(`YouTube ${result.uploadStatus} the upload (${result.rejectionReason ?? result.failureReason ?? 'no reason given'}). The remaining steps were skipped; see Studio.`);
			state.notes.push(...alerts);
			save();
			return {complete: false, videoId, receipt: null, receiptPath: null, alerts, pending: ['YouTube did not accept the video']};
		}

		// 5. thumbnail
		const thumb = inputs.thumbnail;
		if (state.thumbnail.status === 'pending' && thumb && plan.thumbnail) {
			let ready = !plan.thumbnail.afterProcessing;
			for (let poll = 0; !ready && poll < opts.processingPolls; poll++) {
				const processing = await api.processingStatus(videoId);
				if (processing === 'succeeded') ready = true;
				else if (processing === 'failed' || processing === 'terminated') {
					state.thumbnail = {status: 'manual', detail: `YouTube processing ${processing}; set the thumbnail in Studio if the video recovers.`};
					break;
				} else await ctx.sleep(opts.processingIntervalMs);
			}
			if (ready) {
				try {
					await api.setThumbnail(videoId, plan.thumbnail.mimeType, thumb.content);
					state.thumbnail = {status: 'done', detail: null};
				} catch (error) {
					if (!(error instanceof ApiError) || (error.status !== 403 && error.reason !== 'uploadRateLimitExceeded')) throw error;
					state.thumbnail = {
						status: 'manual',
						detail:
							error.status === 403
								? 'YouTube refused the custom thumbnail (403): custom thumbnails need a verified channel (Help 72431). Verify the channel, then upload it in Studio.'
								: "YouTube's daily custom-thumbnail limit is reached (429): upload it in Studio tomorrow.",
					};
				}
			} else if (state.thumbnail.status === 'pending') {
				pending.push(`thumbnail: the Short is still processing after ${opts.processingPolls} checks; run the same command again later to set it`);
			}
			save();
		}

		// 6. captions, one track per language
		for (const caption of state.captions) {
			if (caption.status !== 'pending') continue;
			const input = inputs.captions.find((c) => c.language === caption.language && c.name === caption.name);
			if (!input) throw new Error(`Caption ${caption.language} "${caption.name}" is in the job but not in the inputs.`);
			const res = await api.insertCaption(videoId, caption.language, caption.name, input.content);
			caption.status = res.existed ? 'exists' : 'done';
			caption.captionId = res.captionId;
			save();
			ctx.log(`Captions ${caption.language} "${caption.name}": ${caption.status}.`);
		}

		// 7. playlist
		if (state.playlist.status === 'pending' && plan.playlistId) {
			const res = await api.addToPlaylist(plan.playlistId, videoId);
			state.playlist = {status: 'done', playlistItemId: res.playlistItemId};
			save();
			ctx.log(`Added to playlist ${plan.playlistId}${res.existed ? ' (it was already there)' : ''}.`);
		}

		const complete = pending.length === 0;
		if (complete) {
			state.completedAt = nowIso();
			const entry = ledger.find(plan.channel, plan.video.sha256);
			if (entry) ledger.upsert({...entry, status: 'complete', videoId, updatedAt: nowIso(), completedAt: state.completedAt});
		}
		state.notes = [...new Set([...state.notes, ...alerts, ...notes])];
		save();

		const studioSteps = [
			...(state.thumbnail.status === 'manual' && state.thumbnail.detail ? [state.thumbnail.detail] : []),
			...notes,
			...plan.studioSteps,
		];
		const receipt: Receipt = {
			version: 1,
			channel: plan.channel,
			slug: plan.slug,
			renderId: plan.renderId,
			videoId,
			watchUrl: `https://youtu.be/${videoId}`,
			studioUrl: `https://studio.youtube.com/video/${videoId}/edit`,
			privacyStatus: state.privacy.status === 'forced' ? 'private' : result.privacyStatus,
			publishAt: state.privacy.status === 'forced' ? null : result.publishAt,
			approvalSha256,
			planSha256: plan.digest.sha256,
			uploadedFile: {path: plan.video.rel, sha256: plan.video.sha256, bytes: plan.video.bytes},
			steps: {
				thumbnail: state.thumbnail.status,
				captions: state.captions.map((c) => `${c.language} "${c.name}": ${c.status}`),
				playlist: state.playlist.status,
			},
			studioSteps,
			alerts,
			completedAt: state.completedAt,
		};
		const receiptPath = join(ctx.stateDir, 'receipts', `${plan.channel}__${plan.slug}__${plan.renderId}.json`);
		writeJsonAtomic(receiptPath, receipt);
		return {complete, videoId, receipt, receiptPath, alerts, pending};
	} finally {
		release();
	}
};

/** Plain-text summary of a finished (or paused) run. */
export const renderReceipt = (result: ApplyResult, plan: Prepared['plan']): string => {
	const r = result.receipt;
	if (!r) return `${[...result.alerts, ...result.pending].map((l) => `- ${l}`).join('\n')}\n`;
	const lines = [
		`${result.complete ? 'Done' : 'Paused'}: ${r.watchUrl} is ${r.privacyStatus ?? 'unknown'}${r.publishAt ? `, scheduled for ${formatInZone(Date.parse(r.publishAt))}` : ''}.`,
		`Studio: ${r.studioUrl}`,
		`Thumbnail: ${r.steps.thumbnail}. Captions: ${r.steps.captions.join(', ') || 'none'}. Playlist: ${r.steps.playlist}.`,
	];
	if (result.alerts.length) lines.push('', 'ALERTS', ...result.alerts.map((a) => `- ${a}`));
	if (result.pending.length) lines.push('', 'Not finished (run the same command again):', ...result.pending.map((p) => `- ${p}`));
	lines.push('', 'Still to do in YouTube Studio:', ...r.studioSteps.map((s, i) => `  ${i + 1}. ${s}`));
	if (plan.renderId === 'long') lines.push('', `Then record the video id in the publish kit (from projects/video-studio): node scripts/publish-kit/cli.ts ${plan.channel}/${plan.slug} --youtube-id ${r.videoId}`);
	if (result.receiptPath) lines.push(`Receipt: ${result.receiptPath}`);
	return `${lines.join('\n')}\n`;
};

/** Reads a number option from the environment (tests and CI tune timings this way). */
export const envNumber = (env: Record<string, string | undefined>, name: string, fallback: number): number => num(Number(env[name])) ?? fallback;
