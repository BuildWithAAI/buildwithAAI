import assert from 'node:assert/strict';
import {existsSync, readdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, it} from 'node:test';
import {createApi} from './api.ts';
import {type ApplyContext, type ApplyOptions, applyUpload} from './apply.ts';
import {createApproval} from './approval.ts';
import {GOOGLE} from './contracts.ts';
import {createFakeYouTube, type FakeYouTube, parseMultipart} from './fake-youtube.ts';
import {readOAuthFile} from './oauth.ts';
import {prepareForApproval, prepareFromApproval} from './prepare.ts';
import {createQuotaTracker} from './quota.ts';
import {PrivacyGuardError, startUpload} from './requests.ts';
import {loadJob} from './state.ts';
import {CHANNEL_ID, CHUNK, clock, fakeVideo, makeWorkspace, PLAYLIST_ID, recordSleeps, SHORTS_PLAYLIST_ID, VIDEO_BYTES, type Workspace} from './test-helpers.ts';
import {quotaDay} from './time.ts';
import {Refusal} from './util.ts';

const PUBLISH = '2026-11-28T15:00:00.000Z';

describe('upload --apply', () => {
	let ws: Workspace;
	let fake: FakeYouTube;
	let approvalPath: string;
	let time: ReturnType<typeof clock>;
	let sleeps: ReturnType<typeof recordSleeps>;
	let logs: string[];

	beforeEach(() => {
		ws = makeWorkspace();
		fake = createFakeYouTube({channelId: CHANNEL_ID, playlists: {[PLAYLIST_ID]: CHANNEL_ID}});
		approvalPath = join(ws.kitDir, 'approval-long.json');
		time = clock();
		sleeps = recordSleeps();
		logs = [];
	});
	afterEach(() => ws.cleanup());

	const approve = async (opts: {renderId?: string; thumbnail?: string | null; publishAt?: string | null; path?: string} = {}) => {
		const prepared = await prepareForApproval({
			kitPath: ws.kitPath,
			videoStudioRoot: null,
			channels: ws.channels,
			stateDir: ws.stateDir,
			nowMs: time.now(),
			processingPolls: 20,
			allowSecondUpload: true,
			renderId: opts.renderId ?? 'long',
			thumbnail: opts.thumbnail,
			publishAt: opts.publishAt === undefined ? PUBLISH : opts.publishAt,
		});
		assert.deepEqual(prepared.refusals, []);
		writeFileSync(opts.path ?? approvalPath, JSON.stringify(createApproval(prepared.plan, {nowMs: time.now(), approvedBy: 'owner', validDays: 7, spec: null})));
	};

	const ctx = (overrides: Partial<ApplyContext> = {}): ApplyContext => ({
		transport: fake.transport,
		endpoints: GOOGLE,
		stateDir: ws.stateDir,
		oauthPath: ws.oauthPath,
		env: {},
		now: time.now,
		sleep: sleeps.sleep,
		random: () => 0.5,
		log: (line) => logs.push(line),
		...overrides,
	});
	const opts = (overrides: Partial<ApplyOptions> = {}): ApplyOptions => ({
		chunkBytes: CHUNK,
		restartUpload: false,
		allowSecondUpload: false,
		maxUnitsPerRun: 3000,
		processingPolls: 5,
		processingIntervalMs: 30_000,
		...overrides,
	});
	const run = async (o: Partial<ApplyOptions> = {}, c: Partial<ApplyContext> = {}, path = approvalPath) => {
		const prepared = await prepareFromApproval({kitPath: ws.kitPath, approvalPath: path, videoStudioRoot: null, channels: ws.channels, stateDir: ws.stateDir, nowMs: time.now(), processingPolls: o.processingPolls ?? 5, allowSecondUpload: o.allowSecondUpload ?? false});
		if (prepared.refusals.length) throw new Refusal(prepared.refusals);
		return applyUpload(prepared, ctx(c), opts(o));
	};
	const quotaToday = () => JSON.parse(readFileSync(join(ws.stateDir, 'quota.json'), 'utf8')).days[quotaDay(time.now())];
	const uploadedBytes = (): Buffer => [...fake.videos.values()][0]?.bytes ?? Buffer.alloc(0);

	it('uploads private with the publish time, then thumbnail, captions and playlist, and records everything', async () => {
		await approve();
		const result = await run();
		assert.equal(result.complete, true);
		assert.deepEqual(result.alerts, []);
		assert.deepEqual(
			fake.requests.map((r) => r.label),
			['channels.list', 'playlists.list', 'videos.insert', 'upload.chunk', 'upload.chunk', 'upload.chunk', 'thumbnails.set', 'captions.insert', 'playlistItems.insert'],
		);
		const insert = JSON.parse(fake.byLabel('videos.insert')[0]?.body.toString('utf8') ?? '{}');
		assert.deepEqual(insert.status, {privacyStatus: 'private', publishAt: PUBLISH, selfDeclaredMadeForKids: false, containsSyntheticMedia: false});
		assert.equal(fake.byLabel('videos.insert')[0]?.headers['x-upload-content-length'], String(VIDEO_BYTES));
		assert.deepEqual(fake.byLabel('upload.chunk').map((r) => r.headers['content-range']), [`bytes 0-262143/${VIDEO_BYTES}`, `bytes 262144-524287/${VIDEO_BYTES}`, `bytes 524288-716922/${VIDEO_BYTES}`]);
		assert.ok(uploadedBytes().equals(readFileSync(ws.videoPath)), 'YouTube got exactly the approved bytes');
		assert.ok(fake.thumbnails[0]?.body.equals(readFileSync(ws.thumbPath)));
		assert.equal(fake.thumbnails[0]?.mimeType, 'image/png');
		const [meta, srt] = parseMultipart(fake.byLabel('captions.insert')[0]?.headers['content-type'] ?? '', fake.byLabel('captions.insert')[0]?.body ?? Buffer.alloc(0));
		assert.deepEqual(JSON.parse(meta?.body.toString('utf8') ?? '{}'), {snippet: {videoId: result.videoId, language: 'en', name: 'Captions', isDraft: false}});
		assert.match(srt?.body.toString('utf8') ?? '', /Real support never DMs you first/);
		assert.deepEqual(fake.playlistItems.map((p) => [p.playlistId, p.videoId]), [[PLAYLIST_ID, result.videoId]]);
		// every API call carries the access token
		assert.ok(fake.requests.every((r) => r.headers.authorization === 'Bearer at-0'));
		// ledger, job, receipt
		const ledger = JSON.parse(readFileSync(join(ws.stateDir, 'ledger.json'), 'utf8'));
		assert.equal(ledger.entries[0].status, 'complete');
		assert.equal(ledger.entries[0].videoId, result.videoId);
		assert.equal(result.receipt?.privacyStatus, 'private');
		assert.equal(result.receipt?.publishAt, PUBLISH);
		assert.ok(result.receiptPath && existsSync(result.receiptPath));
		assert.ok(result.receipt?.studioSteps.some((s) => s.startsWith('Paid promotion')));
	});

	describe('private enforcement', () => {
		it('never lets a non-private videos.insert reach the network', async () => {
			let sent = 0;
			const api = createApi({
				transport: async () => {
					sent++;
					throw new Error('must not be called');
				},
				endpoints: GOOGLE,
				tokens: {getAccessToken: async () => 'at-0', scope: () => ''},
				quota: createQuotaTracker({path: null, now: time.now, limits: {defaultUnits: 10_000, uploadCalls: 100}, runCap: 3000}),
				sleep: sleeps.sleep,
				random: () => 0.5,
				now: time.now,
				log: () => {},
			});
			const withoutPrivacy = startUpload(GOOGLE, {part: 'snippet,status'}, JSON.stringify({snippet: {title: 'x'}, status: {selfDeclaredMadeForKids: false}}), 10, 'video/mp4');
			await assert.rejects(api.call(withoutPrivacy, {retry: true}), PrivacyGuardError);
			const publicUpload = startUpload(GOOGLE, {part: 'snippet,status'}, JSON.stringify({snippet: {title: 'x'}, status: {privacyStatus: 'public'}}), 10, 'video/mp4');
			await assert.rejects(api.raw(publicUpload, 1000), PrivacyGuardError);
			assert.equal(sent, 0);
		});

		it('sets the video back to private at once if YouTube reports anything else, and raises an alert', async () => {
			await approve();
			fake.reportPrivacy = 'public';
			const result = await run();
			const update = fake.byLabel('videos.update')[0];
			assert.ok(update, 'videos.update was sent');
			assert.equal(update.url.searchParams.get('part'), 'status');
			assert.deepEqual(JSON.parse(update.body.toString('utf8')), {id: result.videoId, status: {privacyStatus: 'private', selfDeclaredMadeForKids: false, containsSyntheticMedia: false}});
			assert.equal(fake.videos.get(result.videoId ?? '')?.privacyStatus, 'private');
			assert.match(result.alerts.join('\n'), /reported privacy "public".*set it back to private/);
			assert.equal(result.receipt?.privacyStatus, 'private');
			assert.equal(result.receipt?.publishAt, null);
			assert.equal(quotaToday().default, 502 + 50);
		});
	});

	describe('quota accounting', () => {
		it('charges each call to its bucket for the Pacific day, and counts failed attempts too', async () => {
			await approve();
			fake.faults.push({on: 'captions.insert', nth: 1, kind: 'status', status: 503});
			await run();
			const day = quotaToday();
			assert.equal(day.uploads, 1);
			assert.equal(day.default, 1 + 1 + 50 + 400 + 400 + 50);
			assert.deepEqual(day.calls, {'channels.list': 1, 'playlists.list': 1, 'videos.insert': 1, 'thumbnails.set': 1, 'captions.insert': 2, 'playlistItems.insert': 1});
			assert.equal(fake.captions.length, 1);
		});

		it("refuses before sending anything when today's quota or the upload bucket cannot cover the upload", async () => {
			await approve();
			const quotaPath = join(ws.stateDir, 'quota.json');
			writeFileSync(quotaPath, JSON.stringify({version: 1, days: {[quotaDay(time.now())]: {default: 9600, uploads: 0, calls: {}}}}));
			await assert.rejects(run(), (error: unknown) => error instanceof Refusal && error.reasons.some((r) => r.code === 'quota-insufficient'));
			writeFileSync(quotaPath, JSON.stringify({version: 1, days: {[quotaDay(time.now())]: {default: 0, uploads: 100, calls: {}}}}));
			await assert.rejects(run(), /videos\.insert calls are used up/);
			assert.equal(fake.requests.length, 0);
		});

		it("respects this run's cap", async () => {
			await approve();
			await assert.rejects(run({maxUnitsPerRun: 100}), (error: unknown) => error instanceof Refusal && error.reasons.some((r) => r.code === 'quota-run-cap'));
			assert.equal(fake.requests.length, 0);
		});

		it('stops when YouTube says the quota is used up, keeping the job resumable', async () => {
			await approve();
			fake.quotaExceeded.add('captions.insert');
			await assert.rejects(run(), (error: unknown) => error instanceof Error && 'isQuota' in error && (error as {isQuota: boolean}).isQuota);
			const job = loadJob(join(ws.stateDir, 'jobs', readdir(ws.stateDir)));
			assert.equal(job?.insert.status, 'done');
			assert.equal(job?.thumbnail.status, 'done');
			assert.equal(job?.captions[0]?.status, 'pending');
			fake.quotaExceeded.clear();
			time.advance(86_400_000);
			// the approval's publishAt is still 3 days away; the rerun finishes only the remaining steps
			const before = fake.count('videos.insert');
			const result = await run();
			assert.equal(result.complete, true);
			assert.equal(fake.count('videos.insert'), before);
			assert.equal(fake.count('thumbnails.set'), 1);
		});

		it('finishes the remaining steps of an uploaded video even when its schedule is now close or the approval aged out', async () => {
			await approve();
			fake.quotaExceeded.add('captions.insert');
			await assert.rejects(run());
			fake.quotaExceeded.clear();
			time.set(Date.parse(PUBLISH) - 10 * 60_000); // 10 minutes before the scheduled publish
			const result = await run();
			assert.equal(result.complete, true);
			assert.equal(fake.count('videos.insert'), 1);
			assert.equal(fake.captions.length, 1);
			// a render that was never uploaded gets no such leniency
			const other = makeWorkspace();
			try {
				const prepared = await prepareForApproval({kitPath: other.kitPath, videoStudioRoot: null, channels: other.channels, stateDir: other.stateDir, nowMs: Date.parse(PUBLISH) - 10 * 60_000, processingPolls: 5, allowSecondUpload: false, renderId: 'long', publishAt: PUBLISH});
				assert.deepEqual(prepared.refusals.map((r) => r.code), ['publish-time-too-soon']);
			} finally {
				other.cleanup();
			}
		});
	});

	describe('resume', () => {
		it('continues from the confirmed byte when a chunk answer is lost', async () => {
			await approve();
			fake.faults.push({on: 'upload.chunk', nth: 2, kind: 'lost-answer'});
			const result = await run();
			assert.equal(result.complete, true);
			assert.equal(fake.count('upload.status'), 1);
			assert.deepEqual(fake.byLabel('upload.chunk').map((r) => r.headers['content-range']), [`bytes 0-262143/${VIDEO_BYTES}`, `bytes 262144-524287/${VIDEO_BYTES}`, `bytes 524288-716922/${VIDEO_BYTES}`]);
			assert.ok(uploadedBytes().equals(readFileSync(ws.videoPath)));
			assert.equal(sleeps.waits.length, 1);
		});

		it('resends from the server-confirmed offset after a partial chunk', async () => {
			await approve();
			fake.faults.push({on: 'upload.chunk', nth: 2, kind: 'partial', keep: 100_000});
			await run();
			assert.deepEqual(fake.byLabel('upload.chunk').map((r) => r.headers['content-range']), [`bytes 0-262143/${VIDEO_BYTES}`, `bytes 262144-524287/${VIDEO_BYTES}`, `bytes 362144-624287/${VIDEO_BYTES}`, `bytes 624288-716922/${VIDEO_BYTES}`]);
			assert.ok(uploadedBytes().equals(readFileSync(ws.videoPath)));
		});

		it('resumes in a new process from the saved session after the first one died', async () => {
			await approve();
			fake.faults.push({on: 'upload.chunk', nth: 3, kind: 'network'});
			const killed = async () => {
				throw new Error('process killed');
			};
			await assert.rejects(run({}, {sleep: killed}), /process killed/);
			const job = loadJob(join(ws.stateDir, 'jobs', readdir(ws.stateDir)));
			assert.equal(job?.insert.status, 'session');
			assert.equal(job?.insert.confirmedBytes, 2 * CHUNK);
			assert.match(job?.insert.sessionUri ?? '', /upload_id=sess/);
			assert.equal(JSON.parse(readFileSync(join(ws.stateDir, 'ledger.json'), 'utf8')).entries[0].status, 'uploading');
			// a fresh run: same session, no second videos.insert, only the missing bytes are sent
			const result = await run();
			assert.equal(result.complete, true);
			assert.equal(fake.count('videos.insert'), 1);
			assert.equal(fake.sessions.length, 1);
			assert.deepEqual(fake.byLabel('upload.chunk').slice(-1).map((r) => r.headers['content-range']), [`bytes 524288-716922/${VIDEO_BYTES}`]);
			assert.ok(uploadedBytes().equals(readFileSync(ws.videoPath)));
		});

		it('picks up a finished upload whose answer was lost before the crash', async () => {
			await approve();
			fake.faults.push({on: 'upload.chunk', nth: 3, kind: 'lost-answer'});
			await assert.rejects(
				run({}, {
					sleep: async () => {
						throw new Error('process killed');
					},
				}),
				/process killed/,
			);
			const result = await run();
			assert.equal(result.complete, true);
			assert.equal(fake.videos.size, 1, 'one video, not two');
			assert.equal(fake.count('videos.insert'), 1);
		});

		it('does not silently restart an expired session; --restart-upload does', async () => {
			await approve();
			fake.faults.push({on: 'upload.chunk', nth: 2, kind: 'network'});
			await assert.rejects(
				run({}, {
					sleep: async () => {
						throw new Error('process killed');
					},
				}),
			);
			for (const s of fake.sessions) s.expired = true;
			await assert.rejects(run(), (error: unknown) => error instanceof Refusal && error.reasons[0]?.code === 'session-expired' && /Check YouTube Studio/.test(error.message));
			const result = await run({restartUpload: true});
			assert.equal(result.complete, true);
			assert.equal(fake.count('videos.insert'), 2);
			assert.ok(uploadedBytes().equals(readFileSync(ws.videoPath)));
		});

		it('backs off instead of looping when YouTube confirms no new bytes, then continues from its Range', async () => {
			await approve();
			fake.faults.push({on: 'upload.chunk', nth: 2, kind: 'status', status: 308});
			const result = await run();
			assert.equal(result.complete, true);
			assert.equal(sleeps.waits.length, 1);
			assert.ok(uploadedBytes().equals(readFileSync(ws.videoPath)));
		});

		it('backs off on 5xx, honouring Retry-After', async () => {
			await approve();
			fake.faults.push({on: 'upload.chunk', nth: 1, kind: 'status', status: 503, retryAfter: '7'});
			await run();
			assert.deepEqual(sleeps.waits, [7000]);
			assert.ok(uploadedBytes().equals(readFileSync(ws.videoPath)));
		});

		it('refreshes an expired access token mid-upload and saves the new one', async () => {
			await approve();
			let chunks = 0;
			const transport = fake.transport;
			const result = await run({}, {
				transport: async (r) => {
					if (r.url.includes('upload_id=') && !(r.headers['content-range'] ?? '').startsWith('bytes */') && ++chunks === 2) fake.expiredAccessTokens.add('at-0');
					return transport(r);
				},
			});
			assert.equal(result.complete, true);
			assert.equal(fake.count('oauth.token'), 1);
			const saved = readOAuthFile(ws.oauthPath).accounts['zoora-ai'];
			assert.notEqual(saved?.tokens.accessToken, 'at-0');
			assert.equal(saved?.tokens.refreshToken, 'rt-0');
		});

		it('gives up after the retry limit with the session saved for later', async () => {
			await approve();
			for (let nth = 1; nth <= 10; nth++) fake.faults.push({on: 'upload.chunk', nth, kind: 'network'});
			await assert.rejects(run({maxRetries: 2}), /failed 3 times in a row.*run the same command again to resume/);
			assert.equal(loadJob(join(ws.stateDir, 'jobs', readdir(ws.stateDir)))?.insert.status, 'session');
		});

		it('refuses to continue when the file changed during an interrupted upload', async () => {
			await approve();
			fake.faults.push({on: 'upload.chunk', nth: 2, kind: 'network'});
			const changing = async () => {
				writeFileSync(ws.videoPath, fakeVideo(VIDEO_BYTES, 1234));
			};
			await assert.rejects(run({}, {sleep: changing}), (error: unknown) => error instanceof Refusal && error.reasons[0]?.code === 'file-changed');
		});
	});

	describe('ledger', () => {
		it('never uploads the same file twice', async () => {
			await approve();
			await run();
			const sent = fake.requests.length;
			await assert.rejects(run(), (error: unknown) => error instanceof Refusal && error.reasons[0]?.code === 'already-uploaded');
			assert.equal(fake.requests.length, sent);
		});

		it('needs --allow-second-upload for a different file of the same episode render', async () => {
			await approve();
			await run();
			writeFileSync(ws.videoPath, fakeVideo(VIDEO_BYTES, 4321));
			const second = join(ws.kitDir, 'approval-long-2.json');
			await approve({path: second});
			await assert.rejects(run({}, {}, second), (error: unknown) => error instanceof Refusal && error.reasons.some((r) => r.code === 'episode-already-uploaded'));
			const result = await run({allowSecondUpload: true}, {}, second);
			assert.equal(result.complete, true);
			assert.equal(fake.videos.size, 2);
		});
	});

	describe('checks before the upload', () => {
		it('refuses when the saved authorization signs in to another channel', async () => {
			await approve();
			fake.channel.id = 'UCsomeOtherChannel000001';
			await assert.rejects(run(), (error: unknown) => error instanceof Refusal && error.reasons[0]?.code === 'wrong-channel');
			assert.equal(fake.count('videos.insert'), 0);
		});

		it('refuses a playlist that is missing or belongs to another channel', async () => {
			await approve();
			fake.playlists.clear();
			await assert.rejects(run(), (error: unknown) => error instanceof Refusal && error.reasons[0]?.code === 'playlist-not-found');
			fake.playlists.set(PLAYLIST_ID, 'UCsomeOtherChannel000001');
			await assert.rejects(run(), (error: unknown) => error instanceof Refusal && error.reasons[0]?.code === 'playlist-other-channel');
			assert.equal(fake.count('videos.insert'), 0);
		});

		it('refuses without the youtube.force-ssl scope or without an authorization', async () => {
			const bare = makeWorkspace({scope: 'https://www.googleapis.com/auth/youtube.upload'});
			try {
				ws.cleanup();
				ws = bare;
				approvalPath = join(ws.kitDir, 'approval-long.json');
				await approve();
				await assert.rejects(run(), (error: unknown) => error instanceof Refusal && error.reasons[0]?.code === 'scope-missing');
				writeFileSync(ws.oauthPath, JSON.stringify({version: 1, client: null, accounts: {}}));
				await assert.rejects(run(), (error: unknown) => error instanceof Refusal && error.reasons.some((r) => r.code === 'not-authorized'));
				assert.equal(fake.requests.length, 0);
			} finally {
				// afterEach cleans ws
			}
		});

		it('refuses when the publish time came too close before the upload started', async () => {
			await approve();
			time.set(Date.parse(PUBLISH) - 59 * 60_000);
			await assert.rejects(run(), (error: unknown) => error instanceof Refusal && error.reasons.some((r) => r.code === 'publish-time-too-soon'));
			assert.equal(fake.requests.length, 0);
		});
	});

	describe('after the upload', () => {
		it('turns a refused custom thumbnail (unverified channel) into a Studio step', async () => {
			await approve();
			fake.thumbnailError = {status: 403, reason: 'forbidden'};
			const result = await run();
			assert.equal(result.complete, true);
			assert.equal(result.receipt?.steps.thumbnail, 'manual');
			assert.match(result.receipt?.studioSteps[0] ?? '', /verified channel/);
		});

		it('treats a caption whose first answer was lost as already there (409 captionExists)', async () => {
			await approve();
			fake.faults.push({on: 'captions.insert', nth: 1, kind: 'lost-answer'});
			const result = await run();
			assert.equal(fake.captions.length, 1);
			assert.equal(fake.count('captions.insert'), 2);
			assert.deepEqual(result.receipt?.steps.captions, ['en "Captions": exists']);
		});

		it('checks the playlist before retrying a lost playlist insert, so the video is added once', async () => {
			await approve();
			fake.faults.push({on: 'playlistItems.insert', nth: 1, kind: 'lost-answer'});
			const result = await run();
			assert.equal(result.complete, true);
			assert.equal(fake.playlistItems.length, 1);
			assert.equal(fake.count('playlistItems.list'), 1);
			assert.equal(fake.count('playlistItems.insert'), 1);
		});

		it("waits for a Short's processing before setting its thumbnail, and resumes later if it takes too long", async () => {
			await approve({renderId: 'short-1', thumbnail: ws.thumbPath, path: approvalPath});
			fake.playlists.set(SHORTS_PLAYLIST_ID, CHANNEL_ID);
			fake.processing = ['processing', 'processing', 'processing', 'succeeded'];
			const first = await run({processingPolls: 2});
			assert.equal(first.complete, false);
			assert.match(first.pending.join('\n'), /still processing/);
			assert.equal(fake.thumbnails.length, 0);
			assert.deepEqual(sleeps.waits, [30_000, 30_000]);
			const second = await run({processingPolls: 5});
			assert.equal(second.complete, true);
			assert.equal(fake.thumbnails.length, 1);
			assert.equal(fake.count('videos.insert'), 1);
		});

		it('notes when YouTube did not keep the audio language', async () => {
			await approve();
			fake.dropAudioLanguage = true;
			const result = await run();
			assert.match(result.receipt?.studioSteps.join('\n') ?? '', /Video language: YouTube did not keep defaultAudioLanguage "en"/);
		});
	});
});

/** The single job file name in <state>/jobs. */
const readdir = (stateDir: string): string => {
	const files = readdirSync(join(stateDir, 'jobs')).filter((f) => f.endsWith('.json'));
	assert.equal(files.length, 1);
	return files[0] ?? '';
};
