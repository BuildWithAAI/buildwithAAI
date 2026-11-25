import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {describe, it} from 'node:test';
import {buildBrief, howText, lintBriefText, pickIncidents} from './brief.ts';
import {FIXES, fixFor} from './concepts.ts';
import {lintRendered} from './lint.ts';
import {checkRadar, type Radar, type RadarIncident} from './radar.ts';
import {renderEmailHtml, renderMarkdown} from './render.ts';
import {hasErrors, loadAllowlist, makeAllow, type NameAllow} from './safety.ts';

// The AI-security lane in the Threat Brief: the radar's lane is read, the top-3 picker keeps an AI story when the
// radar has one, AI stories get their own One Fix, and an AI incident with no dollar figure passes every rule.

const fixture = (name: string): string => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
const NOW = new Date('2026-11-24T10:00:00Z');
const allow: NameAllow = loadAllowlist(fixture('allowlist.json')).allow ?? makeAllow([]);
const raw = JSON.parse(readFileSync(fixture('radar.json'), 'utf8'));

/** A fictional AI incident: an outlet's report of a prompt injection in a coding agent, no loss figure. */
const aiIncident = (over: Record<string, unknown> = {}) => ({
	id: '2026-11-24-exampleagent',
	title: 'ExampleAgent: prompt injection',
	protocol: 'ExampleAgent',
	// the radar knows the subject (an AI product on its list), so the brief may name it
	subjectKnown: true,
	lane: 'ai',
	chains: [],
	type: 'prompt-injection',
	dateUtc: '',
	firstSeenUtc: '2026-11-24',
	reportedLosses: [],
	status: 'confirmed',
	statusReason: 'confirmed: unhedged primary statement, post-mortem or security-firm research: fixture-lab',
	evergreenTopic: 'ai-security',
	notes: [],
	mechanismKnown: true,
	score: {total: 40},
	sources: [
		{id: 'fixture-lab', url: 'https://lab.fixture.test/research/exampleagent', title: 'Hidden instructions on web pages hijacked the ExampleAgent coding agent', excerpt: 'The vendor shipped a fix after the lab reported the prompt injection.', publishedUtc: '2026-11-24T08:00:00Z', tier: 'A', publisher: 'Fixture Lab', kind: 'news'},
	],
	facts: [{text: 'Fixture Lab headline, 2026-11-24:', sourceId: 'fixture-lab', url: 'https://lab.fixture.test/research/exampleagent', quote: 'Hidden instructions on web pages hijacked the ExampleAgent coding agent', field: 'title'}],
	...over,
});

const radarWith = (top: unknown[], alsoSeen: unknown[] = []): Radar => {
	const read = checkRadar({...raw, top, alsoSeen});
	assert.deepEqual(read.errors, []);
	return read.radar as Radar;
};

describe('Threat Brief, AI lane', () => {
	it('reads the lane, and an older radar file without one as crypto', () => {
		const radar = radarWith([aiIncident(), raw.top[0]]);
		assert.deepEqual(radar.top.map((i) => i.lane), ['ai', 'crypto']);
	});

	it('keeps an AI story in the top 3 when the radar has one below the crypto ones', () => {
		const radar = radarWith(raw.top, [aiIncident()]);
		const pool: RadarIncident[] = [...radar.top, ...radar.alsoSeen];
		const picked = pickIncidents(pool, 3);
		assert.equal(picked.length, 3);
		assert.deepEqual(picked.map((i) => i.lane), ['crypto', 'crypto', 'ai']);
		assert.equal(picked[0], pool[0], 'the top incident stays first');
		assert.deepEqual(pickIncidents(pool, 1), [pool[0]], 'one incident: the best one');
		const crypto = pool.filter((i) => i.lane === 'crypto');
		assert.deepEqual(pickIncidents(crypto, 3), crypto.slice(0, 3), 'one lane only: the radar order');
		// and the other way round: a crypto story is kept below AI ones
		const aiPool = checkRadar({...raw, top: [aiIncident(), aiIncident({id: 'b'}), aiIncident({id: 'c'}), raw.top[0]], alsoSeen: []}).radar as Radar;
		assert.deepEqual(pickIncidents(aiPool.top, 3).map((i) => i.lane), ['ai', 'ai', 'crypto']);
	});

	it('gives an AI story its own One Fix', () => {
		assert.equal(fixFor('ai-security', 'prompt-injection').topic, 'ai-security');
		assert.equal(fixFor(null, 'deepfake-fraud').text, FIXES['ai-scams']);
		assert.equal(fixFor(null, 'ai-phishing').topic, 'ai-scams');
		assert.equal(fixFor(null, 'ai-assisted-attack').topic, 'ai-attacks');
		assert.equal(fixFor(null, 'ai-washing').topic, 'ai-washing');
		const {brief} = buildBrief(radarWith([aiIncident(), ...raw.top]), {allow, now: NOW, show: null});
		assert.equal(brief.fix.topic, 'ai-security');
		assert.doesNotMatch(brief.fix.text, /recovery phrase|private key/i, 'not the crypto default');
	});

	it('builds and lints an AI incident with no dollar figure', () => {
		const {brief, allow: extended} = buildBrief(radarWith([aiIncident(), ...raw.top]), {allow, now: NOW, show: null});
		const inc = brief.incidents[0]!;
		assert.equal(inc.protocol, 'ExampleAgent');
		assert.equal(inc.label, 'CONFIRMED');
		assert.deepEqual(inc.losses, []);
		assert.match(howText(inc.how), /Fixture Lab reports: “Hidden instructions on web pages hijacked the ExampleAgent coding agent”/);
		assert.equal(hasErrors(lintBriefText(brief, extended)), false, JSON.stringify(lintBriefText(brief, extended).filter((f) => f.level === 'error')));
		const md = renderMarkdown(brief);
		assert.doesNotMatch(md, /Reported loss: \$0|\$0\b/);
		assert.equal(hasErrors(lintRendered(md, renderEmailHtml(brief), brief, {allow: extended})), false);
	});
});
