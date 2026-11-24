/**
 * Builds the news-gate test fixtures from the passing one (zoora-security/good-fixtureswap-drain): one deliberately bad
 * storyboard per rule (and a few edge cases), each with the rules it must fail, written to zoora-security/<slug>/ plus
 * cases.json and corrections.json. Everything is fictional and uses reserved example domains.
 *   node scripts/news/fixtures/build-fixtures.ts           rewrite the fixtures
 *   node scripts/news/fixtures/build-fixtures.ts --check   exit 1 if the files on disk are out of date (the tests run this)
 */
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

type J = Record<string, any>; // fixture JSON is edited freely here
type Scene = {id: string; narration: string; onScreen?: Record<string, unknown>; [k: string]: unknown};

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, 'zoora-security');
const BASE = 'good-fixtureswap-drain';

export type FixtureCase = {
	slug: string;
	about: string;
	/** rules that must fail (exactly these) */
	expect: string[];
	/** finding codes that must appear */
	codes: string[];
	/** officials to allowlist for this run (the case passes only with them) */
	officials?: Array<{name: string; role: string; agency: string; sourceUrl: string}>;
	/** the case run without its officials must fail exactly these rules */
	expectWithoutOfficials?: string[];
};

const read = (p: string): J => JSON.parse(readFileSync(p, 'utf8'));
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));
const scene = (sb: J, id: string): Scene => {
	const s = (sb.scenes as Scene[]).find((x) => x.id === id);
	if (!s) throw new Error(`no scene ${id}`);
	return s;
};
const append = (sb: J, id: string, text: string) => {
	const s = scene(sb, id);
	s.narration = `${s.narration} ${text}`;
};

type Mut = {slug: string; about: string; expect: string[]; codes: string[]; officials?: FixtureCase['officials']; expectWithoutOfficials?: string[]; mutate: (sb: J, brief: J) => void};

const POLICE_URL = 'https://police.example/releases/2026-11-24';

const MUTATIONS: Mut[] = [
	{
		slug: 'bad-r1-number',
		about: 'R1: the loss figure ($4.5M) is not in the cited excerpt ($4.2 million).',
		expect: ['R1'],
		codes: ['R1.number-not-in-excerpt'],
		mutate: (sb) => {
			scene(sb, 's01').narration = scene(sb, 's01').narration.replace('{$4.2M|four point two million dollars}', '{$4.5M|four point five million dollars}');
		},
	},
	{
		slug: 'bad-r1-no-fact',
		about: 'R1: a tagged claim that matches no brief fact (a relaunch the source never mentions).',
		expect: ['R1'],
		codes: ['R1.claim-not-in-fact'],
		mutate: (sb) => {
			scene(sb, 's03').narration = scene(sb, 's03').narration.replace('The firm says the funds were later bridged to another network [src:src-lab].', 'The firm says the team plans to relaunch next week [src:src-lab].');
		},
	},
	{
		slug: 'bad-r1-unknown-source',
		about: 'R1: cites a source the radar never selected (no stored excerpt).',
		expect: ['R1'],
		codes: ['R1.not-in-brief', 'R1.no-brief-fact'],
		mutate: (sb) => {
			sb.sources.push({id: 'src-forum', title: 'Forum thread', url: 'https://forum.example.org/t/123', accessed: '2026-11-24', status: 'verified'});
			append(sb, 's03', 'A forum thread says more pools are at risk [src:src-forum].');
		},
	},
	{
		slug: 'bad-r1-spoken-mismatch',
		about: 'R1: the screen shows $4.2M but the voice says four point five million.',
		expect: ['R1'],
		codes: ['R1.spoken-mismatch'],
		mutate: (sb) => {
			scene(sb, 's01').narration = scene(sb, 's01').narration.replace('{$4.2M|four point two million dollars}', '{$4.2M|four point five million dollars}');
		},
	},
	{
		slug: 'bad-r1-quote',
		about: 'R1: a quotation that is not word for word in the cited excerpt.',
		expect: ['R1'],
		codes: ['R1.quote-not-in-excerpt'],
		mutate: (sb) => append(sb, 's02', 'FixtureSwap wrote that "every single pool was emptied" [src:src-pm].'),
	},
	{
		slug: 'bad-r1-unsourced-number',
		about: 'R1: a number stated with no source tag.',
		expect: ['R1'],
		codes: ['R1.unsourced-number'],
		mutate: (sb) => append(sb, 's05', 'Over 12 teams use this setup.'),
	},
	{
		slug: 'bad-r1-unreachable-source',
		about: 'R1: the source is an X post, which this pipeline cannot fetch or verify.',
		expect: ['R1'],
		codes: ['R1.unreachable-source'],
		mutate: (sb, brief) => {
			const url = 'https://x.com/examplelab/status/1';
			sb.sources.find((s: J) => s.id === 'src-lab').url = url;
			brief.sources.find((s: J) => s.id === 'src-lab').url = url;
		},
	},
	{
		slug: 'bad-r2-no-label',
		about: 'R2: a developing incident with no DEVELOPING label on screen or in the storyboard.',
		expect: ['R2'],
		codes: ['R2.no-visible-label', 'R2.short-no-label'],
		mutate: (sb) => {
			delete sb.news.developing;
			scene(sb, 's01').onScreen = {title: 'FixtureSwap reports $4.2M drain'};
		},
	},
	{
		slug: 'bad-r2-not-spoken',
		about: 'R2: the narration never says the story is developing.',
		expect: ['R2'],
		codes: ['R2.not-spoken', 'R2.short-not-spoken'],
		mutate: (sb) => {
			scene(sb, 's01').narration = scene(sb, 's01').narration.replace('This is a developing story. ', '');
		},
	},
	{
		slug: 'bad-r3-unattributed',
		about: 'R3: a cause (a compromised key) stated without saying who reports it.',
		expect: ['R3'],
		codes: ['R3.unattributed', 'R3.short-developing-cause'],
		mutate: (sb) => {
			scene(sb, 's02').narration = scene(sb, 's02').narration.replace("According to FixtureSwap's preliminary review, a compromised", 'A compromised');
		},
	},
	{
		slug: 'bad-r3-loss',
		about: 'R3: a loss amount that is not "reported by" anyone.',
		expect: ['R3'],
		codes: ['R3.unattributed'],
		mutate: (sb) => {
			scene(sb, 's01').narration = scene(sb, 's01').narration.replace(
				'FixtureSwap says attackers drained {$4.2M|four point two million dollars} from its liquidity pools [src:src-wire].',
				"Attackers drained {$4.2M|four point two million dollars} from FixtureSwap's liquidity pools [src:src-wire].",
			);
		},
	},
	{
		slug: 'bad-r3-accusation',
		about: 'R3: an accusation ("insiders stole") with no source and no attribution.',
		expect: ['R3'],
		codes: ['R3.unsourced'],
		mutate: (sb) => append(sb, 's05', 'Insiders stole the key.'),
	},
	// insider accusations in plain paraphrase (2026-11-24 review): each must stay failing on its own
	...(
		[
			['bad-r3-insiders-helped', 'Insiders helped the attackers.'],
			['bad-r3-employee-let-in', 'An employee let the attackers in.'],
			['bad-r3-engineer-in-on-it', 'The engineer was in on it.'],
			['bad-r3-staff-colluded', 'Staff colluded with the attackers.'],
			['bad-r3-someone-at-helped', 'Someone at FixtureSwap helped them get in.'],
		] as Array<[string, string]>
	).map(([slug, line]): Mut => ({slug, about: `R3: an unattributed insider accusation in plain words ("${line}").`, expect: ['R3'], codes: ['R3.unsourced'], mutate: (sb) => append(sb, 's05', line)})),
	{
		slug: 'bad-r3-insider-title',
		about: 'R3: an insider accusation in an on-screen title ("An employee let them in").',
		expect: ['R3'],
		codes: ['R3.short-unattributed'],
		mutate: (sb) => {
			(scene(sb, 's02').onScreen as J).title = 'An employee let them in';
		},
	},
	{
		slug: 'bad-r3-accusation-not-in-source',
		about: 'R3: an attributed accusation the cited source never makes ("stole", "criminals").',
		expect: ['R3'],
		codes: ['R3.not-in-source'],
		mutate: (sb) => append(sb, 's03', 'Example Security Lab says criminals stole the funds that were later bridged to another network [src:src-lab].'),
	},
	{
		slug: 'bad-r3-figure-on-thumbnail',
		about: 'R3: a loss figure on a thumbnail with no "reported by".',
		expect: ['R3'],
		codes: ['R3.figure-unattributed'],
		mutate: (sb) => {
			sb.thumbnails[0].text = 'DEVELOPING: $4.2M DRAIN';
		},
	},
	{
		slug: 'bad-r1-figure-role',
		about: 'R1: money the source says is being recovered, relabelled as stolen.',
		expect: ['R1'],
		codes: ['R1.figure-role'],
		mutate: (sb, brief) => {
			const excerpt = 'FixtureSwap said it is seeking to recover about $1.1 million that an exchange froze.';
			brief.sources.push({id: 'src-wire-2', url: 'https://news.example.com/2026/11/24/fixtureswap-recovery', title: 'FixtureSwap seeks to recover $1.1 million', publisher: 'Example Wire', kind: 'news', publishedAt: '2026-11-24T09:00:00Z', excerpt});
			brief.facts.push({id: 'f6', text: excerpt, sourceIds: ['src-wire-2'], excerpts: [excerpt], incidentId: 'inc-fixtureswap'});
			sb.sources.push({id: 'src-wire-2', title: 'FixtureSwap seeks to recover $1.1 million (Example Wire)', url: 'https://news.example.com/2026/11/24/fixtureswap-recovery', accessed: '2026-11-24', status: 'verified'});
			append(sb, 's03', 'According to Example Wire, FixtureSwap lost about {$1.1 million|one point one million dollars} that an exchange froze [src:src-wire-2].');
		},
	},
	{
		slug: 'bad-r1-tier-c-only',
		about: 'R1: claims that rest on a tier-C aggregator alone.',
		expect: ['R1'],
		codes: ['R1.tier-c-only'],
		mutate: (_sb, brief) => {
			brief.sources.find((s: J) => s.id === 'src-lab').tier = 'C';
		},
	},
	{
		slug: 'bad-r2-title-no-label',
		about: 'R2: a developing story whose video title and Short title do not say developing.',
		expect: ['R2'],
		codes: ['R2.title-no-label', 'R2.short-title-no-label'],
		mutate: (sb) => {
			sb.title = 'FixtureSwap reports $4.2M drain';
			sb.shorts[0].title = 'FixtureSwap reports $4.2M drain';
		},
	},
	{
		slug: 'bad-r5-unnumbered-steps',
		about: 'R5: an on-screen list of attack actions without attack verbs or numbers.',
		expect: ['R5'],
		codes: ['R5.step-list'],
		mutate: (sb) => {
			(scene(sb, 's02').onScreen as J).bullets = ['Post a fake job', 'Send a test repo', 'Grab the session token', 'Sign the upgrade'];
		},
	},
	{
		slug: 'bad-r5-diagram-steps',
		about: 'R5: diagram nodes that are attack actions, linked by "then".',
		expect: ['R5'],
		codes: ['R5.diagram-steps'],
		mutate: (sb) => {
			const o = scene(sb, 's02').onScreen as J;
			o.nodes = ['Send fake offer', 'Victim runs test repo', 'Steal deployer key', 'Upgrade the pool'];
			o.links = ['then', 'then', 'then'];
		},
	},
	{
		slug: 'bad-r6-dropped-hedge',
		about: 'R6: a source suspects a cause; the claim states it as fact.',
		expect: ['R6'],
		codes: ['R6.dropped-hedge'],
		mutate: (sb, brief) => {
			const excerpt = 'FixtureSwap said it suspects a phishing attack on a signer, but the cause is unconfirmed.';
			brief.sources.push({id: 'src-wire-3', url: 'https://news.example.com/2026/11/24/fixtureswap-cause', title: 'FixtureSwap looks at signer phishing', publisher: 'Example Wire', kind: 'news', publishedAt: '2026-11-24T10:00:00Z', excerpt});
			brief.facts.push({id: 'f7', text: excerpt, sourceIds: ['src-wire-3'], excerpts: [excerpt], incidentId: 'inc-fixtureswap'});
			sb.sources.push({id: 'src-wire-3', title: 'FixtureSwap looks at signer phishing (Example Wire)', url: 'https://news.example.com/2026/11/24/fixtureswap-cause', accessed: '2026-11-24', status: 'verified'});
			append(sb, 's02', 'According to Example Wire, FixtureSwap blames a phishing attack on a signer [src:src-wire-3].');
		},
	},
	{
		slug: 'bad-r7-fabricated-own-data',
		about: 'R7: own-data figures the brief\'s stored rows cannot reproduce.',
		expect: ['R7'],
		codes: ['R7.own-data-unverified'],
		mutate: (sb) => {
			sb.analysis[0].detail = 'In our tracker sample, FixtureSwap is one of 7 key-compromise drains in eight weeks, after FixtureLend lost $3.1M on Oct 2.';
			scene(sb, 's04').narration = scene(sb, 's04').narration.replace('this is the second key-compromise drain in eight weeks', 'this is one of 7 key-compromise drains in eight weeks');
		},
	},
	{
		slug: 'bad-r9-price-no-number',
		about: 'R9: a token move with no number, and advice on where to keep savings.',
		expect: ['R9'],
		codes: ['R9.price-direction', 'R9.advice-hold'],
		mutate: (sb) => append(sb, 's05', 'ETH tanked after the news. Keep your savings in USDC instead.'),
	},
	{
		slug: 'bad-r4-speaker-surname',
		about: 'R4: a lone surname quoted as speaking ("Sample said").',
		expect: ['R4'],
		codes: ['R4.speaker-name'],
		mutate: (sb) => append(sb, 's05', 'Sample said the pools stay closed.'),
	},
	{
		slug: 'bad-r4-person-name',
		about: "R4: a private person's name, a social handle and the radar's [named person] placeholder.",
		expect: ['R4'],
		codes: ['R4.two-word-name', 'R4.handle', 'R4.placeholder'],
		mutate: (sb) => {
			append(sb, 's05', 'Thanks to viewer Jordan Sample for the tip, and hi to @fixturefan.');
			append(sb, 's03', '[named person] approved the upgrade.');
		},
	},
	{
		slug: 'bad-r5-howto',
		about: 'R5: a step-by-step with function calls (an exploit how-to).',
		expect: ['R5'],
		codes: ['R5.function-call', 'R5.camel-case'],
		mutate: (sb) => append(sb, 's02', 'First, the deployer calls upgradeTo() on the pool, then calls withdrawAll(), then bridges the funds out.'),
	},
	{
		slug: 'bad-r5-code',
		about: 'R5: payload/calldata talk and a hex selector.',
		expect: ['R5'],
		codes: ['R5.payload', 'R5.hex'],
		mutate: (sb) => append(sb, 's03', 'The payload sat in the calldata at 0x5f2b9c1d.'),
	},
	{
		slug: 'bad-r6-speculation',
		about: 'R6: rumour and a hedge the sources never state.',
		expect: ['R6'],
		codes: ['R6.rumor', 'R6.hedge'],
		mutate: (sb) => append(sb, 's05', 'Rumor has it more pools are affected, and this probably gets worse.'),
	},
	{
		slug: 'bad-r7-no-analysis',
		about: 'R7: no analysis element, so the video adds no real analysis.',
		expect: ['R7'],
		codes: ['R7.no-analysis'],
		mutate: (sb) => {
			delete sb.analysis;
		},
	},
	{
		slug: 'bad-r7-not-presented',
		about: 'R7: an analysis no scene presents, so neither the episode nor the Short shows it.',
		expect: ['R7'],
		codes: ['R7.not-presented', 'R7.short-without-analysis'],
		mutate: (sb) => {
			const a = sb.analysis[0];
			delete a.sceneIds;
			a.detail = 'Bridge drains doubled across the sample this quarter compared with the quarter before it.';
		},
	},
	{
		slug: 'bad-r8-repeats-correction',
		about: 'R8: repeats a claim that corrections.json corrected (the stale excerpt still says it).',
		expect: ['R8'],
		codes: ['R8.repeats-corrected-claim', 'R8.pin-pending'],
		mutate: () => {},
	},
	{
		slug: 'bad-r9-price',
		about: 'R9: buy-the-dip advice and a price chart scene.',
		expect: ['R9'],
		codes: ['R9.market-talk', 'R9.price-chart'],
		mutate: (sb) => {
			append(sb, 's05', 'If you hold FIX, now might be a good time to buy the dip.');
			const i = (sb.scenes as Scene[]).findIndex((s) => s.id === 's04');
			sb.scenes.splice(i + 1, 0, {id: 's04b', type: 'chart', narration: '', chart: {seed: 7, illustrative: true}, onScreen: {pair: '$FIX / ETH'}});
		},
	},
	{
		slug: 'bad-r10-redraw',
		about: "R10: redraws and embeds another outlet's chart.",
		expect: ['R10'],
		codes: ['R10.media-key', 'R10.their-media', 'R10.screenshot'],
		mutate: (sb) => {
			const s = scene(sb, 's03');
			s.onScreen = {title: "Example Security Lab's chart, redrawn", image: 'lab-chart.png', bullets: ['About 1,400 ETH out (Example Security Lab)', 'Bridged to another network']};
		},
	},
	{
		slug: 'bad-input-fiction',
		about: 'INPUT: a news storyboard marked as fiction.',
		expect: ['INPUT'],
		codes: ['INPUT.fiction'],
		mutate: (sb) => {
			sb.fiction = true;
		},
	},
	{
		slug: 'official-named',
		about: 'R4: an official named in a cited law-enforcement release passes only when allowlisted.',
		expect: [],
		codes: [],
		officials: [{name: 'Avery Example', role: 'commissioner', agency: 'Example Police Bureau', sourceUrl: POLICE_URL}],
		expectWithoutOfficials: ['R4'],
		mutate: (sb, brief) => {
			const excerpt = 'Commissioner Avery Example said the bureau is working with FixtureSwap to trace the funds.';
			brief.sources.push({id: 'src-police', url: POLICE_URL, title: 'Bureau statement on FixtureSwap', publisher: 'Example Police Bureau', kind: 'law-enforcement', publishedAt: '2026-11-24T10:00:00Z', excerpt});
			brief.facts.push({id: 'f6', text: 'The Example Police Bureau says it is working with FixtureSwap to trace the funds.', sourceIds: ['src-police'], excerpts: [excerpt], incidentId: 'inc-fixtureswap'});
			sb.sources.push({id: 'src-police', title: 'Bureau statement on FixtureSwap (Example Police Bureau)', url: POLICE_URL, accessed: '2026-11-24', status: 'verified'});
			append(sb, 's03', 'Commissioner Avery Example said the bureau is working with FixtureSwap to trace the funds [src:src-police].');
		},
	},
	{
		slug: 'good-radar-incident',
		about: 'Adapter: brief.json is a radar incident object (scripts/radar output), not a curated brief.',
		expect: [],
		codes: ['INPUT.brief'],
		mutate: (sb, brief) => {
			// one radar incident; the tracker rows are two members of the same feed with different URLs
			const trackerUrls = ['https://tracker.example.net/incidents#fixturelend', 'https://tracker.example.net/incidents#fixtureswap'];
			sb.sources.find((s: J) => s.id === 'src-tracker').url = trackerUrls[0];
			const src = (id: string) => brief.sources.find((s: J) => s.id === id);
			const radarSources = [
				...['src-wire', 'src-pm', 'src-lab'].map((id) => ({id, url: src(id).url, title: src(id).title, excerpt: src(id).excerpt, publishedUtc: src(id).publishedAt, publisher: src(id).publisher, kind: src(id).kind === 'post-mortem' ? 'postmortem' : src(id).kind === 'security-firm' ? 'blog' : 'news', tier: 'A'})),
				...src('src-tracker').excerpts.map((ex: string, i: number) => ({id: 'src-tracker', url: trackerUrls[i], title: src('src-tracker').title, excerpt: ex, publishedUtc: src('src-tracker').publishedAt, publisher: 'Example Hack Tracker', kind: 'structured', tier: 'A'})),
			];
			const fact = (text: string, sid: string, url: string, quote: string) => ({text, sourceId: sid, url, quote, field: 'excerpt'});
			const radar = {
				id: '2026-11-23-fixtureswap',
				title: 'FixtureSwap: reported key compromise (developing)',
				protocol: 'FixtureSwap',
				chains: ['Ethereum'],
				type: 'key-compromise',
				dateUtc: '2026-11-23',
				status: 'developing',
				statusReason: 'developing: fixture',
				sources: radarSources,
				facts: [
					fact('FixtureSwap says attackers drained $4.2 million from its liquidity pools.', 'src-wire', src('src-wire').url, 'attackers drained $4.2 million'),
					fact("FixtureSwap's preliminary review points to a compromised deployer key used to upgrade the pool contract; the investigation is ongoing.", 'src-pm', src('src-pm').url, 'compromised deployer key'),
					fact('Example Security Lab flagged outflows of about 1,400 ETH to a newly funded address; the funds were later bridged to another network.', 'src-lab', src('src-lab').url, 'about 1,400 ETH'),
					fact('Example Hack Tracker lists FixtureLend: 2026-10-02, $3.1M, compromised private key.', 'src-tracker', trackerUrls[0], '$3.1M'),
					fact('Example Hack Tracker lists FixtureSwap: 2026-11-23, $4.2M, private key compromise.', 'src-tracker', trackerUrls[1], '$4.2M'),
				],
			};
			for (const k of Object.keys(brief)) delete brief[k];
			Object.assign(brief, radar);
		},
	},
];

const R8_CORRECTION = {
	id: '2026-11-24-bad-r8-repeats-correction-1',
	slug: 'bad-r8-repeats-correction',
	date: '2026-11-24',
	wrong: 'The funds were later bridged to another network',
	correct: 'Example Security Lab now says the funds have not left Ethereum, according to its updated alert.',
	sourceIds: ['src-lab'],
	status: 'pending',
};

const json = (x: unknown) => `${JSON.stringify(x, null, 2)}\n`;

/** Everything the builder writes: path (relative to fixtures/) -> content. */
export const buildFixtures = (): Map<string, string> => {
	const sb0 = read(join(ROOT, BASE, 'storyboard.json'));
	const brief0 = read(join(ROOT, BASE, 'brief.json'));
	const out = new Map<string, string>();
	const cases: FixtureCase[] = [{slug: BASE, about: 'Passes every rule: attributed, sourced, labelled developing, with own-data analysis and a pinned correction.', expect: [], codes: []}];
	for (const m of MUTATIONS) {
		const sb = clone(sb0);
		const brief = clone(brief0);
		sb.slug = m.slug;
		m.mutate(sb, brief);
		if (brief.slug !== undefined) brief.slug = m.slug;
		out.set(`zoora-security/${m.slug}/storyboard.json`, json(sb));
		out.set(`zoora-security/${m.slug}/brief.json`, json(brief));
		cases.push({slug: m.slug, about: m.about, expect: m.expect, codes: m.codes, ...(m.officials ? {officials: m.officials, expectWithoutOfficials: m.expectWithoutOfficials} : {})});
	}
	const corrections = read(join(ROOT, 'corrections.json'));
	const others = (corrections.corrections as J[]).filter((c) => c.id !== R8_CORRECTION.id);
	out.set('zoora-security/corrections.json', json({version: 1, corrections: [...others, R8_CORRECTION]}));
	out.set('zoora-security/cases.json', json({about: 'News claim gate fixtures. Built by build-fixtures.ts from good-fixtureswap-drain; fictional names on example domains.', cases}));
	return out;
};

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
	const check = process.argv.includes('--check');
	let stale = 0;
	for (const [rel, content] of buildFixtures()) {
		const p = join(HERE, rel);
		const now = existsSync(p) ? readFileSync(p, 'utf8') : null;
		if (now === content) continue;
		if (check) {
			stale++;
			process.stderr.write(`stale: ${rel}\n`);
		} else {
			mkdirSync(dirname(p), {recursive: true});
			writeFileSync(p, content);
			process.stdout.write(`wrote ${rel}\n`);
		}
	}
	if (check && stale) {
		process.stderr.write(`${stale} fixture file(s) out of date: run node scripts/news/fixtures/build-fixtures.ts\n`);
		process.exitCode = 1;
	}
}
