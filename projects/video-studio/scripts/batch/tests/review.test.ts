import assert from 'node:assert/strict';
import {existsSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import {test} from 'node:test';
import {displayNarration, inspectItem, safeStudioPath} from '../lib/inspect.ts';
import {readPlan, runPlan} from '../lib/plan.ts';
import {runReview, type ReviewSnapshot} from '../lib/review.ts';
import {esc, safeRelative, safeUrl} from '../lib/escape.ts';
import type {PlanItem} from '../lib/types.ts';
import {parseWeek} from '../lib/week.ts';
import {buildEpisode, makeWorkspace, NOW, testBacklog, testIdea, type Workspace} from './helpers.ts';

const W = (id: string) => parseWeek(id) as NonNullable<ReturnType<typeof parseWeek>>;

/** Two Zoora AI stories (ai1 = "alpha", ai2 = "beta") and two security pieces, planned for 2026-W49. */
const plannedWorkspace = (o: {categoryId?: string | null} = {}): Workspace => {
	const ws = makeWorkspace({
		backlogs: {
			'zoora-ai': testBacklog('zoora-ai', [testIdea('alpha', 'pov-story', 1), testIdea('beta', 'pov-story', 2)]),
			'zoora-security': testBacklog('zoora-security', [testIdea('sec-expl', 'explainer', 1), testIdea('sec-sotw', 'scam-of-the-week', 1)]),
		},
		categoryId: o.categoryId,
	});
	runPlan({root: ws.root, configPath: ws.configPath, week: W('2026-W49'), nowMs: NOW, dryRun: false, factBank: null, log: () => {}});
	return ws;
};

const review = (ws: Workspace, extra: {copyMedia?: boolean} = {}) => runReview({root: ws.root, week: '2026-W49', hub: '../creator-hub', channelsPath: ws.channelsPath, nowMs: NOW, copyMedia: extra.copyMedia ?? false, log: () => {}});

test('readiness: a fully built episode and its Shorts are READY; missing pieces are named', async (t) => {
	const ws = plannedWorkspace();
	t.after(ws.cleanup);
	buildEpisode(ws, {channel: 'zoora-ai', slug: 'alpha', shorts: 3});
	const r = await review(ws);
	assert.deepEqual(r.model.ready, ['ai1', 'ai1-s1', 'ai1-s2', 'ai1-s3']);
	assert.deepEqual(r.model.notReady, ['sec1', 'ai2', 'ai2-s1', 'ai2-s2', 'sec2', 'ai2-s3', 'ai2-s4']);
	const sec1 = r.model.items.find((i) => i.state.item.id === 'sec1');
	assert.ok(sec1?.state.blockers.some((b) => /No storyboard yet \(content\/zoora-security\/sec-expl\/storyboard\.json\)/.test(b)));
	assert.ok(sec1?.state.blockers.some((b) => /the claim gate has not run/.test(b)));
	assert.ok(sec1?.state.blockers.some((b) => /No English voice timeline/.test(b)));
	assert.ok(sec1?.state.blockers.some((b) => /No publish kit/.test(b)));
	assert.ok(sec1?.state.blockers.some((b) => /Not rendered yet/.test(b)));
	assert.ok(sec1?.state.blockers.some((b) => /No thumbnails/.test(b)));
});

test('each kind of problem blocks the item with its fix', async (t) => {
	const ws = plannedWorkspace();
	t.after(ws.cleanup);
	buildEpisode(ws, {channel: 'zoora-ai', slug: 'alpha', shorts: 2, claimPass: false, kitCheckOk: false, voice: 'am_michael'});
	const {plan} = readPlan(ws.root, '2026-W49');
	const ai1 = await inspectItem(ws.root, plan.items.find((i) => i.id === 'ai1') as PlanItem);
	assert.equal(ai1.ready, false);
	assert.ok(ai1.blockers.some((b) => /claim gate FAILS with 1 error/.test(b)));
	assert.ok(ai1.blockers.some((b) => /voiced with am_michael; Zoo's voice is im_nicola/.test(b)));
	assert.ok(ai1.blockers.some((b) => /Publish-kit checks fail: income-claims/.test(b)));
	const s3 = await inspectItem(ws.root, plan.items.find((i) => i.id === 'ai1-s3') as PlanItem);
	assert.ok(s3.blockers.some((b) => /The storyboard has 2 Short\(s\); this item is Short 3/.test(b)));
	assert.ok(s3.blockers.some((b) => /The kit has no render "short-3"/.test(b)));
	assert.ok(s3.blockers.some((b) => /shorts-3\.txt is missing/.test(b)));
});

test('a storyboard edited after the gate or the render blocks the item until both run again', async (t) => {
	const ws = plannedWorkspace();
	t.after(ws.cleanup);
	buildEpisode(ws, {channel: 'zoora-ai', slug: 'alpha', shorts: 3});
	// edited after the gate (t0 + 2 min) and the render (t0 + 4 min)
	ws.write('content/zoora-ai/alpha/storyboard.json', ws.read('content/zoora-ai/alpha/storyboard.json').replace('Scene s03', 'Scene s03 (edited)'), NOW);
	const {plan} = readPlan(ws.root, '2026-W49');
	const s = await inspectItem(ws.root, plan.items.find((i) => i.id === 'ai1') as PlanItem);
	assert.ok(s.blockers.some((b) => /the storyboard changed after the claim gate ran/.test(b)));
	assert.ok(s.blockers.some((b) => /The render is older than the current storyboard/.test(b)));
});

test('dubs are shown per language and never block the English upload', async (t) => {
	const ws = plannedWorkspace();
	t.after(ws.cleanup);
	buildEpisode(ws, {channel: 'zoora-ai', slug: 'alpha', shorts: 3});
	const sb = JSON.parse(ws.read('content/zoora-ai/alpha/storyboard.json')) as Record<string, unknown>;
	ws.write('content/zoora-ai/alpha/storyboard.es.json', JSON.stringify({...sb, lang: 'es', translation: {status: 'machine', method: 'machine', reviewed: false}}), NOW - 1_000_000);
	ws.write('out/claims/alpha.es.json', JSON.stringify({tool: 'claims/check', pass: true, errors: 0, warnings: 0, checkedAt: new Date(NOW - 900_000).toISOString(), findings: [], waivers: []}), NOW - 900_000);
	ws.write('public/generated/zoora-ai/alpha/es/timeline.json', JSON.stringify({version: 1, mode: 'fit-to-master', voice: 'im_nicola'}), NOW - 800_000);
	const {plan} = readPlan(ws.root, '2026-W49');
	const s = await inspectItem(ws.root, plan.items.find((i) => i.id === 'ai1') as PlanItem);
	assert.equal(s.ready, true);
	const es = s.dubs.find((d) => d.lang === 'es');
	assert.equal(es?.ready, true);
	assert.equal(es?.reviewed, false);
	assert.ok(es?.notes.some((n) => /needs a native review/.test(n)));
	const pt = s.dubs.find((d) => d.lang === 'pt-br');
	assert.equal(pt?.ready, false);
	assert.ok(pt?.notes.some((n) => /not translated yet/.test(n)));
	const page = await review(ws);
	const item = page.model.items.find((i) => i.state.item.id === 'ai1');
	assert.ok(item?.studioSteps.some((x) => /none ready yet; es, pt-br only after its native review/.test(x)));
});

test('the page escapes everything, runs no script, links only http(s), and shows the approve and edit replies', async (t) => {
	const ws = plannedWorkspace();
	t.after(ws.cleanup);
	buildEpisode(ws, {channel: 'zoora-ai', slug: 'alpha', shorts: 3, narration: 'Hostile <script>alert(1)</script> & "quoted" `tick` {$5|five dollars} [src:ex1].', sourceTitle: '"><img src=x onerror=alert(2)>', sourceUrl: 'javascript:alert(3)'});
	const r = await review(ws);
	const html = readFileSync(r.pagePath, 'utf8');
	assert.equal(r.pagePath, join(ws.root, 'out/approval/week-2026-W49/index.html'));
	assert.doesNotMatch(html, /<script/i);
	assert.doesNotMatch(html, /<img src=x/);
	assert.doesNotMatch(html, /href="javascript:/);
	assert.match(html, /Hostile &lt;script&gt;alert\(1\)&lt;\/script&gt; &amp; &quot;quoted&quot; &#96;tick&#96; \$5\./);
	assert.match(html, /&quot;&gt;&lt;img src=x onerror=alert\(2\)&gt;/);
	assert.match(html, /<meta http-equiv="Content-Security-Policy" content="script-src 'none'/);
	assert.match(html, /<meta name="viewport" content="width=device-width,initial-scale=1">/);
	assert.match(html, /prefers-color-scheme:dark/);
	assert.match(html, /Approve every READY item: reply <code>APPROVE 2026-W49 all<\/code>/);
	assert.match(html, /Approve: reply <code>APPROVE 2026-W49 ai1<\/code>/);
	assert.match(html, /Edit: reply <code>EDIT ai1: &lt;what to change&gt;<\/code>/);
	assert.match(html, /Proposed slot: <b>Mon 2026-11-30 11:00 CST<\/b> \(17:00 UTC\)/);
	assert.match(html, /<video controls playsinline preload="none" src="\.\.\/\.\.\/publish\/zoora-ai\/alpha\/media\/long\.mp4">/);
	assert.match(html, /<img alt="v0\.png" src="media\/ai1\/v0\.png">/);
	assert.ok(existsSync(join(ws.root, 'out/approval/week-2026-W49/media/ai1/v0.png')), 'thumbnails are copied next to the page');
	assert.match(html, /Set the Short&#39;s Related video to &quot;Test idea alpha&quot; \(ai1\)/);
	assert.match(html, /Made for kids: <b>No<\/b>/);
	assert.match(html, /Privacy: <b>private<\/b>/);
});

test('review.json records readiness and the hash of every file the page showed', async (t) => {
	const ws = plannedWorkspace({categoryId: null});
	t.after(ws.cleanup);
	buildEpisode(ws, {channel: 'zoora-ai', slug: 'alpha', shorts: 3});
	const r = await review(ws, {copyMedia: true});
	const snap = JSON.parse(readFileSync(r.snapshotPath, 'utf8')) as ReviewSnapshot;
	assert.equal(snap.kind, 'zoora-weekly-review');
	const ai1 = snap.items.find((i) => i.id === 'ai1');
	assert.equal(ai1?.ready, true);
	assert.deepEqual(Object.keys(ai1?.hashes ?? {}).sort(), [
		'content/zoora-ai/alpha/storyboard.json',
		'out/claims/alpha.en.json',
		'out/publish/zoora-ai/alpha/kit.json',
		'out/publish/zoora-ai/alpha/media/long.mp4',
		'out/publish/zoora-ai/alpha/media/thumbnails/en/v0.png',
		'out/publish/zoora-ai/alpha/media/thumbnails/en/v1.png',
		'out/publish/zoora-ai/alpha/media/thumbnails/en/v2.png',
	]);
	assert.ok(Object.values(ai1?.hashes ?? {}).every((h) => typeof h === 'string' && /^[0-9a-f]{64}$/.test(h)));
	assert.equal(snap.items.find((i) => i.id === 'ai1-s2')?.hashes['out/publish/zoora-ai/alpha/shorts-2.txt']?.length, 64);
	assert.ok(existsSync(join(ws.root, 'out/approval/week-2026-W49/media/ai1/long.mp4')), '--copy-media copies the preview');
	assert.ok(r.model.ownerInputs.some((x) => /no YouTube category is set for zoora-ai/.test(x)), 'the owner decision approve needs first');
});

test('kit media paths outside the studio folders block the item; a tampered plan is refused', async (t) => {
	const ws = plannedWorkspace();
	t.after(ws.cleanup);
	buildEpisode(ws, {channel: 'zoora-ai', slug: 'alpha', shorts: 3});
	const kit = JSON.parse(ws.read('out/publish/zoora-ai/alpha/kit.json')) as {renders: Array<{id: string; output: string}>};
	kit.renders = kit.renders.map((r) => (r.id === 'long' ? {...r, output: '../../../etc/passwd'} : r));
	ws.write('out/publish/zoora-ai/alpha/kit.json', JSON.stringify(kit));
	const {plan} = readPlan(ws.root, '2026-W49');
	const s = await inspectItem(ws.root, plan.items.find((i) => i.id === 'ai1') as PlanItem);
	assert.ok(s.blockers.some((b) => /points outside out\//.test(b)));
	const tampered = JSON.parse(ws.read('out/batch/2026-W49/plan.json')) as {items: Array<{paths: {render: string}}>};
	tampered.items[0].paths.render = '/etc/passwd';
	ws.write('out/batch/2026-W49/plan.json', JSON.stringify(tampered));
	assert.throws(() => readPlan(ws.root, '2026-W49'), /has a path outside out\/, content\/ or public\//);
	assert.equal(safeStudioPath('out/publish/zoora-ai/alpha/media/long.mp4'), true);
	assert.equal(safeStudioPath('out/../secret'), false);
	assert.equal(safeStudioPath('out/.hidden/x'), false);
	assert.equal(safeStudioPath('src/index.ts'), false);
});

test('escaping helpers', () => {
	assert.equal(esc(`<a href="x">'&'</a>\``), '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;&#96;');
	assert.equal(safeUrl('javascript:alert(1)'), null);
	assert.equal(safeUrl('https://user:pw@example.com/'), null);
	assert.equal(safeUrl('https://example.com/a b'), 'https://example.com/a%20b');
	assert.equal(safeRelative('../../publish/zoora-ai/x/media/long.mp4'), '../../publish/zoora-ai/x/media/long.mp4');
	assert.equal(safeRelative('media/ai1/v0.png'), 'media/ai1/v0.png');
	assert.equal(safeRelative('../../publish/../../etc/passwd'), null);
	assert.equal(safeRelative('/etc/passwd'), null);
	assert.equal(safeRelative('javascript:alert(1)'), null);
	assert.deepEqual(displayNarration('It cost {$4.5M|four point five million dollars} [src:a, b]. Then [src:c] more.'), {text: 'It cost $4.5M. Then more.', refs: ['a', 'b', 'c']});
});
