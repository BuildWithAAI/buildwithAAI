import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {afterEach, beforeEach, describe, it} from 'node:test';
import {ledgerPath, main, type CliDeps} from './cli.ts';

const fixture = (name: string): string => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
const ALLOWLIST = fileURLToPath(new URL('../threat-brief/fixtures/allowlist.json', import.meta.url));
const DAILY_INPUT = fileURLToPath(new URL('../threat-brief/fixtures/daily-input.json', import.meta.url));
const HUB = fileURLToPath(new URL('../../', import.meta.url));
const TOKEN = '123456789:AAEhBOweik6ad9r_QXMENQjcrGbqCr4K-ab';
const CREDS = {
	TELEGRAM_BOT_TOKEN: TOKEN,
	TELEGRAM_CHAT_ID: '@zoo_fixture_channel',
	X_API_KEY: 'ck',
	X_API_SECRET: 'cs',
	X_ACCESS_TOKEN: 'tok',
	X_ACCESS_TOKEN_SECRET: 'ts',
};
const sha = (data: string | Buffer): string => createHash('sha256').update(data).digest('hex');

type Call = {url: string; init: RequestInit};
type Responder = (url: string) => Response | Promise<Response>;

const okResponder: Responder = (url) =>
	url.includes('api.telegram.org')
		? new Response(JSON.stringify({ok: true, result: {message_id: 5, chat: {id: -100, username: 'zoo_fixture_channel'}}}), {status: 200})
		: new Response(JSON.stringify({data: {id: '1861234567890', text: 'x'}}), {status: 201});

const run = async (argv: string[], over: {env?: Record<string, string>; respond?: Responder; cwd?: string} = {}) => {
	const out: string[] = [];
	const err: string[] = [];
	const calls: Call[] = [];
	const deps: Partial<CliDeps> = {
		env: over.env ?? {},
		cwd: over.cwd ?? process.cwd(),
		fetch: async (input, init) => {
			calls.push({url: String(input), init: init ?? {}});
			return (over.respond ?? okResponder)(String(input));
		},
		now: () => new Date('2026-11-24T10:00:00Z'),
		print: (l) => out.push(l),
		printError: (l) => err.push(l),
	};
	const code = await main(argv, deps);
	return {code, out: out.join('\n'), err: err.join('\n'), calls};
};

/** A stand-in for projects/video-studio: an approved storyboard per episode, and the approval records. */
type Studio = {root: string; storyboard: (channel: string, slug: string) => {path: string; sha256: string}; approve: (channel: string, slug: string, record: unknown) => string};
const makeStudio = (dir: string): Studio => {
	const root = join(dir, 'studio');
	return {
		root,
		storyboard: (channel, slug) => {
			const path = `content/${channel}/${slug}/storyboard.json`;
			mkdirSync(dirname(join(root, path)), {recursive: true});
			if (!existsSync(join(root, path))) writeFileSync(join(root, path), `{"version": 1, "slug": "${slug}"}\n`);
			return {path, sha256: sha(readFileSync(join(root, path)))};
		},
		approve: (channel, slug, record) => {
			const file = join(root, 'content', channel, slug, 'approval.json');
			mkdirSync(dirname(file), {recursive: true});
			writeFileSync(file, JSON.stringify(record, null, 2));
			return file;
		},
	};
};

/** The uploader's record (channel 1 and the weekly batch), as tools/uploader/approval.ts writes it. */
const uploadApproval = (studio: Studio, over: Record<string, unknown> = {}) => ({
	version: 1,
	kind: 'youtube-upload-approval',
	channel: 'zoora-ai',
	slug: 'fixture-signature',
	approvedBy: 'owner',
	approvedAt: '2026-11-24T09:00:00Z',
	expiresAt: '2026-11-30T09:00:00Z',
	publishAt: null,
	render: {id: 'short-1', path: 'out/publish/zoora-ai/fixture-signature/short-1.mp4', sha256: 'b'.repeat(64), bytes: 10},
	storyboard: {...studio.storyboard('zoora-ai', 'fixture-signature'), version: 1},
	plan: {sha256: 'a'.repeat(64), parts: {}},
	inputs: {thumbnail: null, spec: null},
	summary: {},
	...over,
});

/** The daily pipeline's record (video-studio scripts/daily/lib/approve.ts). */
const dailyApproval = (studio: Studio, o: {channel?: string; slug: string; title: string; developing?: boolean; youtubeVideoId?: string | null; kitSha256?: string | null}) => {
	const channel = o.channel ?? 'zoora-security';
	const sb = studio.storyboard(channel, o.slug);
	const renderSha = 'c'.repeat(64);
	return {
		version: 1,
		schema: 'zoora-security/approval@1',
		kind: 'daily-content-approval',
		channel,
		slug: o.slug,
		decision: 'approved',
		approvedBy: 'owner',
		approvedAt: '2026-11-24T09:30:00Z',
		approvedAtLocal: '2026-11-24 03:30 CST',
		via: 'Claude app reply',
		reply: `APPROVE ${o.slug}`,
		versionHash: sha(`storyboard:${sb.sha256}\nrender:${renderSha}\n`),
		versions: {
			storyboard: sb,
			brief: {path: `content/${channel}/${o.slug}/brief.json`, sha256: 'd'.repeat(64)},
			render: {path: `out/approval/${o.slug}/short.mp4`, sha256: renderSha, bytes: 1, durationSec: 50},
			thumbnails: [],
			newsGate: {path: `out/claims/news-${o.slug}.json`, sha256: 'e'.repeat(64), verdict: 'pass'},
			publishKit: {path: `out/daily/${o.slug}/publish/kit.json`, sha256: o.kitSha256 ?? null},
			packet: {path: `out/approval/${o.slug}/packet.json`, sha256: 'f'.repeat(64)},
		},
		developing: o.developing ?? false,
		title: o.title,
		upload: {method: 'manual: YouTube Studio', automated: false, youtubeVideoId: o.youtubeVideoId ?? null, recordedAt: null, note: 'manual'},
		postApproval: [],
		history: [],
	};
};

describe('announcer CLI', () => {
	let dir: string;
	let ledger: string;
	let studio: Studio;
	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), 'announcer-cli-'));
		ledger = join(dir, 'ledger.json');
		studio = makeStudio(dir);
		studio.approve('zoora-ai', 'fixture-signature', uploadApproval(studio));
	});
	afterEach(() => rmSync(dir, {recursive: true, force: true}));

	const post = (...extra: string[]): string[] => ['post', '--kit', fixture('kit.json'), '--offers', fixture('offers.json'), '--allowlist', ALLOWLIST, '--ledger', ledger, '--studio-root', studio.root, ...extra];
	const ledgerEntry = (key: string) => JSON.parse(readFileSync(ledger, 'utf8')).entries[key];

	it('dry run by default: prints each exact request body and posts nothing', async () => {
		const r = await run(post('--targets', 'telegram,x'), {env: CREDS});
		assert.equal(r.code, 0, r.err);
		assert.equal(r.calls.length, 0);
		assert.ok(!existsSync(ledger), 'a dry run never writes the ledger');
		assert.match(r.out, /Announcer DRY RUN for zoora-ai\/fixture-signature/);
		assert.match(r.out, /\[telegram\] would POST https:\/\/api\.telegram\.org\/bot<TELEGRAM_BOT_TOKEN>\/sendMessage/);
		assert.match(r.out, /\[x\] would POST https:\/\/api\.x\.com\/2\/tweets/);
		assert.match(r.out, /body: \{"chat_id":"@zoo_fixture_channel","text":"POV: You almost sign a wallet drainer/);
		assert.match(r.out, /body: \{"text":"The airdrop is free\. The signature is not\./);
		assert.match(r.out, /cost: about \$0\.20 per post with a link/);
		assert.match(r.out, /region-restricted \(hub page only\): exchange-demo/);
		assert.match(r.out, /approval: youtube-upload-approval a{12} OK \(the storyboard is the approved version/);
		assert.match(r.out, /DRY RUN: nothing was posted/);
		assert.ok(!r.out.includes(TOKEN), 'the bot token is never printed');
	});

	it('--out writes the planned posts', async () => {
		const r = await run(post('--out', join(dir, 'plan')));
		assert.equal(r.code, 0, r.err);
		assert.match(readFileSync(join(dir, 'plan', 'x.txt'), 'utf8'), /s=x/);
		assert.match(readFileSync(join(dir, 'plan', 'telegram.txt'), 'utf8'), /s=other/);
		assert.equal(JSON.parse(readFileSync(join(dir, 'plan', 'plan.json'), 'utf8')).mode, 'dry-run');
	});

	it('--apply posts once per target and records it; a second run skips both', async () => {
		const first = await run(post('--apply'), {env: CREDS});
		assert.equal(first.code, 0, first.err);
		assert.deepEqual(first.calls.map((c) => new URL(c.url).pathname.replace(TOKEN, '<token>')), ['/bot<token>/sendMessage', '/2/tweets']);
		assert.match(first.out, /\[telegram\] posted: https:\/\/t\.me\/zoo_fixture_channel\/5/);
		assert.match(first.out, /\[x\] posted: https:\/\/x\.com\/i\/web\/status\/1861234567890/);
		assert.equal(ledgerEntry('zoora-ai/fixture-signature#telegram').state, 'posted');
		assert.equal(ledgerEntry('zoora-ai/fixture-signature#x').remoteId, '1861234567890');
		assert.ok(!existsSync(`${ledger}.lock`), 'the lock is released');

		const second = await run(post('--apply'), {env: CREDS});
		assert.equal(second.code, 0, second.err);
		assert.equal(second.calls.length, 0);
		assert.match(second.out, /\[x\] not posted: already posted/);
		assert.match(second.out, /ledger: already posted/);
	});

	it('never posts without the video id, credentials or a clean lint', async () => {
		const noVideo = await run(['post', '--kit', fixture('kit-developing.json'), '--allowlist', ALLOWLIST, '--ledger', ledger, '--studio-root', studio.root, '--apply'], {env: CREDS});
		assert.equal(noVideo.code, 1);
		assert.match(noVideo.err, /video-link-pending/);
		assert.match(noVideo.err, /Nothing was posted/);
		assert.equal(noVideo.calls.length, 0);

		const noCreds = await run(post('--apply', '--targets', 'x'), {env: {TELEGRAM_BOT_TOKEN: TOKEN}});
		assert.equal(noCreds.code, 1);
		assert.match(noCreds.err, /\[x\] not posted: missing X_API_KEY/);
		assert.equal(noCreds.calls.length, 0);
		assert.ok(!existsSync(ledger) || !JSON.parse(readFileSync(ledger, 'utf8')).entries['zoora-ai/fixture-signature#x'], 'nothing recorded for a post that was never sent');
	});

	describe('the owner approval (no publishing without it)', () => {
		it('refuses --apply with no approval record, and says so in the dry run', async () => {
			rmSync(join(studio.root, 'content', 'zoora-ai', 'fixture-signature', 'approval.json'));
			const dry = await run(post(), {env: CREDS});
			assert.equal(dry.code, 0, dry.err);
			assert.match(dry.out, /approval: not yet \(--apply needs it\): no approval record at/);
			const r = await run(post('--apply'), {env: CREDS});
			assert.equal(r.code, 1);
			assert.match(r.err, /\[structure\/not-approved\] the owner's approval does not cover this post: no approval record/);
			assert.match(r.err, /Nothing was posted/);
			assert.equal(r.calls.length, 0);
			assert.ok(!existsSync(ledger), 'nothing is recorded either');
		});

		it('refuses an expired approval, one for another episode, and a storyboard changed after approval', async () => {
			const refused = async (record: unknown, reason: RegExp): Promise<void> => {
				const file = studio.approve('zoora-ai', 'fixture-signature', record);
				const r = await run(post('--apply'), {env: CREDS});
				assert.equal(r.code, 1, `${reason}`);
				assert.match(r.err, reason);
				assert.equal(r.calls.length, 0);
				rmSync(file);
			};
			await refused(uploadApproval(studio, {expiresAt: '2026-11-24T09:59:00Z'}), /expired at 2026-11-24T09:59:00Z/);
			await refused(uploadApproval(studio, {slug: 'another-episode'}), /approves zoora-ai\/another-episode, not zoora-ai\/fixture-signature/);
			await refused({...uploadApproval(studio), kind: 'something-else'}, /unknown "kind"/);
			const record = uploadApproval(studio);
			writeFileSync(join(studio.root, 'content/zoora-ai/fixture-signature/storyboard.json'), '{"version": 1, "slug": "fixture-signature", "edited": true}\n');
			await refused(record, /the storyboard changed after approval/);
		});

		it('takes another record with --approval (the weekly batch keeps them next to the kit)', async () => {
			const elsewhere = join(dir, 'approval-short-1.json');
			writeFileSync(elsewhere, JSON.stringify(uploadApproval(studio)));
			rmSync(join(studio.root, 'content', 'zoora-ai', 'fixture-signature', 'approval.json'));
			const r = await run(post('--apply', '--targets', 'x', '--approval', elsewhere), {env: CREDS});
			assert.equal(r.code, 0, r.err);
			assert.equal(r.calls.length, 1);
		});

		it('a daily approval binds the exact kit.json and the recorded video id', async () => {
			// a daily episode's kit: the fixture kit as the security channel's
			const kit = {...JSON.parse(readFileSync(fixture('kit.json'), 'utf8')), channel: 'zoora-security', slug: '2026-11-24-fixture-signature'};
			const kitFile = join(dir, 'kit.json');
			writeFileSync(kitFile, `${JSON.stringify(kit, null, 2)}\n`);
			const args = (...extra: string[]): string[] => ['post', '--kit', kitFile, '--offers', fixture('offers.json'), '--allowlist', ALLOWLIST, '--ledger', ledger, '--studio-root', studio.root, '--targets', 'x', ...extra];
			const approve = (over: Partial<Parameters<typeof dailyApproval>[1]> = {}) =>
				studio.approve('zoora-security', kit.slug, dailyApproval(studio, {slug: kit.slug, title: kit.title, youtubeVideoId: 'Zb7xq2Ph0aA', kitSha256: sha(readFileSync(kitFile)), ...over}));

			approve({youtubeVideoId: null});
			const noId = await run(args('--apply'), {env: CREDS});
			assert.equal(noId.code, 1);
			assert.match(noId.err, /records no YouTube id yet/);

			approve({youtubeVideoId: 'AAAAAAAAAAA'});
			const otherVideo = await run(args('--apply'), {env: CREDS});
			assert.equal(otherVideo.code, 1);
			assert.match(otherVideo.err, /records the video AAAAAAAAAAA, not Zb7xq2Ph0aA/);

			approve({kitSha256: 'a'.repeat(64)});
			const otherKit = await run(args('--apply'), {env: CREDS});
			assert.equal(otherKit.code, 1);
			assert.match(otherKit.err, /kit\.json is not the approved publish kit/);

			approve({developing: true});
			const unlabelled = await run(args('--apply'), {env: CREDS});
			assert.equal(unlabelled.code, 1);
			assert.match(unlabelled.err, /approves a DEVELOPING story, but this is not labelled DEVELOPING/);
			assert.equal(otherKit.calls.length + otherVideo.calls.length + noId.calls.length + unlabelled.calls.length, 0);

			approve();
			const ok = await run(args('--apply'), {env: CREDS});
			assert.equal(ok.code, 0, ok.err);
			assert.match(ok.out, /approval: daily-content-approval [0-9a-f]{12} OK .*kit\.json is the approved publish kit/);
			assert.equal(ok.calls.length, 1);
		});
	});

	describe('the ledger never lets a post that may exist be sent twice', () => {
		it('a lost answer leaves the target pending and blocks it until "ledger forget"', async () => {
			const lost = await run(post('--apply', '--targets', 'x'), {env: CREDS, respond: () => Promise.reject(new TypeError('socket hang up'))});
			assert.equal(lost.code, 1);
			assert.match(lost.err, /may have been posted/);
			const blocked = await run(post('--apply', '--targets', 'x'), {env: CREDS});
			assert.equal(blocked.code, 1);
			assert.equal(blocked.calls.length, 0);
			assert.match(blocked.err, /got no answer, so it may have been posted/);

			const list = await run(['ledger', 'list', '--ledger', ledger]);
			assert.match(list.out, /zoora-ai\/fixture-signature#x {2}pending/);
			const forget = await run(['ledger', 'forget', 'zoora-ai/fixture-signature#x', '--ledger', ledger]);
			assert.equal(forget.code, 0, forget.err);
			const retry = await run(post('--apply', '--targets', 'x'), {env: CREDS});
			assert.equal(retry.code, 0, retry.err);
			assert.equal(retry.calls.length, 1);
			assert.equal((await run(['ledger', 'forget', 'nope#x', '--ledger', ledger])).code, 1);
			assert.equal((await run(['ledger', 'frobnicate', '--ledger', ledger])).code, 2);
		});

		it('a refusal is recorded as failed and may be retried', async () => {
			const refused = await run(post('--apply', '--targets', 'telegram'), {
				env: CREDS,
				respond: () => new Response(JSON.stringify({ok: false, error_code: 403, description: 'Forbidden: bot is not a member of the channel chat'}), {status: 403}),
			});
			assert.equal(refused.code, 1);
			assert.match(refused.err, /Nothing was posted; you can run again later/);
			assert.equal(ledgerEntry('zoora-ai/fixture-signature#telegram').state, 'failed');
			const retry = await run(post('--apply', '--targets', 'telegram'), {env: CREDS});
			assert.equal(retry.code, 0, retry.err);
		});

		// The reviewer's attacks: Telegram answers HTTP 200 (the message WAS posted) but the body cannot be read.
		const unconfirmed: [string, () => Response][] = [
			['200 with a truncated JSON body', () => new Response('{"ok":true,"result":{"message_id":5', {status: 200})],
			[
				'200 whose body stream errors',
				() =>
					new Response(
						new ReadableStream({
							start(c) {
								c.error(new Error('ECONNRESET'));
							},
						}),
						{status: 200},
					),
			],
			['200 with no message id', () => new Response(JSON.stringify({ok: true, result: {}}), {status: 200})],
			['200 that is not JSON (a proxy page)', () => new Response('<html>ok</html>', {status: 200})],
		];
		for (const [name, respond] of unconfirmed) {
			it(`Telegram ${name}: recorded as pending ("may have been posted"), never posted again`, async () => {
				const first = await run(post('--apply', '--targets', 'telegram'), {env: CREDS, respond});
				assert.equal(first.code, 1);
				assert.equal(first.calls.length, 1);
				assert.equal(ledgerEntry('zoora-ai/fixture-signature#telegram').state, 'pending');
				assert.match(first.err, /may have been posted/);
				assert.doesNotMatch(first.err, /Nothing was posted/);
				const second = await run(post('--apply', '--targets', 'telegram'), {env: CREDS});
				assert.equal(second.calls.length, 0, 'a message Telegram may have accepted is never sent a second time');
				assert.equal(second.code, 1);
			});
		}
	});

	it('--video sends the Telegram post as a sendVideo caption', async () => {
		const video = join(dir, 'short-1.mp4');
		writeFileSync(video, Buffer.from('fake mp4'));
		const r = await run(post('--apply', '--targets', 'telegram', '--video', video), {env: CREDS});
		assert.equal(r.code, 0, r.err);
		assert.match(r.calls[0]?.url ?? '', /\/sendVideo$/);
		assert.ok((r.calls[0]?.init.body as FormData).get('caption'));
	});

	it('rejects bad usage with exit code 2', async () => {
		assert.equal((await run(['post'])).code, 2);
		assert.equal((await run(post('--targets', 'x,facebook'))).code, 2);
		assert.equal((await run(post('--youtube-id', 'AAAAAAAAAAA'))).code, 2, 'an id that does not match the kit');
		assert.equal((await run(post('--targets', 'x', '--video', fixture('kit.json')))).code, 2);
		assert.equal((await run(post('--hub', 'http://go.zoora.ai'))).code, 2);
		assert.equal((await run(['tweet'])).code, 2);
		assert.match((await run(['--help'])).out, /Usage:/);
	});

	it('ANNOUNCER_LEDGER is relative to the hub, so the daily (run from video-studio) and a manual run share one ledger', () => {
		const fromStudio = ledgerPath(undefined, {ANNOUNCER_LEDGER: 'data/announcer/shared.json'}, '/somewhere/video-studio');
		const fromHub = ledgerPath(undefined, {ANNOUNCER_LEDGER: 'data/announcer/shared.json'}, HUB);
		assert.equal(fromStudio, resolve(HUB, 'data/announcer/shared.json'));
		assert.equal(fromStudio, fromHub);
		assert.equal(ledgerPath(undefined, {ANNOUNCER_LEDGER: '/abs/ledger.json'}, '/x'), '/abs/ledger.json');
		assert.equal(ledgerPath('mine.json', {ANNOUNCER_LEDGER: 'data/x.json'}, '/work'), '/work/mine.json', '--ledger is relative to where you run it');
		assert.equal(ledgerPath(undefined, {}, '/x'), resolve(HUB, 'data/announcer/ledger.json'));
	});

	describe('daily pipeline call (--input --out [--dry-run])', () => {
		const daily = (...extra: string[]): string[] => ['--input', DAILY_INPUT, '--out', join(dir, 'post'), '--allowlist', ALLOWLIST, '--ledger', ledger, '--studio-root', studio.root, ...extra];
		const input = JSON.parse(readFileSync(DAILY_INPUT, 'utf8'));

		it('is a dry run even without --dry-run, and writes next to the daily drafts', async () => {
			const r = await run(daily(), {env: CREDS});
			assert.equal(r.code, 0, r.err);
			assert.equal(r.calls.length, 0);
			assert.match(r.out, /never posts by itself/);
			assert.ok(existsSync(join(dir, 'post', 'announce-x.txt')));
			assert.ok(existsSync(join(dir, 'post', 'announce-telegram.txt')));
			assert.ok(existsSync(join(dir, 'post', 'announce-plan.json')));
			assert.doesNotMatch(readFileSync(join(dir, 'post', 'announce-telegram.txt'), 'utf8'), /^- 2026-11-23:/m, 'no source is credited to a date');
		});

		it('--dry-run wins over --apply; --apply alone still needs the video id', async () => {
			const both = await run(daily('--apply', '--dry-run'), {env: CREDS});
			assert.equal(both.code, 0, both.err);
			assert.equal(both.calls.length, 0);
			const apply = await run(daily('--apply'), {env: CREDS});
			assert.equal(apply.code, 1, 'the fixture input has no YouTube id yet');
			assert.equal(apply.calls.length, 0);
		});

		it('posts with --apply once the daily input has the video id and the daily approval covers it', async () => {
			const withId = join(dir, 'input.json');
			writeFileSync(withId, JSON.stringify({...input, youtubeId: 'Zb7xq2Ph0aA'}));
			const args = ['--input', withId, '--out', join(dir, 'post'), '--allowlist', ALLOWLIST, '--ledger', ledger, '--studio-root', studio.root, '--apply'];
			const none = await run(args, {env: CREDS});
			assert.equal(none.code, 1, 'no approval record yet');
			assert.match(none.err, /not-approved/);
			assert.equal(none.calls.length, 0);

			studio.approve('zoora-security', input.slug, dailyApproval(studio, {slug: input.slug, title: 'Another title', youtubeVideoId: 'Zb7xq2Ph0aA'}));
			const otherTitle = await run(args, {env: CREDS});
			assert.equal(otherTitle.code, 1);
			assert.match(otherTitle.err, /approves the title "Another title"/);

			studio.approve('zoora-security', input.slug, {...uploadApproval(studio), channel: 'zoora-security', slug: input.slug});
			const wrongKind = await run(args, {env: CREDS});
			assert.equal(wrongKind.code, 1);
			assert.match(wrongKind.err, /needs the owner's "daily-content-approval" record/);

			studio.approve('zoora-security', input.slug, dailyApproval(studio, {slug: input.slug, title: input.title, youtubeVideoId: 'Zb7xq2Ph0aA'}));
			const r = await run(args, {env: CREDS});
			assert.equal(r.code, 0, r.err);
			assert.equal(r.calls.length, 2);
			assert.ok(JSON.parse(readFileSync(ledger, 'utf8')).entries['zoora-security/2026-11-24-fixtureswap#x']);
		});
	});
});
