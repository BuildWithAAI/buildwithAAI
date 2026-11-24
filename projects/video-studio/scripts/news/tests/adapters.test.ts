import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdirSync, mkdtempSync, readFileSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {describe, test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {factDeveloping, normalizeBrief} from '../lib/brief.ts';
import {addCorrection, emptyCorrections, pinnedCommentText, todayIn, validateCorrections} from '../lib/corrections.ts';
import {discoverGeneralGate, runGeneralGate} from '../lib/general-gate.ts';
import type {Correction} from '../lib/types.ts';

const NEWS = join(fileURLToPath(import.meta.url), '..', '..');
const FIX = join(NEWS, 'fixtures', 'zoora-security');
const tmp = () => mkdtempSync(join(tmpdir(), 'news-gate-'));

describe('brief.json reader', () => {
	test('the task shape {id, text, sourceIds[], excerpts[]} with string excerpts', () => {
		const {brief, problems} = normalizeBrief({facts: [{id: 'f1', text: 'X lost $1M.', sourceIds: ['a', 'b'], excerpts: ['A says $1M', 'B says $1M']}]});
		assert.deepEqual(problems, []);
		assert.deepEqual(brief?.facts[0].excerpts, [
			{sourceId: 'a', text: 'A says $1M'},
			{sourceId: 'b', text: 'B says $1M'},
		]);
	});
	test('variants: sources as an id map, excerpt objects, publisher from the host', () => {
		const {brief} = normalizeBrief({
			sources: {cd: {url: 'https://www.coindesk.com/x', excerpt: 'short'}},
			facts: [{id: 'f1', text: 't', sources: 'cd', excerpts: [{source: 'cd', quote: 'short'}]}],
		});
		assert.equal(brief?.sources[0].publisher, 'CoinDesk');
		assert.deepEqual(brief?.facts[0].sourceIds, ['cd']);
		assert.equal(brief?.facts[0].excerpts[0].sourceId, 'cd');
	});
	test('fails closed: unknown status words count as developing; missing fields are errors', () => {
		const r = normalizeBrief({incidents: [{id: 'i', name: 'P', status: 'probably fine'}], facts: [{id: 'f', text: 't', sourceIds: ['s'], excerpts: ['e'], incidentId: 'i'}]});
		assert.equal(r.brief?.incidents[0].developing, true);
		assert.ok(r.problems.some((p) => p.msg.includes('treated as developing')));
		assert.equal(factDeveloping(r.brief!, r.brief!.facts[0]), true);
		const bad = normalizeBrief({facts: [{text: 'no id'}, {id: 'x'}]});
		assert.equal(bad.brief, null);
		assert.ok(bad.problems.filter((p) => p.level === 'error').length >= 3);
	});
	test('an over-long excerpt is a warning (store short excerpts only)', () => {
		const r = normalizeBrief({facts: [{id: 'f', text: 't', sourceIds: ['s'], excerpts: ['x'.repeat(281)]}]});
		assert.ok(r.problems.some((p) => p.level === 'warning' && p.msg.includes('281 characters')));
	});
	test('radar daily file: one incident by id, unique source ids, title facts use the title, excerpt facts added', () => {
		const radarIncident = JSON.parse(readFileSync(join(FIX, 'good-radar-incident', 'brief.json'), 'utf8'));
		const daily = {schema: 'zoora-security/radar@1', top: [radarIncident, {...radarIncident, id: 'other', protocol: 'OtherProto'}], alsoSeen: []};
		const none = normalizeBrief(daily);
		assert.equal(none.brief, null, 'two incidents and no --incident is an error');
		assert.ok(none.problems[0].msg.includes('pass --incident'));
		const {brief} = normalizeBrief(daily, {incidentId: radarIncident.id});
		assert.ok(brief);
		assert.deepEqual(
			brief!.sources.map((s) => s.id),
			['src-wire', 'src-pm', 'src-lab', 'src-tracker', 'src-tracker-2'],
		);
		assert.equal(brief!.incidents[0].name, 'FixtureSwap');
		assert.equal(brief!.incidents[0].developing, true);
		assert.ok(brief!.facts.some((f) => f.id === 'e1' && f.text.startsWith('FixtureSwap said attackers drained')));
		// the other incidents' protocols, and the names that open structured tracker records ("FixtureLend | 2026-10-02 | ...")
		assert.deepEqual(brief!.entities, [{name: 'OtherProto', kind: 'protocol'}, {name: 'FixtureLend', kind: 'protocol'}]);
		const lendFact = brief!.facts.find((f) => f.text.includes('FixtureLend'));
		assert.deepEqual(lendFact?.sourceIds, ['src-tracker']);
	});
});

describe('corrections.json', () => {
	const ok: Correction = {id: 'c1', slug: 'ep', date: '2026-11-25', correct: 'FixtureSwap says the loss was $4.2 million.', sourceIds: ['src-wire'], status: 'pending', wrong: 'We said $4.8 million', timestamp: '01:23'};
	test('valid file, pending corrections warn', () => {
		const v = validateCorrections({version: 1, corrections: [ok]});
		assert.ok(v.file);
		assert.ok(v.problems.some((p) => p.level === 'warning' && p.msg.includes('not pinned yet')));
	});
	test('invalid entries are errors (date, source, status, pinnedAt, timestamp, duplicate id)', () => {
		const v = validateCorrections({
			version: 1,
			corrections: [
				{...ok, date: '2026-02-30'},
				{...ok, sourceIds: []},
				{...ok, status: 'pinned'},
				{...ok, timestamp: '1m23'},
			],
		});
		assert.equal(v.file, null);
		const msgs = v.problems.filter((p) => p.level === 'error').map((p) => p.msg).join('\n');
		for (const s of ['date must be YYYY-MM-DD', 'needs sourceIds', 'needs pinnedAt', 'timestamp must be', 'duplicate id']) assert.ok(msgs.includes(s), s);
	});
	test('pinned comment: "Correction (<date>): ..." with timestamp, quote and named source', () => {
		const text = pinnedCommentText(ok, [{id: 'src-wire', url: 'https://news.example.com/a', publisher: 'Example Wire'}]);
		assert.equal(
			text,
			'Correction (2026-11-25): At 01:23 we said: "We said $4.8 million". FixtureSwap says the loss was $4.2 million. Source: Example Wire (https://news.example.com/a)',
		);
		assert.ok(pinnedCommentText(ok, [], false).startsWith('Correction (2026-11-25): This corrects what we said at 01:23. FixtureSwap'));
	});
	test("dates default to the owner's calendar day in America/Chicago", () => {
		assert.equal(todayIn('America/Chicago', new Date('2026-11-25T03:30:00Z')), '2026-11-24'); // 21:30 CST the day before
		assert.equal(todayIn('America/Chicago', new Date('2026-11-25T07:00:00Z')), '2026-11-25');
		const r = addCorrection(emptyCorrections(), {id: 'n1', slug: 'ep', correct: 'FixtureSwap says the loss was $4.2 million.', sourceIds: ['s']}, new Date('2026-11-25T03:30:00Z'));
		assert.equal(r.file?.corrections[0].date, '2026-11-24');
		assert.equal(r.file?.corrections[0].status, 'pending');
	});
});

describe('corrections CLI', () => {
	const cli = (args: string[]) => spawnSync(process.execPath, [join(NEWS, 'corrections.ts'), ...args], {encoding: 'utf8'});
	test('add, pinned, mark-pinned, check, list (atomic writes to a temp file)', () => {
		const dir = tmp();
		const file = join(dir, 'corrections.json');
		const base = ['--file', file, '--content-root', FIX];
		const add = cli(['add', ...base, '--slug', 'good-fixtureswap-drain', '--correct', 'FixtureSwap says attackers drained $4.2 million, according to Example Wire.', '--source', 'src-wire', '--wrong', 'FixtureSwap lost $4.8 million', '--timestamp', '00:07', '--now', '2026-11-25T03:30:00Z']);
		assert.equal(add.status, 0, add.stderr);
		assert.match(add.stdout, /Correction \(2026-11-24\): At 00:07 we said: "FixtureSwap lost \$4\.8 million"\. FixtureSwap says attackers drained \$4\.2 million, according to Example Wire\. Source: Example Wire \(https:\/\/news\.example\.com\//);
		const id = '2026-11-24-good-fixtureswap-drain-1';
		assert.equal(JSON.parse(readFileSync(file, 'utf8')).corrections[0].id, id);
		assert.match(cli(['pinned', id, ...base]).stdout, /^Correction \(2026-11-24\): /);
		assert.equal(cli(['mark-pinned', id, ...base, '--at', '2026-11-25T12:00:00Z']).status, 0);
		assert.equal(JSON.parse(readFileSync(file, 'utf8')).corrections[0].status, 'pinned');
		assert.equal(cli(['check', ...base]).status, 0);
		assert.match(cli(['list', ...base]).stdout, /pinned \(2026-11-25T12:00:00Z\)/);
	});
	test('add refuses a correction that names a person or speculates', () => {
		const dir = tmp();
		const r = cli(['add', '--file', join(dir, 'c.json'), '--slug', 'ep', '--correct', 'Jordan Sample probably took it.', '--source', 's']);
		assert.equal(r.status, 1);
		assert.match(r.stderr, /personal name/);
		assert.match(r.stderr, /hedge/);
	});
	test('usage errors exit 2', () => {
		assert.equal(cli(['add', '--slug', 'x']).status, 2);
		assert.equal(cli(['nope']).status, 2);
	});
});

describe('general claim gate adapter (scripts/claims)', () => {
	const call = (root: string) => ({channel: 'zoora-security', slug: 'ep', storyboard: join(root, 'sb.json'), brief: join(root, 'b.json'), root});
	const studioWith = (file: string, code: string) => {
		const root = tmp();
		mkdirSync(join(root, 'scripts', 'claims'), {recursive: true});
		writeFileSync(join(root, 'scripts', 'claims', file), code);
		return root;
	};
	test('not found: auto mode notes it, require mode errors', () => {
		const root = tmp();
		assert.equal(runGeneralGate(root, call(root), 'auto', {}).status, 'not-found');
		assert.equal(runGeneralGate(root, call(root), 'require', {}).status, 'error');
		assert.equal(runGeneralGate(root, call(root), 'off', {}).status, 'skipped');
	});
	test('a TS entry point is run with <channel>/<slug>; its exit code decides', () => {
		const pass = studioWith('check.ts', "if (process.argv[2] !== 'zoora-security/ep') process.exit(3); console.log('general ok');\n");
		const r = runGeneralGate(pass, call(pass), 'auto', {});
		assert.equal(r.status, 'passed', r.outputTail ?? '');
		assert.match(r.outputTail ?? '', /general ok/);
		const fail = studioWith('gate.ts', "console.error('claim c3 has no source'); process.exit(1);\n");
		const f = runGeneralGate(fail, call(fail), 'auto', {});
		assert.equal(f.status, 'failed');
		assert.equal(f.exitCode, 1);
		assert.match(f.outputTail ?? '', /claim c3 has no source/);
	});
	test('NEWS_GENERAL_GATE_CMD overrides discovery, with placeholders', () => {
		const root = tmp();
		const env = {NEWS_GENERAL_GATE_CMD: JSON.stringify([process.execPath, '-e', 'process.exit(process.argv[1] === "ep" ? 0 : 4)', '{slug}'])};
		assert.deepEqual(discoverGeneralGate(root, call(root), env).argv?.slice(-1), ['ep']);
		assert.equal(runGeneralGate(root, call(root), 'auto', env).status, 'passed');
		assert.equal(runGeneralGate(root, call(root), 'auto', {NEWS_GENERAL_GATE_CMD: 'not json'}).status, 'error');
	});
	test('recursion guard: a gate started by another gate does not start it again', () => {
		const root = studioWith('check.ts', 'process.exit(1);\n');
		assert.equal(runGeneralGate(root, call(root), 'auto', {NEWS_GATE_PARENT: '1'}).status, 'skipped');
	});
});
