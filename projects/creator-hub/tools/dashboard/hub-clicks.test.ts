import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {after, before, describe, it} from 'node:test';
import {DB_FILE, insertClick, openDb} from '../../src/server/db.ts';
import {csvCell} from '../../src/server/routes/admin.ts';
import type {ClickEvent} from '../../src/types.ts';
import {DAY_MS, parseHubCsv, readHubCsv, readHubDb} from './hub-clicks.ts';
import type {ClickCount} from './model.ts';

const DAY1 = Date.UTC(2026, 10, 2); // 2026-11-02 00:00 UTC
const DAY2 = DAY1 + DAY_MS;

const click = (over: Partial<ClickEvent>): ClickEvent => ({
	ts: DAY1 + 3_600_000,
	offerId: 'hardware-wallet',
	videoId: 'fixture0001',
	source: 'yt',
	country: 'DE',
	visitorHash: 'aaaaaaaaaaaaaaaa',
	isBot: false,
	outcome: 'redirected',
	referrerHost: null,
	...over,
});

/** The scenarios the counting rule must handle. */
const EVENTS: ClickEvent[] = [
	click({}), // A, day 1, first click: counts for fixture0001/yt
	click({ts: DAY1 + 7_200_000, videoId: '-fixture011', source: 'shorts'}), // A, same offer, same day: not counted again
	click({ts: DAY2 + 60_000, videoId: '-fixture011', source: 'shorts'}), // A, next UTC day: counts for -fixture011/shorts
	click({ts: DAY1 + 5_000, offerId: 'password-manager'}), // A, another offer: counts
	click({visitorHash: 'bbbbbbbbbbbbbbbb', isBot: true}), // bot: never counted
	click({visitorHash: 'cccccccccccccccc', outcome: 'blocked_region', country: 'GB'}), // blocked: not a click
	click({visitorHash: 'dddddddddddddddd', outcome: 'blocked_unknown_region', country: null}),
	click({visitorHash: 'eeeeeeeeeeeeeeee', ts: DAY1 + DAY_MS - 1, videoId: null, source: null}), // last ms of day 1, no ?v=
	click({visitorHash: 'eeeeeeeeeeeeeeee', ts: DAY2, videoId: 'fixture0001', source: 'email'}), // first ms of day 2: counts again
];

const EXPECTED = [
	'-fixture011|hardware-wallet|shorts|1',
	'fixture0001|hardware-wallet|email|1',
	'fixture0001|hardware-wallet|yt|1',
	'fixture0001|password-manager|yt|1',
	'none|hardware-wallet|none|1',
];

const flat = (clicks: ClickCount[]): string[] => clicks.map((c) => `${c.videoId ?? 'none'}|${c.offerId}|${c.source ?? 'none'}|${c.clicks}`).sort();

describe('hub clicks', () => {
	let dir = '';
	let dbFile = '';
	before(() => {
		dir = mkdtempSync(join(tmpdir(), 'dashboard-hub-'));
		const db = openDb(dir);
		for (const event of EVENTS) insertClick(db, event);
		db.close();
		dbFile = join(dir, DB_FILE);
	});
	after(() => rmSync(dir, {recursive: true, force: true}));

	it('reads the database read-only with the hub rule: humans, redirected, once per visitor, offer and UTC day', async () => {
		const {hub, issues} = await readHubDb(dbFile);
		assert.deepEqual(issues, []);
		assert.ok(hub);
		assert.deepEqual(flat(hub.clicks), EXPECTED);
		const blocked = hub.outcomes?.filter((o) => o.outcome.startsWith('blocked')).reduce((n, o) => n + o.requests, 0);
		assert.equal(blocked, 2, 'blocked requests are counted as outcomes, bots are not');
		const db = new DatabaseSync(dbFile);
		assert.equal(Number(db.prepare('SELECT COUNT(*) AS n FROM clicks').get()?.n), EVENTS.length, 'nothing was written or deleted');
		db.close();
	});

	it('limits the database to a date range', async () => {
		const {hub} = await readHubDb(dbFile, {start: DAY2, end: DAY2 + DAY_MS});
		assert.deepEqual(flat(hub?.clicks ?? []), ['-fixture011|hardware-wallet|shorts|1', 'fixture0001|hardware-wallet|email|1']);
	});

	it('counts the raw clicks.csv export exactly like the database', () => {
		const header = 'ts,time_utc,offer_id,video_id,source,country,visitor_hash,is_bot,outcome,referrer_host';
		const lines = EVENTS.map((e) =>
			[e.ts, new Date(e.ts).toISOString(), e.offerId, e.videoId, e.source, e.country, e.visitorHash, e.isBot ? 1 : 0, e.outcome, e.referrerHost].map(csvCell).join(','),
		);
		assert.ok(lines.some((l) => l.includes(`"'-fixture011"`)), 'the export protected the id that starts with "-"');
		const {hub, issues} = parseHubCsv([header, ...lines].join('\r\n'), 'clicks.csv');
		assert.deepEqual(issues, []);
		assert.deepEqual(flat(hub?.clicks ?? []), EXPECTED);
		assert.equal(hub?.outcomes?.find((o) => o.offerId === 'hardware-wallet' && o.outcome === 'blocked_region')?.requests, 1);
	});

	it('reads the video-clicks.csv export (already counted) and undoes the formula prefix', () => {
		const file = fileURLToPath(new URL('./fixtures/hub-video-clicks.csv', import.meta.url));
		const {hub, issues} = readHubCsv(file);
		assert.deepEqual(issues, []);
		assert.equal(hub?.outcomes, null, 'this export has no outcomes');
		const shorts = hub?.clicks.find((c) => c.videoId === '-fixture011');
		assert.deepEqual(shorts, {videoId: '-fixture011', offerId: 'hardware-wallet', source: 'shorts', clicks: 9});
		assert.deepEqual(hub?.clicks.find((c) => c.videoId === null), {videoId: null, offerId: 'hardware-wallet', source: 'bio', clicks: 17});
		assert.equal(hub?.clicks.find((c) => c.videoId === 'fixture0010')?.source, null);
	});

	it('skips bad rows with one warning and rejects files that are not hub exports', async () => {
		const {hub, issues} = parseHubCsv('video_id,offer_id,source,hub_clicks\nabc,BAD OFFER,yt,1\nabc,ok-offer,yt,-2\nabc,ok-offer,yt,3\n', 'x.csv');
		assert.equal(hub?.clicks.length, 1);
		assert.match(issues[0]?.message ?? '', /2 row\(s\) skipped/);
		assert.equal(parseHubCsv('a,b\n1,2\n', 'other.csv').issues[0]?.level, 'error');
		assert.match((await readHubDb(join(dir, 'missing.sqlite'))).issues[0]?.message ?? '', /not found/);
	});

	it('refuses a SQLite file without a clicks table', async () => {
		const other = join(dir, 'other.sqlite');
		const db = new DatabaseSync(other);
		db.exec('CREATE TABLE t (x)');
		db.close();
		assert.match((await readHubDb(other)).issues[0]?.message ?? '', /no clicks table/);
	});
});
