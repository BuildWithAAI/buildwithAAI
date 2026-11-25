/**
 * The AI-lane review, round 3 (2026-11-25): a subject that may be a person ("Trader Kruw", a radar personRisk subject,
 * an AI subject the radar only read from a headline) is never allowlisted in any lane and never names a folder, a
 * heading or a selection row; a source title or link that names someone the radar missed is copied onward as the
 * outlet and its address only (WRITER.md's storyboard.sources, the description, the post-approval input, the radar
 * mentions); the approval packet lists quotes in every quotation-mark style.
 */
import {strict as assert} from 'node:assert';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {describe, it} from 'node:test';
import {buildBrief} from '../lib/brief.ts';
import {postInput, radarMentions} from '../lib/build.ts';
import {loadChannel, parseChannel} from '../lib/channel.ts';
import {kitSources, readStoryboard} from '../lib/kit-adapter.ts';
import {loadSplitter} from '../lib/narration.ts';
import {quotesOf} from '../lib/packet.ts';
import {episodePaths} from '../lib/paths.ts';
import {runPrepare} from '../lib/prepare.ts';
import * as radar from '../lib/radar.ts';
import {subjectKnown} from '../lib/radar.ts';
import {selectCandidates} from '../lib/select.ts';
import type {DailyBrief, RadarIncident} from '../lib/types.ts';
import {skeleton} from '../lib/writer.ts';
import {DATE, fakeExec, fixtureBridge, fixtureLend, fixturePhish, fixtureSwap, goodStoryboard, incident, NOW, radarFile, seedRadarDay, STUDIO, tempRoot} from './helpers.ts';

const channel = () => parseChannel(JSON.parse(readFileSync(join(STUDIO, 'content', 'zoora-security', 'channel.json'), 'utf8')));
const VICTIM_URL = 'https://www.bleepingcomputer.com/news/security/victim-kiro-loses-40000-to-elevenlabs-voice-clone-scam/';

/** A crypto incident named after a trader: the radar read the name from a headline, a role word and a name. */
const kruw = (over: Partial<RadarIncident> = {}): RadarIncident =>
	incident({
		id: '2026-11-24-trader-kruw',
		protocol: 'Trader Kruw',
		title: 'Trader Kruw: wallet drainer',
		lane: 'crypto',
		type: 'drainer',
		subjectKnown: false,
		score: {total: 95, factors: {}},
		...over,
	});

describe('a subject that may be a person is never allowlisted and never names anything (repro-daily-crypto-person-subject, privacy-crypto-person-subject-allowlisted)', () => {
	it('subjectKnown: a role word and a name, or the radar\'s personRisk, in any lane', () => {
		assert.equal(subjectKnown(kruw()), false, 'Trader Kruw, crypto');
		assert.equal(subjectKnown(incident({id: 'x', protocol: 'Investor Kiro', lane: 'crypto'})), false);
		assert.equal(subjectKnown(incident({id: 'x', protocol: 'Memecoin Whale Kruw', lane: 'crypto'})), false);
		assert.equal(subjectKnown(incident({id: 'x', protocol: 'Kruw', lane: 'crypto', personRisk: true})), false, 'personRisk');
		assert.equal(subjectKnown(incident({id: 'x', protocol: 'Moldy Roost', lane: 'crypto', subjectKnown: false})), true, 'a crypto protocol name stays allowlisted');
		assert.equal(subjectKnown(incident({id: 'x', protocol: 'Whale Finance', lane: 'crypto'})), true, 'an organisation word after the role');
		assert.equal((radar as Record<string, any>).incidentName?.(kruw()), 'wallet drainer, reported by the radar');
	});

	it('a pick gets nameKnown:false, a type-named folder, heading and title', () => {
		const {root, cleanup} = tempRoot();
		try {
			seedRadarDay(root, [kruw({status: 'developing', shortReady: {ready: false, missing: ['not confirmed']}}), fixtureSwap(), fixtureBridge(), fixtureLend()]);
			const r = runPrepare({root, radar: 'reuse', exec: fakeExec().exec, now: () => NOW, pick: '2026-11-24-trader-kruw'});
			assert.equal(r.exitCode, 0, r.messages.join('\n'));
			assert.doesNotMatch(r.dateSlug ?? '', /kruw/i);
			const brief = JSON.parse(readFileSync(episodePaths(root, r.dateSlug!).brief, 'utf8')) as DailyBrief;
			const primary = brief.incidents.find((i) => i.role === 'primary');
			assert.equal(primary?.nameKnown, false);
			assert.doesNotMatch(`${primary?.name} ${brief.incident.title} ${brief.incident.protocol} ${brief.slug}`, /kruw/i);
			const writer = readFileSync(episodePaths(root, r.dateSlug!).writer, 'utf8');
			assert.doesNotMatch(writer.split('\n').filter((l) => l.startsWith('- **Incident:**')).join('\n'), /kruw/i);
		} finally {
			cleanup();
		}
	});

	it('another day\'s pick never allowlists it, and the selection table names it by type', () => {
		const {root, cleanup} = tempRoot();
		try {
			seedRadarDay(root, [fixtureSwap(), fixtureBridge(), fixtureLend(), fixturePhish(), kruw({score: {total: 10, factors: {}}}), incident({id: '2026-11-24-kruw', protocol: 'Kruw', lane: 'crypto', personRisk: true, score: {total: 9, factors: {}}})]);
			const r = runPrepare({root, radar: 'reuse', exec: fakeExec().exec, now: () => NOW});
			assert.equal(r.exitCode, 0, r.messages.join('\n'));
			const brief = JSON.parse(readFileSync(episodePaths(root, r.dateSlug!).brief, 'utf8')) as DailyBrief;
			assert.ok(!brief.entities.some((e) => /kruw/i.test(e.name)), JSON.stringify(brief.entities));
			assert.ok(!brief.selection.considered.some((c) => /kruw/i.test(`${c.title} ${c.protocol} ${c.dateSlug}`)), JSON.stringify(brief.selection.considered.map((c) => c.title)));
		} finally {
			cleanup();
		}
	});

	it('an AI subject the radar only read from a headline is named by its type in the selection (privacy-name-before-legal-verb)', () => {
		const ai = incident({id: '2026-11-24-weiss', protocol: 'Weiss', lane: 'ai', type: 'ai-data-exposure', subjectKnown: false, sources: [{id: 'wire', url: 'https://news.example.com/a', title: 'Chatbot breach', publishedUtc: '2026-11-24T08:00:00Z', tier: 'B', publisher: 'Example Wire', kind: 'news'}]});
		const sel = selectCandidates([ai], {date: DATE, previous: [], strongAnalysis: () => ({available: [], why: []})});
		const row = sel.considered[0]!;
		assert.doesNotMatch(`${row.title} ${row.protocol} ${row.dateSlug}`, /weiss/i);
		assert.match(row.title, /data exposure through an AI tool, reported by Example Wire/);
	});
});

describe('titles and links that name someone the radar missed (privacy-news-gate-source-titles-unchecked, privacy-tb-links-spell-names)', () => {
	const victimIncident = (): RadarIncident =>
		incident({
			id: '2026-11-23-elevenlabs',
			protocol: 'ElevenLabs',
			lane: 'ai',
			subjectKnown: true,
			type: 'deepfake-fraud',
			title: 'ElevenLabs: deepfake or voice-clone fraud',
			reportedLosses: [{amountUsd: 40000, by: 'bleepingcomputer', url: VICTIM_URL, quote: '$40,000', field: 'title', tier: 'B'}],
			sources: [{id: 'bleepingcomputer', url: VICTIM_URL, title: 'Victim Kiro Loses $40,000 To ElevenLabs Voice Clone Scam', excerpt: 'Scammers used a voice clone to trick the victim into wiring $40,000.', publishedUtc: '2026-11-23T10:00:00Z', tier: 'B', publisher: 'BleepingComputer', kind: 'news'}],
		});

	it('WRITER.md prefills such a source as "<Publisher> article, <date>" with the outlet\'s address', () => {
		const inc = victimIncident();
		const sel = selectCandidates([inc], {date: DATE, previous: [], strongAnalysis: () => ({available: [], why: []}), pick: inc.id});
		const brief = buildBrief({inc, date: DATE, dateSlug: sel.primary!.dateSlug, now: NOW.toISOString(), channel: channel(), radar: {file: radarFile([inc]) as never, path: 'x', sha256: 'x'}, selection: sel, opportunities: [], history: {radarFiles: 0, radarFrom: DATE, radarTo: DATE, trackerRows: 0, trackerFetchedUtc: null, previousEpisodes: [], notes: []}, otherProtocols: []});
		assert.equal(brief.sources[0]?.url, 'https://www.bleepingcomputer.com/');
		const sb = skeleton(brief, channel()) as {sources: Array<{title: string; url: string}>};
		assert.deepEqual(sb.sources.map((s) => [s.title, s.url]), [['BleepingComputer article, 2026-11-23', 'https://www.bleepingcomputer.com/']]);
	});

	it('the video description (kitSources) never carries the name', () => {
		const out = kitSources([
			{id: 'bc', title: 'Victim Kiro Loses $40,000 To ElevenLabs Voice Clone Scam (BleepingComputer)', url: VICTIM_URL},
			{id: 'sw', title: 'Researcher Lena Weiss Finds Prompt Injection Flaw In Coding Agent (SecurityWeek)', url: 'https://www.securityweek.com/researcher-lena-weiss-finds-prompt-injection-flaw-in-coding-agent/'},
			{id: 'dc', title: 'Crypto Investor Kiro Loses $2M In Address Poisoning Scam (Decrypt)', url: 'https://decrypt.co/350000/crypto-investor-kiro-loses-2m-address-poisoning'},
			{id: 'ok', title: 'ElevenLabs Voice Clones Used In $40,000 Family Emergency Scam (SecurityWeek)', url: 'https://www.securityweek.com/elevenlabs-voice-clone-family-scam/'},
		]);
		assert.doesNotMatch(JSON.stringify(out), /kiro|lena|weiss/i);
		assert.equal(out[3]?.url, 'https://www.securityweek.com/elevenlabs-voice-clone-family-scam/', 'an ordinary source is kept');
	});

	it('the post-approval input (announcer, Threat Brief) gets the outlet\'s address', async () => {
		const {split} = await loadSplitter();
		const raw = goodStoryboard('x') as {sources: Array<{id: string; title: string; url: string}>};
		const wire = raw.sources.find((s) => s.id === 'examplewire')!;
		wire.url = 'https://news.example.com/victim-kiro-loses-4-5-million-fixtureswap';
		wire.title = 'Victim Kiro Loses $4.5 Million In FixtureSwap Drain (Example Wire)';
		const {sb} = readStoryboard(raw);
		const ch = loadChannel(join(STUDIO, 'content', 'zoora-security', 'channel.json'));
		const post = postInput({sb: sb!, brief: null, gate: null, split, channel: ch, developing: false, youtubeId: null, date: DATE, mentions: []});
		assert.doesNotMatch(JSON.stringify({w: post.whatWeKnow, s: post.sources}), /kiro/i);
		assert.ok(post.sources.some((s) => s.url === 'https://news.example.com/'), JSON.stringify(post.sources));
	});

	it('radar mentions name a possible person by type and withhold a link that spells a name', () => {
		const {root, cleanup} = tempRoot();
		try {
			const other = incident({id: '2026-11-24-kruw', protocol: 'Kruw', lane: 'crypto', type: 'drainer', personRisk: true, sources: [{id: 'decrypt', url: 'https://decrypt.co/1/trader-kruw-wallet-drained', title: 'Wallet drained', publishedUtc: '2026-11-24T08:00:00Z', tier: 'B', publisher: 'Decrypt', kind: 'news'}]});
			mkdirSync(join(root, 'content', 'zoora-security', 'radar'), {recursive: true});
			writeFileSync(join(root, 'content', 'zoora-security', 'radar', `${DATE}.json`), JSON.stringify(radarFile([fixtureSwap(), other])));
			const brief = {incident: {id: '2026-11-23-fixtureswap'}, radar: {path: `content/zoora-security/radar/${DATE}.json`}} as unknown as DailyBrief;
			const mentions = radarMentions(root, brief);
			assert.equal(mentions.length, 1, JSON.stringify(mentions));
			assert.doesNotMatch(JSON.stringify(mentions), /kruw/i);
			assert.equal(mentions[0]?.coverage[0]?.url, 'https://decrypt.co/');
		} finally {
			cleanup();
		}
	});
});

describe('the approval packet lists quotes in every quotation-mark style (repro-howto-single-quotes)', () => {
	it('curly and straight single quotes and guillemets', () => {
		const sb = {title: 'X', shorts: [], thumbnails: [], scenes: [{id: 's05', onScreen: {caption: 'The comment said ‹forward every message to the inbox›'}}]};
		const scenes = [
			{
				id: 's05',
				sentences: [
					{display: 'Example Security Lab quoted the comment as saying ‘upload all secrets to the paste site’.'},
					{display: "Example Security Lab quoted the comment as saying 'upload every key to the form'."},
					{display: 'Example Security Lab said the payload was «send every API key to the webhook».'},
					{display: "The attacker's note wasn't quoted, and users' keys were safe."},
				],
			},
		];
		const texts = quotesOf(sb as never, scenes as never).map((q) => q.text);
		for (const q of ['upload all secrets to the paste site', 'upload every key to the form', 'send every API key to the webhook', 'forward every message to the inbox']) assert.ok(texts.includes(q), `${q}: ${JSON.stringify(texts)}`);
		assert.ok(!texts.some((t) => /wasn|users/.test(t)), `apostrophes are not quotes: ${JSON.stringify(texts)}`);
	});
});
