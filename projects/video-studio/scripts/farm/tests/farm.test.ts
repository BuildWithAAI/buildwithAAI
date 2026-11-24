// node --test scripts/farm/tests/farm.test.ts   (needs git, tar and bash)
// End-to-end runs of the CLI steps in a throwaway project: validate (which writes the gate receipt) and plan from a
// real git push, the claim gates (a fake gate runner; receipt.test.ts covers receipts and the real gate), preflight, a
// fake Remotion and a fake voice build (so no browser or model is needed), dubs fitted to their master, probe,
// public-key encryption of outputs, the narration hand-off, and the run summary.
import assert from 'node:assert/strict';
import {execFileSync, spawnSync} from 'node:child_process';
import {chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync} from 'node:fs';
import {generateKeyPairSync} from 'node:crypto';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {after, test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {decryptHandoff, decryptWithPrivateKey, formatOf, HANDOFF_ENV, isEncrypted} from '../crypto.ts';
import type {GateRunner, GateTarget} from '../gates.ts';
import {
	checkTarMembers,
	cmdPack,
	cmdPlan,
	cmdPreflight,
	cmdProbe,
	cmdRender,
	cmdSummary,
	cmdValidate,
	cmdVoiceBuild,
	cmdVoiceMasterUnpack,
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
const KEY = 'h4ndoff-For-Tests-Only-0123456789-abcdefghij+/=';
const KEY_ENV = HANDOFF_ENV;
// The owner's key pair: the public half is committed in the project, the private half stays with the owner (here).
const ownerKeys = generateKeyPairSync('rsa', {modulusLength: 3072});
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
// The fake python: `python3 scripts/voice/build.py <dir> --lang L --voice V [--fit-to M]` writes a narration folder
// (a dub also records the master timeline it read) and prints the narration text (another leak the farm must contain).
const fakePython = join(root, 'fake-python');
writeFileSync(
	fakePython,
	`#!/usr/bin/env bash
dir="$2"; lang="$4"; channel="$(basename "$(dirname "$dir")")"; slug="$(basename "$dir")"
out="public/generated/$channel/$slug/$lang"; mkdir -p "$out/scenes"
echo "${SECRET}"
if [ "\${7:-}" = "--fit-to" ]; then
  master="public/generated/$channel/$slug/$8/timeline.json"
  [ -f "$master" ] || { echo "master timeline $master not found" >&2; exit 1; }
  printf '{"version":1,"lang":"%s","mode":"fit-to-master","masterLang":"%s"}' "$lang" "$8" > "$out/timeline.json"
else
  printf '{"version":1,"lang":"%s","mode":"native"}' "$lang" > "$out/timeline.json"
fi
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
		{channel: 'zoora-ai', slug: 'ep-secret', lang: 'pt-br', voice: 'im_nicola', fitTo: 'en'},
	],
	jobs: [
		{composition: 'Episode', props: {channel: 'zoora-ai', slug: 'ep-secret', lang: 'es', title: SECRET}, output: 'out/episodes/ep-secret/es/episode.mp4', kind: 'video'},
		{composition: 'Thumbnail', props: {channel: 'zoora-ai', slug: 'ep-secret', text: SECRET}, output: 'out/episodes/ep-secret/thumb.png', kind: 'still', frame: 0},
		{composition: 'Episode', props: {channel: 'zoora-ai', slug: 'ep-secret', lang: 'pt-br'}, output: 'out/episodes/ep-secret/pt-br/dub-track.wav', kind: 'audio'},
	],
};

mkdirSync(project, {recursive: true});
git('init', '-q', '-b', 'main');
put('.gitignore', 'data/\n');
put('src/index.ts', '');
put('src/episode/index.ts', '');
put('src/charts/dev/index.ts', '');
put('scripts/voice/setup.sh', readFileSync(join(REAL_PROJECT, 'scripts/voice/setup.sh'), 'utf8'));
put('content/zoora-ai/ep-secret/storyboard.json', '{}');
put('content/zoora-ai/ep-secret/storyboard.es.json', '{}');
put('content/zoora-ai/ep-secret/storyboard.pt-br.json', '{}');
put('scripts/farm/keys/owner.pub.pem', ownerKeys.publicKey.export({type: 'spki', format: 'pem'}) as string);
put('render-requests/.keep', '');
// The private names list (invented names): gitignored, so it is never committed, as in the real repository.
put('data/private/names.txt', '# invented names only\nTesty McFakename\n@fakehandle123\n');
git('add', '-A');
git('commit', '-q', '-m', 'base');
const base = git('rev-parse', 'HEAD');

type Captured = {ctx: Ctx; logs: string[]; outputs: () => Record<string, string>; summary: () => string};
/** The claim gates as the tests see them: every target passes unless listed in `failing` ("channel/slug/lang"). */
const gateCalls: string[] = [];
const gateModes: string[] = [];
let failing = new Set<string>();
const fakeGates: GateRunner = (gate, t: GateTarget, names) => {
	const key = `${t.channel}/${t.slug}/${t.lang ?? '*'}`;
	gateCalls.push(`${gate}:${key}`);
	gateModes.push(names);
	const status = failing.has(key) ? 'fail' : 'pass';
	return {status, names: gate === 'claims' && status === 'pass' && names === 'check' ? 'checked' : 'unchecked'};
};
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
		runGate: fakeGates,
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

// The owner's step before the push: git add the requests, validate (with the names list) writes ep-secret's gate
// receipt, and the receipt is committed with the request. The self-test renders no script, so it needs none.
put('render-requests/farm-selftest.json', selftest);
put('render-requests/ep-secret.json', secretEpisode);
git('add', '-A');
const validated = harness({});
cmdValidate(validated.ctx, [join(project, 'render-requests/ep-secret.json'), join(project, 'render-requests/farm-selftest.json')]);
assert.match(validated.logs.join('\n'), /ep-secret\.json: ok [^\n]*private names checked\); gate receipt render-requests\/receipts\/ep-secret\.json written/);
assert.ok(!existsSync(join(project, 'render-requests/receipts/farm-selftest.json')), 'a request without scripts gets no receipt');
git('add', '-A');
git('commit', '-q', '-m', 'requests');
const head = git('rev-parse', 'HEAD');
assert.equal(git('ls-files', 'data'), '', 'the names list must never be committed');

test('plan: an encrypted request with narration but no RENDER_HANDOFF_KEY fails the whole plan before anything runs', async () => {
	const h = harness({FARM_EVENT: 'push', FARM_BEFORE: base, FARM_HEAD: head});
	await quiet(() => assert.throws(() => cmdPlan(h.ctx), /problem\(s\) in the render requests/));
	assert.match(h.summary(), /The plan failed; nothing was rendered[\s\S]*ep-secret hand narration from the voice jobs to the render jobs, but the secret RENDER_HANDOFF_KEY is not set/);
	assert.deepEqual(h.outputs(), {});
});

test('plan: a hand-off key shorter than 32 characters also stops the plan, and the key never appears in the summary', async () => {
	const weak = 'zoora-2026-weak';
	const h = harness({FARM_EVENT: 'push', FARM_BEFORE: base, FARM_HEAD: head, [KEY_ENV]: weak});
	await quiet(() => assert.throws(() => cmdPlan(h.ctx)));
	assert.match(h.summary(), /RENDER_HANDOFF_KEY is shorter than 32 characters/);
	assert.ok(!h.summary().includes(weak));
	assert.deepEqual(h.outputs(), {});
});

test('plan: without the owner\'s public key in the commit, an encrypted request cannot run', async () => {
	const pem = join(project, 'scripts/farm/keys/owner.pub.pem');
	renameSync(pem, `${pem}.away`);
	try {
		const h = harness({FARM_EVENT: 'push', FARM_BEFORE: base, FARM_HEAD: head, [KEY_ENV]: KEY});
		await quiet(() => assert.throws(() => cmdPlan(h.ctx)));
		assert.match(h.summary(), /ep-secret\.json: recipient "owner": scripts\/farm\/keys\/owner\.pub\.pem is not in this commit\. The owner creates his key pair once/);
	} finally {
		renameSync(`${pem}.away`, pem);
	}
});

test('plan: gate before push: a script whose claim gate fails is refused, and no script text reaches the summary', async () => {
	failing = new Set(['zoora-ai/ep-secret/es']);
	try {
		const h = harness({FARM_EVENT: 'push', FARM_BEFORE: base, FARM_HEAD: head, [KEY_ENV]: KEY});
		await quiet(() => assert.throws(() => cmdPlan(h.ctx)));
		assert.match(h.summary(), /ep-secret\.json: zoora-ai\/ep-secret \(es\): the claim gate FAILS\. Fix the script before pushing it \(node scripts\/claims\/check\.ts content\/zoora-ai\/ep-secret --lang es prints the report\)/);
		assert.ok(!h.summary().includes('SECRET'));
	} finally {
		failing = new Set();
	}
});

test('plan: matrices for the push (masters, dubs after their master), props and narration never in the outputs or the summary', () => {
	gateCalls.length = 0;
	gateModes.length = 0;
	const h = harness({FARM_EVENT: 'push', FARM_BEFORE: base, FARM_HEAD: head, [KEY_ENV]: KEY});
	cmdPlan(h.ctx);
	assert.deepEqual([...new Set(gateModes)], ['skip'], 'CI runs every claim gate with --no-names');
	assert.match(h.summary(), /Gate receipts match \(each records that validate passed the claim gate with the private names list on exactly this request and these scripts; CI cannot check the names itself, and a receipt is evidence, not a signature\): ep-secret \(4 script\(s\), validated \d{4}-\d{2}-\d{2}T/);
	assert.match(h.summary(), /Gate receipts changed: 1 \(a receipt is not a request: it never starts a render\)/);
	const o = h.outputs();
	const render = JSON.parse(o.render_matrix).include;
	const voice = JSON.parse(o.voice_matrix).include;
	const dubs = JSON.parse(o.voice_dub_matrix).include;
	assert.equal(o.render_count, String(render.length));
	assert.equal(render.length, selftest.jobs.length + 3);
	assert.deepEqual(voice.map((v: {lang: string}) => v.lang), ['en', 'es']);
	assert.deepEqual(dubs.map((v: {lang: string; fitTo: string; masterArtifact: string}) => [v.lang, v.fitTo, v.masterArtifact]), [['pt-br', 'en', 'voice_ep-secret_0']]);
	assert.equal(o.voice_dub_count, '1');
	assert.match(o.kokoro_key, /^kokoro-models-[0-9a-f]{64}-[0-9a-f]{64}$/);
	const es = render.find((c: {request: string; index: number}) => c.request === 'ep-secret' && c.index === 0);
	assert.deepEqual([es.voicePattern, es.voiceExpect, es.encrypt], ['voice_ep-secret_1', 1, true]);
	const audio = render.find((c: {request: string; index: number}) => c.request === 'ep-secret' && c.index === 2);
	assert.deepEqual([audio.kind, audio.voicePattern], ['audio', 'voice_ep-secret_2']);
	assert.deepEqual([...new Set(gateCalls)].sort(), ['claims:zoora-ai/ep-secret/en', 'claims:zoora-ai/ep-secret/es', 'claims:zoora-ai/ep-secret/pt-br', 'claims:zoora-ai/ep-secret/*'].sort(), 'every script the request voices or renders is gated; the self-test is not content');
	for (const text of [JSON.stringify(o), h.summary(), h.logs.join('\n')]) assert.ok(!text.includes('SECRET') && !text.includes('Zoo reveals'), 'content leaked');
});

test('plan: invalid requests and missing entries are reported by field, never by value', async () => {
	put('render-requests/broken.json', {...secretEpisode, id: 'broken', jobs: [{...secretEpisode.jobs[0], composition: SECRET}]});
	put('render-requests/no-entry.json', {id: 'no-entry', entry: 'src/show/index.ts', jobs: [{composition: 'Show', props: {}, output: 'out/s.mp4', kind: 'video'}]});
	git('add', '-A');
	git('commit', '-q', '-m', 'broken');
	const h = harness({FARM_EVENT: 'push', FARM_BEFORE: head, FARM_HEAD: git('rev-parse', 'HEAD'), [KEY_ENV]: KEY});
	await quiet(() => assert.throws(() => cmdPlan(h.ctx)));
	const s = h.summary();
	assert.match(s, /broken\.json: jobs\[0\]\.composition must be 1-64 characters/);
	assert.match(s, /no-entry\.json: the entry src\/show\/index\.ts does not exist in this commit/);
	assert.ok(!s.includes('SECRET'));
	git('rm', '-q', 'render-requests/broken.json', 'render-requests/no-entry.json');
	git('commit', '-q', '-m', 'unbreak');
});

let masterOut = '';
test('voice job: build output is packed, encrypted, and handed to the render job that needs it', async () => {
	// Voice job for ep-secret es (vindex 1).
	const v = harness({FARM_REQUEST: 'ep-secret', FARM_VOICE_INDEX: '1', [KEY_ENV]: KEY});
	cmdVoicePreflight(v.ctx);
	assert.deepEqual([v.outputs().artifact, v.outputs().probe_artifact, v.outputs().master_artifact], ['voice_ep-secret_1', 'probe_voice_ep-secret_1', '']);
	await cmdVoiceBuild(v.ctx);
	await cmdVoicePack(v.ctx);
	assert.equal(v.outputs().has_files, 'true');
	const staged = listFiles(join(v.ctx.temp, 'voice-out'));
	assert.deepEqual(staged, ['logs/voice_ep-secret_1.log.enc', 'voice_ep-secret_1.tar.enc']);
	for (const f of staged) assert.ok(isEncrypted(join(v.ctx.temp, 'voice-out', f)));
	assert.equal(formatOf(join(v.ctx.temp, 'voice-out/voice_ep-secret_1.tar.enc')), 'handoff', 'the narration uses the 1-day hand-off key');
	assert.equal(formatOf(join(v.ctx.temp, 'voice-out/logs/voice_ep-secret_1.log.enc')), 'public-key', 'the log is for the owner: his public key');
	await decryptWithPrivateKey(join(v.ctx.temp, 'voice-out/logs/voice_ep-secret_1.log.enc'), join(root, 'voice.log'), ownerKeys.privateKey);
	assert.match(readFileSync(join(root, 'voice.log'), 'utf8'), /SECRET-NARRATION/, 'the tool output belongs in the encrypted log');
	assert.ok(!v.logs.join('\n').includes('SECRET'), 'the tool output leaked into the job log');
	assert.match(v.summary(), /### Voice[\s\S]*zoora-ai\/ep-secret \| es/);

	// Render job 0 (Episode es) receives only that narration.
	rmSync(join(project, 'public/generated'), {recursive: true, force: true});
	const r = harness({FARM_REQUEST: 'ep-secret', FARM_JOB_INDEX: '0', [KEY_ENV]: KEY, FARM_VOICE_IN: join(v.ctx.temp, 'voice-out')});
	cmdPreflight(r.ctx);
	assert.deepEqual([r.outputs().artifact, r.outputs().retention_days], ['render_ep-secret_0_Episode_es', '7']);
	assert.equal(JSON.parse(readFileSync(join(r.ctx.temp, 'props.json'), 'utf8')).title, SECRET);
	await cmdVoiceUnpack(r.ctx);
	assert.ok(existsSync(join(project, 'public/generated/zoora-ai/ep-secret/es/timeline.json')));
	assert.ok(existsSync(join(project, 'public/generated/zoora-ai/ep-secret/es/scenes/s01.wav')));
	assert.ok(!existsSync(join(r.ctx.temp, 'voice_ep-secret_1.tar')), 'the decrypted archive was left behind');
	assert.match(r.logs.join('\n'), /unpacked 1 narration track\(s\): es/);
});

test('dub job: the master narration is unpacked first, and the dub is voiced with --fit-to into the master timeline', async () => {
	// The master (en, vindex 0) runs in the voice job.
	rmSync(join(project, 'public/generated'), {recursive: true, force: true});
	const m = harness({FARM_REQUEST: 'ep-secret', FARM_VOICE_INDEX: '0', [KEY_ENV]: KEY});
	cmdVoicePreflight(m.ctx);
	await cmdVoiceBuild(m.ctx);
	await cmdVoicePack(m.ctx);
	masterOut = join(m.ctx.temp, 'voice-out');
	// The dub (pt-br, vindex 2) runs on a fresh runner: no master timeline until it is unpacked.
	rmSync(join(project, 'public/generated'), {recursive: true, force: true});
	const d = harness({FARM_REQUEST: 'ep-secret', FARM_VOICE_INDEX: '2', [KEY_ENV]: KEY, FARM_MASTER_IN: masterOut});
	cmdVoicePreflight(d.ctx);
	assert.equal(d.outputs().master_artifact, 'voice_ep-secret_0');
	await cmdVoiceMasterUnpack(d.ctx);
	assert.ok(existsSync(join(project, 'public/generated/zoora-ai/ep-secret/en/timeline.json')));
	await cmdVoiceBuild(d.ctx);
	await cmdVoicePack(d.ctx);
	const tar = join(d.ctx.temp, 'voice-out/voice_ep-secret_2.tar.enc');
	await decryptHandoff(tar, join(root, 'dub.tar'), KEY);
	const members = execFileSync('tar', ['-tf', join(root, 'dub.tar')], {encoding: 'utf8'});
	assert.match(members, /generated\/zoora-ai\/ep-secret\/pt-br\/timeline\.json/);
	assert.doesNotMatch(members, /\/en\//, 'the dub artifact carries only the dub');
	execFileSync('tar', ['-xf', join(root, 'dub.tar'), '-C', root]);
	assert.deepEqual(JSON.parse(readFileSync(join(root, 'generated/zoora-ai/ep-secret/pt-br/timeline.json'), 'utf8')), {version: 1, lang: 'pt-br', mode: 'fit-to-master', masterLang: 'en'});
	// a master that never arrived fails clearly
	const lost = harness({FARM_REQUEST: 'ep-secret', FARM_VOICE_INDEX: '2', [KEY_ENV]: KEY, FARM_MASTER_IN: join(root, 'nowhere')});
	cmdVoicePreflight(lost.ctx);
	await assert.rejects(cmdVoiceMasterUnpack(lost.ctx), /the master narration voice_ep-secret_0 is missing/);
	// a native voice entry has no master to unpack
	const native = harness({FARM_REQUEST: 'ep-secret', FARM_VOICE_INDEX: '1', [KEY_ENV]: KEY});
	cmdVoicePreflight(native.ctx);
	await assert.rejects(cmdVoiceMasterUnpack(native.ctx), /not a dub/);
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
	for (const f of listFiles(stage)) assert.equal(formatOf(join(stage, f)), 'public-key', `${f}: outputs are encrypted to the owner's public key`);
	await decryptWithPrivateKey(join(stage, 'out/episodes/ep-secret/es/episode.mp4.enc'), join(root, 'episode.mp4'), ownerKeys.privateKey);
	assert.equal(readFileSync(join(root, 'episode.mp4'), 'utf8'), 'fake-media-Episode');
	await assert.rejects(decryptHandoff(join(stage, 'out/episodes/ep-secret/es/episode.mp4.enc'), join(root, 'nope.mp4'), KEY), /not a hand-off/, 'the CI secret cannot open an output');
	const probe = JSON.parse(readFileSync(join(r.ctx.temp, 'probe-out/probe_render_ep-secret_0.json'), 'utf8'));
	assert.deepEqual([probe.ok, probe.info.width, probe.info.height, probe.info.durationSec, probe.encrypted], [true, 1920, 1080, 3, true]);
	assert.match(r.summary(), /\| ep-secret \| 0 \| Episode \| es \| video \|[\s\S]*1920x1080/);
	assert.ok(!r.summary().includes('SECRET'));
	// The whole upload folder decrypts with decrypt.sh and the owner's private key, and the checksum verifies.
	const keyFile = join(root, 'owner.key');
	writeFileSync(keyFile, ownerKeys.privateKey.export({type: 'pkcs8', format: 'pem'}), {mode: 0o600});
	const d = spawnSync('bash', [join(HERE, '..', 'decrypt.sh'), '--key', keyFile, stage, '--out', join(root, 'dec')], {encoding: 'utf8', env: {PATH: process.env.PATH}, input: ''});
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
	// an audio job renders sound only, with the farm's audio config (the studio config's x264 preset is refused there)
	assert.deepEqual(remotionArgs({jobKind: 'audio', entry: 'src/episode/index.ts', composition: 'Episode', output: 'out/e/es/dub.wav', propsPath: '/p.json', frame: 0}).slice(2), [
		'render',
		'src/episode/index.ts',
		'Episode',
		'out/e/es/dub.wav',
		'--props=/p.json',
		'--codec=wav',
		'--config=scripts/farm/remotion.audio.config.ts',
	]);
	assert.ok(remotionArgs({jobKind: 'audio', entry: 'src/episode/index.ts', composition: 'Episode', output: 'out/e/es/dub.m4a', propsPath: '/p.json', frame: 0}).includes('--codec=aac'));
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
	assert.throws(() => cmdPreflight(r.ctx), /RENDER_HANDOFF_KEY is not set/);
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
		assert.match(outs.join('\n'), /farm-selftest\.json: ok \(\d+ job\(s\), 0 voice, NOT encrypted \(test\), kept \d+ days; no episode or show script to gate\)/);
		const bad = join(root, 'bad-id.json');
		writeFileSync(bad, JSON.stringify({...selftest, id: 'other'}));
		assert.equal(await main(['validate', bad], {}), 1);
		assert.match(errs.join('\n'), /id must be a string equal to the file name/);
	} finally {
		console.error = orig;
		console.log = ol;
	}
});
