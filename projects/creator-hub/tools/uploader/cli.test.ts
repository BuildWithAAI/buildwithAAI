import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, it} from 'node:test';
import {type Deps, EXIT, main} from './cli.ts';
import {createFakeYouTube, type FakeYouTube} from './fake-youtube.ts';
import {readOAuthFile} from './oauth.ts';
import {CHANNEL_ID, makeWorkspace, NOW, PLAYLIST_ID, type Workspace} from './test-helpers.ts';

describe('cli', () => {
	let ws: Workspace;
	let fake: FakeYouTube;
	let out: string;
	let err: string;
	let approval: string;

	beforeEach(() => {
		// these tests schedule a publish time, which the uploader never does for a video with paid promotion
		ws = makeWorkspace({paidPromotion: false});
		fake = createFakeYouTube({channelId: CHANNEL_ID, playlists: {[PLAYLIST_ID]: CHANNEL_ID}});
		out = '';
		err = '';
		approval = join(ws.kitDir, 'approval-long.json');
	});
	afterEach(() => ws.cleanup());

	const deps = (overrides: Partial<Deps> = {}): Partial<Deps> => ({
		transport: fake.transport,
		now: () => NOW,
		sleep: async () => {},
		random: () => 0.5,
		stdout: (t) => void (out += t),
		stderr: (t) => void (err += t),
		prompt: null,
		env: {},
		cwd: ws.root,
		...overrides,
	});
	const common = () => ['--channels', ws.channelsPath, '--state-dir', ws.stateDir, '--chunk-mb', '0.25'];
	const cli = (args: string[], overrides: Partial<Deps> = {}) => main([...args, ...common()], deps(overrides));
	/** The approval code at the end of a preview, as the owner reads it before approving without a terminal. */
	const codeIn = (text: string): string => /Approval code: ([0-9a-f]{12})/.exec(text)?.[1] ?? '';
	const owner = async () => 'uploader-fixture';
	const approveNow = async (extra: string[] = []) => {
		assert.equal(await cli(['approve', ws.kitPath, '--publish-at', '2026-11-28 09:00', ...extra]), EXIT.notApproved);
		const code = await cli(['approve', ws.kitPath, '--publish-at', '2026-11-28 09:00', '--confirm', codeIn(out), ...extra]);
		assert.equal(code, EXIT.ok, err);
		out = '';
		err = '';
	};

	it('plan refuses without an approval (exit 3) and sends nothing', async () => {
		assert.equal(await cli(['plan', ws.kitPath]), EXIT.refused);
		assert.match(err, /REFUSED: nothing was sent\.\n- \[approval-missing\]/);
		assert.equal(await cli(['plan', ws.kitPath, '--approval', approval]), EXIT.refused);
		assert.match(err, /No approval record at/);
		assert.equal(fake.requests.length, 0);
	});

	it('approve previews without writing anything until the owner types the slug', async () => {
		assert.equal(await cli(['approve', ws.kitPath]), EXIT.notApproved);
		assert.match(out, /^PREVIEW, NOT APPROVED: zoora-ai\/uploader-fixture render "long"/);
		assert.match(out, /Destination: YouTube channel "Zoora AI \(test\)" UCzooraFakeChannel000001 \(pinned in channels\.json/);
		assert.match(err, /--confirm with the approval code printed at the end of the preview/);
		assert.equal(existsSync(approval), false);

		assert.equal(await cli(['approve', ws.kitPath, '--confirm', 'wrong-slug']), EXIT.notApproved);
		assert.equal(existsSync(approval), false);

		let asked = '';
		const prompt = async (q: string) => {
			asked = q;
			return 'nope';
		};
		assert.equal(await cli(['approve', ws.kitPath], {prompt}), EXIT.notApproved);
		assert.match(asked, /Type the episode slug "uploader-fixture" to approve/);
		assert.equal(existsSync(approval), false);

		assert.equal(await cli(['approve', ws.kitPath, '--publish-at', '2026-11-28 09:00'], {prompt: async () => 'uploader-fixture'}), EXIT.ok);
		const record = JSON.parse(readFileSync(approval, 'utf8'));
		assert.equal(record.publishAt, '2026-11-28T15:00:00.000Z');
		assert.equal(record.approvedBy, 'owner');
		assert.equal(record.approvedVia, 'terminal');
		assert.deepEqual(record.summary.destination, {youtubeChannelId: CHANNEL_ID, title: 'Zoora AI (test)'});
		assert.equal(fake.requests.length, 0);
	});

	it('--confirm takes the approval code of the preview, never the slug, and a changed plan needs a new code', async () => {
		assert.equal(await cli(['approve', ws.kitPath]), EXIT.notApproved);
		const code = codeIn(out);
		assert.match(code, /^[0-9a-f]{12}$/);
		assert.equal(await cli(['approve', ws.kitPath, '--confirm', 'uploader-fixture']), EXIT.notApproved);
		assert.match(err, /it is the episode slug; --confirm takes the approval code/);
		assert.equal(existsSync(approval), false);
		// the render changes after the owner saw the preview: the old code no longer approves anything
		const bytes = readFileSync(ws.videoPath);
		bytes[5] ^= 1;
		writeFileSync(ws.videoPath, bytes);
		assert.equal(await cli(['approve', ws.kitPath, '--confirm', code]), EXIT.notApproved);
		assert.match(err, /not the approval code printed at the end of this preview/);
		assert.equal(existsSync(approval), false);
		out = '';
		assert.equal(await cli(['approve', ws.kitPath]), EXIT.notApproved);
		assert.notEqual(codeIn(out), code);
		assert.equal(await cli(['approve', ws.kitPath, '--confirm', codeIn(out).toUpperCase()]), EXIT.ok, err);
		assert.equal(JSON.parse(readFileSync(approval, 'utf8')).approvedVia, 'confirm-code');
	});

	it('refuses to approve a publish time for a video with paid promotion (exit 3)', async () => {
		const paid = makeWorkspace();
		try {
			assert.equal(await main(['approve', paid.kitPath, '--publish-at', '2026-11-28 09:00', '--channels', paid.channelsPath, '--state-dir', paid.stateDir], deps({cwd: paid.root})), EXIT.refused);
			assert.match(err, /\[paid-promotion-schedule\].*Approve it without a publish time/);
			assert.equal(existsSync(join(paid.kitDir, 'approval-long.json')), false);
		} finally {
			paid.cleanup();
		}
	});

	it('plan prints exactly what would be sent once approved, and the same plan as JSON', async () => {
		await approveNow();
		assert.equal(await cli(['plan', ws.kitPath, '--approval', approval]), EXIT.ok);
		assert.match(out, /^APPROVED UPLOAD PLAN: zoora-ai\/uploader-fixture render "long"/);
		assert.match(out, /render sha256 [0-9a-f]{16}… matches, storyboard v1 matches, plan digest matches/);
		assert.match(out, /"privacyStatus": "private"/);
		assert.match(out, /POST https:\/\/www\.googleapis\.com\/upload\/youtube\/v3\/videos\?uploadType=resumable/);
		assert.doesNotMatch(out.split('Not sent:')[0] ?? '', /paidProductPlacement/);
		out = '';
		assert.equal(await cli(['plan', ws.kitPath, '--approval', approval, '--json']), EXIT.ok);
		const json = JSON.parse(out);
		assert.equal(json.plan.insert.body.status.privacyStatus, 'private');
		assert.equal(json.plan.insert.body.status.publishAt, '2026-11-28T15:00:00.000Z');
		assert.equal(fake.requests.length, 0);
	});

	it('refuses when the render no longer matches the approved hash (exit 3)', async () => {
		await approveNow();
		const bytes = readFileSync(ws.videoPath);
		bytes[0] ^= 1;
		writeFileSync(ws.videoPath, bytes);
		assert.equal(await cli(['plan', ws.kitPath, '--approval', approval]), EXIT.refused);
		assert.match(err, /\[render-hash-mismatch\]/);
		assert.equal(await cli(['upload', ws.kitPath, '--approval', approval, '--apply']), EXIT.refused);
		assert.equal(fake.requests.length, 0);
	});

	it('upload without --apply is a dry run; with --apply it uploads, and a second run is refused by the ledger', async () => {
		await approveNow();
		assert.equal(await cli(['upload', ws.kitPath, '--approval', approval]), EXIT.ok);
		assert.match(out, /^DRY RUN/);
		assert.match(out, /Nothing was sent\. Add --apply to upload\./);
		assert.equal(fake.requests.length, 0);

		// a scheduled upload needs the owner at a terminal: no terminal, no upload
		assert.equal(await cli(['upload', ws.kitPath, '--approval', approval, '--apply']), EXIT.refused);
		assert.match(err, /\[owner-presence-required\].*go public at 2026-11-28 09:00 CST.*Agents and scripts never run upload --apply/s);
		assert.equal(await cli(['upload', ws.kitPath, '--approval', approval, '--apply'], {prompt: async () => 'yes'}), EXIT.notApproved);
		assert.equal(fake.requests.length, 0);

		out = '';
		let asked = '';
		const ownerTypes = async (q: string) => {
			asked = q;
			return 'uploader-fixture';
		};
		assert.equal(await cli(['upload', ws.kitPath, '--approval', approval, '--apply'], {prompt: ownerTypes}), EXIT.ok, err);
		assert.match(asked, /Type the episode slug "uploader-fixture" to start the upload/);
		assert.match(out, /YouTube makes it PUBLIC at 2026-11-28 09:00 CST on its own/);
		assert.match(out, /Done: https:\/\/youtu\.be\/\S+ is private, scheduled for 2026-11-28 09:00 CST\./);
		assert.match(out, /node scripts\/publish-kit\/cli\.ts zoora-ai\/uploader-fixture --youtube-id \S+/);
		assert.equal(fake.count('videos.insert'), 1);

		const sent = fake.requests.length;
		assert.equal(await cli(['upload', ws.kitPath, '--approval', approval, '--apply'], {prompt: owner}), EXIT.refused);
		assert.match(err, /\[already-uploaded\]/);
		assert.equal(fake.requests.length, sent);

		out = '';
		assert.equal(await cli(['status']), EXIT.ok);
		assert.match(out, /complete +zoora-ai\/uploader-fixture long https:\/\/youtu\.be\//);
		assert.match(out, /503 units of 10000, 1 upload calls of 100/);
	});

	it('exits 1 with a resume hint when the run stops partway, and the next run finishes', async () => {
		await approveNow();
		fake.quotaExceeded.add('captions.insert');
		assert.equal(await cli(['upload', ws.kitPath, '--approval', approval, '--apply'], {prompt: owner}), EXIT.failed);
		assert.match(err, /quota is used up.*midnight Pacific Time.*run the same command again to resume/s);
		fake.quotaExceeded.clear();
		// the video is on YouTube: finishing its captions and playlist publishes nothing, so no second prompt is needed
		assert.equal(await cli(['upload', ws.kitPath, '--approval', approval, '--apply']), EXIT.ok, err);
		assert.equal(fake.count('videos.insert'), 1);
	});

	it('rejects bad input with exit 2: spec keys that touch privacy, bad times, unknown flags', async () => {
		const spec = ws.write('spec.json', JSON.stringify({version: 1, privacyStatus: 'public'}));
		assert.equal(await cli(['approve', ws.kitPath, '--spec', spec, '--confirm', 'uploader-fixture']), EXIT.usage);
		assert.match(err, /"privacyStatus" cannot be set here: uploads are always private/);
		assert.equal(await cli(['approve', ws.kitPath, '--publish-at', 'tomorrow morning']), EXIT.usage);
		assert.equal(await main(['plan', ws.kitPath, '--bogus'], deps()), EXIT.usage);
		assert.equal(await cli(['frobnicate']), EXIT.usage);
		assert.equal(await main(['help'], deps()), EXIT.ok);
		assert.match(out, /Exit codes: 0 done, 1 failed or paused/);
	});

	it('auth signs in, checks the channel and saves the account; a pinned channel mismatch is refused', async () => {
		const fresh = makeWorkspace({withAccount: false});
		try {
			const secrets = join(fresh.root, 'client_secret.json');
			writeFileSync(secrets, JSON.stringify({installed: {client_id: 'cid.apps.googleusercontent.com', client_secret: 'shh'}}));
			const openUrl = async (consent: string) => {
				const url = new URL(consent);
				fake.pkceChallenge = url.searchParams.get('code_challenge');
				const redirect = new URL(url.searchParams.get('redirect_uri') ?? '');
				redirect.searchParams.set('code', 'test-code');
				redirect.searchParams.set('state', url.searchParams.get('state') ?? '');
				setTimeout(() => void fetch(redirect).catch(() => {}), 5);
			};
			const args = ['auth', '--channel', 'zoora-ai', '--client-secrets', secrets, '--channels', fresh.channelsPath, '--state-dir', fresh.stateDir];
			fake.issued.push('at-0001');
			assert.equal(await main(args, deps({openUrl, cwd: fresh.root})), EXIT.ok, err);
			assert.match(out, /Saved: "zoora-ai" uploads to Zoora AI \(test\)/);
			assert.match(out, /7 days after consent/);
			const saved = readOAuthFile(join(fresh.stateDir, 'oauth.json'));
			assert.equal(saved.accounts['zoora-ai']?.channelId, CHANNEL_ID);
			assert.equal(saved.client?.clientId, 'cid.apps.googleusercontent.com');

			const pinned = JSON.parse(readFileSync(fresh.channelsPath, 'utf8'));
			pinned.channels['zoora-ai'].youtubeChannelId = 'UCpinnedOtherChannel0001';
			writeFileSync(fresh.channelsPath, JSON.stringify(pinned));
			assert.equal(await main(args, deps({openUrl, cwd: fresh.root})), EXIT.refused);
			assert.match(err, /pins "zoora-ai" to UCpinnedOtherChannel0001/);
		} finally {
			fresh.cleanup();
		}
	});

	it('auth refuses an unpinned slug signed in to a channel another slug pins; channels.json refuses one id pinned twice', async () => {
		const fresh = makeWorkspace({withAccount: false, pinned: false});
		try {
			const secrets = join(fresh.root, 'client_secret.json');
			writeFileSync(secrets, JSON.stringify({installed: {client_id: 'cid.apps.googleusercontent.com', client_secret: 'shh'}}));
			const openUrl = async (consent: string) => {
				const url = new URL(consent);
				fake.pkceChallenge = url.searchParams.get('code_challenge');
				const redirect = new URL(url.searchParams.get('redirect_uri') ?? '');
				redirect.searchParams.set('code', 'test-code');
				redirect.searchParams.set('state', url.searchParams.get('state') ?? '');
				setTimeout(() => void fetch(redirect).catch(() => {}), 5);
			};
			// zoora-ai is unpinned; the Google sign-in picks the channel that zoora-security pins
			const config = JSON.parse(readFileSync(fresh.channelsPath, 'utf8'));
			config.channels['zoora-security'] = {youtubeChannelId: CHANNEL_ID, categoryId: null, defaultLanguage: 'en', playlists: {long: null, short: null}};
			writeFileSync(fresh.channelsPath, JSON.stringify(config));
			const args = ['auth', '--channel', 'zoora-ai', '--client-secrets', secrets, '--channels', fresh.channelsPath, '--state-dir', fresh.stateDir];
			fake.issued.push('at-0001');
			assert.equal(await main(args, deps({openUrl, cwd: fresh.root})), EXIT.refused);
			assert.match(err, /Not saved\.[\s\S]*pins that channel to "zoora-security"/);
			assert.doesNotMatch(out, /Tip: pin it/);
			assert.ok(!existsSync(join(fresh.stateDir, 'oauth.json')), 'nothing saved');

			// pinning zoora-ai to the same id is refused before any sign-in
			config.channels['zoora-ai'].youtubeChannelId = CHANNEL_ID;
			writeFileSync(fresh.channelsPath, JSON.stringify(config));
			err = '';
			assert.equal(await main(args, deps({openUrl, cwd: fresh.root})), EXIT.usage);
			assert.match(err, /zoora-security\.youtubeChannelId \S+ is already pinned to "zoora-ai"/);
		} finally {
			fresh.cleanup();
		}
	});

	it('auth warns when the client-secrets file sits where git would commit it', async () => {
		const repo = mkdtempSync(join(tmpdir(), 'uploader-git-'));
		try {
			execFileSync('git', ['init', '-q'], {cwd: repo});
			const secrets = join(repo, 'client_secret_123.apps.googleusercontent.com.json');
			writeFileSync(secrets, JSON.stringify({installed: {client_id: 'cid.apps.googleusercontent.com', client_secret: 'shh'}}));
			const openUrl = async (consent: string) => {
				const url = new URL(consent);
				fake.pkceChallenge = url.searchParams.get('code_challenge');
				const redirect = new URL(url.searchParams.get('redirect_uri') ?? '');
				redirect.searchParams.set('code', 'test-code');
				redirect.searchParams.set('state', url.searchParams.get('state') ?? '');
				setTimeout(() => void fetch(redirect).catch(() => {}), 5);
			};
			fake.issued.push('at-0001');
			assert.equal(await main(['auth', '--channel', 'zoora-ai', '--client-secrets', secrets, '--channels', ws.channelsPath, '--state-dir', join(repo, 'state-outside')], deps({openUrl, cwd: repo})), EXIT.ok, err);
			assert.match(err, /client_secret_123\.apps\.googleusercontent\.com\.json is inside a git work tree and git would commit it/);
		} finally {
			rmSync(repo, {recursive: true, force: true});
		}
	});

	it('categories lists the assignable ones (1 quota unit)', async () => {
		assert.equal(await cli(['categories']), EXIT.ok, err);
		assert.match(out, /28 {2}Science & Technology/);
		assert.doesNotMatch(out, /Short Movies/);
		assert.equal(fake.count('videoCategories.list'), 1);
	});
});
