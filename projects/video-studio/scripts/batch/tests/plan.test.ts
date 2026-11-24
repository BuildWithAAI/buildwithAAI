import assert from 'node:assert/strict';
import {existsSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import {test} from 'node:test';
import {validateRequest} from '../../farm/request.ts';
import {loadFactBank} from '../lib/factbank.ts';
import {runPlan} from '../lib/plan.ts';
import type {Backlog, WeekPlan} from '../lib/types.ts';
import {parseWeek} from '../lib/week.ts';
import {cell} from '../lib/writer.ts';
import {logs, makeWorkspace, NOW, STUDIO, testBacklog, testIdea} from './helpers.ts';

const W = (id: string) => parseWeek(id) as NonNullable<ReturnType<typeof parseWeek>>;
const realBacklogs = () => ({
	'zoora-ai': JSON.parse(readFileSync(join(STUDIO, 'content/zoora-ai/backlog.json'), 'utf8')),
	'zoora-security': JSON.parse(readFileSync(join(STUDIO, 'content/zoora-security/backlog.json'), 'utf8')),
});

test('plan writes plan.json, plan.md, a WRITER packet and a farm draft per episode, and pins the week', (t) => {
	const ws = makeWorkspace({backlogs: realBacklogs()});
	t.after(ws.cleanup);
	const L = logs();
	const r = runPlan({root: ws.root, configPath: ws.configPath, week: W('2026-W49'), nowMs: NOW, dryRun: false, factBank: null, log: L.log});
	assert.equal(r.plan.items.length, 11);
	for (const f of ['out/batch/2026-W49/plan.json', 'out/batch/2026-W49/plan.md', 'out/batch/2026-W49/ai1/WRITER.md', 'out/batch/2026-W49/ai2/WRITER.md', 'out/batch/2026-W49/sec1/WRITER.md', 'out/batch/2026-W49/sec2/WRITER.md', 'out/batch/2026-W49/ai1/render-request.json']) {
		assert.ok(existsSync(join(ws.root, f)), f);
	}
	const plan = ws.json<WeekPlan>('out/batch/2026-W49/plan.json');
	assert.equal(plan.kind, 'zoora-weekly-batch-plan');
	assert.equal(plan.timeZone, 'America/Chicago');
	assert.match(plan.status, /pending the owner's approval/);
	assert.deepEqual(plan.pinned.map((p) => `${p.channel}/${p.ideaId}`).sort(), ['zoora-ai/ai-agent-hedge-fund', 'zoora-ai/pumpfun-top-caller', 'zoora-security/explainer-wallet-drainers', 'zoora-security/sotw-fake-support']);
	const ai = ws.json<Backlog>('content/zoora-ai/backlog.json');
	assert.deepEqual(ai.ideas.filter((i) => i.week).map((i) => [i.id, i.week]), [['pumpfun-top-caller', '2026-W49'], ['ai-agent-hedge-fund', '2026-W49']]);
	// pinning changes only the week fields: everything else is byte-identical after a round trip
	const before = realBacklogs()['zoora-ai'] as {ideas: Array<{id: string; week: string | null}>};
	for (const i of before.ideas) if (['pumpfun-top-caller', 'ai-agent-hedge-fund'].includes(i.id)) i.week = '2026-W49';
	assert.equal(ws.read('content/zoora-ai/backlog.json'), `${JSON.stringify(before, null, 2)}\n`);
	const md = ws.read('out/batch/2026-W49/plan.md');
	assert.match(md, /\| Mon 2026-11-30 11:00 CST \| `ai1` \| Zoora AI \| POV story \(long-form\) \| POV: You become a top caller on Pump\.fun \|/);
	assert.match(md, /`ai1` \*\*POV: You become a top caller on Pump\.fun\*\* .*Shorts `ai1-s1`, `ai1-s2`, `ai1-s3`/);
});

test('planning the next week after a pinned week takes the next ideas; re-planning a week is stable', (t) => {
	const ws = makeWorkspace({backlogs: realBacklogs()});
	t.after(ws.cleanup);
	const quiet = () => {};
	runPlan({root: ws.root, configPath: ws.configPath, week: W('2026-W49'), nowMs: NOW, dryRun: false, factBank: null, log: quiet});
	const again = runPlan({root: ws.root, configPath: ws.configPath, week: W('2026-W49'), nowMs: NOW, dryRun: false, factBank: null, log: quiet});
	assert.deepEqual(again.plan.pinned, [], 'nothing new to pin');
	assert.deepEqual(again.plan.items.filter((i) => i.kind === 'long').map((i) => i.ideaId), ['pumpfun-top-caller', 'explainer-wallet-drainers', 'ai-agent-hedge-fund', 'sotw-fake-support']);
	const next = runPlan({root: ws.root, configPath: ws.configPath, week: W('2026-W50'), nowMs: NOW, dryRun: false, factBank: null, log: quiet});
	assert.deepEqual(next.plan.items.filter((i) => i.kind === 'long').map((i) => i.ideaId), ['pov-free-airdrop', 'explainer-ai-agents', 'pov-malicious-ai-plugin', 'sotw-deepfake-livestream']);
});

test('pin: false (--no-pin) writes the week\'s files but leaves the backlogs unchanged', (t) => {
	const ws = makeWorkspace({backlogs: realBacklogs()});
	t.after(ws.cleanup);
	const before = ws.read('content/zoora-ai/backlog.json');
	const r = runPlan({root: ws.root, configPath: ws.configPath, week: W('2026-W49'), nowMs: NOW, dryRun: false, pin: false, factBank: null, log: () => {}});
	assert.equal(r.pinnedFiles.length, 0);
	assert.equal(r.plan.pinned.length, 4, 'the plan still lists what it placed');
	assert.ok(existsSync(join(ws.root, 'out/batch/2026-W49/ai1/WRITER.md')));
	assert.equal(ws.read('content/zoora-ai/backlog.json'), before);
});

test('--dry-run writes nothing and pins nothing', (t) => {
	const ws = makeWorkspace({backlogs: realBacklogs()});
	t.after(ws.cleanup);
	const before = ws.read('content/zoora-ai/backlog.json');
	const r = runPlan({root: ws.root, configPath: ws.configPath, week: W('2026-W49'), nowMs: NOW, dryRun: true, factBank: null, log: () => {}});
	assert.equal(r.files.length, 0);
	assert.equal(existsSync(join(ws.root, 'out')), false);
	assert.equal(ws.read('content/zoora-ai/backlog.json'), before);
});

test('the WRITER packet carries the slots, the exact Short ids, the facts, the risks and the rules', (t) => {
	const ws = makeWorkspace({backlogs: realBacklogs()});
	t.after(ws.cleanup);
	ws.write('content/zoora-ai/pumpfun-top-caller/research.md', '# Research\n\n## Must not say (binding for the script)\n\n- (none)\n');
	runPlan({root: ws.root, configPath: ws.configPath, week: W('2026-W49'), nowMs: NOW, dryRun: false, factBank: null, log: () => {}});
	const w = ws.read('out/batch/2026-W49/ai1/WRITER.md');
	assert.match(w, /^# Writer packet: ai1 · POV: You become a top caller on Pump\.fun/);
	assert.match(w, /\*\*Long-form:\*\* 2026-11-30 11:00 CST \(`publishAt` 2026-11-30T17:00:00\.000Z\)/);
	assert.match(w, /\*\*Shorts cut from it \(exactly 3\):\*\* `short-1` 2026-11-30 17:00 CST · `short-2` 2026-12-01 17:00 CST · `short-3` 2026-12-02 17:00 CST/);
	assert.match(w, /`content\/zoora-ai\/pumpfun-top-caller\/research\.md` exists/);
	assert.match(w, /\| 15 \| Regulators' advice on paid touts and single tips \(Investor\.gov, CFTC\) \| research needed \|/);
	assert.match(w, /\| 1 \| When Pump\.fun launched and what it lets anyone do \| fact-bank \| `pumpfun-launch-month` \|/);
	assert.match(w, /no real caller names, handles or likenesses/);
	assert.match(w, /Zoo \(title case, never "ZOO"\)/);
	assert.doesNotMatch(w, /\$ZOO\b/, 'ZOO is a real token and the banned spelling of the host: never the example ticker');
	assert.match(w, /an invented ticker that a web search shows is no live token, e\.g\. \$QZLX \/ SOL/);
	assert.match(w, /Never upload, publish or post anything\. `approve` runs only on the owner's own reply/);
	assert.match(w, /--fit-to en --voice im_nicola/);
	const skeleton = JSON.parse(/### Storyboard skeleton[\s\S]*?```json\n([\s\S]*?)\n```/.exec(w)?.[1] ?? '{}') as {fiction: boolean; shorts: Array<{id: string}>; channel: string};
	assert.equal(skeleton.channel, 'zoora-ai');
	assert.equal(skeleton.fiction, true);
	assert.deepEqual(skeleton.shorts.map((s) => s.id), ['short-1', 'short-2', 'short-3']);
	const episode = JSON.parse(/### episode\.json skeleton[\s\S]*?```json\n([\s\S]*?)\n```/.exec(w)?.[1] ?? '{}') as {shortCuts: Array<{id: string}>; render: {entry: string; shortComposition: string}; madeForKids: {value: boolean}};
	assert.deepEqual(episode.shortCuts.map((s) => s.id), ['short-1', 'short-2', 'short-3']);
	assert.equal(episode.render.shortComposition, 'EpisodeShort');
	assert.equal(episode.madeForKids.value, false);

	const sec = ws.read('out/batch/2026-W49/sec1/WRITER.md');
	assert.match(sec, /an Evergreen explainer for The Zoo & Badger Show/);
	assert.match(sec, /\*\*Shorts:\*\* none planned/);
	assert.match(sec, /does not exist yet\.\*\* Write it before the script/);
	const show = JSON.parse(/```json\n([\s\S]*?)\n```/.exec(sec)?.[1] ?? '{}') as {fiction: boolean; scenes: Array<{segment?: string}>; shorts?: unknown};
	assert.equal(show.fiction, false);
	assert.deepEqual(show.scenes.map((s) => s.segment), ['coldOpen', 'desk', 'howItWorked', 'beat', 'badgerRedFlag', 'zooOneFix', 'sources', 'outroEndScreen']);
	assert.equal(show.shorts, undefined);
	const sotw = ws.read('out/batch/2026-W49/sec2/WRITER.md');
	assert.match(sotw, /"segment": "scamOfTheWeek"/);
});

test('the farm drafts pass the render farm\'s own validator, English renders on the kit\'s media paths', (t) => {
	const ws = makeWorkspace({backlogs: realBacklogs()});
	t.after(ws.cleanup);
	runPlan({root: ws.root, configPath: ws.configPath, week: W('2026-W49'), nowMs: NOW, dryRun: false, factBank: null, log: () => {}});
	for (const id of ['ai1', 'ai2', 'sec1', 'sec2']) {
		const raw = ws.json<{id: string}>(`out/batch/2026-W49/${id}/render-request.json`);
		const v = validateRequest(raw, raw.id);
		assert.ok(v.ok, `${id}: ${v.ok ? '' : v.errors.join('; ')}`);
	}
	const ai2 = ws.json<{id: string; encrypt: boolean; voice: Array<{lang: string; voice: string}>; jobs: Array<{composition: string; output: string; props: Record<string, string>}>}>('out/batch/2026-W49/ai2/render-request.json');
	assert.equal(ai2.id, 'batch-2026-w49-ai2');
	assert.equal(ai2.encrypt, true);
	assert.deepEqual(ai2.voice.map((v) => `${v.lang}:${v.voice}`), ['en:im_nicola', 'es:im_nicola', 'pt-br:im_nicola']);
	assert.deepEqual((ai2.voice as Array<{lang: string; fitTo?: string}>).map((v) => v.fitTo ?? null), [null, 'en', 'en'], 'dubs are fitted to the English timeline, for multi-language audio tracks');
	const jobs = ai2.jobs as Array<{composition: string; kind: string; output: string; props: Record<string, string>}>;
	assert.deepEqual(jobs.filter((j) => j.kind === 'video').map((j) => `${j.composition} ${j.output} ${j.props.shortId ?? ''}`.trim()), [
		'Episode out/publish/zoora-ai/ai-agent-hedge-fund/media/long.mp4',
		'EpisodeShort out/publish/zoora-ai/ai-agent-hedge-fund/media/short-1.mp4 short-1',
		'EpisodeShort out/publish/zoora-ai/ai-agent-hedge-fund/media/short-2.mp4 short-2',
		'EpisodeShort out/publish/zoora-ai/ai-agent-hedge-fund/media/short-3.mp4 short-3',
		'EpisodeShort out/publish/zoora-ai/ai-agent-hedge-fund/media/short-4.mp4 short-4',
	]);
	assert.deepEqual(jobs.filter((j) => j.kind === 'audio').map((j) => `${j.composition} ${j.props.lang} ${j.output}`).slice(0, 2), [
		'Episode es out/publish/zoora-ai/ai-agent-hedge-fund/media/dubs/es/long.wav',
		'EpisodeShort es out/publish/zoora-ai/ai-agent-hedge-fund/media/dubs/es/short-1.wav',
	]);
	assert.equal(jobs.filter((j) => j.kind === 'audio').length, 10, 'one dub track per video and dub language');
	const sec1 = ws.json<{entry: string; jobs: Array<{composition: string; kind: string; props: {lang: string}}>}>('out/batch/2026-W49/sec1/render-request.json');
	assert.equal(sec1.entry, 'src/show/index.ts');
	assert.deepEqual(sec1.jobs.map((j) => `${j.composition} ${j.kind} ${j.props.lang}`), ['ShowEpisode video en', 'ShowEpisode audio es', 'ShowEpisode audio pt-br']);
});

test('the packet lists fact-bank facts by id and by topic tag, and flags ids the bank lacks', (t) => {
	const ai = testBacklog('zoora-ai', [
		testIdea('bank-test', 'pov-story', 1, {
			factTags: ['test-tag'],
			facts: [
				{need: 'A stored fact', factId: 'fb-one', status: 'fact-bank'},
				{need: 'A missing fact', factId: 'fb-missing', status: 'fact-bank'},
			],
		}),
		testIdea('other', 'pov-story', 2),
	]);
	const sec = testBacklog('zoora-security', [testIdea('e1', 'explainer', 1), testIdea('s1', 'scam-of-the-week', 1)]);
	const ws = makeWorkspace({backlogs: {'zoora-ai': ai, 'zoora-security': sec}});
	t.after(ws.cleanup);
	const fact = (id: string, statement: string, extra: Record<string, unknown> = {}) =>
		JSON.stringify({id, statement, numbers: [], entities: [], tags: ['unrelated'], volatility: 'historical', verification: 'direct-read', verifiedAt: '2026-11-20', recheckAfter: '2027-11-20', sources: [{url: 'https://example.com/a', title: 'Example page', publisher: 'Example Org', tier: 'primary', accessed: '2026-11-20', excerpt: 'x', checks: []}], languages: {}, usage: [], notes: '', ...extra});
	const bank = ws.write('content/facts/facts.jsonl', [fact('fb-one', 'A fictional stored statement.'), fact('fb-tagged', 'A fictional tagged statement | with a pipe.', {tags: ['test-tag']}), fact('fb-stale', 'A stale one.', {tags: ['test-tag'], recheckAfter: '2026-01-01'}), 'not json'].join('\n'));
	assert.equal(loadFactBank(bank).facts?.size, 3);
	runPlan({root: ws.root, configPath: ws.configPath, week: W('2026-W49'), nowMs: NOW, dryRun: false, factBank: bank, log: () => {}});
	const w = ws.read('out/batch/2026-W49/ai1/WRITER.md');
	assert.match(w, /\| `fb-one` \| A fictional stored statement\. \| direct-read \| 2026-11-20 \| Example Org \|/);
	assert.match(w, /\*\*Not in the fact bank:\*\* `fb-missing`/);
	assert.match(w, /\| `fb-tagged` \| A fictional tagged statement \\\| with a pipe\. \|/);
	assert.match(w, /\| `fb-stale` \| A stale one\. \| direct-read \(not usable: unverified or stale\) \|/);
});

test('markdown cells cannot break the table or inject links', () => {
	assert.equal(cell('a | b\n<script>[x](javascript:y)`'), 'a \\| b \\<script\\>\\[x\\](javascript:y)\\`');
});
