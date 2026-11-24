/** Pure helpers: dates, slugs, escaping, the narration splitter, tracker rows, opportunities. */
import {strict as assert} from 'node:assert';
import {join} from 'node:path';
import {describe, it} from 'node:test';
import {esc, link, md, plain, safeRelative, safeUrl} from '../lib/escape.ts';
import {defillamaKey, loadRadarHistory, loadTrackerRows, previousEpisodes, structuredHead} from '../lib/history.ts';
import {localSplit} from '../lib/narration.ts';
import {figuresComparison, fundFlowOpportunity, label, radarComparison, trackerComparison} from '../lib/opportunities.ts';
import {indexSources} from '../lib/brief.ts';
import {addDays, daysBetween, isDate, localTime, parseDateSlug, slugify, todayIn, usdExact} from '../lib/util.ts';
import {DATE, defillamaCache, fixtureBridge, fixturePhish, fixtureSwap, radarFile, tempRoot, writeJsonFile} from './helpers.ts';

describe('util', () => {
	it('works on the owner calendar (America/Chicago)', () => {
		assert.equal(todayIn('America/Chicago', new Date('2026-11-25T03:00:00Z')), '2026-11-24'); // 21:00 CST
		assert.equal(todayIn('America/Chicago', new Date('2026-11-24T10:43:00Z')), '2026-11-24');
		assert.match(localTime('2026-11-24T12:05:00Z', 'America/Chicago'), /^2026-11-24 06:05 CST$/);
	});
	it('validates dates and date arithmetic', () => {
		assert.ok(isDate('2026-11-24'));
		assert.ok(!isDate('2026-02-30'));
		assert.ok(!isDate('2026-11-24T00:00'));
		assert.equal(addDays('2026-11-24', -29), '2026-10-26');
		assert.equal(daysBetween('2026-10-29', '2026-11-24'), 26);
	});
	it('makes slugs the thumbnail and publish tools accept', () => {
		assert.equal(slugify('Trezor & Exodus users'), 'trezor-and-exodus-users');
		assert.equal(slugify('Ünïcode   Bridge!!'), 'unicode-bridge');
		assert.equal(slugify('---'), 'story');
		assert.equal(slugify('a'.repeat(80)).length, 40);
		assert.deepEqual(parseDateSlug('2026-11-24-binance'), {date: '2026-11-24', slug: 'binance'});
		assert.equal(parseDateSlug('2026-11-24-Binance'), null);
		assert.equal(parseDateSlug('2026-13-24-binance'), null);
		assert.equal(parseDateSlug('binance'), null);
	});
	it('prints exact figures', () => {
		assert.equal(usdExact(6360000000), '$6,360,000,000');
	});
});

describe('escaping (feed text is untrusted)', () => {
	it('escapes HTML text and attributes', () => {
		assert.equal(esc('<script>alert("x")</script>&\''), '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;&amp;&#39;');
	});
	it('links only plain http(s) URLs', () => {
		assert.equal(safeUrl('javascript:alert(1)'), null);
		assert.equal(safeUrl('data:text/html,hi'), null);
		assert.equal(safeUrl('https://user:pw@example.com/'), null);
		assert.equal(safeUrl('https://example.com/a?b=1'), 'https://example.com/a?b=1');
		assert.equal(link('javascript:alert(1)', '<b>x</b>'), '&lt;b&gt;x&lt;/b&gt;');
		assert.match(link('https://example.com/"onmouseover=x', 'ok'), /href="https:\/\/example\.com\/%22onmouseover=x"/);
	});
	it('keeps generated relative paths only', () => {
		assert.equal(safeRelative('short.mp4'), 'short.mp4');
		assert.equal(safeRelative('thumbs/v0.png'), 'thumbs/v0.png');
		assert.equal(safeRelative('../etc/passwd'), null);
		assert.equal(safeRelative('https://x'), null);
	});
	it('neutralises Markdown links and HTML', () => {
		assert.equal(md('[click](https://evil.example) <img src=x>'), '\\[click\\](https://evil.example) \\<img src=x\\>');
		assert.equal(plain('a\u0007b\nc'), 'ab c');
	});
});

describe('local narration splitter (fallback)', () => {
	it('splits sentences and claims like the news gate', () => {
		const s = localSplit('This is developing. FixtureSwap says it lost {$4.2M|four point two million dollars} [src:a]. Our check: two in eight weeks.');
		assert.equal(s.length, 3);
		assert.equal(s[1].display, 'FixtureSwap says it lost $4.2M.');
		assert.deepEqual(s[1].claims, [{display: 'FixtureSwap says it lost $4.2M', srcIds: ['a']}]);
		assert.deepEqual(s[2].claims, []);
	});
	it('attaches a tag after the full stop to the sentence before it', () => {
		const s = localSplit('A claim. [src:x,y]');
		assert.deepEqual(s[0].srcIds, ['x', 'y']);
	});
	it('throws on broken markup', () => {
		assert.throws(() => localSplit('broken {markup'));
	});
});

describe('tracker rows (radar DefiLlama cache)', () => {
	it('keeps only the structured head of each excerpt', () => {
		const rec = {classification: 'Key Compromise', technique: 'Private Key Compromised', target: 'CEX', chains: ['TRON'], amount: 16000000, name: 'CoinX', date: '2026-10-21'};
		const ex = 'CoinX · 2026-10-21 · reported loss $16,000,000 · Key Compromise / Private Key Compromised · target: CEX · chains: TRON · Free text with [named person]';
		assert.equal(structuredHead(ex, rec, false, false), 'CoinX · 2026-10-21 · reported loss $16,000,000 · Key Compromise / Private Key Compromised · target: CEX · chains: TRON');
		assert.equal(structuredHead(ex.replace('TRON ·', 'Ethereum ·'), rec, false, false), null);
	});
	it('reads a fresh cache, skips people-like targets and stale caches', () => {
		const {root, cleanup} = tempRoot();
		try {
			const p = join(root, 'cache.json');
			writeJsonFile(p, defillamaCache());
			const r = loadTrackerRows(p, '2026-10-26', DATE);
			assert.ok(r.ok);
			if (r.ok) {
				assert.deepEqual(
					r.rows.map((x) => x.name),
					['MockPerps', 'TestChain', 'DemoLend', 'SampleVault', 'ExampleDex', 'FixtureBridge', 'FixtureSwap'],
				);
				assert.ok(r.rows.every((x) => !x.head.includes('0xabc') && !x.head.includes('person')));
				assert.ok(r.skipped >= 1); // the "Individual" target
			}
			writeJsonFile(p, defillamaCache('2026-11-20T00:00:00Z'));
			const stale = loadTrackerRows(p, '2026-10-26', DATE);
			assert.ok(!stale.ok && /36 hours/.test(stale.reason));
			writeJsonFile(p, {...defillamaCache(), v: 2});
			const fmt = loadTrackerRows(p, '2026-10-26', DATE);
			assert.ok(!fmt.ok && /unknown format/.test(fmt.reason));
			const missing = loadTrackerRows(join(root, 'none.json'), '2026-10-26', DATE);
			assert.ok(!missing.ok);
		} finally {
			cleanup();
		}
	});
	it('finds the DefiLlama key of an incident', () => {
		assert.equal(defillamaKey(fixtureSwap()), 'defillama:FixtureSwap@2026-11-23');
		assert.equal(defillamaKey(fixturePhish()), null);
	});
});

describe('analysis opportunities', () => {
	const win = {from: '2026-10-26', to: DATE};
	const tracker = () => {
		const {root, cleanup} = tempRoot();
		writeJsonFile(join(root, 'c.json'), defillamaCache());
		const r = loadTrackerRows(join(root, 'c.json'), win.from, win.to);
		cleanup();
		return r;
	};
	it('ranks the incident in DefiLlama\'s own 30-day list, attributed, never averaged', () => {
		const r = trackerComparison(fixtureSwap(), tracker(), win);
		assert.ok(r.opp.available);
		assert.equal(r.opp.basis, 'own-data');
		assert.match(r.opp.detail ?? '', /^DefiLlama lists 7 incidents in the 30 days from Oct 26 to Nov 24\./);
		assert.match(r.opp.detail ?? '', /As listed by DefiLlama, FixtureSwap's \$4,200,000 loss is the second-largest of the 6 with a stated loss\./);
		assert.match(r.opp.detail ?? '', /3 of the 7 share its DefiLlama classification \(key compromise\)\./);
		assert.doesNotMatch(r.opp.detail ?? '', /average|total|sum/i);
		assert.equal(r.sources[0].id, 'defillama-30d');
		assert.equal(r.facts.length, 7);
		for (const f of r.facts) assert.ok(r.sources[0].excerpts?.includes(f.excerpts[0].text));
		assert.ok(r.entities.includes('ExampleDex'));
	});
	it('says why it is unavailable', () => {
		assert.match(trackerComparison(fixturePhish(), tracker(), win).opp.why, /DefiLlama has no record/);
		assert.match(trackerComparison(fixtureSwap(), {ok: false, reason: 'stale'}, win).opp.why, /stale/);
		const few = tracker();
		if (few.ok) few.rows = few.rows.slice(0, 3);
		assert.match(trackerComparison(fixtureSwap(), few, win).opp.why, /not in the cached rows|too few/);
	});
	it('lower-cases tracker labels so the name check does not read them as people', () => {
		assert.equal(label('Frontend & Infrastructure'), 'frontend and infrastructure');
	});
	it('needs a week of radar history for the pattern', () => {
		const {root, cleanup} = tempRoot();
		try {
			const dir = join(root, 'content', 'zoora-security', 'radar');
			writeJsonFile(join(dir, `${DATE}.json`), radarFile([fixtureSwap(), fixtureBridge()]));
			assert.equal(radarComparison(fixtureSwap(), loadRadarHistory(dir, win.from, win.to)).opp.available, false);
			for (let i = 1; i <= 7; i++) {
				const d = `2026-11-${String(24 - i).padStart(2, '0')}`;
				const other = {...fixtureBridge(), id: `2026-11-${String(24 - i).padStart(2, '0')}-other${i}`, protocol: `Other${i}`, type: 'key-compromise', facts: fixtureSwap().facts.slice(0, 1), sources: fixtureSwap().sources.slice(0, 1)};
				writeJsonFile(join(dir, `${d}.json`), radarFile([other], d));
			}
			writeJsonFile(join(dir, '2026-11-10.json'), radarFile([fixtureBridge()], '2026-11-10', 'offline'));
			const h = loadRadarHistory(dir, win.from, win.to);
			assert.equal(h.files.length, 8); // the offline file never counts
			const r = radarComparison(fixtureSwap(), h);
			assert.ok(r.opp.available);
			assert.match(r.opp.detail ?? '', /our radar logged 8 key compromise incidents/);
			assert.ok(r.facts.length >= 1 && r.sources.length === r.facts.length);
		} finally {
			cleanup();
		}
	});
	it('lists each source\'s figure and never merges them', () => {
		const idx = indexSources(fixtureSwap());
		const r = figuresComparison(fixtureSwap(), idx.idFor, (id) => idx.byId.get(id)?.publisher ?? id);
		assert.ok(r.opp.available);
		assert.equal(r.opp.strength, 'supporting');
		assert.match(r.opp.detail ?? '', /DefiLlama lists \$4,200,000; Example Wire reports \$4\.5 million/);
	});
	it('flags a Solana fund-flow trace only as needing published addresses', () => {
		const sol = fundFlowOpportunity(fixtureBridge(), '2026-11-24-fixturebridge');
		assert.equal(sol.opp.available, false);
		assert.match(sol.opp.why, /redacts them/);
		assert.ok(sol.opp.instructions?.some((s) => s.includes('data/private/daily/2026-11-24-fixturebridge/addresses.json')));
		assert.match(fundFlowOpportunity(fixtureSwap(), 'x').opp.why, /Not a Solana incident/);
	});
});

describe('previous episodes', () => {
	it('reads our own briefs and approvals', () => {
		const {root, cleanup} = tempRoot();
		try {
			const c = join(root, 'content', 'zoora-security');
			writeJsonFile(join(c, '2026-11-20-fixtureswap', 'brief.json'), {incident: {id: '2026-11-19-fixtureswap'}});
			writeJsonFile(join(c, '2026-11-20-fixtureswap', 'approval.json'), {});
			writeJsonFile(join(c, '2026-11-01-old', 'brief.json'), {incident: {id: 'old'}});
			const p = previousEpisodes(c, '2026-11-10', DATE);
			assert.deepEqual(p, [{slug: '2026-11-20-fixtureswap', date: '2026-11-20', incidentId: '2026-11-19-fixtureswap', approved: true}]);
		} finally {
			cleanup();
		}
	});
});
