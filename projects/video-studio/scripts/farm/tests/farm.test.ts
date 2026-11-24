// node --test scripts/farm/tests/farm.test.ts   (needs git, tar, openssl and bash)
// End-to-end runs of the CLI steps in a throwaway project: plan from a real git push, preflight, a fake Remotion and
// a fake voice build (so no browser or model is needed), probe, encryption, narration hand-off, and the run summary.
import assert from 'node:assert/strict';
import {execFileSync, spawnSync} from 'node:child_process';
import {chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {after, test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {decryptFile, isEncrypted, KEY_ENV} from '../crypto.ts';
import {
	checkTarMembers,
	cmdPack,
	cmdPlan,
	cmdPreflight,
	cmdProbe,
	cmdRender,
	cmdSummary,
	cmdVoiceBuild,
	cmdVoicePack,
	cmdVoicePreflight,
	cmdVoiceUnpack,
	listFiles,
	main,
	remotionArgs,
	runTool,
	verifyStaging,
	type Ctx,
} from '../farm.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const REAL_PROJECT = join(HERE, '..', '..', '..');
const KEY = 'k3y-For-Tests-Only-0123456789-abcdefghij+/=';
const SECRET = 'SECRET-NARRATION: Zoo reveals the plot';

const root = mkdtempSync(join(tmpdir(), 'farm-cli-'));
after(() => rmSync(root, {recursive: true, force: true}));
const project = join(root, 'project');

const gitEnv = {...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.invalid', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.invalid'};
const git = (...args: string[]) => execFileSync('git', args, {cwd: project, encoding: 'utf8', env: gitEnv}).trim();
const put = (rel: string, data: string | object) => {
	mkdirSync(dirname(join(project, rel)), {recursive: true});
	writeFileSync(join(project, rel), typeof data === 'string' ? data : JSON.stringify(data, null, 2));
};

// The fake npx: `npx --no-install remotion render|still <entry> <comp> <out> --props=<file> [--frame=N]` writes the
// output and prints the props (a leak the farm must contain); `... remotion ffprobe ...` prints a real probe fixture.
const fakeNpx = join(root, 'fake-npx');
writeFileSync(
	fakeNpx,
	`#!/usr/bin/env bash
case "$3" in
  ffprobe) cat "$FAKE_PROBE_JSON" ;;
  render|still)
    cat "\${7#--props=}"; echo
    echo "Rendered 5/10, time remaining: 1s"; echo "Encoded 10/10"
    [ -n "\${FAKE_FAIL:-}" ] && exit 3
    mkdir -p "$(dirname "$6")"; printf 'fake-media-%s' "$5" > "$6" ;;
  *) exit 64 ;;
esac
`,
);
chmodSync(fakeNpx, 0o755);
// The fake python: `python3 scripts/voice/build.py <dir> --lang L --voice V` writes a narration folder and prints
// the narration text (another leak the farm must contain).
const fakePython = join(root, 'fake-python');
writeFileSync(
	fakePython,
	`#!/usr/bin/env bash
dir="$2"; lang="$4"; channel="$(basename "$(dirname "$dir")")"; slug="$(basename "$dir")"
out="public/generated/$channel/$slug/$lang"; mkdir -p "$out/scenes"
echo "${SECRET}"
printf '{"version":1,"lang":"%s"}' "$lang" > "$out/timeline.json"
printf 'RIFFfake' > "$out/narration.wav"; printf 'RIFFfake' > "$out/scenes/s01.wav"
`,
);
chmodSync(fakePython, 0o755);

const selftest = JSON.parse(readFileSync(join(REAL_PROJECT, 'render-requests', 'farm-selftest.json'), 'utf8'));
const secretEpisode = {
	id: 'ep-secret',
	entry: 'src/episode/index.ts',
	voice: [
		{channel: 'zoora-ai', slug: 'ep-secret', lang: 'en', voice: 'im_nicola'},
		{channel: 'zoora-ai', slug: 'ep-secret', lang: 'es', voice: 'im_nicola'},
	],
	jobs: [
		{composition: 'Episode', props: {channel: 'zoora-ai', slug: 'ep-secret', lang: 'es', title: SECRET}, output: 'out/episodes/ep-secret/es/episode.mp4', kind: 'video'},
		{composition: 'Thumbnail', props: {text: SECRET}, output: 'out/episodes/ep-secret/thumb.png', kind: 'still', frame: 0},
	],
};

mkdirSync(project, {recursive: true});
git('init', '-q', '-b', 'main');
put('src/index.ts', '');
put('src/episode/index.ts', '');
put('src/charts/dev/index.ts', '');
put('scripts/voice/setup.sh', readFileSync(join(REAL_PROJECT, 'scripts/voice/setup.sh'), 'utf8'));
put('content/zoora-ai/ep-secret/storyboard.json', '{}');
put('content/zoora-ai/ep-secret/storyboard.es.json', '{}');
put('render-requests/.keep', '');
git('add', '-A');
git('commit', '-q', '-m', 'base');
const base = git('rev-parse', 'HEAD');
put('render-requests/farm-selftest.json', selftest);
put('render-requests/ep-secret.json', secretEpisode);
git('add', '-A');
git('commit', '-q', '-m', 'requests');
const head = git('rev-parse', 'HEAD');

type Captured = {ctx: Ctx; logs: string[]; outputs: () => Record<string, string>; summary: () => string};
let n = 0;
const harness = (env: Record<string, string>): Captured => {
	const dir = join(root, `job-${n++}`);
	mkdirSync(dir, {recursive: true});
	const out = join(dir, 'github_output');
	const sum = join(dir, 'step_summary');
	writeFileSync(out, '');
	writeFileSync(sum, '');
	const logs: string[] = [];
	const ctx: Ctx = {
		project,
		env: {PATH: process.env.PATH, HOME: process.env.HOME, GITHUB_OUTPUT: out, GITHUB_STEP_SUMMARY: sum, FARM_TEMP: join(dir, 'farm'), FARM_NPX: fakeNpx, FARM_PYTHON: fakePython, ...env},
		temp: join(dir, 'farm'),
		log: (m) => logs.push(m),
	};
	return {
		ctx,
		logs,
		outputs: () => Object.fromEntries(readFileSync(out, 'utf8').split('\n').filter(Boolean).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)])),
		summary: () => readFileSync(sum, 'utf8'),
	};
};

const quiet = async <T,>(fn: () => T | Promise<T>): Promise<T> => {
	const orig = console.log;
	console.log = () => {};
	try {
		return await fn();
	} finally {
		console.log = orig;
	}
};

test('plan: an encrypted request without RENDER_ARTIFACT_KEY fails the whole plan before anything runs', async () => {
	const h = harness({FARM_EVENT: 'push', FARM_BEFORE: base, FARM_HEAD: head, FARM_KEY_SET: 'false'});
	await quiet(() => assert.throws(() => cmdPlan(h.ctx), /problem\(s\) in the render requests/));
	assert.match(h.summary(), /The plan failed; nothing was rendered[\s\S]*ep-secret must be encrypted, but the repository secret RENDER_ARTIFACT_KEY is not set/);
	assert.deepEqual(h.outputs(), {});
});

test('plan: matrices for the push, props and narration never in the outputs or the summary', () => {
	const h = harness({FARM_EVENT: 'push', FARM_BEFORE: base, FARM_HEAD: head, FARM_KEY_SET: 'true'});
	cmdPlan(h.ctx);
	const o = h.outputs();
	const render = JSON.parse(o.render_matrix).include;
	const voice = JSON.parse(o.voice_matrix).include;
	assert.equal(o.render_count, String(render.length));
	assert.equal(render.length, selftest.jobs.length + 2);
	assert.deepEqual(voice.map((v: {lang: string}) => v.lang), ['en', 'es']);
	assert.match(o.kokoro_key, /^kokoro-models-[0-9a-f]{64}-[0-9a-f]{64}$/);
	const es = render.find((c: {request: string; index: number}) => c.request === 'ep-secret' && c.index === 0);
	assert.deepEqual([es.voicePattern, es.voiceExpect, es.encrypt], ['voice_ep-secret_1', 1, true]);
	for (const text of [JSON.stringify(o), h.summary(), h.logs.join('\n')]) assert.ok(!text.includes('SECRET') && !text.includes('Zoo reveals'), 'content leaked');
});

test('plan: invalid requests and missing entries are reported by field, never by value', async () => {
	put('render-requests/broken.json', {...secretEpisode, id: 'broken', jobs: [{...secretEpisode.jobs[0], composition: SECRET}]});
	put('render-requests/no-entry.json', {id: 'no-entry', entry: 'src/show/index.ts', jobs: [{composition: 'Show', props: {}, output: 'out/s.mp4', kind: 'video'}]});
	git('add', '-A');
	git('commit', '-q', '-m', 'broken');
	const h = harness({FARM_EVENT: 'push', FARM_BEFORE: head, FARM_HEAD: git('rev-parse', 'HEAD'), FARM_KEY_SET: 'true'});
	await quiet(() => assert.throws(() => cmdPlan(h.ctx)));
	const s = h.summary();
	assert.match(s, /broken\.json: jobs\[0\]\.composition must be 1-64 characters/);
	assert.match(s, /no-entry\.json: the entry src\/show\/index\.ts does not exist in this commit/);
	assert.ok(!s.includes('SECRET'));
	git('rm', '-q', 'render-requests/broken.json', 'render-requests/no-entry.json');
	git('commit', '-q', '-m', 'unbreak');
});

test('voice job: build output is packed, encrypted, and handed to the render job that needs it', async () => {
	// Voice job for ep-secret es (vindex 1).
	const v = harness({FARM_REQUEST: 'ep-secret', FARM_VOICE_INDEX: '1', [KEY_ENV]: KEY});
	cmdVoicePreflight(v.ctx);
	assert.deepEqual([v.outputs().artifact, v.outputs().probe_artifact], ['voice_ep-secret_1', 'probe_voice_ep-secret_1']);
	await cmdVoiceBuild(v.ctx);
	cmdVoicePack(v.ctx);
	assert.equal(v.outputs().has_files, 'true');
	const staged = listFiles(join(v.ctx.temp, 'voice-out'));
	assert.deepEqual(staged, ['logs/voice_ep-secret_1.log.enc', 'voice_ep-secret_1.tar.enc']);
	for (const f of staged) assert.ok(isEncrypted(join(v.ctx.temp, 'voice-out', f)));
	decryptFile(join(v.ctx.temp, 'voice-out/logs/voice_ep-secret_1.log.enc'), join(root, 'voice.log'), KEY);
	assert.match(readFileSync(join(root, 'voice.log'), 'utf8'), /SECRET-NARRATION/, 'the tool output belongs in the encrypted log');
	assert.ok(!v.logs.join('\n').includes('SECRET'), 'the tool output leaked into the job log');
	assert.match(v.summary(), /### Voice[\s\S]*zoora-ai\/ep-secret \| es/);

	// Render job 0 (Episode es) receives only that narration.
	rmSync(join(project, 'public/generated'), {recursive: true, force: true});
	const r = harness({FARM_REQUEST: 'ep-secret', FARM_JOB_INDEX: '0', [KEY_ENV]: KEY, FARM_VOICE_IN: join(v.ctx.temp, 'voice-out')});
	cmdPreflight(r.ctx);
	assert.deepEqual([r.outputs().artifact, r.outputs().retention_days], ['render_ep-secret_0_Episode_es', '7']);
	assert.equal(JSON.parse(readFileSync(join(r.ctx.temp, 'props.json'), 'utf8')).title, SECRET);
	cmdVoiceUnpack(r.ctx);
	assert.ok(existsSync(join(project, 'public/generated/zoora-ai/ep-secret/es/timeline.json')));
	assert.ok(existsSync(join(project, 'public/generated/zoora-ai/ep-secret/es/scenes/s01.wav')));
	assert.ok(!existsSync(join(r.ctx.temp, 'voice_ep-secret_1.tar')), 'the decrypted archive was left behind');
	assert.match(r.logs.join('\n'), /unpacked 1 narration track\(s\): es/);
});

let renderProbeDir = '';
test('render job: hidden tool output, probe, and an upload folder holding ciphertext only', async () => {
	const r = harness({FARM_REQUEST: 'ep-secret', FARM_JOB_INDEX: '0', [KEY_ENV]: KEY, FAKE_PROBE_JSON: join(HERE, 'fixtures/ffprobe-testcard-mp4.json')});
	cmdPreflight(r.ctx);
	await cmdRender(r.ctx);
	cmdProbe(r.ctx);
	renderProbeDir = join(r.ctx.temp, 'probe-out');
	await cmdPack(r.ctx);
	assert.ok(!r.logs.join('\n').includes('SECRET'), 'props leaked into the job log');
	assert.equal(r.outputs().has_files, 'true');
	const stage = join(r.ctx.temp, 'upload');
	assert.deepEqual(listFiles(stage), ['logs/render_ep-secret_0_Episode_es.log.enc', 'out/episodes/ep-secret/es/episode.mp4.enc', 'render_ep-secret_0_Episode_es.sha256.enc']);
	decryptFile(join(stage, 'out/episodes/ep-secret/es/episode.mp4.enc'), join(root, 'episode.mp4'), KEY);
	assert.equal(readFileSync(join(root, 'episode.mp4'), 'utf8'), 'fake-media-Episode');
	const probe = JSON.parse(readFileSync(join(r.ctx.temp, 'probe-out/probe_render_ep-secret_0.json'), 'utf8'));
	assert.deepEqual([probe.ok, probe.info.width, probe.info.height, probe.info.durationSec, probe.encrypted], [true, 1920, 1080, 3, true]);
	assert.match(r.summary(), /\| ep-secret \| 0 \| Episode \| es \| video \|[\s\S]*1920x1080/);
	assert.ok(!r.summary().includes('SECRET'));
	// The whole upload folder decrypts with decrypt.sh, and the checksum verifies.
	const d = spawnSync('bash', [join(HERE, '..', 'decrypt.sh'), stage, '--out', join(root, 'dec')], {encoding: 'utf8', env: {PATH: process.env.PATH, [KEY_ENV]: KEY}, input: ''});
	assert.equal(d.status, 0, d.stderr);
	assert.match(d.stdout, /ok {4}checksums/);
});

test('render job: a still gets --frame; a failed render still uploads its encrypted log, and probe reports it', async () => {
	assert.deepEqual(remotionArgs({jobKind: 'still', entry: 'src/episode/index.ts', composition: 'Thumbnail', output: 'out/t.png', propsPath: '/p.json', frame: 7}).slice(2), [
		'still',
		'src/episode/index.ts',
		'Thumbnail',
		'out/t.png',
		'--props=/p.json',
		'--frame=7',
	]);
	assert.throws(() => remotionArgs({jobKind: 'video', entry: 'src/index.ts', composition: 'X; rm', output: 'out/x.mp4', propsPath: '/p', frame: 0}));
	const r = harness({FARM_REQUEST: 'ep-secret', FARM_JOB_INDEX: '1', [KEY_ENV]: KEY, FAKE_FAIL: '1'});
	cmdPreflight(r.ctx);
	await assert.rejects(cmdRender(r.ctx), /Remotion failed \(exit 3\); its log is encrypted/);
	cmdProbe(r.ctx);
	await cmdPack(r.ctx);
	assert.deepEqual(listFiles(join(r.ctx.temp, 'upload')), ['logs/render_ep-secret_1_Thumbnail.log.enc']);
	assert.match(r.summary(), /failed \(exit 3\)/);
});

test('test requests (encrypt false) upload plaintext with a checksum and need no key', async () => {
	const r = harness({FARM_REQUEST: 'farm-selftest', FARM_JOB_INDEX: '0', FAKE_PROBE_JSON: join(HERE, 'fixtures/ffprobe-testcard-mp4.json')});
	cmdPreflight(r.ctx);
	await quiet(() => cmdRender(r.ctx));
	await cmdPack(r.ctx);
	const files = listFiles(join(r.ctx.temp, 'upload'));
	assert.equal(files.length, 2);
	assert.ok(files.some((f) => f.endsWith('.sha256')) && files.some((f) => f.startsWith('out/')));
});

test('an encrypted request without the key stops at preflight', () => {
	const r = harness({FARM_REQUEST: 'ep-secret', FARM_JOB_INDEX: '0'});
	assert.throws(() => cmdPreflight(r.ctx), /RENDER_ARTIFACT_KEY is not set/);
	assert.ok(!existsSync(join(r.ctx.temp, 'props.json')));
	assert.throws(() => cmdPreflight(harness({FARM_REQUEST: 'ep-secret', FARM_JOB_INDEX: '1; rm -rf /', [KEY_ENV]: KEY}).ctx), /small non-negative integer/);
	assert.throws(() => cmdPreflight(harness({FARM_REQUEST: '../etc/passwd', FARM_JOB_INDEX: '0', [KEY_ENV]: KEY}).ctx), /must be a request id/);
});

test('verifyStaging deletes a folder that holds plaintext for an encrypted request', () => {
	const dir = join(root, 'stage-bad');
	mkdirSync(join(dir, 'out'), {recursive: true});
	writeFileSync(join(dir, 'out/episode.mp4'), 'plaintext');
	assert.throws(() => verifyStaging(dir, true), /not encrypted/);
	assert.equal(existsSync(dir), false);
	mkdirSync(dir, {recursive: true});
	writeFileSync(join(dir, 'fake.enc'), 'not really encrypted at all, just named so');
	assert.throws(() => verifyStaging(dir, true), /not encrypted/);
});

test('narration archives with paths outside their folder, or links, are refused', () => {
	const work = join(root, 'tar');
	mkdirSync(join(work, 'generated/zoora-ai/ep/es'), {recursive: true});
	mkdirSync(join(work, 'generated/zoora-ai/other'), {recursive: true});
	writeFileSync(join(work, 'generated/zoora-ai/ep/es/timeline.json'), '{}');
	writeFileSync(join(work, 'generated/zoora-ai/other/x'), 'x');
	execFileSync('tar', ['-cf', join(root, 'good.tar'), '-C', work, 'generated/zoora-ai/ep/es']);
	assert.ok(checkTarMembers(join(root, 'good.tar'), 'generated/zoora-ai/ep/es').length >= 2);
	execFileSync('tar', ['-cf', join(root, 'wide.tar'), '-C', work, 'generated/zoora-ai']);
	assert.throws(() => checkTarMembers(join(root, 'wide.tar'), 'generated/zoora-ai/ep/es'), /outside/);
	execFileSync('tar', ['-cf', join(root, 'dots.tar'), '-C', work, '--transform', 's,^generated/zoora-ai/other,generated/zoora-ai/ep/es/../../evil,', 'generated/zoora-ai/other/x']);
	assert.throws(() => checkTarMembers(join(root, 'dots.tar'), 'generated/zoora-ai/ep/es'), /outside/);
	execFileSync('ln', ['-s', '/etc/passwd', join(work, 'generated/zoora-ai/ep/es/link')]);
	execFileSync('tar', ['-cf', join(root, 'link.tar'), '-C', work, 'generated/zoora-ai/ep/es']);
	assert.throws(() => checkTarMembers(join(root, 'link.tar'), 'generated/zoora-ai/ep/es'), /link/);
});

test('runTool hides output behind a numbers-only heartbeat', async () => {
	const script = join(root, 'slow.sh');
	writeFileSync(script, `#!/usr/bin/env bash\necho "${SECRET}"\necho "Rendered 5/10, time remaining: 2s"\nsleep 0.6\necho "Encoded 9/10"\n`);
	chmodSync(script, 0o755);
	const h = harness({});
	const r = await runTool(h.ctx, script, [], {logFile: join(h.ctx.temp, 'tool.log'), label: 'render', heartbeatMs: 200});
	assert.equal(r.code, 0);
	const beats = h.logs.join('\n');
	assert.match(beats, /render: running for \d+ s \(rendered 5\/10 frames\)/);
	assert.ok(!beats.includes('SECRET'));
	assert.match(readFileSync(join(h.ctx.temp, 'tool.log'), 'utf8'), /SECRET-NARRATION/);
});

test('summary: one table from the probe records; records that do not look like the farm\'s are dropped', () => {
	const probes = join(root, 'probes');
	mkdirSync(probes, {recursive: true});
	cpSync(renderProbeDir, probes, {recursive: true});
	writeFileSync(join(probes, 'evil.json'), JSON.stringify({type: 'render', request: '| injected |', ok: true, artifact: 'x', index: 0, composition: 'A', kind: 'video', lang: '-', output: 'out/x.mp4'}));
	writeFileSync(join(probes, 'junk.json'), '{not json');
	const h = harness({FARM_PROBES_DIR: probes, FARM_RENDER_COUNT: '4'});
	cmdSummary(h.ctx);
	const s = h.summary();
	assert.match(s, /## Render farm/);
	assert.match(s, /1 of 4 outputs rendered/);
	assert.ok(!s.includes('injected'));
});

test('main: unknown commands print usage; validate checks request files locally', async () => {
	const orig = console.error;
	console.error = () => {};
	try {
		assert.equal(await main(['nope'], {}), 2);
	} finally {
		console.error = orig;
	}
	const errs: string[] = [];
	console.error = (m: string) => errs.push(m);
	const outs: string[] = [];
	const ol = console.log;
	console.log = (m: string) => outs.push(m);
	try {
		assert.equal(await main(['validate', join(REAL_PROJECT, 'render-requests', 'farm-selftest.json')], {}), 0);
		assert.match(outs.join('\n'), /farm-selftest\.json: ok \(\d+ job\(s\), 0 voice, NOT encrypted \(test\), kept \d+ days\)/);
		const bad = join(root, 'bad-id.json');
		writeFileSync(bad, JSON.stringify({...selftest, id: 'other'}));
		assert.equal(await main(['validate', bad], {}), 1);
		assert.match(errs.join('\n'), /id must be a string equal to the file name/);
	} finally {
		console.error = orig;
		console.log = ol;
	}
});
