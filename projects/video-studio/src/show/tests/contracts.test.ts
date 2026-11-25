/** Pure contracts: reported-loss parsing and the dial scale, attribution helpers, the concept guard, segments, UI. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {lossAgrees, meterReading, meterTicks, parseLossUsd, readNumber, tickLabel} from '../money.ts';
import {citedSourceIds, formatAsOf, formatDate, HOST_PUBLISHERS, hostOf, publisherOf, sceneSourceIds, sourceRow} from '../sources.ts';
import {conceptProblems} from '../concept.ts';
import {segmentOf, SEGMENT_SPECS, onScreenStrings} from '../segments.ts';
import {EN_SHOW_UI, showLabel} from '../ui.ts';
import {resolveChannelName} from '../channel.ts';
import {CHANNEL_IDENTITY} from '../../branding/tokens.ts';
import {HOST_PUBLISHERS as GATE_HOSTS} from '../../../scripts/news/lib/brief.ts';
import {SHOW_SEGMENTS, type ShowScene} from '../types.ts';
import {fixture} from './helpers.ts';

test('money: reported loss display strings parse to USD in every launch language', () => {
	const cases: Array<[string, number]> = [
		['$4.2M', 4.2e6],
		['$4.2 million', 4.2e6],
		['US$4.2M', 4.2e6],
		['$950K', 950e3],
		['$1.46B', 1.46e9],
		['$1.5 billion', 1.5e9],
		['$12,400,000', 12.4e6],
		['FixtureLend: $3.1M (Oct 2)', 3.1e6],
		['4,2 millones de dólares', 4.2e6],
		['4,2 mil millones de dólares', 4.2e9],
		['US$ 4,2 milhões', 4.2e6],
		['US$ 4,2 mi', 4.2e6],
		['4,2 milioni di dollari', 4.2e6],
		['420万美元', 4.2e6],
		['4.2亿美元', 4.2e8],
		['42 लाख डॉलर', 4.2e6],
		['$40,000', 40000],
		['1.234.567,89 USD', 1234567.89],
	];
	for (const [s, v] of cases) assert.ok(Math.abs((parseLossUsd(s) ?? NaN) - v) < 1e-3 * v, `${s} -> ${parseLossUsd(s)} (want ${v})`);
	assert.equal(parseLossUsd('no number here'), null);
	assert.equal(readNumber('40,000'), 40000);
	assert.equal(readNumber('4,25'), 4.25);
	assert.equal(lossAgrees('$4.2M', 4_234_567), true);
	assert.equal(lossAgrees('$4.2M', 4_500_000), false);
	assert.equal(lossAgrees('a lot', 4_500_000), null);
});

test('money: the dial is log10 from $100K to $10B; values off the scale pin to its ends and say so', () => {
	assert.equal(meterReading(1e5).fraction, 0);
	assert.equal(meterReading(1e10).fraction, 1);
	assert.ok(Math.abs(meterReading(1e7).fraction - 0.4) < 1e-12);
	assert.ok(Math.abs(meterReading(4.2e6).fraction - (Math.log10(4.2e6) - 5) / 5) < 1e-12);
	assert.deepEqual(meterReading(5e4), {fraction: 0, belowScale: true, aboveScale: false});
	assert.deepEqual(meterReading(2e10), {fraction: 1, belowScale: false, aboveScale: true});
	assert.throws(() => meterReading(0), /positive/);
	assert.throws(() => meterReading(Number.NaN), /positive/);
	// monotonic: a larger loss never sits left of a smaller one
	let prev = -1;
	for (let v = 1e4; v < 1e11; v *= 1.7) {
		const f = meterReading(v).fraction;
		assert.ok(f >= prev);
		prev = f;
	}
	assert.deepEqual(meterTicks().map((t) => t.exp), [5, 6, 7, 8, 9, 10]);
	assert.deepEqual(meterTicks().map((t) => tickLabel(t.usd, 'en')), ['$100K', '$1M', '$10M', '$100M', '$1B', '$10B']);
});

test('sources: outlet names follow the claim gate table; dates are UTC and say published or accessed', () => {
	for (const [host, name] of Object.entries(GATE_HOSTS)) assert.equal(HOST_PUBLISHERS[host], name, `host ${host}`);
	assert.equal(Object.keys(HOST_PUBLISHERS).length, Object.keys(GATE_HOSTS).length);
	assert.equal(hostOf('https://www.theblock.co/post/1'), 'www.theblock.co');
	assert.equal(publisherOf({url: 'https://www.theblock.co/post/1'}), 'The Block');
	assert.equal(publisherOf({url: 'https://news.example.com/x', publisher: 'Example Wire'}), 'Example Wire');
	assert.equal(publisherOf({url: 'https://www.unknown-site.org/a'}), 'unknown-site.org');
	assert.equal(formatDate('2026-11-23', 'en'), 'Nov 23, 2026');
	assert.equal(formatDate('2026-11-23T23:30:00-05:00', 'en'), 'Nov 24, 2026');
	assert.equal(formatAsOf('2026-11-24T08:00:00Z', 'en'), 'Nov 24, 08:00 UTC');
	assert.equal(formatAsOf('2026-11-24', 'en'), 'Nov 24, 2026');
	const sb = fixture();
	const tracker = sb.sources.find((s) => s.id === 'src-tracker');
	assert.ok(tracker);
	assert.deepEqual(sourceRow(tracker, 'en'), {id: 'src-tracker', publisher: 'Example Hack Tracker', title: 'Incidents since 2026-09-28', date: 'Nov 24, 2026', dateKind: 'accessed'});
	const headline = sb.scenes.find((s) => s.id === 's02') as ShowScene;
	assert.deepEqual(sceneSourceIds(headline), ['src-wire', 'src-pm', 'src-lab']);
	assert.deepEqual(citedSourceIds(sb), ['src-wire', 'src-pm', 'src-lab', 'src-lab2', 'src-tracker']);
});

test('concept guard: code, addresses, links and numbered steps are refused; plain concept copy passes', () => {
	const bad: Array<[string, string]> = [
		['call setApprovalForAll on the token', 'code-verb'],
		['funds sent to 0x9f2c4a1b77e0', 'address'],
		['see https://example.com/exploit', 'url'],
		['the attacker called withdraw() twice', 'call'],
		['used flash_loan_attack logic', 'snake'],
		['use `delegatecall` here', 'code-chars'],
		['msg.sender was not checked', 'code-chars'],
		['abcXyzQwe triggers it', 'camel'],
	];
	for (const [s, code] of bad) assert.ok(conceptProblems(s).some((p) => p.code === code), `${s} should flag ${code}`);
	const good = ['A leaked deployer key', 'Pool contract upgraded', 'Bridge to another network', 'Fake "wallet support" accounts', 'iPhone users got a fake call', 'FixtureSwap reports $4.2M drain'];
	for (const s of good) assert.deepEqual(conceptProblems(s, {steps: true}), [], s);
	assert.deepEqual(conceptProblems('1. Revoke old approvals'), []);
	assert.ok(conceptProblems('1. Approve the contract', {steps: true}).some((p) => p.code === 'step'));
	assert.ok(conceptProblems('Step 2 drain the pool', {steps: true}).some((p) => p.code === 'step'));
});

test('segments: explicit segment wins; types map to defaults; charts are refused', () => {
	const sc = (o: Partial<ShowScene>): ShowScene => ({id: 'x', type: 'talk', narration: '', ...o}) as ShowScene;
	assert.equal(segmentOf(sc({type: 'hook'})), 'coldOpen');
	assert.equal(segmentOf(sc({type: 'endscreen'})), 'outroEndScreen');
	assert.equal(segmentOf(sc({type: 'talk'})), 'desk');
	assert.equal(segmentOf(sc({type: 'talk', segment: 'headline'})), 'headline');
	assert.throws(() => segmentOf(sc({type: 'chart'})), /no price talk/);
	assert.throws(() => segmentOf(sc({segment: 'nope' as never})), /unknown segment/);
	for (const seg of SHOW_SEGMENTS) assert.ok(SEGMENT_SPECS[seg], seg);
	assert.deepEqual(onScreenStrings({onScreen: {title: 'a', nodes: ['b', 'c']}}).map((x) => x.key), ['title', 'nodes[0]', 'nodes[1]']);
});

test('ui: English defaults keep "Zoo" title case; other languages must bring their own labels', () => {
	assert.equal(showLabel({lang: 'en'}, 'oneFix'), "Zoo's One Fix");
	assert.ok(!Object.values(EN_SHOW_UI).some((v) => v.includes('ZOO')), 'never upper-case the host name');
	assert.equal(showLabel({lang: 'es', showUi: {oneFix: 'El arreglo de Zoo'}}, 'oneFix'), 'El arreglo de Zoo');
	assert.throws(() => showLabel({lang: 'es'}, 'oneFix'), /showUi\.oneFix is required/);
});

test('channel name: omitted, zoora-security shows its own name and _dev none; an explicit value wins (null hides it)', () => {
	assert.equal(CHANNEL_IDENTITY['zoora-security'].name, 'Zoodger News');
	assert.equal(resolveChannelName({channel: 'zoora-security'}), 'Zoodger News');
	assert.equal(resolveChannelName({channel: 'zoora-security', channelName: null}), null);
	assert.equal(resolveChannelName({channel: 'zoora-security', channelName: 'Zoodger News'}), 'Zoodger News');
	assert.equal(resolveChannelName({channel: '_dev'}), null);
	assert.equal(resolveChannelName({channel: '_dev', channelName: 'Zoodger News'}), 'Zoodger News');
});
