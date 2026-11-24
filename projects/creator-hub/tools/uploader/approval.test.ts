import assert from 'node:assert/strict';
import {readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, it} from 'node:test';
import {type ApprovalRecord, createApproval, parseApproval, presenceReasons, UnapprovablePlanError, verifyApproval} from './approval.ts';
import {gatherInputs} from './inputs.ts';
import {approvalCode, buildPlan} from './plan.ts';
import {EarlyRefusal, prepareForApproval, prepareFromApproval} from './prepare.ts';
import {CHANNEL_ID, makeWorkspace, NOW, type Workspace} from './test-helpers.ts';

const PUBLISH = '2026-11-28T15:00:00.000Z';

describe('approval record', () => {
	let ws: Workspace;
	let approvalPath: string;
	beforeEach(() => {
		// the schedule mechanics need a video the uploader may schedule: the fixture kit without its affiliate offer
		ws = makeWorkspace({paidPromotion: false});
		approvalPath = join(ws.kitDir, 'approval-long.json');
	});
	afterEach(() => ws.cleanup());

	const approve = async (opts: {publishAt?: string | null; validDays?: number; renderId?: string} = {}): Promise<ApprovalRecord> => {
		const prepared = await prepareForApproval({
			kitPath: ws.kitPath,
			videoStudioRoot: null,
			channels: ws.channels,
			stateDir: ws.stateDir,
			nowMs: NOW,
			processingPolls: 20,
			allowSecondUpload: false,
			renderId: opts.renderId ?? 'long',
			publishAt: opts.publishAt === undefined ? PUBLISH : opts.publishAt,
		});
		assert.deepEqual(prepared.refusals, []);
		const record = createApproval(prepared.plan, {nowMs: NOW, approvedBy: 'owner', validDays: opts.validDays ?? 7, spec: null});
		writeFileSync(approvalPath, JSON.stringify(record, null, 2));
		return record;
	};

	const check = (nowMs = NOW) =>
		prepareFromApproval({kitPath: ws.kitPath, approvalPath, videoStudioRoot: null, channels: ws.channels, stateDir: ws.stateDir, nowMs, processingPolls: 20, allowSecondUpload: false});

	const codes = async (nowMs = NOW): Promise<string[]> => (await check(nowMs)).refusals.map((r) => r.code);

	it('refuses without an approval record', async () => {
		await assert.rejects(check(), (error: unknown) => error instanceof EarlyRefusal && error.reasons[0]?.code === 'approval-missing');
	});

	it('refuses a file that is not a complete approval record', async () => {
		writeFileSync(approvalPath, '{"version": 1, "kind": "youtube-upload-approval", "channel": "zoora-ai"}');
		await assert.rejects(check(), (error: unknown) => error instanceof EarlyRefusal && error.reasons[0]?.code === 'approval-invalid');
		writeFileSync(approvalPath, 'not json');
		await assert.rejects(check(), (error: unknown) => error instanceof EarlyRefusal && error.reasons[0]?.code === 'approval-invalid');
	});

	it('accepts a fresh approval: render hash, storyboard version and plan digest all match', async () => {
		const record = await approve();
		assert.equal(record.kind, 'youtube-upload-approval');
		assert.equal(record.version, 2);
		assert.equal(record.summary.privacyStatus, 'private');
		assert.equal(record.summary.publishAtLocal, '2026-11-28 09:00 CST');
		assert.equal(record.render.bytes, 716_923);
		const prepared = await check();
		assert.deepEqual(prepared.refusals, []);
		assert.equal(prepared.plan.digest.sha256, record.plan.sha256);
		assert.match(prepared.approvalSha256 ?? '', /^[0-9a-f]{64}$/);
	});

	it('names the destination channel, a single-use nonce, how it was given and the approval code', async () => {
		const record = await approve();
		assert.deepEqual(record.summary.destination, {youtubeChannelId: CHANNEL_ID, title: null});
		assert.match(record.nonce, /^[0-9a-f]{32}$/);
		assert.notEqual((await approve()).nonce, record.nonce, 'every record gets its own nonce');
		assert.equal(record.approvedVia, 'pipeline', 'a caller that does not say how the owner approved is not "terminal"');
		const prepared = await check();
		assert.equal(record.summary.approvalCode, approvalCode(prepared.plan));
		assert.equal(record.summary.approvalCode, record.plan.sha256.slice(0, 12));
	});

	it('binds the destination channel: pinning another channel after approval is refused as a change', async () => {
		await approve();
		const repinned = {...ws.channels, channels: {...ws.channels.channels, 'zoora-ai': {...ws.channels.channels['zoora-ai']!, youtubeChannelId: 'UCsomeOtherChannel000001'}}};
		const prepared = await prepareFromApproval({kitPath: ws.kitPath, approvalPath, videoStudioRoot: null, channels: repinned, stateDir: ws.stateDir, nowMs: NOW, processingPolls: 20, allowSecondUpload: false});
		assert.match(prepared.refusals.find((r) => r.code === 'metadata-changed')?.message ?? '', /destination channel/);
	});

	it('refuses when the rendered file changed after approval (SHA-256 mismatch)', async () => {
		await approve();
		const bytes = readFileSync(ws.videoPath);
		bytes[1000] ^= 0xff; // same size, one byte different
		writeFileSync(ws.videoPath, bytes);
		const prepared = await check();
		assert.ok(prepared.refusals.some((r) => r.code === 'render-hash-mismatch' && /changed after approval/.test(r.message)));
	});

	it('refuses when the rendered file is gone', async () => {
		await approve();
		writeFileSync(approvalPath, JSON.stringify({...JSON.parse(readFileSync(approvalPath, 'utf8')), render: {...JSON.parse(readFileSync(approvalPath, 'utf8')).render, path: 'out/gone.mp4'}}));
		await assert.rejects(check(), (error: unknown) => error instanceof EarlyRefusal && error.reasons[0]?.code === 'render-missing');
	});

	it('refuses when the storyboard changed or its version differs', async () => {
		await approve();
		const storyboard = JSON.parse(readFileSync(ws.storyboardPath, 'utf8'));
		writeFileSync(ws.storyboardPath, JSON.stringify({...storyboard, title: 'Edited after approval'}));
		assert.deepEqual(await codes(), ['storyboard-changed']);
		writeFileSync(ws.storyboardPath, JSON.stringify({...storyboard, version: 2}));
		assert.ok((await codes()).includes('storyboard-version-mismatch'));
	});

	it('refuses when what would be sent changed after approval, naming what changed', async () => {
		await approve();
		ws.editKit((kit) => {
			kit.title = 'A new title nobody approved';
		});
		const prepared = await check();
		const reason = prepared.refusals.find((r) => r.code === 'metadata-changed');
		assert.match(reason?.message ?? '', /title, description, tags/);
		ws.editKit((kit) => {
			kit.title = 'POV: "Support" DMs you first';
			(kit.captions as {srt: string}).srt = '1\n00:00:00,000 --> 00:00:01,000\nDifferent captions\n';
		});
		assert.match((await check()).refusals.find((r) => r.code === 'metadata-changed')?.message ?? '', /captions/);
	});

	it('refuses an expired approval and a schedule that is too close or past', async () => {
		await approve({validDays: 1});
		assert.ok((await codes(NOW + 2 * 86_400_000)).includes('approval-expired'));
		// 2026-11-28 09:00 CST minus 30 minutes: under the 60-minute lead
		assert.ok((await codes(Date.parse(PUBLISH) - 30 * 60_000)).includes('approval-expired'));
		await approve({validDays: 7});
		const late = await codes(Date.parse(PUBLISH) - 30 * 60_000);
		assert.deepEqual(late, ['publish-time-too-soon']);
		const past = (await check(Date.parse(PUBLISH) + 60_000)).refusals.find((r) => r.code === 'publish-time-too-soon');
		assert.match(past?.message ?? '', /in the past.*publishes a past publishAt immediately/);
	});

	it('allows an approval without a schedule (the video stays private)', async () => {
		const record = await approve({publishAt: null});
		assert.equal(record.publishAt, null);
		assert.deepEqual(await codes(NOW + 3 * 86_400_000), []);
	});

	it('refuses while a publish-kit check fails', async () => {
		await approve();
		ws.editKit((kit) => {
			(kit.checks as {id: string; ok: boolean; detail: string}[]).push({id: 'offers-live', ok: false, detail: 'offer "hardware-wallet" is a placeholder'});
		});
		assert.ok((await codes()).includes('kit-check-failed'));
	});

	it('checks the record belongs to this episode and render, and is not open-ended or from the future', async () => {
		const record = await approve();
		const prepared = await check();
		const plan = prepared.plan;
		const opts = {nowMs: NOW, minLeadMinutes: 60, maxDays: 30};
		assert.ok(verifyApproval({...record, slug: 'another-episode'}, plan, opts).some((r) => r.code === 'approval-wrong-episode'));
		assert.ok(verifyApproval({...record, render: {...record.render, id: 'short-1'}}, plan, opts).some((r) => r.code === 'approval-wrong-render'));
		assert.ok(verifyApproval({...record, expiresAt: '2027-06-01T00:00:00.000Z'}, plan, opts).some((r) => r.code === 'approval-too-long'));
		assert.ok(verifyApproval({...record, approvedAt: '2026-11-25T12:00:00.000Z'}, plan, opts).some((r) => r.code === 'approval-from-future'));
	});

	it('parses only complete records, and refuses records from the earlier format', async () => {
		assert.equal(parseApproval([], 'x').ok, false);
		assert.equal(parseApproval({version: 2, kind: 'youtube-upload-approval'}, 'x').ok, false);
		const old = parseApproval({version: 1, kind: 'youtube-upload-approval'}, 'old.json');
		assert.ok(!old.ok && /earlier uploader \(record version 1/.test(old.reasons[0]?.message ?? ''));
		const record = await approve();
		for (const broken of [{...record, nonce: 'short'}, {...record, approvedVia: 'agent'}]) {
			const parsed = parseApproval(broken, 'x');
			assert.ok(!parsed.ok && parsed.reasons[0]?.code === 'approval-invalid', JSON.stringify(broken).slice(0, 60));
		}
	});

	it('says when the owner must be at a terminal for the upload: a schedule, or an approval not typed there', () => {
		assert.deepEqual(presenceReasons({publishAt: null, approvedVia: 'terminal'}), []);
		assert.match(presenceReasons({publishAt: '2026-11-28T15:00:00.000Z', approvedVia: 'terminal'}).join(), /go public at 2026-11-28 09:00 CST/);
		assert.match(presenceReasons({publishAt: null, approvedVia: 'confirm-code'}).join(), /approve --confirm/);
		assert.match(presenceReasons({publishAt: null, approvedVia: 'pipeline'}).join(), /pipeline/);
	});

	it('cannot be created while the upload would be refused anyway', async () => {
		const prepared = await prepareForApproval({
			kitPath: ws.kitPath,
			videoStudioRoot: null,
			channels: ws.channels,
			stateDir: ws.stateDir,
			nowMs: NOW,
			processingPolls: 20,
			allowSecondUpload: false,
			renderId: 'long',
			publishAt: new Date(NOW + 10 * 60_000).toISOString(),
		});
		assert.deepEqual(prepared.refusals.map((r) => r.code), ['publish-time-too-soon']);
	});
});

describe('paid promotion is never scheduled', () => {
	let ws: Workspace;
	let approvalPath: string;
	beforeEach(() => {
		ws = makeWorkspace(); // the fixture kit: an affiliate offer, so paidPromotion=true
		approvalPath = join(ws.kitDir, 'approval-long.json');
	});
	afterEach(() => ws.cleanup());

	const prepare = (publishAt: string | null) =>
		prepareForApproval({kitPath: ws.kitPath, videoStudioRoot: null, channels: ws.channels, stateDir: ws.stateDir, nowMs: NOW, processingPolls: 20, allowSecondUpload: false, renderId: 'long', publishAt});

	it('refuses to approve a publish time for a video with paid promotion, naming the reason and what to do', async () => {
		const prepared = await prepare(PUBLISH);
		const reason = prepared.refusals.find((r) => r.code === 'paid-promotion-schedule');
		assert.ok(reason, JSON.stringify(prepared.refusals));
		assert.match(reason.message, /affiliate offer "hardware-wallet"/);
		assert.match(reason.message, /Approve it without a publish time.*tick Paid promotion first and schedule it there/);
		assert.throws(() => createApproval(prepared.plan, {nowMs: NOW, approvedBy: 'owner', validDays: 7, spec: null}), UnapprovablePlanError);
	});

	it('refuses a record that schedules it anyway, even with a digest computed by the uploader itself', async () => {
		const unscheduled = await prepare(null);
		assert.deepEqual(unscheduled.refusals, []);
		const inputs = await gatherInputs({kitPath: ws.kitPath, videoStudioRoot: null, channels: ws.channels, renderId: 'long'});
		const scheduled = buildPlan(inputs, {publishAt: PUBLISH, processingPolls: 20});
		const forged = {...createApproval(unscheduled.plan, {nowMs: NOW, approvedBy: 'owner', validDays: 7, spec: null}), publishAt: PUBLISH, plan: {sha256: scheduled.digest.sha256, parts: scheduled.digest.parts}};
		writeFileSync(approvalPath, JSON.stringify(forged));
		const checked = await prepareFromApproval({kitPath: ws.kitPath, approvalPath, videoStudioRoot: null, channels: ws.channels, stateDir: ws.stateDir, nowMs: NOW, processingPolls: 20, allowSecondUpload: false});
		assert.deepEqual(checked.refusals.map((r) => r.code), ['paid-promotion-schedule']);
		assert.equal(verifyApproval(forged, scheduled, {nowMs: NOW, minLeadMinutes: 60, maxDays: 30}).some((r) => r.code === 'paid-promotion-schedule'), true);
	});

	it('approves it private and unscheduled, with the Studio step to tick Paid promotion before publishing', async () => {
		const prepared = await prepare(null);
		assert.deepEqual(prepared.refusals, []);
		const record = createApproval(prepared.plan, {nowMs: NOW, approvedBy: 'owner', validDays: 7, spec: null});
		assert.equal(record.publishAt, null);
		assert.equal(record.summary.paidPromotion, true);
		assert.equal(prepared.plan.insert.body.status.publishAt, undefined);
		assert.match(prepared.plan.studioSteps[0] ?? '', /^Paid promotion: .*tick .* FIRST .*then publish or schedule it in Studio/);
		assert.ok(prepared.plan.studioSteps.some((s) => /stays private and unscheduled: after ticking Paid promotion/.test(s)));
	});
});
