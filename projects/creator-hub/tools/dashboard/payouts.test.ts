import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {describe, it} from 'node:test';
import type {Money} from './model.ts';
import {addMoney, checkPayoutConfig, formatMoney, parsePayoutCsv, parseSubId, readPayoutCsv, type Programme} from './payouts.ts';

const fixture = (name: string): string => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
const loadConfig = (file: string) => checkPayoutConfig(JSON.parse(readFileSync(file, 'utf8')));

describe('payout config', () => {
	it('accepts the fixture and the committed example', () => {
		const fixtureCheck = loadConfig(fixture('payouts.json'));
		assert.deepEqual(fixtureCheck.errors, []);
		assert.equal(fixtureCheck.config?.programmes.length, 2);
		assert.equal(fixtureCheck.config?.programmes[1]?.delimiter, ';');
		const example = loadConfig(fileURLToPath(new URL('../../config/payouts.example.json', import.meta.url)));
		assert.deepEqual(example.errors, []);
	});

	it('reports every problem: typos, missing revenue, bad ids, rates and currencies', () => {
		const {config, errors} = checkPayoutConfig({
			version: 1,
			rates: {EUR: {usdPerUnit: 0}, USD: {usdPerUnit: 1, asOf: '2026-11-01'}, GBP: {usdPerUnit: 1.27, asOf: '2026-11-01', sourse: 'x'}},
			programmes: [
				{id: 'Bad Id', name: 'x', columns: {subId: 'Sub', revnue: 'Amount'}, currency: 'usd'},
				{id: 'ok', name: 'ok', columns: {revenue: 'Amount'}, includeStatuses: ['approved']},
				{id: 'ok', name: 'dup', columns: {revenue: 'A', currency: 'C'}, offerIds: {Shop: 'Not An Id'}, defaultOfferId: 'x'},
			],
			extra: true,
		});
		assert.equal(config, null);
		const expected = [
			/unknown field "extra"/,
			/rates.EUR.usdPerUnit/,
			/rates.EUR.asOf/,
			/rates.USD: the key must be/,
			/rates.GBP: unknown field "sourse"/,
			/programmes\[0\].id/,
			/unknown key "revnue"/,
			/programmes\[0\].columns.revenue is required/,
			/programmes\[0\].currency must be a 3-letter code/,
			/programmes\[1\]: set "currency" or map columns.currency/,
			/programmes\[1\]: includeStatuses needs columns.status/,
			/programmes\[2\].id "ok" is used twice/,
			/offerIds\["Shop"\] must be a hub offer id/,
			/defaultOfferId must be a hub offer id/,
		];
		for (const pattern of expected) assert.ok(errors.some((e) => pattern.test(e)), `missing error ${pattern}: ${errors.join(' | ')}`);
	});

	it('warns when a programme has no sub-id column', () => {
		const {warnings} = checkPayoutConfig({version: 1, programmes: [{id: 'nosub', name: 'n', columns: {revenue: 'A'}, currency: 'USD'}]});
		assert.match(warnings[0] ?? '', /cannot be tied to videos/);
	});
});

describe('sub-ids', () => {
	it('splits "<videoId>.<source>" and accepts "none" for a missing part', () => {
		assert.deepEqual(parseSubId('fixture0002.yt'), {videoId: 'fixture0002', source: 'yt'});
		assert.deepEqual(parseSubId('fake-support-dm.shorts'), {videoId: 'fake-support-dm', source: 'shorts'});
		assert.deepEqual(parseSubId('none.email'), {videoId: null, source: 'email'});
		assert.deepEqual(parseSubId('fixture0002.none'), {videoId: 'fixture0002', source: null});
		assert.deepEqual(parseSubId('fixture0002'), {videoId: 'fixture0002', source: null}, 'a network that drops the source');
		assert.equal(parseSubId('fixture0002.facebook'), null);
		assert.equal(parseSubId('not a sub id!'), null);
		assert.equal(parseSubId(''), null);
		assert.equal(parseSubId('none'), null);
	});
});

describe('payout CSVs', () => {
	const {config} = loadConfig(fixture('payouts.json'));
	const wallet = config?.programmes[0] as Programme;
	const eu = config?.programmes[1] as Programme;

	it('maps columns, filters statuses, parses US dates and keeps reversals', () => {
		const {rows, issues} = readPayoutCsv(fixture('payouts/wallet-network.csv'), wallet);
		assert.equal(rows.length, 8, 'the pending row is not counted');
		assert.ok(issues.some((i) => i.level === 'note' && /1 row\(s\) with status "pending"/.test(i.message)));
		assert.ok(issues.some((i) => /offer names not mapped.*Unknown Programme Name/.test(i.message)));
		assert.ok(issues.some((i) => /sub-ids that are not.*not-a-sub-id!/.test(i.message)));
		const first = rows[0];
		assert.deepEqual(
			{date: first?.date, offerId: first?.offerId, videoId: first?.videoId, source: first?.source, conversions: first?.conversions, amount: first?.amount, currency: first?.currency},
			{date: '2026-11-02', offerId: 'hardware-wallet', videoId: 'fixture0002', source: 'yt', conversions: 1, amount: 18, currency: 'USD'},
		);
		assert.equal(rows.find((r) => r.amount === 1005.5)?.offerId, 'password-manager', 'quoted "1,005.50" and a second mapped offer');
		const reversal = rows.find((r) => r.amount < 0);
		assert.deepEqual([reversal?.conversions, reversal?.amount], [-1, -18]);
		assert.equal(rows.find((r) => r.source === 'bio')?.videoId, null);
	});

	it('keeps reversals written the accounting way, with a trailing minus or the Unicode minus', () => {
		const text = [
			'Date,Program,Sub ID,Sales,Commission,Currency,Status',
			'11/02/2026,Example Wallet Store,fixture0002.yt,1,18.00,USD,Approved',
			'11/03/2026,Example Wallet Store,fixture0002.yt,-1,(18.00),USD,Approved',
			'11/04/2026,Example Wallet Store,fixture0002.yt,-1,18.00-,USD,Approved',
			'11/05/2026,Example Wallet Store,fixture0002.yt,-1,\u221218.00,USD,Approved',
		].join('\n');
		const {rows, issues} = parsePayoutCsv(text, 'reversals.csv', wallet);
		assert.deepEqual(issues.filter((i) => i.level !== 'note'), []);
		assert.deepEqual(rows.map((r) => r.amount), [18, -18, -18, -18]);
	});

	it('reads ";" files with decimal commas and day-first dates; no conversions column means one per row', () => {
		const {rows, issues} = readPayoutCsv(fixture('payouts/eu-tools.csv'), eu);
		assert.deepEqual(issues, []);
		assert.deepEqual(rows.map((r) => [r.date, r.amount, r.currency, r.conversions, r.offerId]), [
			['2026-11-03', 12.5, 'EUR', 1, 'password-manager'],
			['2026-11-15', 7.25, 'EUR', 1, 'password-manager'],
			['2026-11-20', 1000, 'EUR', 1, 'password-manager'],
		]);
	});

	it('applies the --from/--to window', () => {
		const {rows, issues} = readPayoutCsv(fixture('payouts/eu-tools.csv'), eu, {from: '2026-11-10', to: '2026-11-16'});
		assert.deepEqual(rows.map((r) => r.date), ['2026-11-15']);
		assert.ok(issues.some((i) => /2 row\(s\) outside --from\/--to/.test(i.message)));
	});

	it('fails clearly when a mapped column is missing, and skips unreadable amounts', () => {
		const missing = parsePayoutCsv('Date,Amount\n2026-11-01,5\n', 'net.csv', wallet);
		assert.equal(missing.issues[0]?.level, 'error');
		assert.match(missing.issues[0]?.message ?? '', /columns not found.*subId \("Sub ID"\)/);
		const bad = parsePayoutCsv('Date;SubID;Commission;Currency\n01.11.2026;fixture0001.yt;lots;EUR\n01.11.2026;fixture0001.yt;1,00;E\n', 'eu.csv', eu);
		assert.equal(bad.rows.length, 0);
		assert.equal(bad.issues.filter((i) => i.level === 'warning').length, 2);
	});
});

describe('money', () => {
	it('adds USD, converts only with a rate, and keeps other currencies apart', () => {
		const total = {usd: 0, other: [] as Money[]};
		const rates = {GBP: {usdPerUnit: 1.25, asOf: '2026-11-01', source: null}};
		addMoney(total, 10, 'USD', rates);
		addMoney(total, 8, 'GBP', rates);
		addMoney(total, 12.5, 'EUR', rates);
		addMoney(total, 7.25, 'EUR', rates);
		assert.equal(total.usd, 20);
		assert.deepEqual(total.other, [{currency: 'EUR', amount: 19.75}]);
		assert.equal(formatMoney([{currency: 'EUR', amount: 19.75}, {currency: 'CAD', amount: 0.001}]), 'EUR 19.75');
	});
});
