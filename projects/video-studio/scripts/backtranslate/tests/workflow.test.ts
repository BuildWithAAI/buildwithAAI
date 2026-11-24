import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {describe, test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {checkWho, emptyRecord, ImportError, importFilled, parseFilled, validateRecord} from '../lib/importer.ts';
import {loadStoryboards, resolveTarget, STUDIO} from '../lib/load.ts';
import {storyboardSegments} from '../lib/segments.ts';
import type {Worksheet} from '../lib/types.ts';
import {buildWorksheet, parseWorksheetMarkdown, renderWorksheetMarkdown} from '../lib/worksheet.ts';

const HERE = join(fileURLToPath(import.meta.url), '..');
const SHOW = join(HERE, '..', 'proof', 'show-excerpt');
const CLI = join(HERE, '..', 'cli.ts');

const showSegments = async () => {
	const t = resolveTarget(SHOW, 'es');
	if (t.kind !== 'storyboard') throw new Error('not a storyboard');
	const {source, translation} = loadStoryboards(t, 'es');
	return (await storyboardSegments(source, translation, 'es')).segments;
};

describe('prepare: the blind worksheet', () => {
	test('it holds the Spanish only: no English source text anywhere', async () => {
		const segments = await showSegments();
		const {worksheet} = buildWorksheet({channel: '_test', slug: 'show-excerpt', lang: 'es', now: 'now'}, segments, null, false);
		const md = renderWorksheetMarkdown(worksheet);
		const json = JSON.stringify(worksheet);
		for (const s of segments) {
			if (!s.source || s.source === s.translation || s.source.length < 12) continue;
			assert.ok(!md.includes(s.source), `English leaked into the Markdown worksheet: ${s.source}`);
			assert.ok(!json.includes(s.source), `English leaked into the JSON worksheet: ${s.source}`);
		}
		assert.equal(worksheet.items.length, segments.filter((s) => s.hash).length);
		assert.match(md, /Work blind/);
	});
	test('only segments without a current back-translation are asked for again (unless --all)', async () => {
		const segments = await showSegments();
		const first = segments.find((s) => s.hash) as (typeof segments)[number];
		const record = emptyRecord('_test', 'show-excerpt', 'es');
		record.segments[first.id] = {hash: first.hash as string, text: 'x', method: 'human', by: 'T1', blind: true, date: '2026-11-24'};
		const again = buildWorksheet({channel: '_test', slug: 'show-excerpt', lang: 'es', now: 'now'}, segments, record, false);
		assert.equal(again.current, 1);
		assert.ok(!again.worksheet.items.some((i) => i.id === first.id));
		assert.ok(buildWorksheet({channel: '_test', slug: 'show-excerpt', lang: 'es', now: 'now'}, segments, record, true).worksheet.items.some((i) => i.id === first.id));
	});
	test('the Markdown worksheet round-trips through "BT:" lines (multi-line answers too)', async () => {
		const segments = await showSegments();
		const {worksheet} = buildWorksheet({channel: '_test', slug: 'show-excerpt', lang: 'es', now: 'now'}, segments, null, false);
		const filled = renderWorksheetMarkdown(worksheet)
			.replace(/BT:\n/, 'BT: First line\nsecond line\n')
			.replace(/BT:\n/, 'BT:\nOn its own line\n');
		const items = parseWorksheetMarkdown(filled);
		assert.equal(items.length, worksheet.items.length);
		assert.equal(items[0].bt, 'First line\nsecond line');
		assert.equal(items[1].bt, 'On its own line');
		assert.equal(items[2].bt, '');
		assert.equal(items[0].hash, worksheet.items[0].hash);
	});
});

describe('import', () => {
	const opts = {channel: '_test', slug: 'show-excerpt', lang: 'es' as const, method: 'human' as const, by: 'ES-1', blind: true, date: '2026-11-24'};
	test('accepts English back-translations of the current text and records who made them', async () => {
		const segments = await showSegments();
		const s = segments.find((x) => x.id === 's04.onScreen.fix') as (typeof segments)[number];
		const out = importFilled(segments, null, [{id: s.id, hash: s.hash as string, bt: 'Never share it. The real support never asks for it.'}], opts);
		assert.deepEqual(out.imported, [s.id]);
		assert.deepEqual(out.record.segments[s.id], {hash: s.hash, text: 'Never share it. The real support never asks for it.', method: 'human', by: 'ES-1', blind: true, date: '2026-11-24'});
	});
	test('refuses stale, unknown, untranslated, copied and duplicate items; counts empty ones', async () => {
		const segments = await showSegments();
		const nar = segments.find((x) => x.id === 's04.narration') as (typeof segments)[number];
		const fix = segments.find((x) => x.id === 's04.onScreen.fix') as (typeof segments)[number];
		// a short label the language guess cannot judge: only the copy check catches it
		const node0 = segments.find((x) => x.id === 's03.onScreen.nodes.0') as (typeof segments)[number];
		const out = importFilled(
			segments,
			null,
			[
				{id: nar.id, hash: '0123456789abcdef', bt: 'Old text.'},
				{id: 'nope.narration', hash: '0123456789abcdef', bt: 'x'},
				{id: fix.id, hash: fix.hash as string, bt: 'Nunca la compartas. El soporte real nunca la pide.'},
				{id: node0.id, hash: node0.hash as string, bt: node0.translation as string},
				{id: 's05.narration', hash: segments.find((x) => x.id === 's05.narration')?.hash as string, bt: ''},
				{id: fix.id, hash: fix.hash as string, bt: 'Never share it.'},
			],
			opts,
		);
		assert.deepEqual(
			out.rejected.map((r) => [r.id, r.why.split(':')[0].split(' ').slice(0, 3).join(' ')]),
			[
				['s04.narration', 'the translation changed'],
				['nope.narration', 'no such translated'],
				['s04.onScreen.fix', 'reads as Spanish'],
				['s03.onScreen.nodes.0', 'identical to the'],
				['s04.onScreen.fix', 'listed twice in'],
			],
		);
		assert.deepEqual(out.unfilled, ['s05.narration']);
	});
	test('a dropped [src] tag is accepted with a warning', async () => {
		const segments = await showSegments();
		const nar = segments.find((x) => x.id === 's04.narration') as (typeof segments)[number];
		const out = importFilled(segments, null, [{id: nar.id, hash: nar.hash as string, bt: 'The scam of the week: fake support. Real support never asks for it.'}], opts);
		assert.equal(out.imported.length, 1);
		assert.match(out.warnings[0], /tags were dropped/);
	});
	test('worksheets parse as JSON or Markdown; other files are refused', () => {
		const ws: Worksheet = {kind: 'backtranslation-worksheet', version: 1, channel: 'c', slug: 's', lang: 'es', langName: 'Spanish', createdAt: 'now', instructions: [], items: [{id: 'a', hash: '0123456789abcdef', context: 'x', text: 'y', bt: ' z '}]};
		assert.deepEqual(parseFilled(JSON.stringify(ws), 'w.json').items, [{id: 'a', hash: '0123456789abcdef', bt: 'z'}]);
		assert.throws(() => parseFilled('{"kind": "other"}', 'w.json'), ImportError);
		assert.throws(() => parseFilled('# nothing here', 'w.md'), /no worksheet items/);
	});
	test('--who takes initials or a role, never a full name', () => {
		assert.equal(checkWho('ES-1'), null);
		assert.equal(checkWho('claude-session (wave 3)'), null);
		assert.match(checkWho('Maria Gonzalez') ?? '', /full name/);
		assert.match(checkWho('') ?? '', /required/);
	});
	test('a record file is validated', () => {
		assert.throws(() => validateRecord({kind: 'backtranslation', version: 1, lang: 'pt-br', segments: {}}, 'r.json', 'es'), /expected "es"/);
		assert.throws(() => validateRecord({kind: 'backtranslation', version: 1, lang: 'es', segments: {a: {hash: 'x', text: 'y', method: 'deepl', by: 'z', blind: true, date: 'd'}}}, 'r.json', 'es'), /method/);
	});
});

const node = (args: string[], cwd = STUDIO) => spawnSync(process.execPath, [CLI, ...args], {cwd, encoding: 'utf8'});

describe('CLI, end to end', () => {
	test('help, usage errors and refused languages', () => {
		assert.equal(node(['--help']).status, 0);
		assert.equal(node([]).status, 2);
		assert.equal(node(['compare', '_dev/engine-demo']).status, 2);
		const fr = node(['compare', '_dev/engine-demo', '--lang', 'fr']);
		assert.equal(fr.status, 2);
		assert.match(fr.stderr, /French is excluded/);
		assert.equal(node(['compare', '_dev/engine-demo', '--lang', 'hi']).status, 2);
		assert.equal(node(['frobnicate', '_dev/engine-demo', '--lang', 'es']).status, 2);
		assert.equal(node(['compare', 'nowhere/none', '--lang', 'es']).status, 2);
	});
	test('prepare -> fill -> import -> compare on a scratch copy; then a meaning error makes the verdict FIX', () => {
		const dir = mkdtempSync(join(tmpdir(), 'bt-cli-'));
		const ep = join(dir, 'episode');
		const work = join(dir, 'work');
		mkdirSync(ep);
		copyFileSync(join(SHOW, 'storyboard.json'), join(ep, 'storyboard.json'));
		copyFileSync(join(SHOW, 'storyboard.es.json'), join(ep, 'storyboard.es.json'));
		const common = ['--lang', 'es', '--work-dir', work];
		// compare before any back-translation: INCOMPLETE, exit 1
		assert.equal(node(['compare', ep, ...common]).status, 1);
		const prep = node(['prepare', ep, ...common]);
		assert.equal(prep.status, 0, prep.stderr);
		assert.ok(existsSync(join(work, 'worksheet.md')) && existsSync(join(work, 'worksheet.json')));
		// fill it from the stored literal back-translation
		const stored = JSON.parse(readFileSync(join(SHOW, 'backtranslation.es.json'), 'utf8')) as {items: Record<string, {text: string; bt: string}>};
		const ws = JSON.parse(readFileSync(join(work, 'worksheet.json'), 'utf8')) as Worksheet;
		for (const it of ws.items) it.bt = stored.items[it.id].bt;
		writeFileSync(join(work, 'filled.json'), JSON.stringify(ws));
		// import needs who, how, and whether it was blind; a translation API is refused
		assert.equal(node(['import', ep, ...common, '--from', join(work, 'filled.json'), '--by', 'deepl', '--who', 'X', '--blind']).status, 2);
		assert.equal(node(['import', ep, ...common, '--from', join(work, 'filled.json'), '--by', 'human', '--who', 'ES-1']).status, 2);
		const imp = node(['import', ep, ...common, '--from', join(work, 'filled.json'), '--by', 'claude-session', '--who', 'test', '--saw-source']);
		assert.equal(imp.status, 0, imp.stdout + imp.stderr);
		const clean = node(['compare', ep, ...common]);
		assert.equal(clean.status, 0, clean.stdout);
		assert.match(clean.stdout, /CLEAR/);
		const report = JSON.parse(readFileSync(join(work, 'report.json'), 'utf8')) as {verdict: string; backTranslators: Array<{blind: boolean}>};
		assert.equal(report.backTranslators[0].blind, false);
		assert.match(readFileSync(join(work, 'report.md'), 'utf8'), /not blind/);
		// a meaning error: "allegedly" dropped from the Spanish; its old back-translation is now stale -> INCOMPLETE
		const trPath = join(ep, 'storyboard.es.json');
		writeFileSync(trPath, readFileSync(trPath, 'utf8').replace('supuestamente piden', 'piden'));
		const stale = node(['compare', ep, ...common]);
		assert.equal(stale.status, 1);
		assert.match(stale.stdout, /INCOMPLETE/);
		// re-prepare asks only for the changed segment; back-translate it literally; compare says FIX
		node(['prepare', ep, ...common]);
		const ws2 = JSON.parse(readFileSync(join(work, 'worksheet.json'), 'utf8')) as Worksheet;
		assert.deepEqual(ws2.items.map((i) => i.id), ['s04.narration']);
		ws2.items[0].bt = 'The scam of the week: fake wallet support. Example Security Lab warns that accounts that pretend to be support ask the users for their recovery phrase [src:src-lab2]. The real support never asks for it.';
		writeFileSync(join(work, 'filled2.json'), JSON.stringify(ws2));
		assert.equal(node(['import', ep, ...common, '--from', join(work, 'filled2.json'), '--by', 'claude-session', '--who', 'test', '--saw-source']).status, 0);
		const fix = node(['compare', ep, ...common]);
		assert.equal(fix.status, 1);
		assert.match(fix.stdout, /FIX/);
		assert.match(fix.stdout, /s04\.narration\s+HIGH\s+hedge-lost/);
	});
});
