/**
 * The proof as a regression test: every deliberate meaning error in proof/injections.ts must be caught on its own
 * segment, without new findings elsewhere, and the clean literal back-translations must raise no high finding.
 */
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {before, describe, test} from 'node:test';
import {INJECTIONS} from '../proof/injections.ts';
import {runProof, type ProofResult} from '../proof/proof.ts';

let res: ProofResult;

describe('proof run', () => {
	before(async () => {
		res = await runProof(mkdtempSync(join(tmpdir(), 'bt-proof-')));
	});
	test('clean runs: no high finding, and every stored back-translation still matches its text', () => {
		assert.ok(res.clean.length >= 5);
		for (const c of res.clean.filter((x) => !x.live)) {
			assert.equal(c.run.report.counts.high, 0, `${c.fixture} ${c.lang}: ${JSON.stringify(c.run.report.segments.filter((s) => s.findings.some((f) => f.severity === 'high')).map((s) => s.id))}`);
			assert.deepEqual(c.run.stale, [], `${c.fixture} ${c.lang} has stale items`);
			assert.deepEqual(c.run.rejected, []);
		}
	});
	test('the only medium findings in the clean runs are the engine demo\'s untranslated thumbnails', () => {
		const mediums = res.clean
			.filter((x) => !x.live)
			.flatMap((c) => c.run.report.segments.flatMap((s) => s.findings.filter((f) => f.severity === 'medium').map((f) => `${c.fixture}:${s.id}:${f.code}`)));
		assert.ok(mediums.every((m) => /^engine-demo:thumbnails\.[abc]\.text:missing-translation$/.test(m)), mediums.join('\n'));
	});
	for (const inj of INJECTIONS) {
		test(`${inj.key}: ${inj.title}`, () => {
			const r = res.injected.find((x) => x.injection.key === inj.key);
			assert.ok(r, 'not run');
			assert.ok(r.caught, `missed; findings on the segment: ${r.allOnSegment.map((f) => `${f.severity} ${f.code}`).join(', ')}`);
			assert.deepEqual(r.crossTalk, [], 'new findings on other segments');
		});
	}
	test('at least five core errors, all on the real dubbed episode', () => {
		const core = INJECTIONS.filter((i) => i.core);
		assert.ok(core.length >= 5);
		assert.ok(core.every((i) => i.fixture === 'content-demo'));
	});
});
