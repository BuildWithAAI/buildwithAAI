import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {describe, it} from 'node:test';
import {buildBrief, dateLabel, hedgePhrase, howText, moneyFromQuote, parseMoney, type ShowInfo, type ThreatBrief} from './brief.ts';
import {htmlToText, lintBrief, lintFile, lintRendered, markdownToText} from './lint.ts';
import {checkRadar, readRadar, RADAR_SCHEMA, type Radar} from './radar.ts';
import {renderEmailHtml, renderMarkdown, SHOW_LINK_PENDING} from './render.ts';
import {hasErrors, loadAllowlist, makeAllow, type NameAllow} from './safety.ts';
import {checkDailyInput, oneFixFromSummary, readShowKit, showFromDaily} from './show.ts';

const fixture = (name: string): string => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
const NOW = new Date('2026-11-24T10:00:00Z');
const baseAllow: NameAllow = loadAllowlist(fixture('allowlist.json')).allow ?? makeAllow([]);
const radarRead = readRadar(fixture('radar.json'));
const radar = radarRead.radar as Radar;
const show: ShowInfo = {title: 'FixtureSwap lost its keys', url: 'https://youtu.be/Zb7xq2Ph0aA', developing: false, oneFix: null, slug: '2026-11-24-fixtureswap'};
const build = (over: Partial<Parameters<typeof buildBrief>[1]> = {}) => buildBrief(radar, {allow: baseAllow, now: NOW, show, ...over});

describe('radar reader', () => {
	it('reads the fixture and skips malformed incidents with warnings', () => {
		assert.ok(radar);
		assert.equal(radar.top.length, 4);
		assert.equal(radar.alsoSeen.length, 1);
		assert.deepEqual(radarRead.errors, []);
		assert.equal(radarRead.warnings.length, 2);
	});
	it('rejects a file that is not a radar file', () => {
		assert.match(checkRadar({schema: 'other', runDate: '2026-11-24', top: []}).errors.join(), /schema/);
		assert.match(checkRadar({schema: RADAR_SCHEMA, runDate: 'today', top: []}).errors.join(), /runDate/);
		assert.match(checkRadar([]).errors.join(), /JSON object/);
		assert.match(readRadar(fixture('missing.json')).errors.join(), /cannot read/);
	});
	it('treats an unknown status as developing (fail closed) and drops losses without a quote', () => {
		const raw = JSON.parse(readFileSync(fixture('radar.json'), 'utf8'));
		raw.top[0].status = 'verified';
		raw.top[0].reportedLosses[0].quote = '';
		const read = checkRadar(raw);
		assert.equal(read.radar?.top[0]?.status, 'developing');
		assert.equal(read.radar?.top[0]?.reportedLosses.length, 4);
		assert.ok(read.warnings.some((w) => /unknown status/.test(w)));
	});
});

describe('money helpers', () => {
	it('keeps the figure as the source wrote it and reads it back', () => {
		assert.equal(moneyFromQuote('reported loss $4,200,000'), '$4,200,000');
		assert.equal(moneyFromQuote('The $6.4 Billion Binance Hack'), '$6.4 billion');
		assert.equal(moneyFromQuote('$12.6M'), '$12.6M');
		assert.equal(moneyFromQuote('no figure'), null);
		assert.equal(parseMoney('$6.4 billion'), 6.4e9);
		assert.equal(parseMoney('$600K'), 600_000);
		assert.equal(parseMoney('$1,040,000'), 1_040_000);
		assert.equal(parseMoney('$3 zillion'), null);
		assert.equal(dateLabel('2026-11-24'), 'Nov 24, 2026');
	});
});

describe('buildBrief', () => {
	const {brief, notes} = build();
	const [swap, bridge, wallet] = brief.incidents;

	it("takes the radar's top 3 in order and labels each one", () => {
		assert.deepEqual(brief.incidents.map((i) => `${i.protocol}:${i.label}`), ['FixtureSwap:CONFIRMED', 'Mock Bridge:DEVELOPING', 'Sample Wallet:CONFIRMED']);
		assert.equal(bridge?.name, 'Mock Bridge: reported bridge exploit');
		assert.match(bridge?.statusLine ?? '', /^Developing: /);
		assert.equal(brief.subject, 'Threat Brief, Nov 24: FixtureSwap, Mock Bridge, Sample Wallet (1 developing)');
		assert.equal(build({count: 5}).brief.incidents.length, 5);
	});

	it('credits every figure to its source, best tier first, and never averages', () => {
		assert.deepEqual(
			swap?.losses.map((l) => `${l.amount}|${l.publisher}|${l.tier}`),
			['$4,200,000|Fixture DB|A', '$4,200,000|Fixture Firm|A', '$4.8 million|Example Wire|B', '$5M|Aggregator Today|C'],
		);
		assert.match(swap?.lossNote ?? '', /none is averaged/);
		assert.ok(notes.some((n) => /does not match 9900000/.test(n)), 'a quote that disagrees with the figure is left out');
		assert.equal(wallet?.losses.length, 0);
		assert.doesNotMatch(JSON.stringify(brief), /\baverage of\b|\bin total\b|\bcombined\b/);
	});

	it('explains how it worked from the attributed classification, at concept level', () => {
		assert.equal(swap?.how.kind, 'classification');
		assert.equal(howText(swap!.how), 'Fixture DB classifies it as “Key Compromise / Private Key Compromised”. Fixture Firm Hacked lists the attack method as “Private Key Leak”.');
		assert.deepEqual(swap?.how.parts.map((p) => p.url), ['https://db.fixture.test/hacks#FixtureSwap@2026-11-23', 'https://firm.fixture.test/#FixtureSwap@2026-11-23']);
		assert.equal(
			swap?.how.concept,
			"Fixture DB's category “Key Compromise” covers cases where someone other than the rightful holder gained control of a key that can approve transactions.",
			"the definition of the source's category, never how this incident worked",
		);
		assert.doesNotMatch(JSON.stringify(brief.incidents.map((i) => i.how)), /In plain terms|no code bug|\bmeans\b/);
	});

	it('quotes only safe headlines and falls back to a plain label', () => {
		assert.equal(howText(bridge!.how), 'Aggregator Today reports: “Mock Bridge exploited for $700K”.', 'the headline naming a person is skipped');
		assert.equal(howText(wallet!.how), 'Example Wire reports: “Fake ads lure Sample Wallet users to a phishing site, researchers find”.', 'the price headline is skipped');
		const quiet = build({count: 4}).brief.incidents[3];
		assert.equal(quiet?.how.kind, 'unknown');
		assert.deepEqual(wallet?.sources.map((s) => s.text), ['Example Wire: “Fake ads lure Sample Wallet users to a phishing site, researchers find”', 'Sample Daily article, 2026-11-23']);
	});

	it('lists sources one per publisher, https only, without newsletter round-ups', () => {
		const urls = swap?.sources.map((s) => s.url) ?? [];
		assert.equal(urls.length, 4);
		assert.ok(urls.every((u) => u.startsWith('https://')));
		assert.ok(!urls.some((u) => u.includes('/newsletters/')));
		assert.equal(swap?.sources[3]?.text, 'Sample Daily article, 2026-11-23', 'the headline with a personal name is not quoted');
		assert.deepEqual(swap?.chains, {list: ['Ethereum', 'Base'], by: 'Fixture DB'});
		assert.deepEqual(swap?.date, {day: '2026-11-23', label: 'When (per Fixture DB)'}, 'the date a database states, attributed');
		assert.deepEqual(wallet?.date, {day: '2026-11-23', label: 'First reported'}, 'otherwise the first linked report');
	});

	it('turns radar corrections into plain lines and notes the ones it cannot read', () => {
		assert.equal(
			brief.corrections[0],
			'FixtureSwap: status changed from developing to confirmed; Example Wire now states $4,800,000 (previously $4,500,000); Fixture Firm now states $4,200,000 (since the Nov 23, 2026 radar).',
		);
		assert.ok(notes.some((n) => /correction text not understood/.test(n)));
		const daily = build({showCorrections: ['Correction (2026-11-24): Example Wire now gives $4.8 million.']}).brief;
		assert.equal(daily.corrections[0], 'Correction (2026-11-24): Example Wire now gives $4.8 million.');
	});

	it("picks Zoo's One Fix: --fix, then the show's, then the top incident's topic", () => {
		assert.deepEqual([brief.fix.source, brief.fix.topic], ['table', 'key-management']);
		assert.equal(build({show: {...show, oneFix: 'Turn on transaction previews in your wallet.'}}).brief.fix.source, 'show');
		assert.equal(build({fix: 'Bookmark the sites you use.'}).brief.fix.source, 'option');
		const unsafe = build({show: {...show, oneFix: 'Buy the dip before it moons.'}});
		assert.equal(unsafe.brief.fix.source, 'table');
		assert.ok(unsafe.notes.some((n) => /breaks a safety rule/.test(n)));
	});

	it('passes its own lint, and the lint catches broken briefs', () => {
		const {brief: b, allow} = build();
		assert.deepEqual(lintBrief(b, allow).filter((f) => f.level === 'error'), []);
		const broken: ThreatBrief = structuredClone(b);
		broken.incidents[1]!.label = 'CONFIRMED';
		broken.incidents[0]!.losses[0]!.publisher = '';
		broken.incidents[0]!.sources = [];
		broken.footer = [];
		broken.fix.text = 'Guaranteed returns if you act today.';
		const codes = lintBrief(broken, allow).filter((f) => f.level === 'error').map((f) => `${f.rule}/${f.code}`);
		for (const code of ['developing/label', 'attribution/loss-source', 'attribution/no-sources', 'structure/no-why', 'price/income']) assert.ok(codes.includes(code), code);
	});

	it('names the confirming sources from their own text, as before, when nothing hedges', () => {
		assert.equal(swap?.statusLine, 'Confirmed: Fixture DB and Fixture Firm report it without hedging.');
		assert.equal(wallet?.statusLine, 'Confirmed: Example Wire and Sample Daily report it without hedging.');
		assert.deepEqual(swap?.hedges, []);
	});

	it('warns about a pending show link in a draft and refuses it for Kit', () => {
		const {brief: b, allow} = build({show: {...show, url: null}});
		assert.equal(lintBrief(b, allow).find((f) => f.code === 'show-link-pending')?.level, 'warning');
		assert.equal(lintBrief(b, allow, {final: true}).find((f) => f.code === 'show-link-pending')?.level, 'error');
	});
});

describe('status: the hedges in every tier-A and tier-B text', () => {
	// The 2026-11-24 Chainflip case: a tier-A database whose stored text says "suspected", a tier-B headline that hedges
	const hedgedRadar = (): Radar => {
		const r = structuredClone(radar);
		const sources = r.top[0]!.sources;
		sources.find((s) => s.id === 'fixture-firm')!.excerpt =
			'FixtureSwap · reported loss $4,200,000 · attack method: Private Key Leak · The attacker, through a suspected compromise of the aggregate signing key, drained the vault…';
		sources.find((s) => s.title.startsWith('FixtureSwap Drained'))!.title = 'FixtureSwap Suspects Key Theft in $4.8 Million Vault Hack';
		return r;
	};

	it('never says "without hedging" of a source that hedges, and quotes each hedge with its source', () => {
		const {brief, allow} = buildBrief(hedgedRadar(), {allow: baseAllow, now: NOW, show});
		const swap = brief.incidents[0]!;
		assert.equal(
			swap.statusLine,
			'Confirmed: Fixture DB reports it without hedging. Still hedged in the sources: “suspected compromise of the aggregate signing key”, per Fixture Firm; “Suspects Key Theft”, per Example Wire.',
		);
		assert.deepEqual(swap.hedges.map((h) => `${h.publisher}:${h.tier}:${h.word}`), ['Fixture Firm:A:suspected', 'Example Wire:B:suspects']);
		assert.equal(swap.label, 'CONFIRMED');
		assert.deepEqual(lintBrief(brief, allow).filter((f) => f.level === 'error'), []);
		const md = renderMarkdown(brief);
		assert.match(md, /Still hedged in the sources: “suspected compromise of the aggregate signing key”, per Fixture Firm/);
		assert.deepEqual(lintRendered(md, renderEmailHtml(brief), brief, {allow}).filter((f) => f.level === 'error'), []);
	});

	it('labels a radar-confirmed incident DEVELOPING when every confirming source hedges', () => {
		const r = hedgedRadar();
		r.top[0]!.sources.find((s) => s.id === 'fixture-db')!.excerpt = 'FixtureSwap · 2026-11-23 · reported loss $4,200,000 · an apparent key compromise';
		const {brief, notes, allow} = buildBrief(r, {allow: baseAllow, now: NOW, show});
		const swap = brief.incidents[0]!;
		assert.equal(swap.radarStatus, 'confirmed');
		assert.equal(swap.status, 'developing');
		assert.equal(swap.label, 'DEVELOPING');
		assert.match(swap.statusLine, /^Developing: no primary source, and no two independent outlets, report it without hedging yet/);
		assert.match(swap.statusLine, /“apparent key compromise”, per Fixture DB/);
		assert.ok(notes.some((n) => /marks it confirmed, but every tier-A and tier-B source hedges/.test(n)));
		assert.match(brief.subject, /\(2 developing\)$/);
		assert.deepEqual(lintBrief(brief, allow).filter((f) => f.level === 'error'), []);
		assert.match(renderMarkdown(brief), /^### DEVELOPING · FixtureSwap: key compromise$/m);
	});

	it('quotes only hedges about the incident itself, but any hedge stops a source counting as unhedged', () => {
		const r = structuredClone(radar);
		// Sample Wallet: confirmed by two tier-B outlets; one of them now hedges something unrelated to the incident
		r.top[2]!.sources[0]!.excerpt = 'Researchers say the campaign shows potential handoffs to resellers.';
		const {brief, notes} = buildBrief(r, {allow: baseAllow, now: NOW, show});
		const wallet = brief.incidents[2]!;
		assert.deepEqual(wallet.hedges.map((h) => [h.publisher, h.quote, h.aboutIncident]), [['Example Wire', 'potential handoffs', false]]);
		assert.doesNotMatch(wallet.statusLine, /handoffs/);
		assert.equal(wallet.status, 'developing', 'only one unhedged tier-B outlet is left');
		assert.ok(notes.some((n) => /Example Wire hedges something other than the incident itself/.test(n)));
	});

	it('never upgrades a developing incident, and reads the radar flag when the text shows no hedge', () => {
		const r = structuredClone(radar);
		r.top[1]!.sources[0]!.hedge = 'unconfirmed';
		const {brief} = buildBrief(r, {allow: baseAllow, now: NOW, show});
		assert.equal(brief.incidents[1]?.status, 'developing');
		assert.match(brief.incidents[1]?.statusLine ?? '', /“unconfirmed”, per Sample Daily\.$/);
	});

	it('quotes the hedge and what it qualifies, never more than its clause', () => {
		const at = (text: string): string => {
			const m = /suspected|suspects|apparent|may have|alleged/i.exec(text);
			return m ? hedgePhrase(text, m.index, m[0]) : '';
		};
		assert.equal(at('leaves parts of the suspected key theft unconfirmed. Services remain paused.'), 'suspected key theft');
		assert.equal(at('Chainflip Suspects Key Theft in $12.6 Million Vault Hack'), 'Suspects Key Theft');
		assert.equal(at('The attacker, through a suspected compromise of the aggregate signing key, drained 122.86 BTC'), 'suspected compromise of the aggregate signing key');
		assert.equal(at('funds may have been moved to 0xabc'), 'may have been moved');
		assert.equal(at('an apparent'), 'apparent');
	});
});

describe('render', () => {
	const {brief, allow} = build();
	const md = renderMarkdown(brief);
	const html = renderEmailHtml(brief);

	it('writes Markdown with front matter, labels, attributed figures and the footer', () => {
		assert.match(md, /^---\nsubject: "Threat Brief, Nov 24: FixtureSwap, Mock Bridge, Sample Wallet \(1 developing\)"/);
		assert.match(md, /^### CONFIRMED · FixtureSwap: key compromise$/m);
		assert.match(md, /- \*\*When \(per Fixture DB\):\*\* 2026-11-23 \(UTC\) · \*\*Chains \(per Fixture DB\):\*\* Ethereum, Base/);
		assert.match(md, /^### DEVELOPING · Mock Bridge: reported bridge exploit$/m);
		assert.match(md, /\[\$4,200,000\]\(https:\/\/db\.fixture\.test\/hacks#FixtureSwap@2026-11-23\) \(reported by Fixture DB\)/);
		assert.match(md, /## Zoo's One Fix\n\nKeep long-term funds on a hardware wallet/);
		assert.match(md, /You're getting the Threat Brief because you subscribed/);
		assert.match(md, /\*\*\[Watch: FixtureSwap lost its keys\]\(https:\/\/youtu\.be\/Zb7xq2Ph0aA\)\*\*/);
	});

	it('writes email-safe HTML: inline styles, no scripts, styles, images or http links', () => {
		assert.doesNotMatch(html, /<script|<style|<img|<link |<iframe|\son[a-z]+=/i);
		assert.ok([...html.matchAll(/href="([^"]+)"/g)].every((m) => m[1]?.startsWith('https://')));
		assert.match(html, />DEVELOPING<\/span>Mock Bridge: reported bridge exploit</);
		assert.match(html, /max-width:600px/);
		assert.deepEqual(lintRendered(md, html, brief, {allow}).filter((f) => f.level === 'error'), []);
	});

	it('runs the text rules over the whole rendered body, not only field by field', () => {
		const edited = md.replace('Keep long-term funds on a hardware wallet', 'Funds were probably moved by CEO John Smith, so keep long-term funds on a hardware wallet');
		const editedHtml = html.replace('Keep long-term funds on a hardware wallet', 'The founder Jane says to buy the dip and keep long-term funds on a hardware wallet');
		const codes = (where: string): string[] =>
			lintRendered(edited, editedHtml, brief, {allow})
				.filter((f) => f.level === 'error' && f.where === where)
				.map((f) => `${f.rule}/${f.code}`);
		for (const code of ['speculation/hedge', 'names/title-or-role']) assert.ok(codes('Markdown body').includes(code), code);
		for (const code of ['names/title-or-role', 'price/advice']) assert.ok(codes('email body').includes(code), code);
	});

	it('escapes HTML and Kit template braces from every field', () => {
		const evil: ThreatBrief = structuredClone(brief);
		evil.incidents[0]!.name = '<script>alert(1)</script> {{ subscriber.email }}';
		const out = renderEmailHtml(evil);
		assert.doesNotMatch(out, /<script>alert|\{\{/);
		assert.match(out, /&lt;script&gt;alert\(1\)&lt;\/script&gt; &#123;&#123; subscriber\.email &#125;&#125;/);
		assert.doesNotMatch(renderMarkdown(evil), /<script>/);
	});

	it('shows a pending link as a placeholder and "No new episode today" without a show', () => {
		const pending = build({show: {...show, url: null}}).brief;
		assert.ok(renderMarkdown(pending).includes(mdEscaped(SHOW_LINK_PENDING)));
		assert.ok(renderEmailHtml(pending).includes(SHOW_LINK_PENDING));
		assert.match(renderMarkdown(build({show: null}).brief), /No new episode today\./);
		const developingShow = build({show: {...show, developing: true}}).brief;
		assert.match(renderMarkdown(developingShow), /Watch: DEVELOPING: FixtureSwap lost its keys/);
	});

	it('text extraction keeps what a reader sees', () => {
		assert.match(htmlToText(html), /Reported loss: \$4,200,000 \(reported by Fixture DB\)/);
		assert.match(markdownToText(md), /^CONFIRMED · FixtureSwap: key compromise$/m);
	});

	it('lintFile passes the rendered files and catches hand edits', () => {
		assert.deepEqual(lintFile(md, 'markdown', 'brief.md', allow).filter((f) => f.level === 'error'), []);
		assert.deepEqual(lintFile(html, 'html', 'brief.html', allow).filter((f) => f.level === 'error'), []);
		const edited = md
			.replace('### DEVELOPING · Mock Bridge', '### Mock Bridge')
			.replace('Keep long-term funds on a hardware wallet', 'CEO John Smith says it was probably fine, so buy the dip')
			.replace('(reported by Example Wire)', '');
		const codes = lintFile(edited, 'markdown', 'brief.md', allow).filter((f) => f.level === 'error').map((f) => `${f.rule}/${f.code}`);
		for (const code of ['developing/label-missing', 'names/first-name', 'speculation/hedge', 'price/market-talk', 'attribution/loss-unattributed']) assert.ok(codes.includes(code), code);
		assert.ok(hasErrors(lintFile(html.replace('</body>', '<script>x()</script></body>'), 'html', 'brief.html', allow)));
		const pending = renderMarkdown(build({show: {...show, url: null}}).brief);
		assert.ok(lintFile(pending, 'markdown', 'brief.md', allow).some((f) => f.rule === 'placeholder' && f.level === 'error'), 'a pending link blocks sending');
	});
});

describe('show inputs', () => {
	it('reads a publish kit: title, link, developing flag and the One Fix from the summary', () => {
		const {show: s, errors} = readShowKit(fixture('kit.json'), 'Zb7xq2Ph0aA');
		assert.deepEqual(errors, []);
		assert.deepEqual(s, {title: 'FixtureSwap lost its keys', url: 'https://youtu.be/Zb7xq2Ph0aA', developing: false, oneFix: 'Keep long-term funds on a hardware wallet.', slug: '2026-11-24-fixtureswap'});
		assert.equal(oneFixFromSummary('No fix here.'), null);
		assert.match(readShowKit(fixture('radar.json'), null).errors.join(), /version/);
	});
	it("reads the daily pipeline's PostInput", () => {
		const {input, errors} = checkDailyInput(JSON.parse(readFileSync(fixture('daily-input.json'), 'utf8')));
		assert.deepEqual(errors, []);
		assert.equal(input?.corrections.length, 1);
		assert.equal(showFromDaily(input!).url, null);
		assert.match(checkDailyInput({date: 'x'}).errors.join(), /date/);
	});
});

const mdEscaped = (s: string): string => s.replace(/[[\]]/g, '\\$&');
