import assert from 'node:assert/strict';
import {existsSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import {test} from 'node:test';
import {crossBacklogProblems, parseBacklog} from '../lib/backlog.ts';
import {loadConfig, parseConfig} from '../lib/config.ts';
import {claimWords, loadFactBank, supportedBy, unsupportedWording, type BankFact} from '../lib/factbank.ts';
import {channelTopics, loadAll} from '../lib/load.ts';
import type {Backlog} from '../lib/types.ts';
import {UsageError} from '../lib/util.ts';
import {REAL_CONFIG, STUDIO, testBacklog, testIdea} from './helpers.ts';

const config = loadConfig(REAL_CONFIG, STUDIO);
const channel = (id: string) => config.channels.find((c) => c.channel === id) as (typeof config.channels)[number];
const parse = (ch: string, ideas: Array<Record<string, unknown>>): Backlog => parseBacklog(testBacklog(ch, ideas), `content/${ch}/backlog.json`, channel(ch), 'sha');
const refusal = (fn: () => unknown, pattern: RegExp) => assert.throws(fn, (e: unknown) => e instanceof UsageError && e.reasons.some((r) => pattern.test(r)));

test('the committed backlogs validate, with no warnings', () => {
	const {backlogs, warnings} = loadAll(STUDIO, REAL_CONFIG);
	assert.deepEqual(warnings, []);
	assert.deepEqual(backlogs.map((b) => b.channel), ['zoora-ai', 'zoora-security']);
	for (const b of backlogs) assert.ok(b.ideas.length >= 12 && b.ideas.length <= 20, `${b.channel} has ${b.ideas.length} ideas (12-20 wanted)`);
});

test('the two planned Zoora AI stories are in the backlog, pilot first', () => {
	const {backlogs} = loadAll(STUDIO, REAL_CONFIG);
	const ai = backlogs.find((b) => b.channel === 'zoora-ai') as Backlog;
	const byPriority = [...ai.ideas].sort((a, b) => a.priority - b.priority);
	assert.equal(byPriority[0].title, 'POV: You become a top caller on Pump.fun');
	assert.equal(byPriority[0].research, 'content/zoora-ai/pumpfun-top-caller/research.md');
	assert.equal(byPriority[1].title, 'POV: You created an autonomous AI trading agent hedge fund');
	assert.equal(byPriority[1].research, 'content/zoora-ai/ai-agent-hedge-fund/research.md');
	assert.deepEqual(new Set(ai.ideas.map((i) => i.format)), new Set(['pov-story', 'explainer']));
});

test('every idea carries what a writer needs: facts (fact-bank ids or "research needed"), risks, en + es/pt-br, an evergreen topic', () => {
	const {backlogs} = loadAll(STUDIO, REAL_CONFIG);
	for (const b of backlogs) {
		for (const idea of b.ideas) {
			const at = `${b.channel}/${idea.id}`;
			assert.ok(idea.facts.length >= 2, `${at}: facts`);
			assert.ok(idea.facts.every((f) => (f.status === 'fact-bank') === !!f.factId), `${at}: fact-bank status iff an id`);
			assert.ok(idea.risks.length >= 1, `${at}: risks`);
			assert.deepEqual(idea.languages, {master: 'en', dubs: ['es', 'pt-br']}, `${at}: languages`);
			assert.ok(idea.evergreenTopic, `${at}: topic`);
			assert.equal(idea.week, null, `${at}: nothing is pinned until the owner approves a week`);
			assert.equal(idea.status, 'idea');
			if (b.channel === 'zoora-ai' && idea.format === 'pov-story') assert.ok(idea.shortIdeas.length >= 4, `${at}: up to 4 Shorts are cut from a story`);
		}
	}
});

test('security ideas use the evergreen topics the daily news links (content/zoora-security/channel.json) and both formats', (t) => {
	const {backlogs} = loadAll(STUDIO, REAL_CONFIG);
	const sec = backlogs.find((b) => b.channel === 'zoora-security') as Backlog;
	const topics = channelTopics(STUDIO, 'zoora-security');
	if (!topics) return t.skip('content/zoora-security/channel.json (the daily workflow\'s file) is not in this checkout');
	assert.ok(topics.size >= 10);
	for (const idea of sec.ideas) assert.ok(topics.has(idea.evergreenTopic), `${idea.id}: ${idea.evergreenTopic}`);
	assert.deepEqual(new Set(sec.ideas.map((i) => i.format)), new Set(['explainer', 'scam-of-the-week']));
	const explainerTopics = new Set(sec.ideas.filter((i) => i.format === 'explainer').map((i) => i.evergreenTopic));
	assert.deepEqual(explainerTopics, topics, 'one explainer per planned evergreen topic');
	assert.ok(sec.ideas.some((i) => i.evergreenTopic === 'ai-security' && i.format === 'scam-of-the-week'), 'AI security is in scope (owner, 2026-11-24)');
});

test('the backlogs name no private individuals and make no income promises', () => {
	for (const ch of ['zoora-ai', 'zoora-security']) {
		const text = readFileSync(join(STUDIO, 'content', ch, 'backlog.json'), 'utf8');
		assert.doesNotMatch(text, /\[named person\]/, 'research redactions must not leak into the backlog');
		assert.doesNotMatch(text, /0x[0-9a-fA-F]{8,}/, 'no wallet addresses');
		assert.doesNotMatch(text, /https?:\/\//, 'no links: sources live in research files and the fact bank');
		assert.doesNotMatch(text, /[$€£]\s?\d|\d+(\.\d+)?\s?%/, 'no figures: they live, checked, in the research files and the fact bank');
		assert.doesNotMatch(text.replaceAll('never \\"ZOO\\"', ''), /\bZOO\b/, 'the host is "Zoo" (the rule that says never "ZOO" is the only use)');
		for (const phrase of [/guaranteed returns?(?! ')/i, /passive income/i, /get rich/i]) {
			for (const line of text.split('\n').filter((l) => phrase.test(l))) assert.match(line, /never|not|no |only|warning|pitch|regulator|red flag|banned|risks|'/i, `unguarded income phrase: ${line.trim()}`);
		}
	}
});

test('every fact-bank id the backlogs cite is in the fact bank, verified', (t) => {
	const bankPath = join(STUDIO, 'content', 'facts', 'facts.jsonl');
	const bank = loadFactBank(existsSync(bankPath) ? bankPath : null);
	if (!bank.facts) return t.skip('content/facts/facts.jsonl (the fact bank workflow\'s file) is not in this checkout');
	const {backlogs} = loadAll(STUDIO, REAL_CONFIG);
	const cited = backlogs.flatMap((b) => b.ideas.flatMap((i) => i.facts.filter((f) => f.factId).map((f) => ({at: `${b.channel}/${i.id}`, id: f.factId as string}))));
	assert.ok(cited.length >= 30, 'the planned stories reuse the seeded facts');
	for (const c of cited) {
		const fact = bank.facts.get(c.id);
		assert.ok(fact, `${c.at}: ${c.id} is not in the fact bank`);
		assert.notEqual(fact?.verification, 'unverified', `${c.at}: ${c.id} is unverified`);
	}
});

test('titles, Short angles and fact needs carry no figure or superlative that their cited facts do not state', (t) => {
	const bankPath = join(STUDIO, 'content', 'facts', 'facts.jsonl');
	const bank = loadFactBank(existsSync(bankPath) ? bankPath : null);
	if (!bank.facts) return t.skip('content/facts/facts.jsonl (the fact bank workflow\'s file) is not in this checkout');
	const {backlogs} = loadAll(STUDIO, REAL_CONFIG);
	const found = backlogs.flatMap((b) => b.ideas.flatMap((i) => unsupportedWording(i, bank.facts as Map<string, BankFact>).map((u) => `${b.channel}/${u.where}: "${u.text}" (${u.words.join(', ')})`)));
	assert.deepEqual(found, []);
});

test('the wording check: figures, number words and superlatives need a cited statement that says them', () => {
	const fact = (id: string, text: string): BankFact => ({id, text, tags: [], verification: 'direct-read', verifiedAt: '2026-11-24', recheckAfter: '2027-11-24', sources: [], usage: []});
	const bank = new Map([
		['result', fact('result', "Qwen3 Max finished first in Alpha Arena Season 1, and OpenAI's model finished last after losing more than half of its stake.")],
		['sec', fact('sec', 'In March 2024, the SEC charged two investment advisers with AI washing.')],
		['coingecko', fact('coingecko', '12.8 million of them (68.67%) made their last bonding-curve trade on launch day.')],
		['followers', fact('followers', 'Followers of 10 small-cap callers were collectively down about $926,000.')],
	]);
	const idea = (title: string, shortIdeas: string[], facts: Array<{need: string; factId: string | null}>) => ({id: 'x', title, shortIdeas, facts});
	// the 2026-11-24 review's case: "four of six" is in no cited statement
	assert.deepEqual(unsupportedWording(idea('T', ['Four of six AI traders lost real money'], [{need: 'n', factId: 'result'}]), bank).map((u) => u.words), [['four', 'six']]);
	assert.deepEqual(unsupportedWording(idea('T', ['The AI that finished last lost more than half'], [{need: 'n', factId: 'result'}]), bank), []);
	// a need is checked against its own fact only
	assert.deepEqual(unsupportedWording(idea('T', [], [{need: "The SEC's first AI-washing cases", factId: 'sec'}]), bank).map((u) => [u.where, u.words]), [['x facts[0].need', ['first']]]);
	assert.deepEqual(unsupportedWording(idea('T', [], [{need: 'The SEC charged two advisers (March 2024)', factId: 'sec'}]), bank), []);
	assert.deepEqual(unsupportedWording(idea('T', [], [{need: 'Alpha Arena: how it ended (most models lost money)', factId: 'result'}]), bank).map((u) => u.words), [['most']]);
	// "most" is supported by a share above half; a number word by the same figure in digits
	assert.ok(supportedBy('most', [bank.get('coingecko')?.text ?? '']));
	assert.ok(supportedBy('ten', [bank.get('followers')?.text ?? '']));
	assert.ok(!supportedBy('twelve', [bank.get('followers')?.text ?? '']));
	assert.ok(supportedBy('926000', [bank.get('followers')?.text ?? '']));
	// no cited fact: every figure and superlative waits for research; idioms and the video's own structure are not claims
	assert.deepEqual(unsupportedWording(idea('The oldest trick in the book', ['Send one, get two'], [{need: 'n', factId: null}]), bank).map((u) => u.words), [['oldest'], ['two']]);
	assert.deepEqual(claimWords('Your new best friend has a track record'), []);
	assert.deepEqual(claimWords('Three questions for any AI pitch'), []);
	assert.deepEqual(claimWords('Check the holders first'), []);
	assert.deepEqual(claimWords('Why the first and last characters are not enough'), []);
	assert.deepEqual(claimWords('The first AI-washing case cost $400,000'), ['400000', 'first']);
});

test('slugs are unique across both channels (claim reports are keyed by slug)', () => {
	const {backlogs} = loadAll(STUDIO, REAL_CONFIG);
	assert.deepEqual(crossBacklogProblems(backlogs), []);
	const a = parse('zoora-ai', [testIdea('shared-slug', 'pov-story', 1)]);
	const b = parse('zoora-security', [testIdea('shared-slug', 'explainer', 1)]);
	assert.equal(crossBacklogProblems([a, b]).length, 1);
});

test('malformed ideas are refused with the reason', () => {
	refusal(() => parse('zoora-ai', [testIdea('x1', 'scam-of-the-week', 1)]), /format "scam-of-the-week" is not one of pov-story, explainer/);
	refusal(() => parse('zoora-ai', [testIdea('x1', 'pov-story', 1, {facts: []})]), /facts must list/);
	refusal(() => parse('zoora-ai', [testIdea('x1', 'pov-story', 1, {facts: [{need: 'n', factId: null, status: 'fact-bank'}]})]), /status "fact-bank" but no factId/);
	refusal(() => parse('zoora-ai', [testIdea('x1', 'pov-story', 1, {facts: [{need: 'n', factId: 'f1', status: 'research needed'}]})]), /has a factId, so its status must be "fact-bank"/);
	refusal(() => parse('zoora-ai', [testIdea('x1', 'pov-story', 1, {languages: {master: 'en', dubs: ['fr']}})]), /fr has no male Kokoro voice/);
	refusal(() => parse('zoora-ai', [testIdea('x1', 'pov-story', 1, {languages: {master: 'es', dubs: []}})]), /languages.master must be "en"/);
	refusal(() => parse('zoora-ai', [testIdea('x1', 'pov-story', 1, {week: '2026-W60'})]), /week must be null or an ISO week/);
	refusal(() => parse('zoora-ai', [testIdea('x1', 'pov-story', 1, {risks: []})]), /risks must list/);
	refusal(() => parse('zoora-ai', [testIdea('x1', 'pov-story', 1, {title: 'A <b>bold</b> title'})]), /title must be 1-100 characters with no < or >/);
	refusal(() => parse('zoora-ai', [testIdea('x1', 'pov-story', 1, {angle: 'Too short.'})]), /angle must say/);
	refusal(() => parse('zoora-ai', [testIdea('x1', 'pov-story', 1), testIdea('x1', 'pov-story', 2)]), /idea id "x1" is used twice/);
	refusal(() => parse('zoora-ai', [testIdea('x1', 'pov-story', 1, {research: '../../etc/passwd'})]), /research must be null or content/);
	refusal(() => parseBacklog(testBacklog('zoora-security', [testIdea('x1', 'explainer', 1)]), 'b.json', channel('zoora-ai'), 'sha'), /"channel" must be "zoora-ai"/);
});

test('batch settings are validated: zone, slots, formats and prefixes', () => {
	const base = JSON.parse(readFileSync(REAL_CONFIG, 'utf8')) as Record<string, unknown>;
	const bad = (patch: (c: Record<string, unknown>) => void, pattern: RegExp) => {
		const c = JSON.parse(JSON.stringify(base)) as Record<string, unknown>;
		patch(c);
		refusal(() => parseConfig(c, 'config.json', STUDIO, REAL_CONFIG, 'sha'), pattern);
	};
	bad((c) => (c.timeZone = 'Mars/Olympus'), /not an IANA time zone/);
	bad((c) => (c.startWeek = '2026-W99'), /startWeek/);
	bad((c) => ((c.channels as Array<Record<string, unknown>>)[0].long = [{day: 'Funday', time: '11:00', formats: ['pov-story']}]), /long\[0\] needs/);
	bad((c) => ((c.channels as Array<Record<string, unknown>>)[0].long = [{day: 'Mon', time: '25:00', formats: ['pov-story']}]), /long\[0\] needs/);
	bad((c) => ((c.channels as Array<Record<string, unknown>>)[0].long = [{day: 'Mon', time: '11:00', formats: ['podcast']}]), /unknown formats: podcast/);
	bad((c) => ((c.channels as Array<Record<string, unknown>>)[1].prefix = 'ai'), /prefix "ai" is used by two channels/);
	bad((c) => (((c.channels as Array<Record<string, unknown>>)[0].formats as Record<string, Record<string, unknown>>)['pov-story'].entry = 'src/evil.ts'), /entry must be one of/);
	bad((c) => (c.dateNotes = {'2026-13-01': 'x'}), /dateNotes/);
	const ok = parseConfig(base, 'config.json', STUDIO, REAL_CONFIG, 'sha');
	assert.equal(ok.timeZone, 'America/Chicago', 'the owner\'s zone (CLAUDE.md, 2026-11-24)');
	assert.equal(ok.startWeek, '2026-W49');
});
