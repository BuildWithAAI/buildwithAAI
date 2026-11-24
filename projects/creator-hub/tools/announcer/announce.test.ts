import assert from 'node:assert/strict';
import {existsSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {afterEach, beforeEach, describe, it} from 'node:test';
import {checkRegistry} from '../../src/server/offers.ts';
import type {OfferRegistry} from '../../src/types.ts';
import {loadAllowlist, makeAllow, type NameAllow} from '../threat-brief/safety.ts';
import {clearance, forgetEntry, LedgerError, ledgerKey, newEntry, putEntry, readLedger, readLockToken, takeOverStaleLock, withLedgerLock} from './ledger.ts';
import {lintPost, lintSource} from './lint.ts';
import {checkDailySource, hashtagsFrom, hookFrom, readKitSource, type AnnounceSource} from './source.ts';
import {buildTelegramPost, buildXPost, DEVELOPING_LINE, fitHook, planOffers, sourceLine, VIDEO_LINK_PENDING} from './templates.ts';
import {xLength} from './x-count.ts';

const fixture = (name: string): string => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
const NOW = new Date('2026-11-24T10:00:00Z');
const registry = checkRegistry(JSON.parse(readFileSync(fixture('offers.json'), 'utf8'))).registry as OfferRegistry;
const allow: NameAllow = loadAllowlist(fileURLToPath(new URL('../threat-brief/fixtures/allowlist.json', import.meta.url))).allow ?? makeAllow([]);
const kit = readKitSource(fixture('kit.json')).source as AnnounceSource;
const developing = readKitSource(fixture('kit-developing.json')).source as AnnounceSource;

describe('ledger', () => {
	let dir: string;
	let file: string;
	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), 'announcer-ledger-'));
		file = join(dir, 'data', 'ledger.json');
	});
	afterEach(() => rmSync(dir, {recursive: true, force: true}));

	it('starts empty, writes atomically, and decides what may be posted', () => {
		assert.deepEqual(readLedger(file), {version: 1, entries: {}});
		const key = ledgerKey('zoora-ai/ep', 'x');
		assert.deepEqual(clearance(readLedger(file), key), {ok: true, previous: null});
		const pending = newEntry('zoora-ai/ep', 'x', 'abc', '2026-11-24T10:00:00Z', null);
		putEntry(file, pending);
		const blocked = clearance(readLedger(file), key);
		assert.equal(blocked.ok, false);
		assert.match(blocked.ok ? '' : blocked.reason, /may have been posted.*ledger forget "zoora-ai\/ep#x"/);
		putEntry(file, {...pending, state: 'posted', postedAt: '2026-11-24T10:00:01Z', remoteId: '99', url: 'https://x.com/i/web/status/99'});
		const posted = clearance(readLedger(file), key);
		assert.match(posted.ok ? '' : posted.reason, /already posted 2026-11-24T10:00:01Z \(id 99\)/);
		putEntry(file, {...pending, state: 'failed', error: 'X answered 403'});
		const retry = clearance(readLedger(file), key);
		assert.equal(retry.ok, true);
		assert.equal(retry.ok ? newEntry('zoora-ai/ep', 'x', 'abc', 'later', retry.previous).history.length : 0, 2);
		assert.equal(forgetEntry(file, key), true);
		assert.equal(forgetEntry(file, key), false);
		assert.ok(!existsSync(`${file}.${process.pid}.tmp`));
	});

	it('refuses to work from an unreadable ledger (fail closed)', () => {
		putEntry(file, newEntry('a/b', 'x', 'h', 't', null));
		writeFileSync(file, '{"version": 1, "entries": ');
		assert.throws(() => readLedger(file), LedgerError);
		writeFileSync(file, '{"version": 2, "entries": {}}');
		assert.throws(() => readLedger(file), /unknown format/);
	});

	it('lets one run hold the lock, and replaces a stale lock from a crashed run', async () => {
		await withLedgerLock(file, async () => {
			await assert.rejects(withLedgerLock(file, async () => 1), /another announcer run holds/);
		});
		assert.ok(!existsSync(`${file}.lock`));
		writeFileSync(`${file}.lock`, 'old');
		const old = new Date(Date.now() - 11 * 60_000);
		utimesSync(`${file}.lock`, old, old);
		assert.equal(await withLedgerLock(file, async () => 'ran'), 'ran');
	});

	it('a stale-lock takeover race never leaves two holders, and a run removes only its own lock', async () => {
		// the reviewer's interleaving: B saw the stale lock, A took it over first, then B replays its takeover
		const lock = `${file}.lock`;
		putEntry(file, newEntry('a/b', 'x', 'h', 't', null));
		writeFileSync(lock, '999999 2026-11-24T00:00:00Z\n');
		const old = new Date(Date.now() - 11 * 60_000);
		utimesSync(lock, old, old);
		const seenByB = readFileSync(lock, 'utf8');
		await withLedgerLock(file, async (held) => {
			const mine = readLockToken(lock);
			assert.equal(mine, held.token);
			assert.equal(takeOverStaleLock(lock, seenByB), false, "B must not move A's fresh lock away");
			assert.equal(readLockToken(lock), mine, "A's lock is back in place, untouched");
			held.assertHeld();
			await assert.rejects(withLedgerLock(file, async () => 'B'), /another announcer run holds/);
			// had B removed A's lock by path and made its own, A notices before posting and leaves B's lock alone
			rmSync(lock);
			writeFileSync(lock, 'b-token 2 2026-11-24T10:00:00Z\n');
			assert.throws(() => held.assertHeld(), /lost the lock/);
		});
		assert.equal(readFileSync(lock, 'utf8'), 'b-token 2 2026-11-24T10:00:00Z\n', "A's finally removed only its own lock");
		assert.equal(takeOverStaleLock(lock, 'b-token 2 2026-11-24T10:00:00Z\n'), false, 'a fresh lock is never taken over');
		assert.ok(existsSync(lock));
	});

	it('keeps a long run fresh: refresh (and the heartbeat) update the lock, so it is never taken for a crashed run', async () => {
		const lock = `${file}.lock`;
		await withLedgerLock(file, async (held) => {
			const old = new Date(Date.now() - 9 * 60_000);
			utimesSync(lock, old, old);
			held.refresh();
			assert.ok(Date.now() - statSync(lock).mtimeMs < 60_000);
			await assert.rejects(withLedgerLock(file, async () => 1), /another announcer run holds/);
		});
	});
});

describe('source readers', () => {
	it('reads a kit: hook from the X post, hashtags, developing from the disclosures', () => {
		assert.equal(kit.hook, 'The airdrop is free. The signature is not.');
		assert.deepEqual(kit.hashtags, ['#CryptoSecurity', '#WalletDrainer']);
		assert.equal(kit.developing, false);
		assert.equal(developing.developing, true);
		assert.equal(hookFrom('https://x.test\n#Tag\nDEVELOPING: Real hook', 'Title'), 'Real hook');
		assert.equal(hookFrom('', 'DEVELOPING: Title'), 'Title');
		assert.deepEqual(hashtagsFrom('a #One b #One #Two&x'), ['#One', '#Two']);
		assert.match(readKitSource(fixture('missing.json')).errors.join(), /cannot read/);
	});
	it("reads the daily pipeline's PostInput", () => {
		const raw = JSON.parse(readFileSync(fileURLToPath(new URL('../threat-brief/fixtures/daily-input.json', import.meta.url)), 'utf8'));
		const {source, errors} = checkDailySource(raw);
		assert.deepEqual(errors, []);
		assert.equal(source?.channel, 'zoora-security');
		assert.deepEqual(
			source?.sources,
			[{title: 'Fixture DB hacks: FixtureSwap (2026-11-23) (Fixture DB)', url: 'https://db.fixture.test/hacks#FixtureSwap@2026-11-23'}],
			"the publisher comes from the PostInput's publisher field, never from the title's last parenthetical (a date)",
		);
		assert.equal(sourceLine(source!.sources[0]!.title, source!.sources[0]!.url, allow), '- Fixture DB hacks: FixtureSwap (2026-11-23): https://db.fixture.test/hacks#FixtureSwap@2026-11-23');
		const other = checkDailySource({...raw, sources: [{publisher: 'Example Wire', title: 'Mock Bridge pauses deposits', url: 'https://wire.example.test/a'}]});
		assert.equal(other.source?.sources[0]?.title, 'Mock Bridge pauses deposits (Example Wire)');
		const credited = checkDailySource({...raw, sources: [{publisher: 'Example Wire', title: 'Mock Bridge pauses deposits (Example Wire)', url: 'https://wire.example.test/a'}]});
		assert.equal(credited.source?.sources[0]?.title, 'Mock Bridge pauses deposits (Example Wire)', 'a title already credited is not credited twice');
		assert.match(checkDailySource({slug: 'bad slug!', title: '', developing: 'no'}).errors.join(' '), /slug.*title.*developing/);
	});
});

describe('offers', () => {
	it('includes live unrestricted offers, keeps restricted ones off the posts, leaves the rest out', () => {
		const plan = planOffers(kit, registry, NOW, null);
		assert.deepEqual(plan.included.map((o) => o.id), ['hardware-wallet']);
		assert.deepEqual(plan.restricted, ['exchange-demo']);
		assert.deepEqual(plan.leftOut, [{id: 'paused-tool', reason: 'inactive or expired in the offer registry'}]);
		assert.equal(plan.origin, 'https://go.zoora.ai');
		assert.deepEqual(planOffers(kit, null, NOW, null).included, [], 'no registry: no offers (fail closed)');
	});
	it('reports offers without a disclosure or a valid hub link', () => {
		const broken = {...kit, offers: [{id: 'hardware-wallet', hubUrl: 'http://go.zoora.ai/go/hardware-wallet', disclosure: ''}]};
		const plan = planOffers(broken, registry, NOW, null);
		assert.equal(plan.problems.length, 2);
		assert.equal(lintSource(broken, plan).filter((f) => f.rule === 'offers').length, 2);
	});
});

describe('X post', () => {
	const plan = planOffers(kit, registry, NOW, null);
	const post = buildXPost(kit, plan);

	it('hook, summary sentence, video link, then each offer with its disclosure and ?s=x', () => {
		assert.equal(
			post.text,
			[
				'The airdrop is free. The signature is not.',
				'A stranger offers you a free airdrop and a claim link.',
				'https://youtu.be/Zb7xq2Ph0aA',
				'Affiliate link: I may earn a commission if you buy. It costs you nothing extra. https://go.zoora.ai/go/hardware-wallet?v=fixture-signature&s=x',
				'#CryptoSecurity #WalletDrainer',
			].join('\n\n'),
		);
		assert.equal(post.length, xLength(post.text));
		assert.ok(post.length <= 280);
		assert.ok(!post.text.includes('exchange-demo'));
		assert.deepEqual(lintPost(post, kit, plan, allow, {apply: true}).filter((f) => f.level === 'error'), []);
	});

	it('drops hashtags, then the summary, then shortens the hook to fit 280', () => {
		const long = {...kit, hook: `${'A very long hook about wallet safety '.repeat(5)}end.`, summary: `${'Another long sentence about the episode and its scam '.repeat(3)}.`};
		const p = buildXPost(long, plan);
		assert.ok(p.length <= 280, String(p.length));
		assert.ok(p.text.includes('https://go.zoora.ai/go/hardware-wallet?v=fixture-signature&s=x'), 'the disclosure and link always stay');
		assert.ok(p.notes.some((n) => /summary sentence did not fit/.test(n)));
		assert.ok(p.notes.some((n) => /hook was shortened/.test(n)));
	});

	it("shortens on X's weighted count, so a shortened post always fits (ellipsis, emoji and CJK weigh 2)", () => {
		const bare = {...kit, summary: '', hashtags: [], offers: []};
		const noOffers = planOffers(bare, registry, NOW, null);
		for (const hook of ['x'.repeat(256), `${'word '.repeat(60)}end`, '漢字'.repeat(80), `${'🚨'.repeat(30)} Mock Bridge paused ${'🔥'.repeat(90)}`]) {
			const p = buildXPost({...bare, hook}, noOffers);
			assert.ok(xLength(p.text) <= 280, `${xLength(p.text)} for a hook of ${hook.length}`);
			assert.equal(p.length, xLength(p.text));
			assert.deepEqual(lintPost(p, bare, noOffers, allow, {apply: true}).filter((f) => f.code === 'too-long'), []);
		}
		const exact = buildXPost({...bare, hook: 'x'.repeat(255)}, noOffers);
		assert.equal(exact.length, 280, 'a post that fits is never shortened');
		assert.ok(!exact.notes.some((n) => /shortened/.test(n)));
		assert.equal(fitHook('one two three four', (h) => h.length <= 10), 'one two…');
		assert.equal(fitHook('abcdefghij', (h) => h.length <= 5), 'abcd…');
	});

	it('labels a developing story and uses a placeholder until the video id is known', () => {
		const p = buildXPost(developing, planOffers(developing, registry, NOW, null));
		assert.match(p.text, /^DEVELOPING: Mock Bridge paused after a reported exploit/);
		assert.ok(p.text.includes(VIDEO_LINK_PENDING));
		const findings = lintPost(p, developing, planOffers(developing, registry, NOW, null), allow, {apply: false});
		assert.equal(findings.find((f) => f.code === 'video-link-pending')?.level, 'warning');
		assert.equal(lintPost(p, developing, planOffers(developing, registry, NOW, null), allow, {apply: true}).find((f) => f.code === 'video-link-pending')?.level, 'error');
	});
});

describe('Telegram post', () => {
	const plan = planOffers(kit, registry, NOW, null);

	it('title, summary, link, offers with disclosures (?s=other), the hub page for restricted offers, disclosures, sources', () => {
		const post = buildTelegramPost(kit, plan, {video: false, allow});
		assert.equal(post.method, 'sendMessage');
		assert.equal(
			post.text,
			[
				'POV: You almost sign a wallet drainer',
				kit.summary,
				'Watch: https://youtu.be/Zb7xq2Ph0aA',
				'Affiliate link: I may earn a commission if you buy. It costs you nothing extra.\nhttps://go.zoora.ai/go/hardware-wallet?v=fixture-signature&s=other',
				'More partner links, only where they are available in your country: https://go.zoora.ai/?v=fixture-signature&s=other\nSome of them are affiliate or referral links that may earn me money; each one is disclosed on that page.',
				'Disclosure: some links for this video are affiliate or referral links. If you use them, I may earn money. Each one is labelled next to the link.\nFictional story: the people, chats and wallets in this video are made up and animated.\nEducation only, not financial advice.',
				'Sources:\n- FTC: What To Know About Cryptocurrency and Scams: https://consumer.ftc.gov/articles/what-know-about-cryptocurrency-and-scams',
			].join('\n\n'),
		);
		assert.ok(!/Demo Exchange|exchange-demo/.test(post.text), 'a restricted offer is never named');
		assert.deepEqual(lintPost(post, kit, plan, allow, {apply: true}).filter((f) => f.level === 'error'), []);
	});

	it('a developing story starts with DEVELOPING and ends with the corrections line', () => {
		const post = buildTelegramPost(developing, planOffers(developing, registry, NOW, null), {video: false, allow});
		assert.match(post.text, /^DEVELOPING: Mock Bridge paused after a reported exploit/);
		assert.ok(post.text.endsWith(DEVELOPING_LINE));
		assert.equal((post.text.match(/developing/gi) ?? []).length, 2, "the kit's own developing disclosure is not repeated");
	});

	it('a video caption keeps to 1024 characters by dropping sources, then the summary', () => {
		const long = {...kit, summary: 'Long summary sentence about the scam. '.repeat(30)};
		const post = buildTelegramPost(long, plan, {video: true, allow});
		assert.equal(post.method, 'sendVideo');
		assert.ok(post.length <= 1024, String(post.length));
		assert.ok(!post.text.includes('Sources:'));
		assert.ok(post.notes.some((n) => /summary did not fit/.test(n)));
		assert.match(post.text, /Full episode: https:\/\/youtu\.be\/Zb7xq2Ph0aA/);
	});

	it('quotes source headlines with their publisher only when they are safe', () => {
		assert.equal(sourceLine('Mock Bridge pauses deposits (Example Wire)', 'https://wire.example.test/a', allow), '- Example Wire: “Mock Bridge pauses deposits” https://wire.example.test/a');
		assert.equal(sourceLine('CEO John Smith says funds are safe (Sample Daily)', 'https://daily.sample.test/b', allow), '- Sample Daily: https://daily.sample.test/b');
		assert.equal(sourceLine('Fixture DB hacks: FixtureSwap (2026-11-23) (Fixture DB)', 'https://db.fixture.test/x', allow), '- Fixture DB hacks: FixtureSwap (2026-11-23): https://db.fixture.test/x');
		assert.equal(sourceLine('Token price crashes 40%', 'https://www.news.test/c', allow), '- news.test: https://www.news.test/c');
	});

	it('never credits a quote to a date (the reviewer\'s SlowMist case)', () => {
		const slowmist = {publisher: 'Fixture Firm', title: 'Fixture Firm Hacked: FixtureSwap (2026-11-21)', url: 'https://firm.fixture.test/#FixtureSwap@2026-11-21'};
		assert.equal(sourceLine(slowmist.title, slowmist.url, allow), '- Fixture Firm Hacked: FixtureSwap (2026-11-21): https://firm.fixture.test/#FixtureSwap@2026-11-21');
		assert.equal(sourceLine('Bridge paused after exploit (Nov 21, 2026)', 'https://wire.example.test/z', allow), '- Bridge paused after exploit (Nov 21, 2026): https://wire.example.test/z');
		const raw = JSON.parse(readFileSync(fileURLToPath(new URL('../threat-brief/fixtures/daily-input.json', import.meta.url)), 'utf8'));
		const daily = checkDailySource({...raw, youtubeId: 'Zb7xq2Ph0aA', sources: [slowmist]}).source!;
		const post = buildTelegramPost(daily, planOffers(daily, null, NOW, null), {video: false, allow});
		assert.match(post.text, /^- Fixture Firm Hacked: FixtureSwap \(2026-11-21\): https:/m);
		assert.doesNotMatch(post.text, /^- \d{4}-\d{2}-\d{2}:/m, 'no source line starts with a date');
	});
});

describe('post lint', () => {
	const plan = planOffers(kit, registry, NOW, null);
	it('catches a missing DEVELOPING label, a wrong hub source, a missing disclosure, names and length', () => {
		const base = buildXPost(kit, plan);
		const codes = (text: string, source: AnnounceSource = kit): string[] =>
			lintPost({...base, text, length: xLength(text)}, source, plan, allow, {apply: true}).filter((f) => f.level === 'error').map((f) => `${f.rule}/${f.code}`);
		assert.ok(codes('Mock Bridge paused https://youtu.be/Zb7xq2Ph0aA', developing).includes('developing/label'));
		assert.ok(codes('Watch https://youtu.be/Zb7xq2Ph0aA Affiliate link: I may earn a commission if you buy. It costs you nothing extra. https://go.zoora.ai/go/hardware-wallet?v=x&s=yt').includes('links/hub-source'));
		assert.ok(codes('Watch https://go.zoora.ai/go/hardware-wallet?v=x&s=x').includes('offers/disclosure'));
		assert.ok(codes('Watch https://go.zoora.ai/go/exchange-demo?v=x&s=x').includes('offers/unknown-offer'));
		assert.ok(codes('John Smith says watch https://youtu.be/Zb7xq2Ph0aA').includes('names/first-name'));
		assert.ok(codes('x'.repeat(281)).includes('limits/too-long'));
	});
	it('blocks a kit whose blocking checks failed, but not one with a failed chapters check', () => {
		assert.deepEqual(lintSource(kit, plan), [], 'chapters is not a blocking check');
		const failed = {...kit, checks: [{id: 'income-claims', ok: false, detail: '"guaranteed" in the title'}]};
		assert.equal(lintSource(failed, plan)[0]?.code, 'kit-check');
	});
});
