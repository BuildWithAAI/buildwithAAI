import assert from 'node:assert/strict';
import {existsSync, readdirSync, readFileSync, statSync, utimesSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, it} from 'node:test';
import {createApi} from './api.ts';
import {type ApplyContext, type ApplyOptions, applyUpload} from './apply.ts';
import {createApproval, type ApprovedVia} from './approval.ts';
import {GOOGLE} from './contracts.ts';
import {createFakeYouTube, type FakeYouTube, parseMultipart} from './fake-youtube.ts';
import {readOAuthFile} from './oauth.ts';
import {prepareForApproval, prepareFromApproval} from './prepare.ts';
import {createQuotaTracker} from './quota.ts';
import {PrivacyGuardError, startUpload} from './requests.ts';
import {loadJob} from './state.ts';
import {CHANNEL_ID, CHUNK, clock, fakeVideo, makeWorkspace, PLAYLIST_ID, recordSleeps, SHORTS_PLAYLIST_ID, VIDEO_BYTES, type Workspace} from './test-helpers.ts';
import {quotaDay} from './time.ts';
import {Refusal, sha256Hex} from './util.ts';

const PUBLISH = '2026-11-28T15:00:00.000Z';

describe('upload --apply', () => {
	let ws: Workspace;
	let fake: FakeYouTube;
	let approvalPath: string;
	let time: ReturnType<typeof clock>;
	let sleeps: ReturnType<typeof recordSleeps>;
	let logs: string[];

	beforeEach(() => {
		// most tests schedule a publish time, which the uploader never does for a video with paid promotion
		ws = makeWorkspace({paidPromotion: false});
		fake = createFakeYouTube({channelId: CHANNEL_ID, playlists: {[PLAYLIST_ID]: CHANNEL_ID}});
		approvalPath = join(ws.kitDir, 'approval-long.json');
		time = clock();
		sleeps = recordSleeps();
		logs = [];
	});
	afterEach(() => ws.cleanup());

	const approve = async (opts: {renderId?: string; thumbnail?: string | null; publishAt?: string | null; path?: string; approvedVia?: ApprovedVia} = {}) => {
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
		writeFileSync(opts.path ?? approvalPath, JSON.stringify(createApproval(prepared.plan, {nowMs: time.now(), approvedBy: 'owner', validDays: 7, spec: null, ...(opts.approvedVia ? {approvedVia: opts.approvedVia} : {})})));
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
		ownerPresent: true, // the CLI sets it after the owner typed the slug (cli.test.ts covers that prompt)
		...overrides,
	});
	const run = async (o: Partial<ApplyOptions> = {}, c: Partial<ApplyContext> = {}, path = approvalPath) => {
		const prepared = await prepareFromApproval({kitPath: ws.kitPath, approvalPath: path, videoStudioRoot: null, channels: ws.channels, stateDir: c.stateDir ?? ws.stateDir, nowMs: time.now(), processingPolls: o.processingPolls ?? 5, allowSecondUpload: o.allowSecondUpload ?? false});
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
			['channels.list', 'playlists.list', 'playlistItems.list', 'videos.insert', 'upload.chunk', 'upload.chunk', 'upload.chunk', 'thumbnails.set', 'captions.insert', 'playlistItems.insert'],
		);
		// the duplicate check read the channel's uploads playlist before the upload session started
		assert.equal(fake.byLabel('playlistItems.list')[0]?.url.searchParams.get('playlistId'), fake.uploadsPlaylistId);
		assert.equal(fake.byLabel('channels.list')[0]?.url.searchParams.get('part'), 'id,snippet,contentDetails');
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
		// the receipt records what was SENT, the approval's nonce and the channel it went to
		assert.deepEqual(result.receipt?.uploadedFile, {path: 'out/publish/zoora-ai/uploader-fixture/media/long.mp4', sha256: sha256Hex(readFileSync(ws.videoPath)), bytes: VIDEO_BYTES, verified: 'bytes-sent'});
		assert.match(result.receipt?.approvalNonce ?? '', /^[0-9a-f]{32}$/);
		assert.deepEqual(result.receipt?.destination, {youtubeChannelId: CHANNEL_ID, title: 'Zoora AI (test)'});
		assert.equal(JSON.parse(readFileSync(join(ws.stateDir, 'ledger.json'), 'utf8')).entries[0].approvalNonce, result.receipt?.approvalNonce);
		// the private staged copy is gone once YouTube has the video
		assert.deepEqual(readdirSync(join(ws.stateDir, 'staging')).filter((f) => !f.startsWith('.')), []);
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
			assert.equal(quotaToday().default, 503 + 50);
		});
	});

	describe('quota accounting', () => {
		it('charges each call to its bucket for the Pacific day, and counts failed attempts too', async () => {
			await approve();
			fake.faults.push({on: 'captions.insert', nth: 1, kind: 'status', status: 503});
			await run();
			const day = quotaToday();
			assert.equal(day.uploads, 1);
			assert.equal(day.default, 1 + 1 + 1 + 50 + 400 + 400 + 50);
			assert.deepEqual(day.calls, {'channels.list': 1, 'playlists.list': 1, 'playlistItems.list': 1, 'videos.insert': 1, 'thumbnails.set': 1, 'captions.insert': 2, 'playlistItems.insert': 1});
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
			const other = makeWorkspace({paidPromotion: false});
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

		it('sends the approved bytes even when the render on disk is rewritten mid-upload (it reads a private staged copy)', async () => {
			await approve();
			const approved = readFileSync(ws.videoPath);
			fake.faults.push({on: 'upload.chunk', nth: 2, kind: 'network'});
			const rewrite = async () => {
				writeFileSync(ws.videoPath, fakeVideo(VIDEO_BYTES, 1234));
			};
			const result = await run({}, {sleep: rewrite});
			assert.equal(result.complete, true);
			assert.ok(uploadedBytes().equals(approved), 'YouTube got the approved bytes, not the rewritten file');
			assert.equal(result.receipt?.uploadedFile.sha256, sha256Hex(approved));
			assert.match(logs.join('\n'), /changed on disk during the upload; YouTube received the approved copy/);
		});

		it('refuses to continue when the staged copy itself changes during the upload', async () => {
			await approve();
			fake.faults.push({on: 'upload.chunk', nth: 2, kind: 'network'});
			const tamper = async () => {
				const staged = loadJob(join(ws.stateDir, 'jobs', readdir(ws.stateDir)))?.insert.staged?.path ?? '';
				const st = statSync(staged);
				writeFileSync(staged, fakeVideo(VIDEO_BYTES, 1234));
				utimesSync(staged, st.atime, new Date(st.mtimeMs + 5000)); // a visibly different time, whatever the file system's resolution
			};
			await assert.rejects(run({}, {sleep: tamper}), (error: unknown) => error instanceof Refusal && error.reasons[0]?.code === 'file-changed');
			assert.equal(fake.videos.size, 0, 'no video was created');
		});

		it('never sends the last chunk when the bytes read do not hash to the approval, even with size and mtime restored', async () => {
			await approve();
			fake.faults.push({on: 'upload.chunk', nth: 2, kind: 'network'});
			const tamper = async () => {
				const staged = loadJob(join(ws.stateDir, 'jobs', readdir(ws.stateDir)))?.insert.staged?.path ?? '';
				const st = statSync(staged);
				const bytes = readFileSync(staged);
				bytes[VIDEO_BYTES - 10] ^= 0xff; // in the last chunk, which has not been sent yet
				writeFileSync(staged, bytes);
				// restore the modification time to the same millisecond (the middle of it: Date objects would round to the
				// millisecond and float seconds can land just below it), so only the hash can tell the files apart
				utimesSync(staged, st.atimeMs / 1000, (Math.floor(st.mtimeMs) + 0.5) / 1000);
				assert.equal(Math.floor(statSync(staged).mtimeMs), Math.floor(st.mtimeMs));
			};
			await assert.rejects(run({}, {sleep: tamper}), (error: unknown) => error instanceof Refusal && error.reasons[0]?.code === 'render-hash-mismatch' && /last chunk was not sent/.test(error.message));
			assert.equal(fake.videos.size, 0, 'YouTube never received the last byte, so no video exists');
			assert.deepEqual(
				fake.byLabel('upload.chunk').filter((r) => (r.headers['content-range'] ?? '').endsWith(`-${VIDEO_BYTES - 1}/${VIDEO_BYTES}`)),
				[],
				'the chunk with the last byte was never sent',
			);
		});

		it('refuses a render swapped after the approval check (same size and mtime) before anything is sent', async () => {
			await approve();
			const prepared = await prepareFromApproval({kitPath: ws.kitPath, approvalPath, videoStudioRoot: null, channels: ws.channels, stateDir: ws.stateDir, nowMs: time.now(), processingPolls: 5, allowSecondUpload: false});
			assert.deepEqual(prepared.refusals, []);
			const st = statSync(ws.videoPath);
			writeFileSync(ws.videoPath, Buffer.alloc(VIDEO_BYTES, 0x41));
			utimesSync(ws.videoPath, st.atime, st.mtime);
			await assert.rejects(applyUpload(prepared, ctx(), opts()), (error: unknown) => error instanceof Refusal && error.reasons[0]?.code === 'render-hash-mismatch' && /Nothing was sent/.test(error.message));
			assert.equal(fake.requests.length, 0);
			assert.equal(fake.videos.size, 0);
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
			const bare = makeWorkspace({scope: 'https://www.googleapis.com/auth/youtube.upload', paidPromotion: false});
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
			// one lookup of the video in the playlist (the other playlistItems.list is the duplicate check)
			assert.equal(fake.byLabel('playlistItems.list').filter((r) => r.url.searchParams.get('videoId')).length, 1);
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

	describe('an approval used twice (another machine, a deleted state folder)', () => {
		it('refuses a second upload from another state folder: the channel already has a recent upload with that title', async () => {
			await approve();
			assert.equal((await run()).complete, true);
			const elsewhere = join(ws.root, 'state-on-another-machine');
			const sent = fake.requests.length;
			await assert.rejects(run({}, {stateDir: elsewhere}), (error: unknown) => error instanceof Refusal && error.reasons[0]?.code === 'duplicate-on-channel' && /scheduled for 2026-11-28 09:00 CST/.test(error.message));
			assert.equal(fake.videos.size, 1, 'still one video');
			assert.equal(fake.count('videos.insert'), 1);
			assert.deepEqual(fake.requests.slice(sent).map((r) => r.label), ['channels.list', 'playlists.list', 'playlistItems.list'], 'only the read-only checks were sent');
		});

		it('refuses when a video with the same title is already on the channel, unless --allow-second-upload', async () => {
			await approve();
			fake.existingUploads.push({videoId: 'existing001', title: 'POV: "Support" DMs you first', privacyStatus: 'private', publishedAt: '2026-11-20T10:00:00Z'});
			await assert.rejects(run(), (error: unknown) => error instanceof Refusal && error.reasons[0]?.code === 'duplicate-on-channel' && /youtu\.be\/existing001 \(private/.test(error.message));
			assert.equal(fake.count('videos.insert'), 0);
			const result = await run({allowSecondUpload: true});
			assert.equal(result.complete, true);
			assert.match(logs.join('\n'), /duplicate check skipped \(--allow-second-upload\)/);
		});

		it('does not run the duplicate check when it resumes its own session', async () => {
			await approve();
			fake.faults.push({on: 'upload.chunk', nth: 2, kind: 'network'});
			const killed = async () => {
				throw new Error('process killed');
			};
			await assert.rejects(run({}, {sleep: killed}), /process killed/);
			const result = await run();
			assert.equal(result.complete, true);
			assert.equal(fake.count('playlistItems.list') - fake.byLabel('playlistItems.list').filter((r) => r.url.searchParams.get('videoId')).length, 1, 'one duplicate check, before the one session');
		});
	});

	describe('the upload session address', () => {
		it('never sends the token or the video to a session URI from the job file that is not on the upload endpoint', async () => {
			await approve();
			fake.faults.push({on: 'upload.chunk', nth: 1, kind: 'status', status: 400, reason: 'badRequest'});
			await assert.rejects(run());
			const jobFile = join(ws.stateDir, 'jobs', readdir(ws.stateDir));
			const job = JSON.parse(readFileSync(jobFile, 'utf8'));
			assert.match(job.insert.sessionUri, /^https:\/\/www\.googleapis\.com\//);
			job.insert.sessionUri = 'https://attacker.example/upload?upload_id=x';
			writeFileSync(jobFile, JSON.stringify(job));
			const elsewhere: string[] = [];
			const spy = async (r: Parameters<typeof fake.transport>[0]) => {
				if (new URL(r.url).host === 'attacker.example') elsewhere.push(r.url);
				return fake.transport(r);
			};
			await assert.rejects(run({}, {transport: spy}), (error: unknown) => error instanceof Refusal && error.reasons[0]?.code === 'session-invalid' && /not a YouTube upload address/.test(error.message));
			assert.deepEqual(elsewhere, []);
			// with --restart-upload it starts a new session on YouTube instead, after the duplicate check
			const result = await run({restartUpload: true}, {transport: spy});
			assert.equal(result.complete, true);
			assert.deepEqual(elsewhere, []);
		});

		it('refuses a Location header on another origin, sending nothing to it', async () => {
			await approve();
			const elsewhere: string[] = [];
			const rewriting = async (r: Parameters<typeof fake.transport>[0]) => {
				if (new URL(r.url).host === 'evil.example') {
					elsewhere.push(r.url);
					return {status: 308, headers: {get: () => null}, text: ''};
				}
				const res = await fake.transport(r);
				const location = res.headers.get('location');
				if (!location) return res;
				return {...res, headers: {get: (name: string) => (name.toLowerCase() === 'location' ? location.replace('https://www.googleapis.com', 'https://evil.example') : res.headers.get(name))}};
			};
			await assert.rejects(run({}, {transport: rewriting}), (error: unknown) => error instanceof Refusal && error.reasons[0]?.code === 'session-invalid');
			assert.deepEqual(elsewhere, []);
			assert.equal(loadJob(join(ws.stateDir, 'jobs', readdir(ws.stateDir)))?.insert.sessionUri, null, 'the address was never saved');
		});
	});

	describe('owner presence, destination channel and paid promotion', () => {
		it('refuses to start a scheduled upload unless the owner confirmed at a terminal for this run', async () => {
			await approve({approvedVia: 'terminal'});
			await assert.rejects(run({ownerPresent: false}), (error: unknown) => error instanceof Refusal && error.reasons[0]?.code === 'owner-presence-required' && /go public at 2026-11-28 09:00 CST/.test(error.message));
			assert.equal(fake.requests.length, 0);
			assert.equal(existsSync(join(ws.stateDir, 'jobs')), false, 'not even a job file');
		});

		it('refuses an approval recorded without the owner at a terminal, even unscheduled', async () => {
			await approve({publishAt: null, approvedVia: 'confirm-code'});
			await assert.rejects(run({ownerPresent: false}), (error: unknown) => error instanceof Refusal && error.reasons[0]?.code === 'owner-presence-required' && /approve --confirm/.test(error.message));
			assert.equal(fake.requests.length, 0);
		});

		it('needs no second confirmation for an unscheduled upload the owner approved at a terminal', async () => {
			await approve({publishAt: null, approvedVia: 'terminal'});
			const result = await run({ownerPresent: false});
			assert.equal(result.complete, true);
			assert.equal(result.receipt?.publishAt, null);
		});

		it('finishes the follow-up steps of an uploaded video without asking again', async () => {
			await approve();
			fake.quotaExceeded.add('captions.insert');
			await assert.rejects(run());
			fake.quotaExceeded.clear();
			const result = await run({ownerPresent: false});
			assert.equal(result.complete, true);
			assert.equal(fake.count('videos.insert'), 1);
		});

		it('refuses to upload until channels.json pins the destination channel', async () => {
			const unpinned = makeWorkspace({paidPromotion: false, pinned: false});
			try {
				ws.cleanup();
				ws = unpinned;
				approvalPath = join(ws.kitDir, 'approval-long.json');
				await approve();
				await assert.rejects(run(), (error: unknown) => error instanceof Refusal && error.reasons[0]?.code === 'channel-not-pinned' && /copy the channel id it prints into channels\.json/.test(error.message));
				assert.equal(fake.requests.length, 0);
			} finally {
				// afterEach cleans ws
			}
		});

		it('never schedules a video with paid promotion, even if the earlier checks were bypassed', async () => {
			const paid = makeWorkspace();
			try {
				ws.cleanup();
				ws = paid;
				approvalPath = join(ws.kitDir, 'approval-long.json');
				await approve({publishAt: null});
				const prepared = await prepareFromApproval({kitPath: ws.kitPath, approvalPath, videoStudioRoot: null, channels: ws.channels, stateDir: ws.stateDir, nowMs: time.now(), processingPolls: 5, allowSecondUpload: false});
				const forged = {...prepared, plan: {...prepared.plan, publishAt: PUBLISH}};
				await assert.rejects(applyUpload(forged, ctx(), opts()), (error: unknown) => error instanceof Refusal && error.reasons[0]?.code === 'paid-promotion-schedule');
				assert.equal(fake.requests.length, 0);
				// unscheduled, it uploads private with nothing that publishes it, and says to tick the box first
				const result = await applyUpload(prepared, ctx(), opts());
				assert.equal(result.complete, true);
				assert.equal(JSON.parse(fake.byLabel('videos.insert')[0]?.body.toString('utf8') ?? '{}').status.publishAt, undefined);
				assert.match(result.receipt?.studioSteps.join('\n') ?? '', /Paid promotion: .*tick .* FIRST/);
			} finally {
				// afterEach cleans ws
			}
		});
	});
});

/** The single job file name in <state>/jobs. */
const readdir = (stateDir: string): string => {
	const files = readdirSync(join(stateDir, 'jobs')).filter((f) => f.endsWith('.json'));
	assert.equal(files.length, 1);
	return files[0] ?? '';
};
