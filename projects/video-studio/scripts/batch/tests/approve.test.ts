/**
 * The approve step against the REAL creator-hub uploader code (tools/uploader: inputs, prepare, approval), with a
 * temp channels.json and state folder. fetch is replaced so any network use fails the test.
 */
import assert from 'node:assert/strict';
import {existsSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import {test} from 'node:test';
import {parseReply, runApprove, sameSelection, type ApproveOptions} from '../lib/approve.ts';
import {runPlan} from '../lib/plan.ts';
import {runReview, type ReviewSnapshot} from '../lib/review.ts';
import {loadUploader} from '../lib/uploader.ts';
import {sha256} from '../lib/util.ts';
import {parseWeek} from '../lib/week.ts';
import {buildEpisode, fakeVideo, HUB, logs, makeWorkspace, noNetwork, NOW, testBacklog, testIdea, type Workspace} from './helpers.ts';

const W = (id: string) => parseWeek(id) as NonNullable<ReturnType<typeof parseWeek>>;

const ready = async (o: {categoryId?: string | null} = {}): Promise<Workspace> => {
	const ws = makeWorkspace({
		backlogs: {
			'zoora-ai': testBacklog('zoora-ai', [testIdea('alpha', 'pov-story', 1), testIdea('beta', 'pov-story', 2)]),
			'zoora-security': testBacklog('zoora-security', [testIdea('sec-expl', 'explainer', 1), testIdea('sec-sotw', 'scam-of-the-week', 1)]),
		},
		categoryId: o.categoryId,
	});
	runPlan({root: ws.root, configPath: ws.configPath, week: W('2026-W49'), nowMs: NOW, dryRun: false, factBank: null, log: () => {}});
	buildEpisode(ws, {channel: 'zoora-ai', slug: 'alpha', shorts: 3});
	buildEpisode(ws, {channel: 'zoora-security', slug: 'sec-expl', shorts: 0});
	await runReview({root: ws.root, week: '2026-W49', hub: '../creator-hub', channelsPath: ws.channelsPath, nowMs: NOW, copyMedia: false, log: () => {}});
	return ws;
};

/** The current page's code, as every reply on the page carries it. */
const code = (ws: Workspace): string => ws.json<ReviewSnapshot>('out/approval/week-2026-W49/review.json').page.code;
const rebuild = (ws: Workspace, nowMs = NOW + 60_000) => runReview({root: ws.root, week: '2026-W49', hub: '../creator-hub', channelsPath: ws.channelsPath, nowMs, copyMedia: false, log: () => {}});

const opts = (ws: Workspace, o: Partial<ApproveOptions>): ApproveOptions => ({
	root: ws.root,
	week: '2026-W49',
	items: 'all',
	reply: null,
	prompt: null,
	hubDir: HUB,
	channelsPath: ws.channelsPath,
	stateDir: ws.stateDir,
	nowMs: NOW,
	validDays: 7,
	by: 'owner',
	log: () => {},
	...o,
});

test('the owner\'s reply approves exactly the named items: uploader approval records next to each kit, nothing uploaded', async (t) => {
	const ws = await ready();
	const restore = noNetwork();
	t.after(() => {
		restore();
		ws.cleanup();
	});
	const L = logs();
	const reply = `APPROVE 2026-W49 ai1, ai1-s1, sec1 #${code(ws)}`;
	const r = await runApprove(opts(ws, {items: ['ai1', 'ai1-s1', 'sec1'], reply, log: L.log}));
	assert.equal(r.exitCode, 0, L.text());
	assert.deepEqual(r.approved.map((a) => [a.id, a.approval, a.publishAt]), [
		['ai1', 'out/publish/zoora-ai/alpha/approval-long.json', '2026-11-30T17:00:00.000Z'],
		['ai1-s1', 'out/publish/zoora-ai/alpha/approval-short-1.json', '2026-11-30T23:00:00.000Z'],
		['sec1', 'out/publish/zoora-security/sec-expl/approval-long.json', '2026-12-01T19:00:00.000Z'],
	]);
	const uploader = await loadUploader(HUB);
	const channels = uploader.loadChannels(ws.channelsPath);
	for (const a of r.approved) {
		const path = join(ws.root, a.approval);
		const record = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
		// the uploader's own strict parser accepts it, and its own verification finds nothing to refuse
		const parsed = uploader.parseApproval(record, path);
		assert.ok(parsed.ok, JSON.stringify(parsed));
		assert.equal(record.kind, 'youtube-upload-approval');
		assert.equal(record.approvedBy, 'owner');
		assert.equal(record.publishAt, a.publishAt);
		assert.equal((record.summary as {privacyStatus: string}).privacyStatus, 'private');
		assert.equal((record.render as {id: string}).id, a.renderId);
		const media = a.renderId === 'long' ? 'long.mp4' : `${a.renderId}.mp4`;
		assert.equal((record.render as {sha256: string}).sha256, sha256(readFileSync(join(ws.root, 'out/publish', a.channel, a.slug, 'media', media))), 'bound to the exact file the page showed');
		assert.equal((record.storyboard as {sha256: string}).sha256, sha256(readFileSync(join(ws.root, 'content', a.channel, a.slug, 'storyboard.json'))));
		const check = await uploader.prepareFromApproval({kitPath: join(ws.root, a.kit), approvalPath: path, videoStudioRoot: ws.root, channels, stateDir: ws.stateDir, nowMs: NOW, processingPolls: 20, allowSecondUpload: false});
		assert.deepEqual(check.refusals, []);
		assert.equal(check.plan.publishAt, a.publishAt);
		assert.equal(check.plan.insert.body.status.privacyStatus, 'private');
		assert.equal(check.plan.insert.body.status.selfDeclaredMadeForKids, false);
	}
	assert.equal(existsSync(join(ws.stateDir, 'ledger.json')), false, 'nothing was uploaded');
	assert.equal(existsSync(join(ws.stateDir, 'jobs')), false);
	const index = ws.json<{kind: string; reply: string; items: Array<{id: string; uploadCommand: string}>}>('out/approval/week-2026-W49/approvals.json');
	assert.equal(index.kind, 'zoora-weekly-approvals');
	assert.equal(index.reply, reply);
	assert.match(ws.json<{note: string}>('out/publish/zoora-ai/alpha/approval-long.json').note, new RegExp(`on the weekly page #${code(ws)}`));
	assert.match(index.items[0].uploadCommand, /^node tools\/uploader\/cli\.ts upload .*out\/publish\/zoora-ai\/alpha\/kit\.json --approval .*approval-long\.json --apply$/);
	assert.match(L.text(), /Nothing was uploaded\./);
});

test('"all" approves every item that was READY on the page and nothing else', async (t) => {
	const ws = await ready();
	t.after(ws.cleanup);
	const r = await runApprove(opts(ws, {items: 'all', reply: `APPROVE 2026-W49 all #${code(ws)}`}));
	assert.equal(r.exitCode, 0);
	assert.deepEqual(r.approved.map((a) => a.id), ['ai1', 'ai1-s1', 'sec1', 'ai1-s2', 'ai1-s3']);
	assert.equal(existsSync(join(ws.root, 'out/publish/zoora-ai/beta/approval-long.json')), false);
});

test('no approval without the owner: a missing, malformed or mismatched reply writes nothing', async (t) => {
	const ws = await ready();
	t.after(ws.cleanup);
	const none = async (o: Partial<ApproveOptions>) => {
		const r = await runApprove(opts(ws, o));
		assert.equal(r.exitCode, 4, JSON.stringify(o));
		assert.equal(existsSync(join(ws.root, 'out/publish/zoora-ai/alpha/approval-long.json')), false);
	};
	const c = code(ws);
	await none({items: ['ai1']});
	await none({items: ['ai1'], reply: 'looks good, go ahead'});
	await none({items: ['ai1'], reply: `APPROVE 2026-W50 ai1 #${c}`});
	await none({items: ['ai1'], reply: `APPROVE 2026-W49 ai1 ai1-s1 #${c}`});
	await none({items: 'all', reply: `APPROVE 2026-W49 ai1 #${c}`});
	await none({items: ['ai1'], reply: `APPROVE 2026-W49 all #${c}`});
	await none({items: ['ai1'], prompt: async () => 'yes'});
	// the page code is required, and must be this page's
	await none({items: ['ai1'], reply: 'APPROVE 2026-W49 ai1'});
	await none({items: ['ai1'], reply: 'APPROVE 2026-W49 ai1 #00000000'});
	await none({items: ['ai1'], reply: `APPROVE 2026-W49 ai1 ${c}`});
	await none({items: ['ai1'], prompt: async () => '2026-W49'});
	await none({items: ['ai1'], prompt: async () => '#00000000'});
});

test('at a terminal the owner types the code of the page he reviewed', async (t) => {
	const ws = await ready();
	t.after(ws.cleanup);
	const asked: string[] = [];
	const r = await runApprove(opts(ws, {items: ['ai1'], prompt: async (q) => (asked.push(q), `#${code(ws).toUpperCase()}`)}));
	assert.equal(r.exitCode, 0);
	assert.match(asked[0], /Type the page code shown at the top of the 2026-W49 page you reviewed/);
	assert.doesNotMatch(asked[0], new RegExp(code(ws)), 'the prompt never prints the code it asks for');
	const record = ws.json<{note: string}>('out/publish/zoora-ai/alpha/approval-long.json');
	assert.match(record.note, /approved at a terminal/);
});

test('a reply only approves the page it carries the code of: a page rebuilt after the reply is refused', async (t) => {
	const ws = await ready();
	const restore = noNetwork();
	t.after(() => {
		restore();
		ws.cleanup();
	});
	const longRel = 'out/publish/zoora-ai/alpha/media/long.mp4';
	const v1 = code(ws);
	const reply = `APPROVE 2026-W49 ai1 #${v1}`; // the owner answers page v1
	// afterwards the render is replaced (an EDIT round, a re-render) and the page is rebuilt
	ws.write(longRel, fakeVideo(41_000, 999), NOW - 1000);
	await rebuild(ws);
	const v2 = code(ws);
	assert.notEqual(v2, v1);
	assert.ok(existsSync(join(ws.root, `out/approval/week-2026-W49/review-${v1}.json`)), 'the page he answered keeps its record');
	assert.ok(existsSync(join(ws.root, `out/approval/week-2026-W49/review-${v2}.json`)));
	const L = logs();
	const r = await runApprove(opts(ws, {items: ['ai1'], reply, nowMs: NOW + 120_000, log: L.log}));
	assert.equal(r.exitCode, 4, L.text());
	assert.match(L.text(), new RegExp(`answers the page built .* \\(#${v1}\\), but the page was rebuilt since: the current page is #${v2}`));
	assert.equal(existsSync(join(ws.root, 'out/publish/zoora-ai/alpha/approval-long.json')), false, 'nothing is approved');
	// his reply to the new page approves exactly the file that page showed
	const r2 = await runApprove(opts(ws, {items: ['ai1'], reply: `APPROVE 2026-W49 ai1 #${v2}`, nowMs: NOW + 120_000}));
	assert.equal(r2.exitCode, 0);
	const record = ws.json<{render: {sha256: string}}>('out/publish/zoora-ai/alpha/approval-long.json');
	assert.equal(record.render.sha256, sha256(readFileSync(join(ws.root, longRel))));
	assert.equal(ws.json<ReviewSnapshot>(`out/approval/week-2026-W49/review-${v2}.json`).items.find((i) => i.id === 'ai1')?.hashes[longRel], record.render.sha256);
});

test('an upload spec added after the page was built is refused; on a rebuilt page it is shown, linted and blocks on a claim', async (t) => {
	const ws = await ready();
	const restore = noNetwork();
	t.after(() => {
		restore();
		ws.cleanup();
	});
	const specRel = 'content/zoora-ai/alpha/upload-spec.long.json';
	const pageBefore = ws.read('out/approval/week-2026-W49/index.html');
	ws.write(specRel, JSON.stringify({version: 1, localizations: {es: {title: 'Ganancias garantizadas: hazte rico con memecoins', description: 'Sin riesgo. Ingresos pasivos.'}}}));
	const L = logs();
	const r = await runApprove(opts(ws, {items: ['ai1'], reply: `APPROVE 2026-W49 ai1 #${code(ws)}`, nowMs: NOW + 60_000, log: L.log}));
	assert.equal(r.exitCode, 3, L.text());
	assert.match(r.refused[0].reasons[0], /Changed since the page was built: content\/zoora-ai\/alpha\/upload-spec\.long\.json/);
	assert.equal(existsSync(join(ws.root, 'out/publish/zoora-ai/alpha/approval-long.json')), false);
	assert.equal(pageBefore.includes('Ganancias'), false);
	// rebuilt: the page shows the spec's text, and the shared es/pt-br income lint blocks the item
	const page = await rebuild(ws);
	const html = ws.read('out/approval/week-2026-W49/index.html');
	assert.match(html, /Upload spec: extra metadata the upload sends/);
	assert.match(html, /Ganancias garantizadas: hazte rico con memecoins/);
	assert.match(html, /Sin riesgo\. Ingresos pasivos\./);
	const ai1 = page.model.items.find((i) => i.state.item.id === 'ai1');
	assert.equal(ai1?.state.ready, false);
	assert.ok(ai1?.state.blockers.some((b) => /localizations\.es\.title: income or return claim \(garantizado/.test(b)), JSON.stringify(ai1?.state.blockers));
	assert.ok(ai1?.state.blockers.some((b) => /localizations\.es\.description: income or return claim \(sin riesgo/.test(b)));
	const r2 = await runApprove(opts(ws, {items: ['ai1'], reply: `APPROVE 2026-W49 ai1 #${code(ws)}`, nowMs: NOW + 120_000}));
	assert.equal(r2.exitCode, 3);
	assert.match(r2.refused[0].reasons[0], /It was NOT READY on the page you reviewed/);
});

test('a clean upload spec is shown in full and bound to the approval; a caption file it names is hashed too', async (t) => {
	const ws = await ready();
	const restore = noNetwork();
	t.after(() => {
		restore();
		ws.cleanup();
	});
	const specRel = 'content/zoora-ai/alpha/upload-spec.long.json';
	const srtRel = 'content/zoora-ai/alpha/captions.es.srt';
	ws.write(srtRel, '1\n00:00:00,000 --> 00:00:02,000\nUna historia ficticia.\n');
	ws.write(specRel, JSON.stringify({version: 1, tags: ['estafas', 'seguridad'], localizations: {es: {title: 'POV: el falso soporte técnico', description: 'Una historia ficticia sobre una estafa.'}}, captions: [{language: 'es', name: 'Español', file: srtRel}]}));
	await rebuild(ws);
	const html = ws.read('out/approval/week-2026-W49/index.html');
	assert.match(html, /POV: el falso soporte técnico/);
	assert.match(html, /<code>estafas<\/code> <code>seguridad<\/code>/);
	assert.match(html, /Caption track es “Español”: <code>content\/zoora-ai\/alpha\/captions\.es\.srt<\/code>/);
	const snap = ws.json<ReviewSnapshot>('out/approval/week-2026-W49/review.json');
	assert.deepEqual(Object.keys(snap.items.find((i) => i.id === 'ai1')?.specHashes ?? {}).sort(), [srtRel, specRel]);
	const L = logs();
	const r = await runApprove(opts(ws, {items: ['ai1'], reply: `APPROVE 2026-W49 ai1 #${code(ws)}`, nowMs: NOW + 120_000, log: L.log}));
	assert.equal(r.exitCode, 0, L.text());
	const record = ws.json<{inputs: {spec: string}}>('out/publish/zoora-ai/alpha/approval-long.json');
	assert.equal(record.inputs.spec, specRel);
	// the caption file changes after approval: a second approve run refuses it
	ws.write(srtRel, '1\n00:00:00,000 --> 00:00:02,000\nOtro texto.\n');
	const r2 = await runApprove(opts(ws, {items: ['ai1'], reply: `APPROVE 2026-W49 ai1 #${code(ws)}`, nowMs: NOW + 180_000}));
	assert.equal(r2.exitCode, 3);
	assert.match(r2.refused[0].reasons[0], /Changed since the page was built: content\/zoora-ai\/alpha\/captions\.es\.srt/);
});

test('an item that was NOT READY on the page, or changed since, is refused; the others still go through', async (t) => {
	const ws = await ready();
	t.after(ws.cleanup);
	// a file changes after the owner saw the page
	ws.write('out/publish/zoora-ai/alpha/shorts-1.txt', ws.read('out/publish/zoora-ai/alpha/shorts-1.txt').replace('A fictional Short.', 'A different description.'));
	const r = await runApprove(opts(ws, {items: ['ai1', 'ai1-s1', 'ai2'], reply: `APPROVE 2026-W49 ai1 ai1-s1 ai2 #${code(ws)}`}));
	assert.equal(r.exitCode, 1);
	assert.deepEqual(r.approved.map((a) => a.id), ['ai1']);
	assert.match(r.refused.find((x) => x.id === 'ai1-s1')?.reasons[0] ?? '', /Changed since the page was built: out\/publish\/zoora-ai\/alpha\/shorts-1\.txt/);
	assert.match(r.refused.find((x) => x.id === 'ai2')?.reasons[0] ?? '', /It was NOT READY on the page you reviewed/);
	assert.equal(existsSync(join(ws.root, 'out/publish/zoora-ai/alpha/approval-short-1.json')), false);
	const index = ws.json<{items: Array<{id: string}>; refused: Array<{id: string}>}>('out/approval/week-2026-W49/approvals.json');
	assert.deepEqual(index.items.map((i) => i.id), ['ai1']);
	assert.deepEqual(index.refused.map((i) => i.id), ['ai1-s1', 'ai2']);
});

test('the uploader\'s own checks still apply: no category, or a slot under an hour away, is refused', async (t) => {
	const noCategory = await ready({categoryId: null});
	t.after(noCategory.cleanup);
	const r1 = await runApprove(opts(noCategory, {items: ['ai1'], reply: `APPROVE 2026-W49 ai1 #${code(noCategory)}`}));
	assert.equal(r1.exitCode, 3);
	assert.match(r1.refused[0].reasons.join(' '), /categoryId: none is set for "zoora-ai"/);

	const late = await ready();
	t.after(late.cleanup);
	const r2 = await runApprove(opts(late, {items: ['ai1'], reply: `APPROVE 2026-W49 ai1 #${code(late)}`, nowMs: Date.parse('2026-11-30T16:30:00Z')}));
	assert.equal(r2.exitCode, 3);
	assert.match(r2.refused[0].reasons.join(' '), /publish-time-too-soon/);
	assert.equal(existsSync(join(late.root, 'out/publish/zoora-ai/alpha/approval-long.json')), false);
});

test('a plan changed after the page was built refuses everything', async (t) => {
	const ws = await ready();
	t.after(ws.cleanup);
	runPlan({root: ws.root, configPath: ws.configPath, week: W('2026-W49'), nowMs: NOW + 60_000, dryRun: false, factBank: null, log: () => {}});
	const r = await runApprove(opts(ws, {items: ['ai1'], reply: `APPROVE 2026-W49 ai1 #${code(ws)}`}));
	assert.equal(r.exitCode, 3);
	assert.equal(existsSync(join(ws.root, 'out/publish/zoora-ai/alpha/approval-long.json')), false);
});

test('the approval index records the dub tracks that were ready on the page, and drops any that changed since', async (t) => {
	const ws = makeWorkspace({
		backlogs: {
			'zoora-ai': testBacklog('zoora-ai', [testIdea('alpha', 'pov-story', 1), testIdea('beta', 'pov-story', 2)]),
			'zoora-security': testBacklog('zoora-security', [testIdea('sec-expl', 'explainer', 1), testIdea('sec-sotw', 'scam-of-the-week', 1)]),
		},
	});
	t.after(ws.cleanup);
	runPlan({root: ws.root, configPath: ws.configPath, week: W('2026-W49'), nowMs: NOW, dryRun: false, factBank: null, log: () => {}});
	buildEpisode(ws, {channel: 'zoora-ai', slug: 'alpha', shorts: 3});
	const sb = JSON.parse(ws.read('content/zoora-ai/alpha/storyboard.json')) as Record<string, unknown>;
	for (const lang of ['es', 'pt-br']) {
		ws.write(`content/zoora-ai/alpha/storyboard.${lang}.json`, JSON.stringify({...sb, lang, translation: {status: 'native-reviewed', reviewer: 'native reviewer', method: 'human', reviewed: true}}), NOW - 1_000_000);
		ws.write(`out/claims/alpha.${lang}.json`, JSON.stringify({tool: 'claims/check', pass: true, errors: 0, warnings: 0, checkedAt: new Date(NOW - 900_000).toISOString(), findings: [], waivers: []}), NOW - 900_000);
		ws.write(`public/generated/zoora-ai/alpha/${lang}/timeline.json`, JSON.stringify({version: 1, mode: 'fit-to-master', voice: 'im_nicola'}), NOW - 800_000);
	}
	await runReview({root: ws.root, week: '2026-W49', hub: '../creator-hub', channelsPath: ws.channelsPath, nowMs: NOW, copyMedia: false, log: () => {}});
	ws.write('content/zoora-ai/alpha/storyboard.pt-br.json', JSON.stringify({...sb, lang: 'pt-br', title: 'changed after the page', translation: {status: 'native-reviewed', reviewed: true}}), NOW - 700_000);
	const L = logs();
	const r = await runApprove(opts(ws, {items: ['ai1'], reply: `APPROVE 2026-W49 ai1 #${code(ws)}`, log: L.log}));
	assert.equal(r.exitCode, 0, L.text());
	assert.deepEqual(r.approved[0].dubTracks, ['es']);
	assert.match(r.approved[0].notes[0], /Dub files changed after the page was built \(content\/zoora-ai\/alpha\/storyboard\.pt-br\.json\)/);
});

test('replies are parsed strictly, and must carry the page code', () => {
	assert.deepEqual(parseReply('APPROVE 2026-W49 all #93770ddb'), {week: '2026-W49', items: 'all', code: '93770ddb'});
	assert.deepEqual(parseReply('  approve 2026w49 AI1, ai1-s2 #93770DDB .'), {week: '2026-W49', items: ['ai1', 'ai1-s2'], code: '93770ddb'});
	assert.deepEqual(parseReply('APPROVE 2026-W9 sec1, #0badc0de'), {week: '2026-W09', items: ['sec1'], code: '0badc0de'});
	assert.equal(parseReply('APPROVE 2026-W49 all'), null, 'no page code');
	assert.equal(parseReply('APPROVE 2026-W49 ai1 93770ddb'), null, 'a code without "#" would read as an item id');
	assert.equal(parseReply('APPROVE 2026-W49 ai1 #93770dd'), null, 'seven characters');
	assert.equal(parseReply('APPROVE 2026-W49 ai1 #93770ddb #0badc0de'), null, 'two codes');
	assert.equal(parseReply('APPROVE 2026-W49 #93770ddb'), null);
	assert.equal(parseReply('APPROVE 2026-W49 all ai1 #93770ddb'), null);
	assert.equal(parseReply('approved! ship it'), null);
	assert.equal(parseReply('APPROVE 2026-W49 ai1; rm -rf / #93770ddb'), null);
	assert.ok(sameSelection(['ai1', 'sec1'], ['sec1', 'ai1']));
	assert.ok(!sameSelection('all', ['ai1']));
});
