import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdirSync, mkdtempSync, readFileSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {describe, test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {runGate} from '../lib/run.ts';
import type {FixtureCase} from '../fixtures/build-fixtures.ts';

const NEWS = join(fileURLToPath(import.meta.url), '..', '..');
const STUDIO = join(NEWS, '..', '..');
const ROOT = join(NEWS, 'fixtures', 'zoora-security');
const CASES: FixtureCase[] = JSON.parse(readFileSync(join(ROOT, 'cases.json'), 'utf8')).cases;
const ALLOW = JSON.parse(readFileSync(join(NEWS, 'allowlist.json'), 'utf8'));
const NOW = '2026-11-24T14:00:00Z';
const tmp = () => mkdtempSync(join(tmpdir(), 'news-gate-'));

const allowlistWith = (officials: NonNullable<FixtureCase['officials']>): string => {
	const p = join(tmp(), 'allowlist.json');
	writeFileSync(p, JSON.stringify({...ALLOW, officials}));
	return p;
};
const gate = (slug: string, extra: Partial<Parameters<typeof runGate>[0]> = {}) =>
	runGate({slug, studioRoot: STUDIO, contentRoot: ROOT, outDir: tmp(), generalGate: 'off', now: NOW, ...extra});
const failing = (r: ReturnType<typeof gate>) => r.result.rules.filter((x) => x.status === 'fail').map((x) => x.rule);

describe('fixtures', () => {
	test('are up to date with build-fixtures.ts', () => {
		const r = spawnSync(process.execPath, [join(NEWS, 'fixtures', 'build-fixtures.ts'), '--check'], {encoding: 'utf8'});
		assert.equal(r.status, 0, r.stderr);
	});
	test('cover every rule with a deliberately bad storyboard', () => {
		for (const rule of ['INPUT', 'R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'R8', 'R9', 'R10'])
			assert.ok(CASES.some((c) => c.expect.includes(rule) || c.expectWithoutOfficials?.includes(rule)), `no bad fixture for ${rule}`);
	});
});

describe('every fixture case fails exactly the rules it was built to fail', () => {
	for (const c of CASES) {
		test(`${c.slug}: ${c.about}`, () => {
			const run = gate(c.slug, c.officials ? {allowlistPath: allowlistWith(c.officials)} : {});
			const r = run.result;
			assert.deepEqual(failing(run), c.expect, r.findings.filter((f) => f.severity === 'error').map((f) => `${f.code}: ${f.message}`).join('\n'));
			const codes = r.findings.map((f) => f.code);
			for (const code of c.codes) assert.ok(codes.includes(code), `missing ${code}; got ${codes.join(', ')}`);
			assert.equal(r.verdict, c.expect.length ? 'fail' : 'pass');
			// one fix hint per failure
			for (const f of r.findings) assert.ok(f.fix && f.fix.length > 10, `${f.code} has no fix hint`);
			// the report files
			assert.ok(run.mdPath?.endsWith(`news-${c.slug}.md`) && run.jsonPath?.endsWith(`news-${c.slug}.json`));
			const json = JSON.parse(readFileSync(run.jsonPath!, 'utf8'));
			assert.equal(json.verdict, r.verdict);
			assert.equal(json.gate, 'news-claim-gate');
			const md = readFileSync(run.mdPath!, 'utf8');
			assert.ok(md.startsWith(`# News claim gate: ${r.verdict.toUpperCase()} · ${c.slug}`));
			if (c.expect.length) {
				assert.ok(md.includes('## Fix these'));
				assert.equal((md.match(/\n {3}Fix: /g) ?? []).length, r.counts.errors + r.counts.warnings);
			}
			if (c.officials) {
				const without = gate(c.slug);
				assert.deepEqual(failing(without), c.expectWithoutOfficials);
			}
		});
	}
});

describe('the passing fixture report', () => {
	test('shows the claims, the developing label, the analysis and the pinned correction', () => {
		const md = gate('good-fixtureswap-drain').markdown;
		assert.match(md, /\| s01 \| FixtureSwap says attackers drained \$4\.2M from its liquidity pools \(developing\) \| src-wire \| f1 \| FixtureSwap \| yes \|/);
		assert.match(md, /Developing: inc-fixtureswap\. Label: news\.developing \+ s01 onScreen\.title\. Said aloud in: s01\./);
		assert.match(md, /\*\*a1\*\* · pattern · own-data · sources src-tracker · presented in s04/);
		assert.match(md, /Correction \(2026-11-24\): At 00:07 we said: "FixtureSwap lost \$4\.8 million"\. FixtureSwap says attackers drained \$4\.2 million from its liquidity pools, according to Example Wire\. Source: Example Wire \(https:\/\/news\.example\.com/);
	});
	test('is byte-for-byte reproducible', () => {
		assert.equal(gate('good-fixtureswap-drain').markdown, gate('good-fixtureswap-drain').markdown);
	});
});

describe('general claim gate integration', () => {
	const studioWith = (code: string) => {
		const root = tmp();
		mkdirSync(join(root, 'scripts', 'claims'), {recursive: true});
		writeFileSync(join(root, 'scripts', 'claims', 'check.ts'), code);
		return root;
	};
	const allowlistPath = join(NEWS, 'allowlist.json');
	test('a failing general gate fails the news gate', () => {
		const r = gate('good-fixtureswap-drain', {studioRoot: studioWith("console.error('c2: unverified source'); process.exit(1);\n"), allowlistPath, generalGate: 'auto'}).result;
		assert.equal(r.verdict, 'fail');
		assert.equal(r.generalGate.status, 'failed');
		assert.ok(r.findings.some((f) => f.code === 'GEN.failed'));
	});
	test('a passing general gate leaves the news verdict alone', () => {
		const r = gate('good-fixtureswap-drain', {studioRoot: studioWith('process.exit(0);\n'), allowlistPath, generalGate: 'auto'}).result;
		assert.equal(r.verdict, 'pass');
		assert.equal(r.generalGate.status, 'passed');
	});
	test('not found is a warning in auto mode and an error in require mode', () => {
		const empty = tmp();
		assert.equal(gate('good-fixtureswap-drain', {studioRoot: empty, allowlistPath, generalGate: 'auto'}).result.verdict, 'pass');
		assert.equal(gate('good-fixtureswap-drain', {studioRoot: empty, allowlistPath, generalGate: 'require'}).result.verdict, 'fail');
	});
});

describe('CLI (node scripts/news/gate.ts)', () => {
	const cli = (args: string[]) => spawnSync(process.execPath, [join(NEWS, 'gate.ts'), ...args], {encoding: 'utf8'});
	const common = () => ['--content-root', ROOT, '--out', tmp(), '--general-gate', 'off', '--now', NOW];
	test('pass exits 0, fail exits 1 with a fix line per error, usage exits 2', () => {
		const ok = cli(['good-fixtureswap-drain', ...common()]);
		assert.equal(ok.status, 0, ok.stdout + ok.stderr);
		assert.match(ok.stdout, /^news gate: PASS good-fixtureswap-drain/);
		assert.equal(ok.stderr, '', 'no warnings printed');
		const bad = cli(['zoora-security/bad-r1-number', ...common()]);
		assert.equal(bad.status, 1);
		assert.match(bad.stdout, /\[R1\] s01 narration: "\$4\.5M" is not in the stored excerpt/);
		assert.equal((bad.stdout.match(/\n {6}fix: /g) ?? []).length, (bad.stdout.match(/\n {2}\[/g) ?? []).length);
		assert.equal(cli([]).status, 2);
		assert.equal(cli(['../escape', ...common()]).status, 2);
		assert.equal(cli(['good-fixtureswap-drain', '--general-gate', 'maybe']).status, 2);
	});
	test('a storyboard path works, and --json prints the result', () => {
		const r = cli([join(ROOT, 'bad-r9-price', 'storyboard.json'), '--json', ...common()]);
		assert.equal(r.status, 1);
		const json = JSON.parse(r.stdout);
		assert.equal(json.slug, 'bad-r9-price');
		assert.ok(json.findings.some((f: {code: string}) => f.code === 'R9.price-chart'));
	});
	test('a radar daily file works as --brief with --incident', () => {
		const dir = tmp();
		const incident = JSON.parse(readFileSync(join(ROOT, 'good-radar-incident', 'brief.json'), 'utf8'));
		const daily = join(dir, '2026-11-24.json');
		writeFileSync(daily, JSON.stringify({schema: 'zoora-security/radar@1', top: [incident, {...incident, id: 'x', protocol: 'OtherProto'}], alsoSeen: []}));
		const r = cli(['good-radar-incident', '--brief', daily, '--incident', incident.id, ...common()]);
		assert.equal(r.status, 0, r.stdout);
		const missing = cli(['good-radar-incident', '--brief', daily, ...common()]);
		assert.equal(missing.status, 1);
		assert.match(missing.stdout, /pass --incident/);
	});
	test('a missing storyboard fails closed with a report', () => {
		const out = tmp();
		const r = cli(['no-such-episode', '--content-root', ROOT, '--out', out, '--general-gate', 'off']);
		assert.equal(r.status, 1);
		assert.match(readFileSync(join(out, 'news-no-such-episode.md'), 'utf8'), /storyboard\.json: not found/);
	});
});
