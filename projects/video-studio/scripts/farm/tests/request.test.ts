// node --test scripts/farm/tests/request.test.ts   (Node 22 strips the types)
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {audioCodec, isTestComposition, LIMITS, outputProblem, parseRequest, validateRequest, voiceContentDir, voiceOutputDir, type Validation} from '../request.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const FARM = join(HERE, '..');
const PROJECT = join(FARM, '..', '..');

/** A content-like string: it must never appear in an error message. */
const SECRET = 'NARRATION Zoo says the secret plan';

const episode = () => ({
	id: 'ep-demo',
	entry: 'src/episode/index.ts',
	jobs: [
		{composition: 'Episode', props: {channel: 'zoora-ai', slug: 'ep-demo', lang: 'en'}, output: 'out/episodes/ep-demo/en/episode.mp4', kind: 'video'},
		{composition: 'Episode', props: {channel: 'zoora-ai', slug: 'ep-demo', lang: 'es'}, output: 'out/episodes/ep-demo/es/episode.mp4', kind: 'video'},
	],
	voice: [
		{channel: 'zoora-ai', slug: 'ep-demo', lang: 'en', voice: 'im_nicola'},
		{channel: 'zoora-ai', slug: 'ep-demo', lang: 'es', voice: 'im_nicola'},
	],
	encrypt: true,
});

const errorsOf = (v: Validation): string[] => (v.ok ? [] : v.errors);
const expectError = (raw: unknown, re: RegExp, id = 'ep-demo') => {
	const v = validateRequest(raw, id);
	assert.equal(v.ok, false, `expected an error matching ${re}`);
	assert.ok(errorsOf(v).some((e) => re.test(e)), `no error matched ${re}: ${JSON.stringify(errorsOf(v))}`);
	for (const e of errorsOf(v)) assert.ok(!e.includes(SECRET), `an error message leaked a value: ${e}`);
	return errorsOf(v);
};

test('a valid episode request normalizes: job entries inherit, retention defaults to 7 days, langs come from props', () => {
	const v = validateRequest(episode(), 'ep-demo');
	assert.ok(v.ok, JSON.stringify(errorsOf(v)));
	const r = v.request;
	assert.equal(r.encrypt, true);
	assert.equal(r.retentionDays, LIMITS.retentionDefaultDays);
	assert.deepEqual(r.jobs.map((j) => [j.entry, j.lang, j.frame]), [['src/episode/index.ts', 'en', 0], ['src/episode/index.ts', 'es', 0]]);
	assert.deepEqual(r.voice.map((x) => x.lang), ['en', 'es']);
});

test('encrypt defaults to true when left out', () => {
	const raw: Record<string, unknown> = episode();
	delete raw.encrypt;
	const v = validateRequest(raw, 'ep-demo');
	assert.ok(v.ok && v.request.encrypt === true);
});

test('the shipped self-test requests and the example are valid', () => {
	for (const [file, id] of [
		[join(PROJECT, 'render-requests', 'farm-selftest.json'), 'farm-selftest'],
		[join(PROJECT, 'render-requests', 'farm-selftest-voice.json'), 'farm-selftest-voice'],
		[join(PROJECT, 'render-requests', 'farm-selftest-encrypted.json'), 'farm-selftest-encrypted'],
		[join(FARM, 'examples', 'episode-en-es-ptbr.json'), 'episode-en-es-ptbr'],
		[join(FARM, 'examples', 'farm-selftest-handoff.json'), 'farm-selftest-handoff'],
	] as const) {
		const v = parseRequest(readFileSync(file, 'utf8'), id);
		assert.ok(v.ok, `${file}: ${JSON.stringify(errorsOf(v))}`);
	}
});

test('the id must equal the file name, and file names are lowercase ids', () => {
	expectError({...episode(), id: 'other'}, /id must be a string equal to the file name/);
	const v = validateRequest(episode(), 'Bad_Name');
	assert.equal(v.ok, false);
	assert.match(errorsOf(v)[0], /file name must be <id>\.json/);
});

test('entries come only from the allowlist, per request and per job', () => {
	expectError({...episode(), entry: 'src/evil.ts'}, /^entry must be one of/);
	const raw = episode();
	(raw.jobs[0] as Record<string, unknown>).entry = '../../etc/passwd';
	expectError(raw, /jobs\[0\]\.entry must be one of/);
});

test('composition ids are [A-Za-z0-9-]+ and the value is never echoed', () => {
	const raw = episode();
	raw.jobs[0].composition = `${SECRET}; rm -rf /`;
	expectError(raw, /jobs\[0\]\.composition must be 1-64 characters/);
});

test('outputs must be under out/, safe, unique and match the kind', () => {
	const bad = ['/tmp/x.mp4', 'out/../x.mp4', 'out/.hidden/x.mp4', 'renders/x.mp4', 'out/a b.mp4', 'out/x.mp4/', 'out//x.mp4', 'out', `out/${'a'.repeat(250)}.mp4`, 'out/x.mov', 'out\\x.mp4', 'out/$(id).mp4'];
	for (const o of bad) assert.ok(outputProblem(o, 'video'), `accepted ${o}`);
	assert.equal(outputProblem('out/episodes/ep-1/pt-br/episode.mp4', 'video'), null);
	assert.equal(outputProblem('out/thumbs/ep-1/a.png', 'still'), null);
	assert.ok(outputProblem('out/thumbs/a.png', 'video'));
	assert.ok(outputProblem('out/x.mp4', 'still'));
	assert.ok(outputProblem(`out/${'a/'.repeat(11)}x.mp4`, 'video'), 'accepted a path 12 folders deep');
	const raw = episode();
	raw.jobs[1].output = raw.jobs[0].output;
	expectError(raw, /jobs\[1\]\.output repeats/);
});

test('props must be a JSON object within the size limit', () => {
	const raw = episode();
	(raw.jobs[0] as Record<string, unknown>).props = [SECRET];
	expectError(raw, /jobs\[0\]\.props must be a JSON object/);
	const big = episode();
	big.jobs[0].props = {channel: 'zoora-ai', slug: 'x', lang: 'en', pad: 'x'.repeat(LIMITS.propsBytes)} as typeof big.jobs[0]['props'];
	expectError(big, /props must be at most/);
});

test('kind is video, still or audio; frame is only for stills and is a bounded integer', () => {
	const raw = episode();
	(raw.jobs[0] as Record<string, unknown>).kind = 'gif';
	expectError(raw, /jobs\[0\]\.kind must be "video", "still" or "audio"/);
	// audio: a dub's full mix for a multi-language audio track, as WAV, M4A (AAC) or MP3
	for (const [out, codec] of [['out/e/es/dub.wav', 'wav'], ['out/e/es/dub.m4a', 'aac'], ['out/e/es/dub.mp3', 'mp3']] as const) {
		assert.equal(outputProblem(out, 'audio'), null);
		assert.equal(audioCodec(out), codec);
	}
	assert.ok(outputProblem('out/e/es/dub.mp4', 'audio'));
	assert.ok(outputProblem('out/e/es/dub.flac', 'audio'));
	const a = episode();
	a.jobs[1] = {...a.jobs[1], kind: 'audio', output: 'out/episodes/ep-demo/es/dub.wav'};
	assert.ok(validateRequest(a, 'ep-demo').ok);
	(a.jobs[1] as Record<string, unknown>).frame = 1;
	expectError(a, /jobs\[1\]\.frame is only for kind "still"/);
	const f = episode();
	(f.jobs[0] as Record<string, unknown>).frame = 3;
	expectError(f, /frame is only for kind "still"/);
	const s = {id: 'st', entry: 'src/index.ts', encrypt: false, jobs: [{composition: 'TestCard', props: {}, output: 'out/t.png', kind: 'still', frame: -1}]};
	expectError(s, /frame must be an integer/, 'st');
	s.jobs[0].frame = 45;
	const ok = validateRequest(s, 'st');
	assert.ok(ok.ok && ok.request.jobs[0].frame === 45);
});

test('unknown keys are refused; plain key names are named, odd ones are not echoed', () => {
	expectError({...episode(), ouput: 'x'}, /unknown key "ouput"/);
	const raw = episode();
	(raw.jobs[0] as Record<string, unknown>)[SECRET] = 1;
	const errs = expectError(raw, /jobs\[0\] has an unknown key \(name not shown\)/);
	assert.ok(errs.every((e) => !e.includes('secret plan')));
});

test('voice entries: Zoo is im_nicola in every language; ja and fr are refused; no duplicates', () => {
	const v1 = episode();
	(v1.voice[0] as Record<string, unknown>).voice = 'am_michael';
	expectError(v1, /voice\[0\]\.voice must be "im_nicola"/);
	for (const lang of ['ja', 'fr', 'EN']) {
		const v = episode();
		(v.voice[0] as Record<string, unknown>).lang = lang;
		expectError(v, /voice\[0\]\.lang must be one of en, es, pt-br, hi, it, zh/);
	}
	const dup = episode();
	dup.voice[1] = {...dup.voice[0]};
	expectError(dup, /voice\[1\] repeats/);
	const ch = episode();
	ch.voice[0].channel = '_dev';
	expectError(ch, /may start with "_" only as "_farm"/);
	const slug = episode();
	slug.voice[0].slug = '../../secrets';
	expectError(slug, /voice\[0\]\.slug must be/);
});

test('encrypt: false is refused for anything but the listed test compositions and _farm voice fixtures', () => {
	expectError({...episode(), encrypt: false}, /encrypt: false is only for the test compositions .*jobs\[0\] renders another composition/);
	const mixed = {
		id: 'mix',
		entry: 'src/index.ts',
		encrypt: false,
		jobs: [{composition: 'TestCard', props: {}, output: 'out/t.mp4', kind: 'video'}],
		voice: [{channel: 'zoora-ai', slug: 'ep', lang: 'en', voice: 'im_nicola'}],
	};
	expectError(mixed, /voice\[0\] voices real content/, 'mix');
	const thumbs = {id: 'th', entry: 'src/index.ts', encrypt: false, jobs: [{composition: 'Thumbnail', props: {}, output: 'out/t.png', kind: 'still', entry: 'src/episode/index.ts'}]};
	expectError(thumbs, /jobs\[0\] renders another composition/, 'th');
	const test1 = {id: 't1', entry: 'src/charts/dev/index.ts', encrypt: false, jobs: [{composition: 'ChartTest', props: {}, output: 'out/c.png', kind: 'still'}]};
	assert.ok(validateRequest(test1, 't1').ok);
	// the 2026-11-24 review's case: a new composition registered in src/index.ts is not a test, whatever its entry
	const leak = {id: 'leak', entry: 'src/index.ts', encrypt: false, retentionDays: 90, jobs: [{composition: 'EpisodeLowerThird', kind: 'video', output: 'out/leak/ep.mp4', props: {channel: 'zoora-ai', slug: 'pumpfun-top-caller', lang: 'en'}}]};
	const errs = expectError(leak, /jobs\[0\] renders another composition, so this request must be encrypted to the owner/, 'leak');
	assert.ok(errs.some((e) => /retentionDays may be at most 7 for an unencrypted request/.test(e)), 'and a public test artifact is kept a week at most');
	assert.ok(isTestComposition('src/index.ts', 'TestCard') && isTestComposition('src/index.ts', 'Preview10s') && isTestComposition('src/charts/dev/index.ts', 'ChartReveal'));
	assert.ok(!isTestComposition('src/index.ts', 'ChartTest'), 'listed with its own entry only');
	assert.ok(!isTestComposition('src/episode/index.ts', 'TestCard'));
	expectError({...test1, retentionDays: 8}, /retentionDays may be at most 7/, 't1');
	assert.ok(validateRequest({...test1, retentionDays: 7}, 't1').ok);
});

test('recipient: outputs go to the owner\'s public key by default; "selftest" only for test compositions', () => {
	const v = validateRequest(episode(), 'ep-demo');
	assert.ok(v.ok && v.request.recipient === 'owner');
	expectError({...episode(), recipient: 'selftest'}, /recipient "selftest" is only for the test compositions/);
	expectError({...episode(), recipient: '../owner'}, /recipient must be 1-32 lowercase letters/);
	const st = {id: 'st', entry: 'src/index.ts', recipient: 'selftest', jobs: [{composition: 'TestCard', props: {}, output: 'out/t.mp4', kind: 'video'}]};
	const ok = validateRequest(st, 'st');
	assert.ok(ok.ok && ok.request.encrypt && ok.request.recipient === 'selftest');
});

test('dubs: fitTo voices a language into its master\'s timeline; the master must be a native entry of the same episode', () => {
	const dub = episode();
	(dub.voice[1] as Record<string, unknown>).fitTo = 'en';
	const v = validateRequest(dub, 'ep-demo');
	assert.ok(v.ok, JSON.stringify(errorsOf(v)));
	assert.deepEqual(v.request.voice.map((x) => [x.lang, x.fitTo ?? null]), [['en', null], ['es', 'en']]);
	const self = episode();
	(self.voice[1] as Record<string, unknown>).fitTo = 'es';
	expectError(self, /voice\[1\]\.fitTo must differ from lang/);
	const orphan = episode();
	(orphan.voice[1] as Record<string, unknown>).fitTo = 'pt-br';
	expectError(orphan, /voice\[1\]\.fitTo is "pt-br", but the request has no voice entry for pt-br of the same channel and slug/);
	const chain = episode();
	chain.voice.push({channel: 'zoora-ai', slug: 'ep-demo', lang: 'pt-br', voice: 'im_nicola'});
	(chain.voice[1] as Record<string, unknown>).fitTo = 'en';
	(chain.voice[2] as Record<string, unknown>).fitTo = 'es';
	expectError(chain, /voice\[2\] fits to a voice entry that is itself a dub/);
	const bad = episode();
	(bad.voice[1] as Record<string, unknown>).fitTo = 'fr';
	expectError(bad, /voice\[1\]\.fitTo must be one of en, es, pt-br, hi, it, zh/);
});

test('limits: jobs, voice entries and retention', () => {
	const many = episode();
	many.jobs = Array.from({length: LIMITS.jobsPerRequest + 1}, (_, i) => ({...many.jobs[0], output: `out/x${i}.mp4`}));
	expectError(many, /jobs may hold at most/);
	expectError({...episode(), jobs: []}, /jobs must be a non-empty array/);
	expectError({...episode(), retentionDays: 91}, /retentionDays must be an integer from 1 to 90/);
	expectError({...episode(), retentionDays: 1.5}, /retentionDays/);
	const ok = validateRequest({...episode(), retentionDays: 30}, 'ep-demo');
	assert.ok(ok.ok && ok.request.retentionDays === 30);
});

test('parseRequest reports bad JSON by position, without quoting the text', () => {
	const text = `{"id": "ep-demo", "jobs": [ ${SECRET} ]}`;
	const v = parseRequest(text, 'ep-demo');
	assert.equal(v.ok, false);
	assert.match(errorsOf(v)[0], /not valid JSON \(line 1, column \d+\)|not valid JSON$/);
	assert.ok(!errorsOf(v)[0].includes('secret'));
	assert.ok(!parseRequest('x'.repeat(LIMITS.requestBytes + 1), 'ep-demo').ok);
	assert.equal(validateRequest(null, 'ep-demo').ok, false);
	assert.equal(validateRequest([], 'ep-demo').ok, false);
});

test('voice folders: _farm fixtures live in scripts/farm/fixtures, everything else in content/', () => {
	assert.equal(voiceContentDir({channel: '_farm', slug: 'voice-selftest'}), 'scripts/farm/fixtures/_farm/voice-selftest');
	assert.equal(voiceContentDir({channel: 'zoora-ai', slug: 'ep'}), 'content/zoora-ai/ep');
	assert.equal(voiceOutputDir({channel: 'zoora-ai', slug: 'ep', lang: 'pt-br'}), 'generated/zoora-ai/ep/pt-br');
});
