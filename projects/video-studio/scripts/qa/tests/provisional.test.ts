// Unit tests for the model-provisional warning (provisional drawings awaiting the owner's OK, decision BADGER-D23).
// Run: node --test scripts/qa/tests/*.test.ts
import assert from 'node:assert/strict';
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {after, describe, it} from 'node:test';
import type {CharacterFact, FrameFacts} from '../../../src/qa/protocol.ts';
import {characterDomFindings} from '../lib/checks/dom.ts';
import {groupFindings} from '../lib/issues.ts';
import {demoteInTransitions} from '../lib/motion.ts';
import {loadManifest} from '../lib/manifest.ts';
import {findReExport, loadProvisional, provisionalMatch, type Provisional} from '../lib/provisional.ts';
import {PROJECT_ROOT} from '../lib/bundle.ts';

const manifest = loadManifest(PROJECT_ROOT);

const badger = (o: Partial<CharacterFact> = {}): CharacterFact => ({
	key: 'badger0',
	kind: 'badger',
	view: 'left',
	pose: 'stand',
	head: 'front',
	ctm: [0.5, 0, 0, 0.5, 600, 900],
	box: {x: 400, y: 600, w: 300, h: 300},
	headBox: {x: 420, y: 600, w: 120, h: 110},
	hands: [],
	pin: null,
	spots: [],
	effects: {filter: [], opacity: 1, blend: [], clip: [], cssTransform: false},
	props: {view: 'left'},
	droppedProps: [],
	localFrame: 0,
	frameSource: 'context',
	canonical: true,
	coveredBy: [],
	...o,
});
const frame = (chars: CharacterFact[], n = 0): FrameFacts => ({v: 1, pass: 'scout', run: 'r', comp: 'C', frame: n, width: 1920, height: 1080, settled: true, texts: [], chars, banned: [], ms: 1, errors: []});
const provisionalOf = (chars: CharacterFact[], m = manifest) => characterDomFindings(frame(chars), m).filter((f) => f.check === 'model-provisional');

const tmp = mkdtempSync(join(tmpdir(), 'qa-provisional-'));
after(() => rmSync(tmp, {recursive: true, force: true}));
/** A throwaway project root with a Badger index (and optionally the module it names and a manifest copy). */
const fakeRoot = (name: string, files: Record<string, string>) => {
	const root = join(tmp, name);
	for (const [rel, body] of Object.entries(files)) {
		mkdirSync(join(root, rel, '..'), {recursive: true});
		writeFileSync(join(root, rel), body);
	}
	return root;
};

describe('model-provisional: where the list comes from', () => {
	it('reads BADGER_PROVISIONAL_POSES through the Badger index re-export', () => {
		const p = manifest.provisional;
		assert.ok(p.poses.some((x) => x.view === 'left' && x.pose === 'sit'), JSON.stringify(p));
		assert.ok(p.poses.some((x) => x.view === 'left' && x.pose === 'lie'), JSON.stringify(p));
		assert.match(p.source, /src\/characters\/badger\/provisional\.ts/);
		assert.match(p.source, /index\.ts/);
		assert.match(p.decision ?? '', /^BADGER-D23/);
	});
	it('parses named, renamed and type-only re-exports', () => {
		const src = `export {Badger, BadgerLayer} from './Badger';\nexport {A as BADGER_PROVISIONAL_POSES, type T} from './prov';\nexport type {X} from './x';`;
		assert.deepEqual(findReExport(src, 'BADGER_PROVISIONAL_POSES'), {from: './prov', local: 'A'});
		assert.deepEqual(findReExport(src, 'Badger'), {from: './Badger', local: 'Badger'});
		assert.equal(findReExport(src, 'Nope'), null);
	});
	it('finds nothing provisional once the index stops exporting the list', () => {
		const root = fakeRoot('accepted', {'src/characters/badger/index.ts': "export {Badger} from './Badger';\n"});
		const p = loadProvisional(root);
		assert.equal(p.poses.length, 0);
		assert.match(p.source, /does not export BADGER_PROVISIONAL_POSES/);
	});
	it('loads a renamed export from the module the index names', () => {
		const root = fakeRoot('renamed', {
			'src/characters/badger/index.ts': "export {LIST as BADGER_PROVISIONAL_POSES} from './prov';\n",
			'src/characters/badger/prov.ts': "export const LIST = [{view: 'right', pose: 'walk'}];\nexport const BADGER_PROVISIONAL_DECISION = 'X-1';\n",
		});
		const p = loadProvisional(root);
		assert.deepEqual(p.poses, [{view: 'right', pose: 'walk'}]);
		assert.equal(p.decision, 'X-1');
	});
	it('follows an export-star re-export, and falls back to the manifest when the index defines the list itself', () => {
		const star = fakeRoot('star', {
			'src/characters/badger/index.ts': "export * from './missing';\nexport * from './prov';\n",
			'src/characters/badger/prov.ts': "export const BADGER_PROVISIONAL_POSES = [{view: 'left', pose: 'lie'}];\n",
		});
		assert.deepEqual(loadProvisional(star).poses, [{view: 'left', pose: 'lie'}]);
		const inline = fakeRoot('inline', {
			'src/characters/badger/index.ts': "import {Badger} from './Badger';\nexport const BADGER_PROVISIONAL_POSES = [{view: 'left', pose: 'sit'}];\n",
			'src/characters/manifest.v1.json': JSON.stringify({provisional: {badger: {decision: 'D', poses: [{view: 'left', pose: 'sit'}]}}}),
		});
		const p = loadProvisional(inline);
		assert.deepEqual(p.poses, [{view: 'left', pose: 'sit'}]);
		assert.match(p.source, /defined in the Badger index/);
	});
	it("falls back to the generated manifest's copy when the module cannot be loaded", () => {
		const root = fakeRoot('broken', {
			'src/characters/badger/index.ts': "export {BADGER_PROVISIONAL_POSES} from './missing';\n",
			'src/characters/manifest.v1.json': JSON.stringify({provisional: {badger: {decision: 'BADGER-D23-pose-facing', poses: [{view: 'left', pose: 'sit'}]}}}),
		});
		const p = loadProvisional(root);
		assert.deepEqual(p.poses, [{view: 'left', pose: 'sit'}]);
		assert.match(p.source, /manifest\.v1\.json/);
	});
	it('matches on the drawn view and pose only', () => {
		const list: Provisional = {source: 't', decision: null, poses: [{view: 'left', pose: 'sit'}]};
		assert.deepEqual(provisionalMatch(list, 'left', 'sit'), {view: 'left', pose: 'sit'});
		assert.equal(provisionalMatch(list, 'right', 'sit'), null);
		assert.equal(provisionalMatch(list, 'left', null), null);
	});
});

describe('model-provisional: the warning', () => {
	it("warns (never errors) for Badger's left-facing sit and lie", () => {
		for (const pose of ['sit', 'lie']) {
			const out = provisionalOf([badger({pose, head: 'threeQuarterLeftScreen', props: {view: 'left', pose}})]);
			assert.equal(out.length, 1, pose);
			assert.equal(out[0].severity, 'warn');
			assert.match(out[0].message, new RegExp(`view 'left' with pose '${pose}'.*PROVISIONAL.*BADGER-D23`));
		}
	});
	it('stays silent for every approved drawing (no false positives)', () => {
		const clean = [
			badger(),
			badger({key: 'b1', view: 'right', pose: 'sit', props: {view: 'right', pose: 'sit'}}),
			badger({key: 'b2', view: 'right', pose: 'lie', props: {view: 'front', pose: 'lie'}}),
			badger({key: 'b3', view: 'left', pose: 'walk', props: {view: 'left', pose: 'walk'}}),
			badger({key: 'b4', view: 'left', pose: 'lookUp', props: {view: 'left', pose: 'lookUp'}}),
			badger({key: 'b5', view: 'front', pose: 'stand', props: {view: 'front'}}),
			badger({key: 'z0', kind: 'zoo', view: 'front', pose: 'stand', head: null, props: {view: 'front', pose: 'stand'}}),
		];
		assert.deepEqual(provisionalOf(clean), []);
	});
	it('judges what is drawn: an unknown view falls back to the left-facing body', () => {
		// Badger renders data-view="left" for a view it does not implement, so a 'sit' there is the provisional drawing
		assert.equal(provisionalOf([badger({view: 'left', pose: 'sit', props: {view: 'side', pose: 'sit'}})]).length, 1);
		// without data attributes (an older probe), the props decide; Badger's defaults are view 'left', pose 'stand'
		assert.equal(provisionalOf([badger({view: null, pose: null, props: {pose: 'lie'}})]).length, 1);
		assert.equal(provisionalOf([badger({view: null, pose: null, props: {}})]).length, 0);
	});
	it('is silent once the list is empty (the owner accepted the poses)', () => {
		const accepted = {...manifest, provisional: {source: 'test', decision: null, poses: []}};
		assert.deepEqual(provisionalOf([badger({pose: 'sit', props: {view: 'left', pose: 'sit'}})], accepted), []);
	});
	it('keeps its warning inside a scene transition (it is about the asset, not the frame)', () => {
		const findings = characterDomFindings(frame([badger({pose: 'sit', props: {view: 'left', pose: 'sit'}, spots: manifest.badgerBody.sitLeft})], 5), manifest);
		demoteInTransitions(findings, new Set([5]));
		assert.equal(findings.find((f) => f.check === 'model-provisional')?.severity, 'warn');
		// and the left-facing sit is checked against its own LEFT markings, so it raises no marking error
		assert.equal(findings.filter((f) => f.check === 'model-spots').length, 0);
	});
	it('groups into one issue per Badger instance across frames', () => {
		const findings = [0, 1, 2, 30].flatMap((n) => characterDomFindings(frame([badger({pose: 'lie', props: {view: 'left', pose: 'lie'}})], n), manifest));
		const issues = groupFindings(findings).filter((i) => i.check === 'model-provisional');
		assert.equal(issues.length, 1);
		assert.equal(issues[0].severity, 'warn');
		assert.equal(issues[0].ranges, '0-2, 30');
	});
});
