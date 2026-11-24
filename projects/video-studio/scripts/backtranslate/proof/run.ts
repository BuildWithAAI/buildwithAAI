#!/usr/bin/env node
/**
 * node scripts/backtranslate/proof/run.ts [--out <dir>]
 * Runs the proof (see proof.ts) and prints the clean findings and the injected-error table. Writes worksheets,
 * records and reports under --out (default out/backtranslate/_proof, gitignored). Exit 1 if any injected error is
 * missed or causes findings on other segments.
 */
const original = process.emitWarning;
process.emitWarning = function (this: unknown, warning: string | Error, ...rest: unknown[]) {
	const opt = rest[0];
	const code = typeof opt === 'object' && opt !== null ? (opt as {code?: string}).code : rest[1];
	if (code === 'MODULE_TYPELESS_PACKAGE_JSON') return;
	return (original as (...a: unknown[]) => void).call(process, warning, ...rest);
} as typeof process.emitWarning;

const {join, resolve} = await import('node:path');
const {runProof} = await import('./proof.ts');
const {STUDIO} = await import('../lib/load.ts');

const argv = process.argv.slice(2);
const i = argv.indexOf('--out');
const out = i >= 0 && argv[i + 1] ? resolve(argv[i + 1]) : join(STUDIO, 'out', 'backtranslate', '_proof');

const res = await runProof(out);
const sevOrder = ['high', 'medium', 'low', 'info'] as const;
console.log(`Back-translation proof · output: ${out}\n`);
console.log('1. Clean runs (stored literal back-translations, normal prepare -> import -> compare path)\n');
for (const c of res.clean) {
	const r = c.run.report;
	console.log(`   ${c.fixture}${c.live ? ' (LIVE content folder)' : ''} ${c.lang}: ${r.verdict} · ${r.counts.high} high, ${r.counts.medium} medium, ${r.counts.low} low · ${r.counts.checked}/${r.counts.segments} checked${c.run.stale.length ? ` · STALE (fixture changed): ${c.run.stale.join(', ')}` : ''}`);
	for (const s of r.segments.filter((x) => x.findings.some((f) => f.severity !== 'info'))) {
		const f = [...s.findings].sort((a, b) => sevOrder.indexOf(a.severity) - sevOrder.indexOf(b.severity))[0];
		console.log(`      ${s.id.padEnd(26)} ${f.severity.padEnd(6)} ${f.code}: ${f.message.length > 120 ? `${f.message.slice(0, 119)}…` : f.message}`);
	}
	console.log(`      report: ${join(c.run.workDir, 'report.md')}\n`);
}
console.log('2. Injected meaning errors (each in its own scratch copy)\n');
let missed = 0;
for (const r of res.injected) {
	const inj = r.injection;
	const ok = r.caught && !r.crossTalk.length;
	if (!ok) missed++;
	console.log(`   ${ok ? 'CAUGHT' : 'MISSED'}  ${inj.key.padEnd(17)} ${inj.lang.padEnd(5)} ${inj.segment.padEnd(22)} ${inj.title}`);
	console.log(`           by: ${r.matched.map((f) => `${f.severity} ${f.code}`).join(', ') || 'nothing'}; all findings on the segment: ${r.allOnSegment.map((f) => `${f.severity} ${f.code}`).join(', ') || 'none'}; verdict ${r.verdict}${r.crossTalk.length ? `; NEW findings elsewhere: ${r.crossTalk.join(', ')}` : ''}`);
}
console.log(`\n${res.injected.length - missed} of ${res.injected.length} injected errors caught (${res.injected.filter((r) => r.injection.core && r.caught).length} of ${res.injected.filter((r) => r.injection.core).length} in the core set).`);
process.exitCode = missed ? 1 : 0;

export {};
