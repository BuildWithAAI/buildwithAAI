// node --test scripts/farm/tests/plan.test.ts
import assert from 'node:assert/strict';
import {execFileSync, spawnSync} from 'node:child_process';
import {mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {after, test} from 'node:test';
import {buildPlan, classifyPaths, detectChanges, PLAN_LIMITS, RECEIPTS_DIR, voiceArtifact, voiceNeeds, type ChangeInput, type Git} from '../plan.ts';
import {validateRequest, type RenderRequest} from '../request.ts';

const req = (raw: Record<string, unknown>, id = raw.id as string): RenderRequest => {
	const v = validateRequest(raw, id);
	if (!v.ok) throw new Error(v.errors.join('; '));
	return v.request;
};

const episode = (id: string, langs: string[]): RenderRequest =>
	req({
		id,
		entry: 'src/episode/index.ts',
		voice: langs.map((lang) => ({channel: 'zoora-ai', slug: id, lang, voice: 'im_nicola'})),
		jobs: [
			...langs.map((lang) => ({composition: 'Episode', props: {channel: 'zoora-ai', slug: id, lang}, output: `out/${id}/${lang}/episode.mp4`, kind: 'video'})),
			{composition: 'Thumbnail', props: {variant: 'a'}, output: `out/${id}/thumb.png`, kind: 'still'},
		],
	});

test('buildPlan: one voice cell per language, one render cell per job; props never enter the matrix', () => {
	const {plan, errors} = buildPlan([episode('ep1', ['en', 'es', 'pt-br', 'zh'])]);
	assert.deepEqual(errors, []);
	assert.deepEqual(plan.voice.map((v) => [v.lang, v.vindex, v.cjk, v.artifact]), [
		['en', 0, false, 'voice_ep1_0'],
		['es', 1, false, 'voice_ep1_1'],
		['pt-br', 2, false, 'voice_ep1_2'],
		['zh', 3, true, 'voice_ep1_3'],
	]);
	assert.equal(plan.render.length, 5);
	const es = plan.render[1];
	assert.deepEqual(
		{lang: es.lang, voicePattern: es.voicePattern, voiceExpect: es.voiceExpect, artifact: es.artifact, encrypt: es.encrypt},
		{lang: 'es', voicePattern: 'voice_ep1_1', voiceExpect: 1, artifact: 'render_ep1_1_Episode_es', encrypt: true},
	);
	// A job whose props name no single voice entry gets every narration track of its request.
	const thumb = plan.render[4];
	assert.deepEqual([thumb.lang, thumb.voicePattern, thumb.voiceExpect, thumb.artifact], ['-', 'voice_ep1_*', 4, 'render_ep1_4_Thumbnail']);
	const json = JSON.stringify(plan);
	assert.ok(!json.includes('variant') && !json.includes('"props"'), 'props leaked into the matrix');
});

test('artifact patterns cannot match another request whose id extends this one', () => {
	const {plan} = buildPlan([episode('ep1', ['en', 'es']), episode('ep1-es', ['es'])]);
	const pattern = plan.render.find((c) => c.request === 'ep1' && c.composition === 'Thumbnail')?.voicePattern ?? '';
	const glob = new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`);
	const names = plan.voice.map((v) => v.artifact);
	assert.deepEqual(names.filter((n) => glob.test(n)), ['voice_ep1_0', 'voice_ep1_1']);
	assert.ok(!glob.test(voiceArtifact('ep1-es', 0)));
});

test('buildPlan: dubs (fitTo) wait for their master in a second voice matrix and know its artifact', () => {
	const raw = {
		id: 'ep2',
		entry: 'src/episode/index.ts',
		voice: [
			{channel: 'zoora-ai', slug: 'ep2', lang: 'en', voice: 'im_nicola'},
			{channel: 'zoora-ai', slug: 'ep2', lang: 'es', voice: 'im_nicola', fitTo: 'en'},
			{channel: 'zoora-ai', slug: 'ep2', lang: 'pt-br', voice: 'im_nicola', fitTo: 'en'},
		],
		jobs: [
			{composition: 'Episode', props: {channel: 'zoora-ai', slug: 'ep2', lang: 'en'}, output: 'out/ep2/en/episode.mp4', kind: 'video'},
			{composition: 'Episode', props: {channel: 'zoora-ai', slug: 'ep2', lang: 'es'}, output: 'out/ep2/es/dub-track.wav', kind: 'audio'},
		],
	};
	const {plan, errors} = buildPlan([req(raw)]);
	assert.deepEqual(errors, []);
	assert.deepEqual(plan.voice.map((v) => [v.lang, v.fitTo, v.masterArtifact]), [['en', '', '']]);
	assert.deepEqual(plan.voiceDub.map((v) => [v.lang, v.vindex, v.fitTo, v.masterArtifact, v.artifact]), [
		['es', 1, 'en', 'voice_ep2_0', 'voice_ep2_1'],
		['pt-br', 2, 'en', 'voice_ep2_0', 'voice_ep2_2'],
	]);
	const audio = plan.render.find((c) => c.index === 1);
	assert.deepEqual([audio?.kind, audio?.voicePattern, audio?.voiceExpect], ['audio', 'voice_ep2_1', 1], 'the dub track render downloads only the fitted es narration');
});

test('voiceNeeds: none without voice entries', () => {
	const r = req({id: 't', entry: 'src/index.ts', encrypt: false, jobs: [{composition: 'TestCard', props: {}, output: 'out/t.mp4', kind: 'video'}]});
	assert.deepEqual(voiceNeeds(r, 0), []);
	const {plan} = buildPlan([r]);
	assert.deepEqual([plan.render[0].voicePattern, plan.render[0].voiceExpect, plan.render[0].encrypt], ['', 0, false]);
});

test('buildPlan enforces the per-run limits', () => {
	const many = Array.from({length: PLAN_LIMITS.requestsPerRun + 1}, (_, i) => episode(`r${i}`, ['en']));
	assert.ok(buildPlan(many).errors.some((e) => /at most 16 request files/.test(e)));
});

test('classifyPaths keeps <id>.json directly in render-requests/, flags bad names, ignores the rest', () => {
	const c = classifyPaths(['render-requests/a.json', 'render-requests/B c.json', 'render-requests/README.md', 'render-requests/sub/x.json', 'render-requests/a.json', 'src/x.ts']);
	assert.deepEqual(c.ids, ['a']);
	assert.deepEqual(c.badNames, ['B c.json']);
	assert.deepEqual(c.ignored, ['render-requests/README.md', 'render-requests/sub/x.json', 'src/x.ts']);
	assert.deepEqual(c.receipts, []);
});

test('classifyPaths lists gate receipts apart: a receipt is never a request id, even one named like a request', () => {
	const c = classifyPaths([`${RECEIPTS_DIR}/a.json`, `${RECEIPTS_DIR}/Bad Name.json`, `${RECEIPTS_DIR}/nested/x.json`, 'render-requests/receipts.json']);
	assert.equal(RECEIPTS_DIR, 'render-requests/receipts');
	assert.deepEqual(c.receipts, ['render-requests/receipts/Bad Name.json', 'render-requests/receipts/a.json', 'render-requests/receipts/nested/x.json']);
	assert.deepEqual(c.ids, ['receipts'], 'render-requests/receipts.json is a request file named "receipts", not the folder');
	assert.deepEqual([c.badNames, c.ignored], [[], []]);
});

// ---- detectChanges against a real git repository -------------------------------------------------------------

const repo = mkdtempSync(join(tmpdir(), 'farm-plan-'));
after(() => rmSync(repo, {recursive: true, force: true}));
const sh = (...args: string[]) => execFileSync('git', args, {cwd: repo, encoding: 'utf8', env: {...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.invalid', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.invalid'}}).trim();
const git: Git = (args) => {
	const r = spawnSync('git', args, {cwd: repo, encoding: 'utf8'});
	return {ok: r.status === 0, stdout: r.stdout ?? ''};
};
const write = (rel: string, text = '{}') => {
	mkdirSync(join(repo, rel, '..'), {recursive: true});
	writeFileSync(join(repo, rel), text);
};
const commit = (msg: string) => {
	sh('add', '-A');
	sh('commit', '-q', '-m', msg, '--allow-empty');
	return sh('rev-parse', 'HEAD');
};
const input = (over: Partial<ChangeInput>): ChangeInput => ({
	event: 'push',
	before: '',
	head: '',
	dispatchRequest: '',
	listRequestFiles: () => readdirSync(join(repo, 'render-requests')),
	...over,
});

sh('init', '-q', '-b', 'main');
write('render-requests/old.json');
write('render-requests/gone.json');
write('src/index.ts', '');
const c1 = commit('first');
write('render-requests/new.json');
write('render-requests/old.json', '{"changed": true}');
rmSync(join(repo, 'render-requests/gone.json'));
write('render-requests/notes.md', 'x');
write('src/other.ts', '');
const c2 = commit('second');

test('push: added and modified request files render; deleted ones and other files do not', () => {
	const ch = detectChanges(input({before: c1, head: c2}), git);
	assert.deepEqual(ch.errors, []);
	assert.deepEqual(ch.ids, ['new', 'old']);
	assert.deepEqual(ch.ignored, ['render-requests/notes.md']);
	assert.equal(ch.how, 'files changed by this push');
});

test('push: a commit that changes only a gate receipt renders nothing; the receipt is listed apart', () => {
	write('render-requests/receipts/old.json', '{"kind": "zoora-farm-gate-receipt"}');
	const c = commit('receipt only');
	const ch = detectChanges(input({before: c2, head: c}), git);
	assert.deepEqual([ch.ids, ch.badNames, ch.ignored, ch.errors], [[], [], [], []]);
	assert.deepEqual(ch.receipts, ['render-requests/receipts/old.json']);
});

test('push: a rename counts as a new request file', () => {
	sh('mv', 'render-requests/new.json', 'render-requests/renamed.json');
	const c3 = commit('rename');
	assert.deepEqual(detectChanges(input({before: c2, head: c3}), git).ids, ['renamed']);
});

test('push to a new branch (before = 000...0) or an unknown base falls back to the head commit', () => {
	write('render-requests/branchy.json');
	const head = commit('branch head');
	const zero = detectChanges(input({before: '0'.repeat(40), head}), git);
	assert.deepEqual(zero.ids, ['branchy']);
	assert.match(zero.how, /head commit/);
	const unknown = detectChanges(input({before: 'f'.repeat(40), head}), git);
	assert.deepEqual(unknown.ids, ['branchy']);
});

test('the root commit renders every request file', () => {
	const ch = detectChanges(input({before: '0'.repeat(40), head: c1}), git);
	assert.match(ch.how, /root commit/);
	assert.ok(ch.ids.length >= 1);
});

test('workflow_dispatch renders the named request, which must exist; ids are validated', () => {
	assert.deepEqual(detectChanges(input({event: 'workflow_dispatch', dispatchRequest: 'old'}), git).ids, ['old']);
	assert.deepEqual(detectChanges(input({event: 'workflow_dispatch', dispatchRequest: 'old.json'}), git).ids, ['old']);
	assert.match(detectChanges(input({event: 'workflow_dispatch', dispatchRequest: 'missing'}), git).errors[0], /does not exist/);
	assert.match(detectChanges(input({event: 'workflow_dispatch', dispatchRequest: '../x; rm -rf /'}), git).errors[0], /must be a request id/);
});

test('other events and malformed shas are refused', () => {
	assert.match(detectChanges(input({event: 'pull_request_target', head: c2}), git).errors[0], /unsupported event/);
	assert.match(detectChanges(input({head: 'main'}), git).errors[0], /head commit sha/);
});
