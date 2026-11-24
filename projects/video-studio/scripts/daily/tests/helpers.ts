/**
 * Test helpers: a temporary video-studio layout, a fictional radar day (reserved example domains, invented
 * protocols), the radar's DefiLlama cache, and a fake command runner that records every call. Nothing here touches
 * the network, renders, synthesizes or uploads.
 */
import {cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import type {Exec, ExecRequest, ExecResult} from '../lib/exec.ts';
import type {RadarIncident} from '../lib/types.ts';
import {quietTypelessWarning} from '../lib/quiet.ts';

// the news gate's splitter loads src/episode/markup.ts (no "type" in the studio package.json): hide that one warning
quietTypelessWarning();

export const STUDIO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
export const DATE = '2026-11-24';
export const NOW = new Date('2026-11-24T10:43:00Z'); // 04:43 America/Chicago

export const tempRoot = (opts: {news?: boolean; src?: boolean} = {}): {root: string; cleanup: () => void} => {
	// <tmp>/video-studio, so the creator-hub sibling (<tmp>/creator-hub) also stays inside the temp folder
	const base = mkdtempSync(join(tmpdir(), 'daily-test-'));
	const root = join(base, 'video-studio');
	mkdirSync(join(root, 'content', 'zoora-security', 'radar'), {recursive: true});
	cpSync(join(STUDIO, 'content', 'zoora-security', 'channel.json'), join(root, 'content', 'zoora-security', 'channel.json'));
	mkdirSync(join(root, 'scripts'), {recursive: true});
	if (opts.news) symlinkSync(join(STUDIO, 'scripts', 'news'), join(root, 'scripts', 'news'));
	else {
		mkdirSync(join(root, 'scripts', 'news'), {recursive: true});
		cpSync(join(STUDIO, 'scripts', 'news', 'allowlist.json'), join(root, 'scripts', 'news', 'allowlist.json'));
	}
	if (opts.src) symlinkSync(join(STUDIO, 'src'), join(root, 'src'));
	return {root, cleanup: () => rmSync(base, {recursive: true, force: true})};
};

export const writeJsonFile = (path: string, data: unknown): void => {
	mkdirSync(dirname(path), {recursive: true});
	writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
};

export const touch = (path: string, content = ''): void => {
	mkdirSync(dirname(path), {recursive: true});
	writeFileSync(path, content);
};

// ---- a fictional radar day ----

const dl = (name: string, date: string) => `https://api.llama.fi/hacks#${encodeURIComponent(`${name}@${date}`)}`;

export const incident = (over: Partial<RadarIncident> & {id: string; protocol: string}): RadarIncident => ({
	title: `${over.protocol}: key compromise`,
	chains: ['Ethereum'],
	type: 'key-compromise',
	dateUtc: '2026-11-23',
	reportedLosses: [],
	status: 'confirmed',
	statusReason: 'confirmed: unhedged tier-A source(s): defillama-hacks',
	sources: [],
	postMortemUrl: null,
	evergreenTopic: 'key-management',
	notes: [],
	typeReason: 'fixture',
	mechanismKnown: true,
	facts: [],
	score: {total: 70, factors: {loss: {value: 0.5, weight: 25, points: 12.5, reason: 'fixture'}}},
	shortReady: {ready: true, missing: []},
	...over,
});

/** FixtureSwap: confirmed, DefiLlama-listed, two outlets, a hedge and a redacted name. */
export const fixtureSwap = (): RadarIncident => {
	const dlUrl = dl('FixtureSwap', '2026-11-23');
	const dlExcerpt = 'FixtureSwap · 2026-11-23 · reported loss $4,200,000 · Key Compromise / Private Key Compromised · target: DeFi Protocol · chains: Ethereum · The protocol said a deployer key was used to upgrade its pool contract.';
	return incident({
		id: '2026-11-23-fixtureswap',
		protocol: 'FixtureSwap',
		score: {total: 80},
		reportedLosses: [
			{amountUsd: 4200000, by: 'defillama-hacks', url: dlUrl, quote: 'reported loss $4,200,000', field: 'excerpt', tier: 'A'},
			{amountUsd: 4500000, by: 'examplewire', url: 'https://news.example.com/fixtureswap', quote: '$4.5 million', field: 'excerpt', tier: 'B'},
		],
		sources: [
			{id: 'defillama-hacks', url: dlUrl, title: 'DefiLlama hacks: FixtureSwap (2026-11-23)', excerpt: dlExcerpt, publishedUtc: null, tier: 'A', publisher: 'DefiLlama', kind: 'structured', eventDate: '2026-11-23'},
			{id: 'examplewire', url: 'https://news.example.com/fixtureswap', title: 'FixtureSwap says attackers drained $4.5 million', excerpt: 'FixtureSwap said attackers drained $4.5 million from its pools, according to a statement. [named person] declined to comment.', publishedUtc: '2026-11-23T18:00:00Z', tier: 'B', publisher: 'Example Wire', kind: 'news', redacted: {names: 1, code: 0}},
			{id: 'examplewire', url: 'https://news.example.com/fixtureswap-update', title: 'FixtureSwap probe points to suspected key theft', excerpt: 'Investigators suspect a stolen deployer key, the outlet reported.', publishedUtc: '2026-11-24T02:00:00Z', tier: 'B', publisher: 'Example Wire', kind: 'news', hedge: 'suspected'},
			{id: 'examplelab', url: 'https://lab.example.org/alerts/fixtureswap', title: 'Alert: FixtureSwap outflows', excerpt: 'Example Security Lab flagged outflows of about 1,400 ETH from FixtureSwap pools.', publishedUtc: '2026-11-23T16:30:00Z', tier: 'A', publisher: 'Example Security Lab', kind: 'blog'},
		],
		facts: [
			{text: 'DefiLlama lists a loss of $4,200,000.', sourceId: 'defillama-hacks', url: dlUrl, quote: 'reported loss $4,200,000', field: 'excerpt'},
			{text: 'DefiLlama classifies it as Key Compromise / Private Key Compromised.', sourceId: 'defillama-hacks', url: dlUrl, quote: 'Key Compromise / Private Key Compromised', field: 'excerpt'},
			{text: 'Example Wire headline, 2026-11-23:', sourceId: 'examplewire', url: 'https://news.example.com/fixtureswap', quote: 'FixtureSwap says attackers drained $4.5 million', field: 'title'},
			{text: 'A fact whose quote is not stored.', sourceId: 'examplelab', url: 'https://lab.example.org/alerts/fixtureswap', quote: 'not in the excerpt', field: 'excerpt'},
		],
	});
};

export const fixtureBridge = (): RadarIncident => {
	const dlUrl = dl('FixtureBridge', '2026-11-22');
	return incident({
		id: '2026-11-22-fixturebridge',
		protocol: 'FixtureBridge',
		type: 'bridge',
		evergreenTopic: 'bridge-security',
		chains: ['Solana', 'Ethereum'],
		score: {total: 75},
		reportedLosses: [{amountUsd: 900000, by: 'defillama-hacks', url: dlUrl, quote: 'reported loss $900,000', field: 'excerpt', tier: 'A'}],
		sources: [{id: 'defillama-hacks', url: dlUrl, title: 'DefiLlama hacks: FixtureBridge (2026-11-22)', excerpt: 'FixtureBridge · 2026-11-22 · reported loss $900,000 · Bridge & Cross-Chain / Message Spoofing · target: DeFi Protocol · chains: Solana, Ethereum', publishedUtc: null, tier: 'A', publisher: 'DefiLlama', kind: 'structured'}],
		facts: [{text: 'DefiLlama lists a loss of $900,000.', sourceId: 'defillama-hacks', url: dlUrl, quote: 'reported loss $900,000', field: 'excerpt'}],
	});
};

export const fixtureLend = (): RadarIncident =>
	incident({id: '2026-11-24-fixturelend', protocol: 'FixtureLend', title: 'FixtureLend: reported exploit (developing)', status: 'developing', score: {total: 90}, shortReady: {ready: false, missing: ['not confirmed', 'fewer than 2 independent sources']}, sources: [{id: 'examplewire', url: 'https://news.example.com/fixturelend', title: 'FixtureLend pauses contracts', excerpt: 'FixtureLend paused its contracts after an alert.', publishedUtc: '2026-11-24T05:00:00Z', tier: 'B', publisher: 'Example Wire', kind: 'news'}]});

export const fixturePhish = (): RadarIncident =>
	incident({id: '2026-11-23-fixturephish', protocol: 'FixturePhish', type: 'phishing', evergreenTopic: 'phishing', chains: [], score: {total: 85}, sources: [{id: 'examplewire', url: 'https://news.example.com/fixturephish', title: 'Phishing ads target wallet users', excerpt: 'A phishing campaign used search ads.', publishedUtc: '2026-11-23T05:00:00Z', tier: 'B', publisher: 'Example Wire', kind: 'news'}]});

export const radarFile = (incidents: RadarIncident[], date = DATE, mode = 'live') => ({
	schema: 'zoora-security/radar@1',
	radarVersion: '0.1',
	runDate: date,
	generatedUtc: `${date}T10:40:00Z`,
	mode,
	userAgent: 'NewsRadar/0.1',
	top: incidents.slice(0, 5),
	alsoSeen: incidents.slice(5),
	unclustered: [],
	corrections: [],
	sources: [],
	counts: {},
});

const row = (name: string, date: string, amount: number | null, classification: string, technique: string, target = 'DeFi Protocol', chains = ['Ethereum']) => {
	const head = [name, date, amount ? `reported loss $${amount.toLocaleString('en-US')}` : 'loss not stated', `${classification} / ${technique}`, `target: ${target}`, `chains: ${chains.join(', ')}`].join(' · ');
	return {
		categories: [classification, technique],
		eventDate: date,
		excerpt: `${head} · A free-text description that mentions a person and an address 0xabc.`,
		key: `defillama:${name}@${date}`,
		kind: 'structured',
		lead: '',
		publishedUtc: null,
		record: {amount, bridgeHack: false, chains, classification, defillamaId: null, name, parentProtocolId: null, returnedFunds: null, targetType: target, technique},
		referenceUrl: null,
		title: `DefiLlama hacks: ${name} (${date})`,
		url: dl(name, date),
	};
};

export const defillamaCache = (fetchedUtc = '2026-11-24T10:41:00Z') => ({
	etag: null,
	fetchedUtc,
	httpStatus: 200,
	lastModified: null,
	parserVersion: '2026-11-24.1',
	sourceId: 'defillama-hacks',
	url: 'https://api.llama.fi/hacks',
	v: 1,
	items: [
		row('FixtureSwap', '2026-11-23', 4200000, 'Key Compromise', 'Private Key Compromised'),
		row('FixtureBridge', '2026-11-22', 900000, 'Bridge & Cross-Chain', 'Message Spoofing', 'DeFi Protocol', ['Solana', 'Ethereum']),
		row('ExampleDex', '2026-11-20', 12000000, 'Key Compromise', 'Hot Wallet Key Compromised', 'CEX'),
		row('SampleVault', '2026-11-10', 300000, 'Protocol Logic', 'Rounding Error'),
		row('DemoLend', '2026-11-05', null, 'Oracle Manipulation', 'Spot Price Manipulation'),
		row('TestChain', '2026-11-01', 2500000, 'Key Compromise', 'Private Key Compromised', 'Chain'),
		row('MockPerps', '2026-10-28', 150000, 'Access Control', 'Improper Access Control'),
		row('OldThing', '2026-09-01', 99000000, 'Key Compromise', 'Private Key Compromised'),
		row('SomeoneWallet', '2026-11-12', 50000, 'Social Engineering', 'Phishing', 'Individual'),
	],
});

/** A radar day with all four incidents, written where prepare reads it, plus the DefiLlama cache. */
export const seedRadarDay = (root: string, incidents: RadarIncident[] = [fixtureSwap(), fixtureBridge(), fixtureLend(), fixturePhish()], cache: unknown = defillamaCache()): void => {
	writeJsonFile(join(root, 'content', 'zoora-security', 'radar', `${DATE}.json`), radarFile(incidents));
	if (cache) writeJsonFile(join(root, '.cache', 'radar', 'sources', 'defillama-hacks.json'), cache);
};

// ---- a recording fake runner ----

export type Call = ExecRequest & {tool: string};
export type Handler = (req: ExecRequest, tool: string) => Partial<ExecResult> | void;

/** Names the tool a call is for, from its argv. */
export const toolOf = (req: ExecRequest): string => {
	const a = [req.cmd, ...req.args].join(' ');
	if (a.includes('radar.py')) return 'radar';
	if (a.includes('scripts/claims/check.ts')) return 'general-gate';
	if (a.includes('scripts/news/gate.ts')) return 'news-gate';
	if (a.includes('voice/build.py')) return 'voice';
	if (a.includes('remotion render')) return 'render';
	if (a.includes('remotion still')) return 'still';
	if (a.includes('thumbnails.ts')) return 'thumbnails';
	if (a.includes('publish-kit/cli.ts')) return 'publish-kit';
	if (req.cmd === 'ffprobe') return 'ffprobe';
	if (req.cmd === 'ffmpeg') return 'poster';
	if (a.includes('tools/announcer')) return 'announcer';
	if (a.includes('tools/threat-brief')) return 'threat-brief';
	return 'other';
};

export const fakeExec = (handlers: Record<string, Handler> = {}): {exec: Exec; calls: Call[]} => {
	const calls: Call[] = [];
	const exec: Exec = (req) => {
		const tool = toolOf(req);
		calls.push({...req, tool});
		const h = handlers[tool];
		const r = (h ? h(req, tool) : undefined) ?? {};
		return {status: 0, stdout: '', stderr: '', durationMs: 1, ...r};
	};
	return {exec, calls};
};

export const argAfter = (req: ExecRequest, flag: string): string | undefined => {
	const i = req.args.indexOf(flag);
	return i >= 0 ? req.args[i + 1] : undefined;
};

// ---- a fictional show-format storyboard for the FixtureSwap brief ----

export const SLUG = '2026-11-24-fixtureswap';

export const goodStoryboard = (analysisDetail: string, analysisMethod = 'Counted the stored DefiLlama rows of the window (brief.json, facts t1..t7).') => {
	const waiver = {rule: 'factual', reason: 'Own-data analysis a1 (method in storyboard.analysis), checked by the news gate R7.'};
	return {
		version: 1,
		channel: 'zoora-security',
		slug: SLUG,
		lang: 'en',
		sourceLang: 'en',
		title: 'DefiLlama lists FixtureSwap among November hacks',
		fiction: false,
		news: {format: 'daily-short', incidentIds: ['2026-11-23-fixtureswap']},
		scenes: [
			{id: 's01', type: 'hook', segment: 'coldOpen', narration: 'Example Security Lab flagged outflows of about {1,400 ETH|fourteen hundred E T H} from FixtureSwap pools [src:examplelab].', onScreen: {kicker: 'Threat Brief', title: 'FixtureSwap outflows flagged'}, zoo: {expression: 'neutral'}, badger: {present: true}, badgerBeats: [{reaction: 'lookUp'}]},
			{
				id: 's02',
				type: 'talk',
				segment: 'headline',
				narration: 'DefiLlama lists the loss at {$4,200,000|four point two million dollars} [src:defillama-hacks]. Example Wire reports that FixtureSwap said attackers drained {$4.5 million|four point five million dollars} from its pools [src:examplewire].',
				onScreen: {title: 'The reported loss', loss: '$4,200,000', lossAlt: '$4.5 million'},
				rekt: {usd: 4200000, source: 'defillama-hacks', alt: {usd: 4500000, source: 'examplewire'}},
			},
			{id: 's03', type: 'talk', segment: 'howItWorked', narration: "According to DefiLlama's entry, the protocol said a deployer key was used to upgrade its pool contract [src:defillama-hacks].", onScreen: {title: 'How it worked', nodes: ['A deployer key', 'The pool contract'], links: ['upgraded']}, diagram: {nodes: ['key', 'contract']}},
			{
				id: 's04',
				type: 'talk',
				segment: 'desk',
				narration: "Our check: DefiLlama lists 7 incidents in the 30 days from October 26 to November 24. As listed by DefiLlama, FixtureSwap's loss is the second-largest of the 6 with a stated figure.",
				onScreen: {title: 'Our check', bullets: ['7 incidents in 30 days', 'Second-largest of 6']},
				badger: {present: true},
				badgerBeats: [{reaction: 'shocked'}],
				claimWaivers: [
					{match: 'DefiLlama lists 7 incidents', ...waiver},
					{match: 'second-largest of the 6', ...waiver},
				],
			},
			{id: 's05', type: 'talk', segment: 'badgerRedFlag', narration: "Badger's red flag: one key that can change a contract on its own.", onScreen: {flag: 'One key that can change a contract'}, badgerBeats: [{reaction: 'judge'}]},
			{id: 's06', type: 'talk', segment: 'zooOneFix', narration: "Zoo's one fix, for teams: put upgrade keys in a multisig with a time delay.", onScreen: {fix: 'Upgrade keys in a multisig', detail: 'Add a time delay.'}},
			{id: 's07', type: 'cta', narration: "Subscribe for tomorrow's Threat Brief.", onScreen: {button: 'Subscribe'}},
		],
		sources: [
			{id: 'examplelab', title: 'Alert: FixtureSwap outflows (Example Security Lab)', url: 'https://lab.example.org/alerts/fixtureswap', accessed: DATE, status: 'verified'},
			{id: 'defillama-hacks', title: 'DefiLlama hacks: FixtureSwap (2026-11-23) (DefiLlama)', url: 'https://api.llama.fi/hacks#FixtureSwap%402026-11-23', accessed: DATE, status: 'verified'},
			{id: 'examplewire', title: 'FixtureSwap says attackers drained $4.5 million (Example Wire)', url: 'https://news.example.com/fixtureswap', accessed: DATE, status: 'verified'},
			{id: 'defillama-30d', title: 'DefiLlama hacks: incidents dated 2026-10-26 to 2026-11-24 (DefiLlama)', url: 'https://api.llama.fi/hacks', accessed: DATE, status: 'verified'},
		],
		analysis: [{id: 'a1', kind: 'comparison', basis: 'own-data', detail: analysisDetail, sourceIds: ['defillama-30d'], sceneIds: ['s04'], method: analysisMethod}],
		shorts: [{id: 'short1', sceneIds: ['s01', 's02', 's03', 's04', 's05', 's06', 's07'], title: 'DefiLlama lists FixtureSwap among November hacks'}],
		thumbnails: [
			{id: 't1', text: 'One key,\nwhole pool', expression: 'worried', badger: true, badgerReaction: 'worried'},
			{id: 't2', text: 'FixtureSwap drained', expression: 'neutral', badger: true, badgerReaction: 'judge'},
			{id: 't3', text: 'Lock upgrade keys', expression: 'shocked', badger: false},
		],
	};
};
