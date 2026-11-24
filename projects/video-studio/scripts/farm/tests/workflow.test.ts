// node --test scripts/farm/tests/workflow.test.ts
// Static checks of .github/workflows/video-render.yml: the security rules the farm depends on.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';

const WORKFLOW = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', '..', '.github', 'workflows', 'video-render.yml');
const text = readFileSync(WORKFLOW, 'utf8');
const lines = text.split('\n');

/** run: blocks (single-line and block scalars), with their line numbers. */
const runBlocks = (): {line: number; body: string}[] => {
	const blocks: {line: number; body: string}[] = [];
	lines.forEach((l, i) => {
		const m = /^(\s*)(?:- )?run:\s*(.*)$/.exec(l);
		if (!m) return;
		const indent = m[1].length;
		if (!/^[|>][-+]?\s*$/.test(m[2])) {
			blocks.push({line: i + 1, body: m[2]});
			return;
		}
		const body: string[] = [];
		for (let j = i + 1; j < lines.length; j++) {
			const next = lines[j];
			if (next.trim() && next.length - next.trimStart().length <= indent) break;
			body.push(next);
		}
		blocks.push({line: i + 1, body: body.join('\n')});
	});
	return blocks;
};

test('no run: block interpolates an expression (untrusted values go through env)', () => {
	const blocks = runBlocks();
	assert.ok(blocks.length >= 12, `found only ${blocks.length} run blocks`);
	for (const b of blocks) assert.ok(!b.body.includes('${{'), `line ${b.line} interpolates an expression into a shell script`);
});

test('every action is pinned to a full commit SHA with its tag in a comment', () => {
	const uses = lines.filter((l) => /^\s*(?:- )?uses:/.test(l));
	assert.ok(uses.length >= 10);
	for (const l of uses) assert.match(l, /uses: [\w.-]+\/[\w./-]+@[0-9a-f]{40} # v\d+\.\d+\.\d+$/, l.trim());
});

test('the token is read-only and checkouts do not persist credentials', () => {
	assert.match(text, /^permissions:\n {2}contents: read\n\n/m);
	assert.ok(!/^[ \t]+permissions:/m.test(text), 'a job widens permissions');
	const checkouts = lines.filter((l) => l.includes('actions/checkout@')).length;
	assert.equal((text.match(/persist-credentials: false/g) || []).length, checkouts);
	assert.ok(!/pull_request_target|workflow_run/.test(text));
});

test('triggers: pushes of request files on any branch, and manual dispatch', () => {
	assert.match(text, /^on:\n {2}push:\n {4}paths:\n {6}- "projects\/video-studio\/render-requests\/\*\*"\n {2}workflow_dispatch:/m);
	assert.ok(!/^[ \t]+branches:/m.test(text), 'pushes are limited to some branches');
});

test('secrets are only read into step env, and only by steps that encrypt or decrypt', () => {
	const uses = lines.flatMap((l, i) => (l.includes('secrets.') ? [{l: l.trim(), i}] : []));
	for (const {l} of uses) assert.match(l, /^(RENDER_ARTIFACT_KEY: \$\{\{ secrets\.RENDER_ARTIFACT_KEY \}\}|FARM_KEY_SET: \$\{\{ secrets\.RENDER_ARTIFACT_KEY != '' \}\})$/);
	assert.equal(uses.length, 6, 'plan (is it set?), voice preflight + pack, render preflight + unpack + pack');
	// Steps that run third-party code (Remotion, the voice build, npm) never see the key.
	for (const name of ['Render', 'Build the narration', 'Install dependencies', 'Set up Kokoro']) {
		const start = lines.findIndex((l) => l.includes(`name: ${name}`));
		assert.ok(start > 0, name);
		const end = lines.findIndex((l, j) => j > start && /^\s+- (name|uses):/.test(l));
		assert.ok(!lines.slice(start, end).join('\n').includes('RENDER_ARTIFACT_KEY'), `${name} sees the key`);
	}
});

test('fan-out: matrices from the plan, 8 parallel jobs, no fail-fast, Ubuntu 24.04 pinned', () => {
	assert.equal((text.match(/max-parallel: 8/g) || []).length, 2);
	assert.equal((text.match(/fail-fast: false/g) || []).length, 2);
	assert.match(text, /matrix: \$\{\{ fromJSON\(needs\.plan\.outputs\.render_matrix\) \}\}/);
	assert.match(text, /matrix: \$\{\{ fromJSON\(needs\.plan\.outputs\.voice_matrix\) \}\}/);
	const runsOn = lines.filter((l) => /runs-on:/.test(l));
	assert.equal(runsOn.length, 4);
	for (const l of runsOn) assert.match(l, /runs-on: ubuntu-24\.04$/);
	for (const m of text.matchAll(/timeout-minutes: (\d+)/g)) assert.ok(Number(m[1]) <= 350, 'a job may exceed the 6-hour limit');
});

test('uploads happen only after the pack step, which verifies the folder is ciphertext for encrypted requests', () => {
	const uploads = lines.flatMap((l, i) => (l.includes('actions/upload-artifact@') ? [i] : []));
	assert.equal(uploads.length, 4);
	for (const i of uploads) {
		const cond = lines.slice(i - 2, i).join('\n');
		assert.match(cond, /if: \$\{\{ !cancelled\(\) && steps\.(pack|probe)\.outcome == 'success'/);
	}
	const outputs = uploads.map((i) => lines.slice(i, i + 4).join('\n')).filter((s) => /farm\/(upload|voice-out)/.test(s));
	assert.equal(outputs.length, 2);
});

test('the workflow parses as YAML when js-yaml is available', async (t) => {
	let yaml: {load: (s: string) => unknown};
	try {
		const spec = 'js-yaml';
		yaml = await import(spec);
	} catch {
		t.skip('js-yaml is not installed');
		return;
	}
	const doc = yaml.load(text) as {jobs: Record<string, {needs?: string | string[]; strategy?: {matrix: string}}>};
	assert.deepEqual(Object.keys(doc.jobs), ['plan', 'voice', 'render', 'summary']);
	assert.deepEqual(doc.jobs.render.needs, ['plan', 'voice']);
	assert.deepEqual(doc.jobs.summary.needs, ['plan', 'render']);
});
