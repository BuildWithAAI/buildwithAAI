/**
 * prepare -> storyboard -> build with the REAL news gate (scripts/news, run as a child process). Only the voice, the
 * render, the still and ffprobe are faked. This proves the brief.json prepare writes is what the news gate checks
 * against, and that a writer who follows WRITER.md gets a passing gate.
 */
import {strict as assert} from 'node:assert';
import {existsSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import {describe, it} from 'node:test';
import {runBuild} from '../lib/build.ts';
import {realExec, type Exec} from '../lib/exec.ts';
import {episodePaths} from '../lib/paths.ts';
import {runPrepare} from '../lib/prepare.ts';
import type {DailyBrief, PacketSummary} from '../lib/types.ts';
import {fakeExec, goodStoryboard, NOW, patternOf, seedRadarDay, SLUG, tempRoot, toolOf, touch, writeJsonFile} from './helpers.ts';

describe('end to end with the real news gate', () => {
	it('a WRITER.md-style storyboard passes the gate and the packet is ready', async () => {
		const t = tempRoot({news: true});
		try {
			const {root} = t;
			seedRadarDay(root);
			assert.equal(runPrepare({root, radar: 'reuse', exec: fakeExec().exec, now: () => NOW}).exitCode, 0);
			const ep = episodePaths(root, SLUG);
			const brief = JSON.parse(readFileSync(ep.brief, 'utf8')) as DailyBrief;
			const opp = brief.analysisOpportunities.find((o) => o.id === 'tracker-30d');
			assert.ok(opp?.available && opp.detail && opp.method);
			writeJsonFile(ep.storyboard, goodStoryboard(opp.detail, opp.method, patternOf(brief)));
			touch(join(root, 'scripts', 'voice', 'build.py'));
			touch(join(root, 'src', 'show', 'index.ts'));
			const fake = fakeExec({
				voice: () => writeJsonFile(ep.timeline, {version: 1, totalMs: 51000, voice: 'im_nicola', scenes: []}),
				render: (req) => touch(req.args[4], 'fake mp4'),
				still: (req) => touch(req.args[4], 'fake png'),
				ffprobe: () => ({stdout: '51.0'}),
			});
			const exec: Exec = (req) => (toolOf(req) === 'news-gate' ? realExec(req) : fake.exec(req));
			const r = await runBuild({root, dateSlug: SLUG, exec, now: () => NOW, env: {...process.env, NEWS_GENERAL_GATE_CMD: ''}});
			const report = existsSync(ep.gateMd) ? readFileSync(ep.gateMd, 'utf8') : 'no report';
			assert.equal(r.exitCode, 0, `${JSON.stringify(r.packet?.blockers ?? r.error)}\n${report.slice(0, 3000)}`);
			const p = JSON.parse(readFileSync(ep.packetJson, 'utf8')) as PacketSummary;
			assert.equal(p.versions.newsGate.verdict, 'pass');
			const gate = JSON.parse(readFileSync(ep.gateJson, 'utf8'));
			assert.equal(gate.counts.claims, gate.counts.claimsOk);
			assert.ok(gate.counts.claims >= 4);
			assert.deepEqual(gate.analysis[0].presentedIn, ['s04']);
			const html = readFileSync(ep.approvalHtml, 'utf8');
			assert.match(html, /READY TO APPROVE/);
			assert.match(html, /Example Security Lab flagged outflows of about 1,400 ETH from FixtureSwap pools\./, 'the excerpt is shown inline under its claim');
			assert.match(html, /splitter: the news gate/i, 'sentence numbers come from the gate\'s own splitter');
		} finally {
			t.cleanup();
		}
	});

	it('the real gate fails an unsourced figure, and build stops before the voice', async () => {
		const t = tempRoot({news: true});
		try {
			const {root} = t;
			seedRadarDay(root);
			runPrepare({root, radar: 'reuse', exec: fakeExec().exec, now: () => NOW});
			const ep = episodePaths(root, SLUG);
			const brief = JSON.parse(readFileSync(ep.brief, 'utf8')) as DailyBrief;
			const sb = goodStoryboard(brief.analysisOpportunities.find((o) => o.id === 'tracker-30d')?.detail ?? '', undefined, patternOf(brief));
			sb.scenes[1].narration = sb.scenes[1].narration.replace('{$4,200,000|four point two million dollars}', '{$9,900,000|nine point nine million dollars}');
			writeJsonFile(ep.storyboard, sb);
			const fake = fakeExec();
			const exec: Exec = (req) => (toolOf(req) === 'news-gate' ? realExec(req) : fake.exec(req));
			const r = await runBuild({root, dateSlug: SLUG, exec, now: () => NOW, env: {...process.env, NEWS_GENERAL_GATE_CMD: ''}});
			assert.equal(r.exitCode, 1);
			assert.ok(!fake.calls.some((c) => c.tool === 'voice'));
			const gate = JSON.parse(readFileSync(ep.gateJson, 'utf8'));
			assert.equal(gate.verdict, 'fail');
			assert.ok(gate.findings.some((f: {rule: string}) => f.rule === 'R1'));
		} finally {
			t.cleanup();
		}
	});
});
