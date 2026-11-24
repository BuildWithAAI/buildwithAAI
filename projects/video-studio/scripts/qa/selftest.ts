// End-to-end self-test of the visual QA checker on the planted-defect fixtures (src/qa/fixtures).
//
//   node scripts/qa/selftest.ts [--only QaFxFaces,QaFxMirror] [--concurrency <n>]
//
// Each fixture plants one defect class; the test asserts that every expected check fires with at least the
// expected severity, and that nothing else reaches warning or error (the false-positive guard). The clean
// control must pass with no warnings. Bundles once, one browser for all fixtures. Exit 0 = all pass, 1 = any fail,
// 2 = the self-test itself could not run.
import {cpus} from 'node:os';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {openBrowser, type HeadlessBrowser} from '@remotion/renderer';
import {browserExecutable, bundleForQa, PROJECT_ROOT} from './lib/bundle.ts';
import {parseArgs, run, type RunResult} from './check.ts';
import type {CheckId, Severity} from './lib/issues.ts';

type Expect = {comp: string; must: Array<[CheckId, Severity]>; allow?: CheckId[]};

const RANK: Record<Severity, number> = {info: 1, warn: 2, error: 3};

/** What each fixture must report (check, minimum severity) and what else it may report. */
export const EXPECTATIONS: Expect[] = [
	{comp: 'QaFxClean', must: []},
	{comp: 'QaFxText', must: [['text-clipped', 'error'], ['text-overflow', 'warn'], ['text-offframe', 'error'], ['text-small', 'warn'], ['text-name', 'error']], allow: ['safe-area']},
	{comp: 'QaFxSafe', must: [['safe-area', 'error']], allow: ['text-face-zone']},
	{comp: 'QaFxShorts', must: [['shorts-ui', 'error']], allow: ['safe-area']},
	{comp: 'QaFxFaces', must: [['caption-face', 'error'], ['text-face', 'error']], allow: ['face-occluded', 'text-face-zone']},
	{comp: 'QaFxOccluded', must: [['face-occluded', 'warn']]},
	{comp: 'QaFxContrast', must: [['contrast', 'error']]},
	{comp: 'QaFxMirror', must: [['model-transform', 'error'], ['model-ssim', 'error'], ['model-pin', 'error'], ['model-earcap', 'error']], allow: ['model-spots']},
	{comp: 'QaFxStretch', must: [['model-transform', 'error'], ['model-ssim', 'error']], allow: ['model-spots', 'model-earcap']},
	// the filter also makes Chrome re-rasterise Zoo differently from frame to frame: a real one-frame flicker
	{comp: 'QaFxFilter', must: [['model-effect', 'error'], ['model-ssim', 'error'], ['model-palette', 'error']], allow: ['banned', 'model-pin', 'flicker']},
	{comp: 'QaFxClip', must: [['model-ssim', 'error'], ['model-spots', 'error']]},
	{comp: 'QaFxForgery', must: [['model-component', 'error']], allow: ['model-ssim', 'model-palette', 'model-pin']},
	{comp: 'QaFxBanding', must: [['banned', 'error'], ['gradient', 'error'], ['texture', 'warn']]},
	// the one-frame white flash also covers both faces for that frame
	{comp: 'QaFxFlicker', must: [['one-frame-state', 'error'], ['flicker', 'error'], ['flash', 'error']], allow: ['face-occluded']},
];

const main = async () => {
	const argv = process.argv.slice(2);
	let only: string[] | null = null;
	let concurrency = Math.max(1, Math.min(3, cpus().length));
	for (let i = 0; i < argv.length; i++) {
		if (argv[i] === '--only') only = (argv[++i] ?? '').split(',').filter(Boolean);
		else if (argv[i] === '--concurrency') concurrency = Number(argv[++i]);
		else {
			console.error('usage: node scripts/qa/selftest.ts [--only QaFxA,QaFxB] [--concurrency <n>]');
			return 2;
		}
	}
	const entry = join(PROJECT_ROOT, 'src', 'qa', 'fixtures', 'index.ts');
	const t0 = Date.now();
	console.log('bundling the fixtures ...');
	const serveUrl = await bundleForQa(entry);
	const browser = (await openBrowser('chrome', {browserExecutable: browserExecutable(), logLevel: 'error'} as never)) as HeadlessBrowser;
	let failed = 0;
	const rows: string[] = [];
	try {
		for (const e of EXPECTATIONS) {
			if (only && !only.includes(e.comp)) continue;
			const args = parseArgs(['--entry', entry, '--comp', e.comp, '--out', join(PROJECT_ROOT, 'out', 'qa', 'selftest', e.comp), '--concurrency', String(concurrency)]);
			let res: RunResult;
			try {
				res = await run(args, {serveUrl, browser, quiet: true});
			} catch (err) {
				// one broken fixture must not hide the others' results
				failed++;
				const why = (err instanceof Error ? err.message : String(err)).split('\n')[0];
				rows.push(`| ${e.comp} | ${e.must.map(([c]) => c).join(', ') || '(none: clean control)'} | 0/${e.must.length} | - | FAIL: could not run: ${why.replace(/\|/g, '\\|')} |`);
				console.log(`FAIL ${e.comp}: could not run: ${why}`);
				continue;
			}
			const problems: string[] = [];
			for (const [check, sev] of e.must) {
				const hit = res.issues.find((i) => i.check === check && RANK[i.severity] >= RANK[sev]);
				if (!hit) problems.push(`missed ${check} (>= ${sev})`);
			}
			const expected = new Set<CheckId>([...e.must.map(([c]) => c), ...(e.allow ?? [])]);
			for (const i of res.issues) if (i.severity !== 'info' && !expected.has(i.check)) problems.push(`unexpected ${i.severity} ${i.check}: ${i.subject}`);
			if (res.toolErrors.length) problems.push(`tool errors: ${res.toolErrors.slice(0, 2).join(' / ')}`);
			const caught = e.must.filter(([check, sev]) => res.issues.some((i) => i.check === check && RANK[i.severity] >= RANK[sev])).length;
			const extra = res.issues.filter((i) => i.severity !== 'info' && !expected.has(i.check)).length;
			const ok = problems.length === 0;
			if (!ok) failed++;
			rows.push(`| ${e.comp} | ${e.must.map(([c]) => c).join(', ') || '(none: clean control)'} | ${caught}/${e.must.length} | ${extra} | ${ok ? 'pass' : `FAIL: ${problems.join('; ')}`} |`);
			console.log(`${ok ? 'pass' : 'FAIL'} ${e.comp}: ${res.verdict}, ${res.issues.filter((i) => i.severity !== 'info').length} issue(s)${ok ? '' : `\n    ${problems.join('\n    ')}`}`);
		}
	} finally {
		await browser.close({silent: true} as never).catch(() => undefined);
	}
	console.log('\n| Fixture | Planted defect checks | Caught | Unexpected warnings/errors | Result |');
	console.log('| --- | --- | --- | --- | --- |');
	for (const r of rows) console.log(r);
	console.log(`\n${failed ? `${failed} fixture(s) FAILED` : 'all fixtures pass'} in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
	return failed ? 1 : 0;
};

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	let code = 2;
	try {
		code = await main();
	} catch (err) {
		console.error(`self-test could not run: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
	}
	process.exit(code);
}
