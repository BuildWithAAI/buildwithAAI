import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {describe, it} from 'node:test';
import {buildBrief, lintBriefText} from './brief.ts';
import {buildDailyBrief, checkPostInput, lintDailyBrief, renderDailyEmailHtml, renderDailyMarkdown} from './daily.ts';
import {lintRendered} from './lint.ts';
import {checkRadar, type Radar} from './radar.ts';
import {renderEmailHtml, renderMarkdown} from './render.ts';
import {FIXES, DEFAULT_FIX} from './concepts.ts';
import * as safety from './safety.ts';
import {extendAllow, hasErrors, isSafeQuote, loadAllowlist, makeAllow, scanText, type NameAllow} from './safety.ts';

// added in round 3: read through the module so each test fails on its own on older code
const looksPersonal = (name: string, allow?: NameAllow): boolean => (safety as Record<string, any>).looksPersonal(name, allow);
const slugNamesPerson = (url: string, headline?: string, allow?: NameAllow): boolean => (safety as Record<string, any>).slugNamesPerson(url, headline, allow);

// The AI-lane review, round 3 (2026-11-25): a role word with punctuation before the name, roles outside the old list,
// one-name appositions, "they", Title Case names before a person's verb or a legal verb, names in brackets, handles;
// links whose address spells a name the radar missed; crypto subjects that are people; paraphrased instructions to an
// AI. The subscriber email never carries the name, and ordinary headlines are still quoted.

const fixture = (name: string): string => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
const NOW = new Date('2026-11-24T10:00:00Z');
const allow: NameAllow = loadAllowlist(fixture('allowlist.json')).allow ?? makeAllow([]);
const raw = JSON.parse(readFileSync(fixture('radar.json'), 'utf8'));
const products = makeAllow(['ElevenLabs', 'ChatGPT', 'Claude', 'Claude Code', 'OpenAI Sora', 'AWS Kiro', 'Example Wire', 'Exchange'], [], [], ['claude', 'sora', 'kiro']);

describe('role words, punctuation, appositions and Title Case names (repro-tb-role-name-variants, regress-tb-titlecase-name-residual)', () => {
	it('refuses every variant the reviews found', () => {
		for (const headline of [
			'Victim, Kiro, Loses $40,000 To ElevenLabs Voice Clone Scam',
			'Victim—Kiro—Loses $40,000 To ElevenLabs Voice Clone Scam',
			'Victim (Kiro) Loses $40,000 To ElevenLabs Voice Clone Scam',
			'Victim «Kiro» Loses $40,000 To ElevenLabs Voice Clone Scam',
			'Victim: Kiro Loses $40,000 To ElevenLabs Voice Clone Scam',
			'victim kiro loses $40,000 to elevenlabs voice clone scam',
			'Nurse Kiro Loses $40,000 To ElevenLabs Voice Clone Scam',
			'Teacher Tanaka Loses $40,000 To Voice Clone Scam',
			'Grandson Kiro Tricked By ElevenLabs Voice Clone Scam',
			'Pastor Kiro Loses $40,000 To ElevenLabs Voice Clone Scam',
			'Elderly Kiro Loses $40,000 To ElevenLabs Voice Clone Scam',
			'Gamer Kiro Loses $40,000 To ElevenLabs Voice Clone Scam',
			'Cybercriminal Kiro Sold Stolen ChatGPT Accounts',
			'Doctor Kiro Loses $40,000 To ElevenLabs Voice Clone Scam',
			'Mother Of Two Kiro Loses $40,000 To ElevenLabs Voice Clone Scam',
			'Retired Teacher Claude Loses $40,000 To AI Voice Scam',
			'Kiro, A Retiree, Loses $40,000 To ElevenLabs Voice Clone Scam',
			'Sora, A Hacker, Sold Stolen ChatGPT Accounts',
			'Retiree’s Savings Gone: Kiro Loses $40,000 To ElevenLabs Voice Clone',
			'How Kiro Lost $40,000 To An ElevenLabs Voice Clone Scam',
			'Kiro Lost $40,000 To An ElevenLabs Voice Clone, Police Say',
			'Kiro Tanaka Loses $40,000 To Voice Clone Scam',
			'Kiro says they lost $40,000 to a cloned voice',
			'Claude, who lost $40,000 to a cloned voice, said he was devastated',
			'Kiro recounted how he lost $40,000 to a cloned voice',
			'Claude lost $40,000 to a cloned voice, he said',
			'Hacker «Sora» Sold Access Stolen With AI Phishing Kit',
			'Hacker, Sora, Sold Access Stolen With AI Phishing Kit',
			'Cybercriminal ‘Kiro’ Leaks Data Stolen From AI Chatbot Vendor',
			'Lena Weiss Arrested Over AI Chatbot Breach',
			'Tanaka Charged Over AI Deepfake Scam',
			'Kiro’s Savings Wiped Out By Voice Clone Call',
			'Teen Behind Kiberphant0m Persona Charged',
			'Kiro (72) Loses $40,000 To Voice Clone Scam',
			'72-Year-Old Kiro Loses $40,000 To Voice Clone Scam',
		]) {
			assert.equal(isSafeQuote(headline, 'Example Wire', products), false, headline);
		}
	});

	it('still quotes ordinary headlines', () => {
		for (const headline of [
			'ElevenLabs Voice Clones Used In $40,000 Family Emergency Scam',
			'Victim Loses $40,000 To Voice Clone Scam',
			'Researcher Finds Flaw In Coding Agent',
			'Hacker Group Claims Attack On AI Startup',
			'Victim Of AI Voice Clone Scam Loses $40,000',
			'Attacker Used Claude Code To Breach Developer Machines',
			'Developer Tools Exposed Secrets Of Thousands',
			'Judge Orders Exchange To Freeze Stolen Funds',
			'The CEO Says Funds Are Safe',
			'Prosecutors said he used ChatGPT to write phishing emails',
			'Hacker News Users Targeted With Fake AI Extension',
			'Developer Portal Exposed API Keys',
			'Student Loan Scam Uses AI Voice Clones',
		]) {
			assert.equal(isSafeQuote(headline, 'Example Wire', products), true, headline);
		}
		// a hedge phrase is a lower-case fragment, still quoted
		assert.equal(isSafeQuote('suspected compromise of the aggregate signing key', 'Fixture Firm', allow), true);
	});

	it('a name before a legal verb is an error in any text', () => {
		const codes = scanText('Prosecutors said Weiss was arrested on Monday.', {where: 't', allow}).filter((f) => f.level === 'error').map((f) => f.code);
		assert.ok(codes.includes('legal-name'), codes.join(', '));
		assert.deepEqual(scanText('Two suspects were arrested, according to the Justice Department.', {where: 't', allow}).filter((f) => f.code === 'legal-name'), []);
	});

	it('an allowed phrase of the day never hides a role and a name (privacy-crypto-person-subject-allowlisted)', () => {
		const day = extendAllow(allow, ['Investor Kiro', 'Trader Kruw']);
		for (const text of ['Investor Kiro lost $2 million, according to Decrypt.', 'Trader Kruw lost $1 million, CoinDesk reports.']) {
			const codes = scanText(text, {where: 't', allow: day}).filter((f) => f.level === 'error').map((f) => f.code);
			assert.ok(codes.includes('title-or-role'), `${text}: ${codes.join(', ')}`);
		}
		// a name in the allowlist file itself is an organisation (the exchange "Trader Joe")
		const file = makeAllow(['Trader Joe']);
		assert.equal(looksPersonal('Trader Joe', file), false);
		assert.equal(looksPersonal('Trader Kruw', file), true);
		assert.equal(looksPersonal('Memecoin Whale Kruw', file), true);
		assert.equal(looksPersonal('Whale Finance', file), false);
	});
});

describe('links whose address spells a name (privacy-tb-links-spell-names)', () => {
	it('the slug check reads role words, given names, ages and the headline\'s own names', () => {
		for (const [url, title] of [
			['https://www.bleepingcomputer.com/news/security/victim-kiro-loses-40000-to-elevenlabs-voice-clone-scam/', ''],
			['https://example.com/claude-72-loses-40000-to-ai-voice-clone-scam', ''],
			['https://example.com/lena-weiss-arrested-over-ai-chatbot-breach/', 'Lena Weiss Arrested Over AI Chatbot Breach'],
			['https://decrypt.co/350000/crypto-investor-kiro-loses-2m-address-poisoning', ''],
			['https://www.securityweek.com/researcher-lena-weiss-finds-prompt-injection-flaw-in-coding-agent/', ''],
		] as const) {
			assert.equal(slugNamesPerson(url, title, products), true, url);
		}
		for (const url of [
			'https://www.securityweek.com/elevenlabs-voice-clone-family-scam/',
			'https://example.com/hacker-group-claims-attack-on-ai-startup',
			'https://example.com/attacker-used-claude-code-to-breach-developer-machines',
			'https://example.com/victim-of-ai-voice-clone-scam-loses-40000',
			'https://wire.example.test/news/fixtureswap-drained',
		]) {
			assert.equal(slugNamesPerson(url, '', products), false, url);
		}
	});

	const victim = (title: string, url: string) => ({
		id: '2026-11-23-elevenlabs',
		title: 'ElevenLabs: deepfake or voice-clone fraud',
		protocol: 'ElevenLabs',
		subjectKnown: true,
		lane: 'ai',
		chains: [],
		type: 'deepfake-fraud',
		dateUtc: null,
		firstSeenUtc: '2026-11-23',
		reportedLosses: [{amountUsd: 40000, by: 'bleepingcomputer', url, quote: '$40,000', field: 'title', tier: 'B'}],
		status: 'confirmed',
		statusReason: 'confirmed: 2+ unhedged tier-B outlets with different origins: bleepingcomputer, securityweek',
		sources: [
			{id: 'bleepingcomputer', url, title, excerpt: 'Scammers used an ElevenLabs voice clone of a relative to trick the victim into wiring $40,000.', publishedUtc: '2026-11-23T10:00:00Z', tier: 'B', publisher: 'BleepingComputer', kind: 'news'},
			{id: 'securityweek', url: 'https://www.securityweek.com/elevenlabs-voice-clone-family-scam/', title: 'ElevenLabs Voice Clones Used In $40,000 Family Emergency Scam', excerpt: 'Scammers used ElevenLabs voice clones to defraud a family of $40,000.', publishedUtc: '2026-11-23T14:00:00Z', tier: 'B', publisher: 'SecurityWeek', kind: 'news'},
		],
		postMortemUrl: null,
		evergreenTopic: 'ai-scams',
		notes: [],
		mechanismKnown: true,
		facts: [
			{text: 'BleepingComputer headline, 2026-11-23:', sourceId: 'bleepingcomputer', url, quote: title, field: 'title'},
			{text: 'SecurityWeek headline, 2026-11-23:', sourceId: 'securityweek', url: 'https://www.securityweek.com/elevenlabs-voice-clone-family-scam/', quote: 'ElevenLabs Voice Clones Used In $40,000 Family Emergency Scam', field: 'title'},
		],
		score: {total: 73.4},
	});

	const draft = (incident: Record<string, unknown>): {all: string; brief: ReturnType<typeof buildBrief>['brief']; extended: NameAllow} => {
		const read = checkRadar({...raw, top: [incident, ...raw.top], alsoSeen: []});
		assert.deepEqual(read.errors, []);
		const {brief, allow: extended} = buildBrief(read.radar as Radar, {allow, now: NOW, show: null});
		return {all: `${renderMarkdown(brief)}\n${renderEmailHtml(brief)}\n${brief.subject}\n${brief.preview}`, brief, extended};
	};

	it('a radar draft never links to an address that spells the name, nor quotes the headline (comma and nurse variants)', () => {
		for (const [title, url] of [
			['Victim, Kiro, Loses $40,000 To ElevenLabs Voice Clone Scam', 'https://www.bleepingcomputer.com/news/security/victim-kiro-loses-40000-to-elevenlabs-voice-clone-scam/'],
			['Nurse Kiro Loses $40,000 To ElevenLabs Voice Clone Scam', 'https://www.bleepingcomputer.com/news/security/nurse-kiro-loses-40000-to-elevenlabs-voice-clone-scam/'],
			['Victim Kiro Loses $40,000 To ElevenLabs Voice Clone Scam', 'https://www.bleepingcomputer.com/news/security/victim-kiro-loses-40000-to-elevenlabs-voice-clone-scam/'],
		] as const) {
			const {all, brief, extended} = draft(victim(title, url));
			assert.doesNotMatch(all, /kiro/i, title);
			const shown = brief.incidents.find((i) => i.id === '2026-11-23-elevenlabs')!;
			assert.ok(shown.sources.some((s) => s.url === 'https://www.bleepingcomputer.com/' && /the article's address names a person/.test(s.text)), JSON.stringify(shown.sources));
			assert.ok(shown.losses.every((l) => !/kiro/i.test(l.url)), JSON.stringify(shown.losses));
			assert.equal(hasErrors([...lintBriefText(brief, extended), ...lintRendered(renderMarkdown(brief), renderEmailHtml(brief), brief, {allow: extended})]), false);
		}
	});

	it('the daily email withholds such links in facts, sources and also-on-the-radar coverage', () => {
		const base = JSON.parse(readFileSync(fixture('daily-input.json'), 'utf8'));
		const bad = 'https://www.bleepingcomputer.com/news/security/victim-kiro-loses-40000-to-elevenlabs-voice-clone-scam/';
		const {input, errors} = checkPostInput({
			...base,
			whatWeKnow: [{text: 'Scammers used a voice clone to take $40,000, according to BleepingComputer.', sources: [{publisher: 'BleepingComputer', url: bad}]}],
			sources: [...base.sources, {publisher: 'BleepingComputer', title: 'ElevenLabs voice clone scam', url: bad}],
			alsoOnRadar: [{name: 'ElevenLabs', status: 'developing', coverage: [{publisher: 'BleepingComputer', url: bad}]}],
		});
		assert.deepEqual(errors, []);
		const {brief, notes} = buildDailyBrief(input!, {allow, now: NOW, inputSha256: 'x'.repeat(64)});
		assert.doesNotMatch(`${renderDailyMarkdown(brief)}\n${renderDailyEmailHtml(brief)}`, /kiro/i);
		assert.ok(notes.some((n) => n.includes("goes to the outlet's address")), notes.join('\n'));
		assert.equal(hasErrors(lintDailyBrief(brief, allow)), false);
	});
});

describe('subjects that are people never name the email (repro-daily-crypto-person-subject, privacy-crypto-person-subject-allowlisted, repro-ai-subject-person-variants)', () => {
	const crypto = (protocol: string, extra: Record<string, unknown>, title: string, url: string) => ({
		id: `2026-11-23-${protocol.toLowerCase().replace(/\s+/g, '-')}`,
		title: `${protocol}: phishing`,
		protocol,
		lane: 'crypto',
		chains: [],
		type: 'phishing',
		dateUtc: '2026-11-23',
		reportedLosses: [{amountUsd: 2000000, by: 'decrypt', url, quote: '$2M', field: 'title', tier: 'B'}],
		status: 'confirmed',
		statusReason: 'confirmed: 2+ unhedged tier-B outlets with different origins: decrypt, the-defiant',
		sources: [
			{id: 'decrypt', url, title, excerpt: 'The wallet was drained after an address poisoning attack.', publishedUtc: '2026-11-23T10:00:00Z', tier: 'B', publisher: 'Decrypt', kind: 'news'},
			{id: 'the-defiant', url: 'https://thedefiant.io/news/hacks/address-poisoning-drains-2m', title: 'Address Poisoning Drains $2 Million From Wallet', excerpt: 'An address poisoning attack drained $2 million.', publishedUtc: '2026-11-23T12:00:00Z', tier: 'B', publisher: 'The Defiant', kind: 'news'},
		],
		postMortemUrl: null,
		evergreenTopic: 'phishing',
		notes: [],
		mechanismKnown: true,
		facts: [{text: 'Decrypt headline, 2026-11-23:', sourceId: 'decrypt', url, quote: title, field: 'title'}],
		score: {total: 90},
		...extra,
	});

	const all = (incident: Record<string, unknown>): string => {
		const read = checkRadar({...raw, top: [incident, ...raw.top], alsoSeen: []});
		assert.deepEqual(read.errors, []);
		const {brief} = buildBrief(read.radar as Radar, {allow, now: NOW, show: null});
		return `${renderMarkdown(brief)}\n${renderEmailHtml(brief)}\n${brief.subject}\n${brief.preview}`;
	};

	it('a crypto subject with a role word ("Investor Kiro") is named by its type', () => {
		const text = all(crypto('Investor Kiro', {subjectKnown: false}, 'Crypto Investor Kiro Loses $2M In Address Poisoning Scam', 'https://decrypt.co/350000/crypto-investor-kiro-loses-2m-address-poisoning'));
		assert.doesNotMatch(text, /kiro/i);
		assert.match(text, /phishing, reported by Decrypt/);
	});

	it('a crypto subject the radar flags as a possible person (personRisk) is named by its type', () => {
		const text = all(crypto('Kruw', {subjectKnown: false, personRisk: true}, 'Kruw Wallet Drained of $1 Million After Malicious Approval', 'https://decrypt.co/1/kruw-wallet-drained'));
		assert.doesNotMatch(text, /kruw/i);
	});

	it('an AI subject the radar could not confirm never reaches the subject line', () => {
		const text = all({
			...crypto('Sora', {subjectKnown: false, lane: 'ai', type: 'deepfake-fraud'}, 'Teenager Sora Arrested Over AI Deepfake Scam', 'https://example.com/teenager-sora-arrested-over-ai-deepfake-scam'),
			title: 'Sora: deepfake or voice-clone fraud',
		});
		assert.doesNotMatch(text, /\bsora\b/i);
	});
});

describe('an instruction an attack gave an AI, paraphrased (repro-howto-paraphrase-verbs, regress-r5-howto-paraphrase)', () => {
	const errors = (text: string): string[] => scanText(text, {where: 't', allow: products}).filter((f) => f.level === 'error').map((f) => f.code);
	it('every paraphrase is an error', () => {
		for (const text of [
			'The README got Copilot to upload the env file to a paste site.',
			'The README tricked Copilot into uploading the env file to a paste site.',
			'The README caused Copilot to upload the env file to a paste site.',
			'The README had Copilot upload the env file to a paste site.',
			'The README told Copilot it should upload the env file to a paste site.',
			'The README directs Copilot to upload the env file to a paste site.',
			'The README convinced Copilot to upload the env file to a paste site.',
			'The README told CURSOR to upload the env file to a paste site.',
			"The README told Windsurf's Cascade agent to upload the env file to a paste site.",
			'The README told the Copilot coding agent to upload the env file to a paste site.',
			'The README told GitHub Copilot, the coding agent, to upload the env file to a paste site.',
			'The README told Copilot to commit the env file to a public repo.',
			'The README told Copilot to attach the env file to an issue.',
			'The README told Copilot to curl the env file to a remote server.',
			'The README told the coding agent to base64 the env file and append it to a URL.',
			'Hidden text in the README makes Copilot upload the env file to a paste site.',
			'The hidden text tricked the coding agent into sending every API key to the attacker.',
			'The poisoned issue got the agent to send the API keys to an attacker server.',
			'The page convinced the assistant to email the inbox contents to the attacker.',
			'The hidden comment instructed GitHub Copilot Chat to encode private code into image URLs.',
			'The injected text had Claude Code upload the env file to a paste site.',
			'Hidden instructions caused the agent to send the keys to a webhook.',
		]) {
			assert.ok(errors(text).includes('told-the-agent'), text);
		}
		// a payload in single quotes or guillemets is a quoted instruction too
		assert.ok(errors("Example Wire reports the comment said 'upload all secrets to the paste site'.").includes('ai-quoted-instruction'));
		assert.ok(errors('Example Wire reports the payload was «send every API key to the webhook».').includes('ai-quoted-instruction'));
	});

	it('the user\'s own request, the concept and the One Fix texts pass', () => {
		for (const text of [
			'A user asked the assistant to summarize the page.',
			'Never let Copilot run commands from files you did not write.',
			'Hidden instructions on a web page made the coding agent read secrets, according to Example Wire.',
			...Object.values(FIXES),
			DEFAULT_FIX,
		]) {
			assert.deepEqual(errors(text).filter((c) => c === 'told-the-agent' || c === 'ai-quoted-instruction'), [], text);
		}
	});
});
