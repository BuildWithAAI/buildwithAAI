import assert from 'node:assert/strict';
import {readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, it} from 'node:test';
import {type ApprovalRecord, createApproval, parseApproval, verifyApproval} from './approval.ts';
import {EarlyRefusal, prepareForApproval, prepareFromApproval} from './prepare.ts';
import {makeWorkspace, NOW, type Workspace} from './test-helpers.ts';

const PUBLISH = '2026-11-28T15:00:00.000Z';

describe('approval record', () => {
	let ws: Workspace;
	let approvalPath: string;
	beforeEach(() => {
		ws = makeWorkspace();
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
		assert.equal(record.summary.privacyStatus, 'private');
		assert.equal(record.summary.publishAtLocal, '2026-11-28 09:00 CST');
		assert.equal(record.render.bytes, 716_923);
		const prepared = await check();
		assert.deepEqual(prepared.refusals, []);
		assert.equal(prepared.plan.digest.sha256, record.plan.sha256);
		assert.match(prepared.approvalSha256 ?? '', /^[0-9a-f]{64}$/);
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

	it('parses only complete records', () => {
		assert.equal(parseApproval([], 'x').ok, false);
		assert.equal(parseApproval({version: 1, kind: 'youtube-upload-approval'}, 'x').ok, false);
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
