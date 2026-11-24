import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {describe, test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {runRules} from '../lib/rules.ts';

const NEWS = join(fileURLToPath(import.meta.url), '..', '..');
const GOOD = join(NEWS, 'fixtures', 'zoora-security', 'good-fixtureswap-drain');
const ALLOW = JSON.parse(readFileSync(join(NEWS, 'allowlist.json'), 'utf8'));
const load = (f: string) => JSON.parse(readFileSync(join(GOOD, f), 'utf8'));

type J = Record<string, any>;
const run = (mutate: (sb: J, brief: J) => void = () => {}, opts: {allow?: J; corrections?: unknown} = {}) => {
	const sb = load('storyboard.json');
	const brief = load('brief.json');
	mutate(sb, brief);
	const out = runRules({storyboard: sb, brief, corrections: opts.corrections ?? null, allowlist: opts.allow ?? ALLOW, slug: sb.slug});
	const errors = out.findings.filter((f) => f.severity === 'error').map((f) => f.code);
	const warnings = out.findings.filter((f) => f.severity === 'warning').map((f) => f.code);
	return {out, errors, warnings};
};
const scene = (sb: J, id: string) => sb.scenes.find((s: J) => s.id === id);
const addFact = (brief: J, id: string, sourceId: string, text: string) => {
	const src = brief.sources.find((s: J) => s.id === sourceId);
	src.excerpts = [...(src.excerpts ?? (src.excerpt ? [src.excerpt] : [])), text];
	delete src.excerpt;
	brief.facts.push({id, text, sourceIds: [sourceId], excerpts: [{sourceId, text}], incidentId: 'inc-fixtureswap'});
};

describe('the passing fixture', () => {
	test('no errors, no warnings, every claim traced, deterministic', () => {
		const a = run();
		assert.deepEqual(a.errors, []);
		assert.deepEqual(a.warnings, []);
		assert.equal(a.out.claims.length, 6);
		assert.ok(a.out.claims.every((c) => c.ok && c.factId && c.attribution));
		assert.deepEqual(JSON.stringify(run().out), JSON.stringify(a.out));
	});
});

describe('R1 facts', () => {
	test('dropping the source qualifier ("about") is a warning, not an error', () => {
		const r = run((sb) => {
			scene(sb, 's03').narration = scene(sb, 's03').narration.replace('says about {1,400 ETH', 'says {1,400 ETH');
		});
		assert.deepEqual(r.errors, []);
		assert.ok(r.warnings.includes('R1.dropped-qualifier'));
	});
	test('an averaged loss figure fails with the averaging hint', () => {
		const r = run((sb) => {
			scene(sb, 's04').narration = 'On average, FixtureLend and FixtureSwap lost {$3.65M|three point six five million dollars} each, as listed by Example Hack Tracker [src:src-tracker].';
		});
		const f = r.out.findings.find((x) => x.code === 'R1.number-not-in-excerpt');
		assert.ok(f);
		assert.match(f!.fix, /never averaged/);
	});
	test('the radar fact text must agree with its own excerpt', () => {
		const r = run((_, brief) => {
			brief.facts[0].text = 'FixtureSwap says attackers drained $4.5 million from its liquidity pools.';
		});
		assert.ok(r.errors.includes('R1.fact-number-not-in-excerpt'));
	});
	test('a source with status "unverified" fails', () => {
		assert.ok(run((sb) => (sb.sources[0].status = 'unverified')).errors.includes('R1.unverified-source'));
	});
});

describe('R2 developing', () => {
	test('the label must say DEVELOPING', () => {
		const r = run((sb) => {
			sb.news.developing = {label: 'BREAKING'};
			scene(sb, 's01').onScreen.title = 'FixtureSwap reports $4.2M drain';
		});
		assert.ok(r.errors.includes('R2.label-text'));
		assert.ok(r.errors.includes('R2.no-visible-label'));
	});
	test('a field-only label warns that the renderer does not draw it yet', () => {
		const r = run((sb) => (scene(sb, 's01').onScreen.title = 'FixtureSwap reports $4.2M drain'));
		assert.deepEqual(r.errors, []);
		assert.ok(r.warnings.includes('R2.field-not-drawn'));
	});
	test('a confirmed incident needs no label', () => {
		const r = run((sb, brief) => {
			for (const i of brief.incidents) i.status = 'confirmed';
			delete sb.news.developing;
			scene(sb, 's01').narration = scene(sb, 's01').narration.replace('This is a developing story. ', '');
			scene(sb, 's01').onScreen.title = 'FixtureSwap reports $4.2M drain';
		});
		assert.deepEqual(r.errors, []);
		assert.deepEqual(r.out.developing.incidents, []);
	});
});

describe('R3 attribution', () => {
	test('an attribution to someone the cited source does not name fails', () => {
		const r = run((sb) => {
			scene(sb, 's02').narration = scene(sb, 's02').narration.replace("According to FixtureSwap's preliminary review", 'According to Example Wire');
		});
		assert.ok(r.errors.includes('R3.attribution-unsupported'));
	});
	test('a threat-group name needs an attribution in the same sentence', () => {
		const r = run((sb) => (scene(sb, 's05').narration += ' Lazarus Group is behind this.'));
		assert.ok(r.errors.includes('R3.unsourced'));
	});
	test('a scene that hides the sources card must say its sources aloud', () => {
		const r = run((sb) => {
			scene(sb, 's03').showSources = false;
			scene(sb, 's03').narration = 'About {1,400 ETH|fourteen hundred E T H} left the pools for a newly funded address [src:src-lab].';
		});
		assert.ok(r.errors.includes('R3.sources-hidden'));
	});
	test('titles never accuse', () => {
		assert.ok(run((sb) => (sb.title = 'FixtureSwap rug pull?')).errors.includes('R3.short-unattributed'));
	});
});

describe('R4 officials', () => {
	const allow = {...ALLOW, officials: [{name: 'Avery Example', role: 'commissioner', agency: 'Example Police Bureau', sourceUrl: 'https://police.example/r/1'}]};
	test('an allowlisted official is still refused when no cited law-enforcement source names them', () => {
		const r = run((sb) => (scene(sb, 's03').narration += ' Commissioner Avery Example is watching.'), {allow});
		assert.ok(r.errors.includes('R4.official-unsupported'));
	});
});

describe('R5 how-to', () => {
	test('a defensive checklist is fine; the same list with attack steps is not', () => {
		const ok = run((sb) => (scene(sb, 's05').onScreen.bullets = ['1. Verify the address', '2. Use a hardware wallet']));
		assert.deepEqual(ok.errors, []);
		const bad = run((sb) => (scene(sb, 's05').onScreen.bullets = ['1. Phish a signer', '2. Drain the pools']));
		assert.ok(bad.errors.includes('R5.step-list'));
		assert.ok(bad.errors.includes('R5.numbered-list'));
	});
	test('a sequence of attack steps across a scene', () => {
		const r = run((sb) => {
			scene(sb, 's05').narration = 'First, attackers phish a signer. Then they upgrade the contract. Finally, they drain the pools.';
		});
		assert.ok(r.errors.includes('R5.step-sequence'));
	});
	test('AI security: prompt-injection strings and voice-clone how-tos', () => {
		const r = run((sb) => {
			scene(sb, 's05').narration = 'The page said ignore all previous instructions. Here is how to clone a voice in minutes.';
		});
		assert.ok(r.errors.includes('R5.injection-string'));
		assert.ok(r.errors.includes('R5.how-to'));
	});
});

describe('R6 speculation', () => {
	test('a hedge is allowed only when the cited source itself says it', () => {
		const said = run((sb, brief) => {
			addFact(brief, 'f7', 'src-lab', 'Example Security Lab said the outflows were likely routed through a known drainer kit.');
			scene(sb, 's03').narration += ' Example Security Lab says the outflows were likely routed through a known drainer kit [src:src-lab].';
		});
		assert.ok(!said.errors.some((c) => c.startsWith('R6')), said.errors.join(','));
		const unsaid = run((sb) => {
			scene(sb, 's03').narration += ' Example Security Lab says the funds were likely bridged to another network [src:src-lab].';
		});
		assert.ok(unsaid.errors.includes('R6.likely'));
	});
	test('"allegedly" needs a named source; a question headline implies an accusation', () => {
		assert.ok(run((sb) => (scene(sb, 's05').narration += ' The keys were allegedly sold.')).errors.includes('R6.reportedly'));
		assert.ok(run((sb) => (sb.thumbnails[0].text = 'INSIDE JOB?')).errors.includes('R6.question-headline'));
	});
});

describe('R7 analysis', () => {
	test('restating a fact is not analysis; a source-based comparison needs two sources', () => {
		const r = run((sb) => {
			sb.analysis = [{id: 'a1', kind: 'comparison', basis: 'source', detail: 'FixtureSwap says attackers drained $4.2 million from its liquidity pools.', sourceIds: ['src-wire'], sceneIds: ['s01']}];
		});
		assert.ok(r.errors.includes('R7.restates-fact'));
		assert.ok(r.errors.includes('R7.needs-two-points'));
	});
	test('a weekly round-up needs a fund-flow analysis', () => {
		assert.ok(run((sb) => (sb.news.format = 'weekly-roundup')).errors.includes('R7.roundup-needs-fund-flow'));
	});
	test('own-data analysis without a method, or with one nobody can reproduce, is an error', () => {
		assert.ok(run((sb) => delete sb.analysis[0].method).errors.includes('R7.no-method'));
		assert.ok(run((sb) => (sb.analysis[0].method = 'We looked at the data carefully.')).errors.includes('R7.method-not-reproducible'));
	});
});

describe('R8 corrections', () => {
	test('an invalid corrections file fails the gate', () => {
		assert.ok(run(() => {}, {corrections: {version: 1, corrections: [{id: 'x'}]}}).errors.includes('R8.corrections-file'));
	});
	test('a correction text that names a person fails', () => {
		const corrections = {version: 1, corrections: [{id: 'c1', slug: 'good-fixtureswap-drain', date: '2026-11-24', correct: 'Jordan Sample says the loss was $4.2 million.', sourceIds: ['src-wire'], status: 'pending'}]};
		assert.ok(run(() => {}, {corrections}).errors.includes('R8.correction-text'));
	});
});

describe('R9 price talk', () => {
	test('mechanism words and safety tips are fine', () => {
		const r = run((sb) => {
			scene(sb, 's05').narration += ' Oracle price manipulation is a different bug class. Never share your seed phrase, and not financial advice.';
		});
		assert.deepEqual(r.errors, []);
	});
	test('price moves, advice, income claims and wallet calls to action fail', () => {
		const r = run((sb) => {
			scene(sb, 's05').narration += ' The token price fell sharply. Time to buy, guaranteed returns. Connect your wallet to claim your airdrop.';
		});
		for (const c of ['R9.price', 'R9.advice', 'R9.income', 'R9.cta']) assert.ok(r.errors.includes(c), c);
	});
	test('a quoted scam call to action is education, not a call to action', () => {
		const r = run((sb) => (scene(sb, 's05').narration += ' The fake site said "connect your wallet to claim your airdrop" and drained visitors.'));
		assert.ok(!r.errors.includes('R9.cta'), r.errors.join(','));
	});
});

describe('INPUT', () => {
	test('missing brief, broken markup', () => {
		const sb = load('storyboard.json');
		sb.scenes[1].narration = 'broken {markup';
		const out = runRules({storyboard: sb, brief: null, corrections: null, allowlist: ALLOW, slug: sb.slug});
		const codes = out.findings.map((f) => f.code);
		assert.ok(codes.includes('INPUT.brief-missing'));
		assert.ok(codes.includes('INPUT.markup'));
	});
});
