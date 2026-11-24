/**
 * Render farm CLI (docs/RENDER_FARM.md). Each step of .github/workflows/video-render.yml runs one subcommand:
 *
 *   plan             read the request files the push changed, validate them, emit the voice and render matrices
 *   voice-preflight  voice job: check the request, the voice entry and (when encrypting) the key
 *   voice-build      voice job: scripts/voice/build.py for one channel/slug/lang (Zoo = im_nicola)
 *   voice-pack       voice job: tar public/generated/<channel>/<slug>/<lang>, encrypt it, probe the narration
 *   preflight        render job: check the request, the job and the key; write the props file
 *   voice-unpack     render job: decrypt and unpack the narration this job needs into public/generated
 *   render           render job: npx remotion render|still
 *   probe            render job: ffprobe the output, write the job summary and the probe record
 *   pack             render job: encrypt the output (and the log) into the upload folder
 *   summary          summary job: one table for the whole run
 *
 * and locally, before pushing:
 *
 *   validate [render-requests/<id>.json ...]
 *
 * Run from projects/video-studio:  node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/farm/farm.ts <command>
 * Inputs arrive in environment variables (FARM_*), never interpolated into shell commands. Props, narration and keys
 * are never printed: encrypted requests write tool output to a log file that is encrypted into the artifact.
 */
import {spawn, spawnSync, execFileSync} from 'node:child_process';
import {createHash, randomUUID} from 'node:crypto';
import {
	copyFileSync,
	createReadStream,
	createWriteStream,
	existsSync,
	lstatSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import {basename, dirname, join, relative, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {FarmError, decryptFile, encryptFile, isEncrypted, keyProblem, requireKey} from './crypto.ts';
import {kokoroCacheKey} from './kokoro.ts';
import {
	REQUESTS_DIR,
	buildPlan,
	detectChanges,
	renderArtifact,
	renderProbeArtifact,
	voiceArtifact,
	voiceNeeds,
	voiceProbeArtifact,
	type Git,
} from './plan.ts';
import {isProbe, jobSummary, parseProbe, runSummary, type AnyProbe, type ProbeInfo, type RenderProbe, type VoiceProbe} from './probe.ts';
import {
	COMPOSITION_RE,
	ID_RE,
	ZOO_VOICE,
	outputProblem,
	parseRequest,
	voiceContentDir,
	voiceOutputDir,
	type Entry,
	type Kind,
	type RenderRequest,
} from './request.ts';

export const PROJECT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

export type Ctx = {
	project: string; // projects/video-studio
	env: NodeJS.ProcessEnv;
	temp: string; // per-job scratch: $RUNNER_TEMP/farm
	log: (msg: string) => void;
};

export const makeCtx = (env: NodeJS.ProcessEnv, project = PROJECT): Ctx => ({
	project,
	env,
	temp: env.FARM_TEMP || join(env.RUNNER_TEMP || tmpdir(), 'farm'),
	log: (msg) => console.log(msg),
});

const inActions = (ctx: Ctx) => ctx.env.GITHUB_ACTIONS === 'true';

/** Workflow-command escaping for annotation text. */
const escapeData = (s: string) => s.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');

const reportError = (ctx: Ctx, msg: string) => {
	if (inActions(ctx)) console.log(`::error title=render farm::${escapeData(msg)}`);
	else console.error(`farm: ${msg}`);
};

const setOutput = (ctx: Ctx, name: string, value: string) => {
	if (/[\r\n]/.test(value)) throw new FarmError(`output ${name} would span lines`);
	if (ctx.env.GITHUB_OUTPUT) writeFileSync(ctx.env.GITHUB_OUTPUT, `${name}=${value}\n`, {flag: 'a'});
	else ctx.log(`output ${name}=${value}`);
};

const addSummary = (ctx: Ctx, md: string) => {
	if (ctx.env.GITHUB_STEP_SUMMARY) writeFileSync(ctx.env.GITHUB_STEP_SUMMARY, `${md}\n`, {flag: 'a'});
};

const intEnv = (ctx: Ctx, name: string): number => {
	const v = ctx.env[name] ?? '';
	if (!/^\d{1,4}$/.test(v)) throw new FarmError(`${name} must be a small non-negative integer`);
	return Number(v);
};

const ensureDir = (p: string) => mkdirSync(p, {recursive: true});

/** Every file under a folder, as paths relative to it (forward slashes). */
export const listFiles = (root: string): string[] => {
	if (!existsSync(root)) return [];
	const out: string[] = [];
	const walk = (dir: string) => {
		for (const d of readdirSync(dir, {withFileTypes: true})) {
			const p = join(dir, d.name);
			if (d.isDirectory()) walk(p);
			else out.push(relative(root, p).split(sep).join('/'));
		}
	};
	walk(root);
	return out.sort();
};

const sha256File = (path: string): Promise<string> =>
	new Promise((res, rej) => {
		const h = createHash('sha256');
		createReadStream(path)
			.on('data', (b) => h.update(b))
			.on('error', rej)
			.on('end', () => res(h.digest('hex')));
	});

// ---------------------------------------------------------------------------------------------------------------
// Requests and job state

const requestPath = (ctx: Ctx, id: string) => join(ctx.project, REQUESTS_DIR, `${id}.json`);

export const loadRequest = (ctx: Ctx, id: string): RenderRequest => {
	if (!ID_RE.test(id)) throw new FarmError('FARM_REQUEST must be a request id');
	const path = requestPath(ctx, id);
	if (!existsSync(path)) throw new FarmError(`${REQUESTS_DIR}/${id}.json does not exist in this commit`);
	const v = parseRequest(readFileSync(path, 'utf8'), id);
	if (!v.ok) throw new FarmError(`${REQUESTS_DIR}/${id}.json is invalid: ${v.errors.join('; ')}`);
	return v.request;
};

/** Problems that depend on the checkout: entry files and voice storyboards must exist. */
export const checkoutProblems = (ctx: Ctx, req: RenderRequest): string[] => {
	const errors: string[] = [];
	const entries = new Set<Entry>([...req.jobs.map((j) => j.entry)]);
	for (const e of entries) if (!existsSync(join(ctx.project, e))) errors.push(`the entry ${e} does not exist in this commit`);
	req.voice.forEach((v, i) => {
		const dir = voiceContentDir(v);
		const has = existsSync(join(ctx.project, dir, `storyboard.${v.lang}.json`)) || existsSync(join(ctx.project, dir, 'storyboard.json'));
		if (!has) errors.push(`voice[${i}]: no storyboard.json or storyboard.${v.lang}.json in ${dir}`);
	});
	return errors;
};

type VoiceState = {
	kind: 'voice';
	startedAt: number;
	request: string;
	vindex: number;
	encrypt: boolean;
	channel: string;
	slug: string;
	lang: string;
	contentDir: string;
	outputDir: string; // relative to public/
	artifact: string;
	exitCode?: number;
	buildSeconds?: number;
};

type RenderState = {
	kind: 'render';
	startedAt: number;
	request: string;
	index: number;
	composition: string;
	jobKind: Kind;
	entry: Entry;
	output: string;
	frame: number;
	lang: string;
	encrypt: boolean;
	artifact: string;
	propsPath: string;
	voice: {vindex: number; channel: string; slug: string; lang: string}[];
	voiceTracks?: number;
	exitCode?: number;
	renderSeconds?: number;
};

const statePath = (ctx: Ctx) => join(ctx.temp, 'state.json');
const logPath = (ctx: Ctx) => join(ctx.temp, 'tool.log');

const saveState = (ctx: Ctx, st: VoiceState | RenderState) => {
	ensureDir(ctx.temp);
	writeFileSync(statePath(ctx), JSON.stringify(st), {mode: 0o600});
};

function readState(ctx: Ctx, kind: 'voice'): VoiceState;
function readState(ctx: Ctx, kind: 'render'): RenderState;
function readState(ctx: Ctx, kind: 'voice' | 'render'): VoiceState | RenderState {
	if (!existsSync(statePath(ctx))) throw new FarmError('no job state: the preflight step did not run');
	const st = JSON.parse(readFileSync(statePath(ctx), 'utf8')) as VoiceState | RenderState;
	if (st.kind !== kind) throw new FarmError(`job state is for a ${st.kind} job, not ${kind}`);
	return st;
}

// ---------------------------------------------------------------------------------------------------------------
// Child processes

const PROGRESS_RE = /\b(Rendered|Encoded)\s+(\d+)\s*\/\s*(\d+)/g;

/**
 * Runs a tool. With a log path its output goes only to that file (encrypted later) and the job log shows a heartbeat
 * with frame counts parsed from Remotion's progress lines (numbers only). Without one, output is shown live, wrapped in
 * ::stop-commands:: so nothing the tool prints can act as a workflow command.
 */
export const runTool = (ctx: Ctx, cmd: string, args: string[], opts: {logFile: string | null; label: string; heartbeatMs?: number}): Promise<{code: number; seconds: number}> =>
	new Promise((done) => {
		const t0 = Date.now();
		const hidden = opts.logFile !== null;
		const token = !hidden && inActions(ctx) ? randomUUID().replace(/-/g, '') : null;
		if (token) console.log(`::stop-commands::${token}`);
		const child = spawn(cmd, args, {cwd: ctx.project, env: ctx.env, stdio: hidden ? ['ignore', 'pipe', 'pipe'] : ['ignore', 'inherit', 'inherit']});
		const progress: Record<string, string> = {};
		let partial = '';
		let log: ReturnType<typeof createWriteStream> | null = null;
		if (hidden) {
			ensureDir(dirname(opts.logFile as string));
			log = createWriteStream(opts.logFile as string, {flags: 'a', mode: 0o600});
			const onData = (buf: Buffer) => {
				(log as ReturnType<typeof createWriteStream>).write(buf);
				const text = partial + buf.toString('utf8');
				const lines = text.split(/\r?\n|\r/);
				partial = (lines.pop() ?? '').slice(-200);
				for (const line of lines) for (const m of line.matchAll(PROGRESS_RE)) progress[m[1].toLowerCase()] = `${m[2]}/${m[3]}`;
			};
			child.stdout?.on('data', onData);
			child.stderr?.on('data', onData);
		}
		const timer = hidden
			? setInterval(() => {
					const p = Object.entries(progress).map(([k, v]) => `${k} ${v}`).join(', ');
					ctx.log(`${opts.label}: running for ${Math.round((Date.now() - t0) / 1000)} s${p ? ` (${p} frames)` : ''}; output is going to the encrypted log`);
				}, opts.heartbeatMs ?? 60_000)
			: null;
		let settled = false;
		const finish = (code: number) => {
			if (settled) return;
			settled = true;
			if (timer) clearInterval(timer);
			if (token) console.log(`::${token}::`);
			const seconds = Math.round((Date.now() - t0) / 100) / 10;
			if (log) log.end(() => done({code, seconds}));
			else done({code, seconds});
		};
		child.on('error', () => finish(127));
		child.on('close', (code) => finish(code ?? 1));
	});

/** ffprobe JSON for a file: Remotion's bundled ffprobe in render jobs (runners have no ffmpeg), the system one otherwise. */
const ffprobe = (ctx: Ctx, file: string, viaRemotion: boolean): unknown | null => {
	const cmd = viaRemotion ? ctx.env.FARM_NPX || 'npx' : 'ffprobe';
	const pre: string[] = viaRemotion ? ['--no-install', 'remotion', 'ffprobe'] : [];
	const r = spawnSync(cmd, [...pre, '-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file], {
		cwd: ctx.project,
		env: ctx.env,
		encoding: 'utf8',
		stdio: ['ignore', 'pipe', 'pipe'],
		maxBuffer: 16 * 1024 * 1024,
	});
	if (r.status !== 0 || !r.stdout) return null;
	try {
		return JSON.parse(r.stdout);
	} catch {
		return null;
	}
};

/** Every staged file must be ciphertext when the request is encrypted; anything else is deleted and the step fails. */
export const verifyStaging = (dir: string, encrypt: boolean): string[] => {
	const files = listFiles(dir);
	for (const f of files) {
		const p = join(dir, f);
		if (lstatSync(p).isSymbolicLink()) {
			rmSync(dir, {recursive: true, force: true});
			throw new FarmError('the upload folder held a symbolic link; nothing was uploaded');
		}
		if (encrypt && (!f.endsWith('.enc') || !isEncrypted(p))) {
			rmSync(dir, {recursive: true, force: true});
			throw new FarmError('the upload folder held a file that is not encrypted; it was deleted and nothing was uploaded');
		}
	}
	return files;
};

// ---------------------------------------------------------------------------------------------------------------
// plan

export const cmdPlan = (ctx: Ctx): void => {
	const env = ctx.env;
	const reqDir = join(ctx.project, REQUESTS_DIR);
	const listRequestFiles = () => (existsSync(reqDir) ? readdirSync(reqDir, {withFileTypes: true}).filter((d) => d.isFile()).map((d) => d.name) : []);
	const git: Git = (args) => {
		const r = spawnSync('git', args, {cwd: ctx.project, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 16 * 1024 * 1024});
		return {ok: r.status === 0, stdout: r.stdout ?? ''};
	};
	const changes = detectChanges(
		{event: env.FARM_EVENT ?? '', before: env.FARM_BEFORE ?? '', head: env.FARM_HEAD ?? '', dispatchRequest: env.FARM_DISPATCH_REQUEST ?? '', listRequestFiles},
		git,
	);
	const errors = [...changes.errors];
	for (const name of changes.badNames) {
		errors.push(`${REQUESTS_DIR}/${JSON.stringify(name)}: a request file must be named <id>.json, with an id of 1-64 lowercase letters, digits and dashes`);
	}
	const requests: RenderRequest[] = [];
	for (const id of changes.ids) {
		const path = requestPath(ctx, id);
		if (!existsSync(path)) {
			errors.push(`${REQUESTS_DIR}/${id}.json is not in this commit`);
			continue;
		}
		const v = parseRequest(readFileSync(path, 'utf8'), id);
		if (!v.ok) {
			errors.push(...v.errors.map((e) => `${REQUESTS_DIR}/${id}.json: ${e}`));
			continue;
		}
		const cp = checkoutProblems(ctx, v.request);
		if (cp.length) {
			errors.push(...cp.map((e) => `${REQUESTS_DIR}/${id}.json: ${e}`));
			continue;
		}
		requests.push(v.request);
	}
	const encrypted = requests.filter((r) => r.encrypt).map((r) => r.id);
	if (encrypted.length && env.FARM_KEY_SET !== 'true') {
		errors.push(`${encrypted.join(', ')} must be encrypted, but ${keyProblem(undefined)}`);
	}
	const {plan, errors: planErrors} = buildPlan(requests);
	errors.push(...planErrors);
	let kokoroKey = '';
	if (plan.voice.length) {
		try {
			kokoroKey = kokoroCacheKey(readFileSync(join(ctx.project, 'scripts/voice/setup.sh'), 'utf8'));
		} catch (e) {
			errors.push(e instanceof Error ? e.message : String(e));
		}
	}

	const md = [`## Render farm plan`, '', `Source: ${changes.how}.`, ''];
	if (changes.ignored.length) md.push(`Ignored (not request files): ${changes.ignored.length} path(s).`, '');
	if (errors.length) {
		for (const e of errors) reportError(ctx, e);
		md.push('**The plan failed; nothing was rendered.**', '', ...errors.map((e) => `- ${e}`), '');
		addSummary(ctx, md.join('\n'));
		throw new FarmError(`${errors.length} problem(s) in the render requests; nothing was rendered`);
	}
	if (!plan.render.length) {
		md.push('No added or modified request files: nothing to render.', '');
	} else {
		md.push('| Request | Job | Composition | Kind | Lang | Encrypted | Narration |', '| --- | --- | --- | --- | --- | --- | --- |');
		for (const c of plan.render) md.push(`| ${c.request} | ${c.index} | ${c.composition} | ${c.kind} | ${c.lang} | ${c.encrypt ? 'yes' : 'no (test)'} | ${c.voiceExpect || '-'} |`);
		md.push('');
		if (plan.voice.length) {
			md.push('| Request | Voice | Channel / slug | Lang |', '| --- | --- | --- | --- |');
			for (const v of plan.voice) md.push(`| ${v.request} | ${v.vindex} | ${v.channel}/${v.slug} | ${v.lang} |`);
			md.push('');
		}
	}
	addSummary(ctx, md.join('\n'));
	ctx.log(`plan: ${changes.how}; ${requests.length} request(s), ${plan.voice.length} voice job(s), ${plan.render.length} render job(s)`);
	setOutput(ctx, 'render_matrix', JSON.stringify({include: plan.render}));
	setOutput(ctx, 'render_count', String(plan.render.length));
	setOutput(ctx, 'voice_matrix', JSON.stringify({include: plan.voice}));
	setOutput(ctx, 'voice_count', String(plan.voice.length));
	setOutput(ctx, 'kokoro_key', kokoroKey);
};

// ---------------------------------------------------------------------------------------------------------------
// voice job

export const cmdVoicePreflight = (ctx: Ctx): void => {
	const id = ctx.env.FARM_REQUEST ?? '';
	const vindex = intEnv(ctx, 'FARM_VOICE_INDEX');
	const req = loadRequest(ctx, id);
	const v = req.voice[vindex];
	if (!v) throw new FarmError(`${id} has no voice entry ${vindex}`);
	if (req.encrypt) requireKey(ctx.env);
	const problems = checkoutProblems(ctx, {...req, jobs: [], voice: [v]});
	if (problems.length) throw new FarmError(problems.join('; '));
	rmSync(ctx.temp, {recursive: true, force: true});
	saveState(ctx, {
		kind: 'voice',
		startedAt: Date.now(),
		request: id,
		vindex,
		encrypt: req.encrypt,
		channel: v.channel,
		slug: v.slug,
		lang: v.lang,
		contentDir: voiceContentDir(v),
		outputDir: voiceOutputDir(v),
		artifact: voiceArtifact(id, vindex),
	});
	ctx.log(`voice ${id}[${vindex}]: ${v.channel}/${v.slug} ${v.lang}, voice ${ZOO_VOICE}, ${req.encrypt ? 'encrypted' : 'not encrypted (test)'}`);
	setOutput(ctx, 'artifact', voiceArtifact(id, vindex));
	setOutput(ctx, 'probe_artifact', voiceProbeArtifact(id, vindex));
};

export const cmdVoiceBuild = async (ctx: Ctx): Promise<void> => {
	const st = readState(ctx, 'voice');
	const python = ctx.env.FARM_PYTHON || 'python3';
	const args = ['scripts/voice/build.py', st.contentDir, '--lang', st.lang, '--voice', ZOO_VOICE];
	const r = await runTool(ctx, python, args, {logFile: st.encrypt ? logPath(ctx) : null, label: 'voice build'});
	saveState(ctx, {...st, exitCode: r.code, buildSeconds: r.seconds});
	if (r.code !== 0) throw new FarmError(`the voice build failed (exit ${r.code})${st.encrypt ? '; its log is encrypted into this job\'s artifact' : ''}`);
	ctx.log(`voice build finished in ${r.seconds} s`);
};

export const cmdVoicePack = (ctx: Ctx): void => {
	const st = readState(ctx, 'voice');
	const key = st.encrypt ? requireKey(ctx.env) : null;
	const stage = join(ctx.temp, 'voice-out');
	const probes = join(ctx.temp, 'probe-out');
	rmSync(stage, {recursive: true, force: true});
	ensureDir(stage);
	ensureDir(probes);
	const publicDir = join(ctx.project, 'public');
	const genDir = join(publicDir, st.outputDir);
	const built = st.exitCode === 0 && existsSync(join(genDir, 'timeline.json'));
	if (built) {
		const tar = join(ctx.temp, `${st.artifact}.tar`);
		execFileSync('tar', ['-cf', tar, '-C', publicDir, st.outputDir], {stdio: ['ignore', 'ignore', 'pipe']});
		if (key) {
			encryptFile(tar, join(stage, `${st.artifact}.tar.enc`), key);
			rmSync(tar, {force: true});
		} else {
			renameSync(tar, join(stage, `${st.artifact}.tar`));
		}
	}
	if (key && existsSync(logPath(ctx))) {
		ensureDir(join(stage, 'logs'));
		encryptFile(logPath(ctx), join(stage, 'logs', `${st.artifact}.log.enc`), key);
	}
	const files = verifyStaging(stage, st.encrypt);
	const narration = join(genDir, 'narration.wav');
	const raw = built && existsSync(narration) ? ffprobe(ctx, narration, false) : null;
	const rec: VoiceProbe = {
		type: 'voice',
		request: st.request,
		vindex: st.vindex,
		channel: st.channel,
		slug: st.slug,
		lang: st.lang,
		artifact: st.artifact,
		encrypted: st.encrypt,
		ok: built,
		exitCode: st.exitCode ?? null,
		buildSeconds: st.buildSeconds ?? null,
		info: raw ? parseProbe(raw, 'audio') : null,
	};
	writeFileSync(join(probes, `${voiceProbeArtifact(st.request, st.vindex)}.json`), JSON.stringify(rec));
	addSummary(ctx, jobSummary(rec));
	ctx.log(`voice pack: ${files.length} file(s) staged${key ? ', all encrypted' : ''}`);
	setOutput(ctx, 'has_files', files.length ? 'true' : 'false');
};

// ---------------------------------------------------------------------------------------------------------------
// render job

export const cmdPreflight = (ctx: Ctx): void => {
	const id = ctx.env.FARM_REQUEST ?? '';
	const index = intEnv(ctx, 'FARM_JOB_INDEX');
	const req = loadRequest(ctx, id);
	const job = req.jobs[index];
	if (!job) throw new FarmError(`${id} has no job ${index}`);
	if (req.encrypt) requireKey(ctx.env);
	const problems = checkoutProblems(ctx, {...req, jobs: [job], voice: []});
	if (problems.length) throw new FarmError(problems.join('; '));
	rmSync(ctx.temp, {recursive: true, force: true});
	ensureDir(ctx.temp);
	const propsPath = join(ctx.temp, 'props.json');
	writeFileSync(propsPath, JSON.stringify(job.props), {mode: 0o600});
	const needs = voiceNeeds(req, index);
	const artifact = renderArtifact(id, index, job.composition, job.lang);
	saveState(ctx, {
		kind: 'render',
		startedAt: Date.now(),
		request: id,
		index,
		composition: job.composition,
		jobKind: job.kind,
		entry: job.entry,
		output: job.output,
		frame: job.frame,
		lang: job.lang ?? '-',
		encrypt: req.encrypt,
		artifact,
		propsPath,
		voice: needs.map((i) => ({vindex: i, channel: req.voice[i].channel, slug: req.voice[i].slug, lang: req.voice[i].lang})),
	});
	ctx.log(`render ${id}[${index}]: ${job.composition} (${job.kind}, ${job.lang ?? '-'}) from ${job.entry} -> ${job.output}; ${req.encrypt ? 'encrypted' : 'not encrypted (test)'}; narration tracks: ${needs.length}`);
	setOutput(ctx, 'artifact', artifact);
	setOutput(ctx, 'probe_artifact', renderProbeArtifact(id, index));
	setOutput(ctx, 'retention_days', String(req.retentionDays));
};

/** Lists a tar and refuses anything outside `prefix/`, absolute paths, '..' and entries that are not files or folders. */
export const checkTarMembers = (tarPath: string, prefix: string): string[] => {
	const names = execFileSync('tar', ['-tf', tarPath], {encoding: 'utf8', maxBuffer: 64 * 1024 * 1024}).split('\n').filter(Boolean);
	const verbose = execFileSync('tar', ['-tvf', tarPath], {encoding: 'utf8', maxBuffer: 64 * 1024 * 1024}).split('\n').filter(Boolean);
	if (!names.length || names.length !== verbose.length) throw new FarmError('a narration archive is empty or unreadable');
	for (const line of verbose) if (!/^[-d]/.test(line)) throw new FarmError('a narration archive holds a link or a special file; refusing it');
	for (const n of names) {
		const clean = n.replace(/\/$/, '');
		if (n.startsWith('/') || clean.split('/').includes('..') || !(clean === prefix || clean.startsWith(`${prefix}/`))) {
			throw new FarmError(`a narration archive holds a path outside ${prefix}/; refusing it`);
		}
	}
	return names;
};

export const cmdVoiceUnpack = (ctx: Ctx): void => {
	const st = readState(ctx, 'render');
	if (!st.voice.length) {
		ctx.log('this job needs no narration');
		return;
	}
	const key = st.encrypt ? requireKey(ctx.env) : null;
	const inDir = ctx.env.FARM_VOICE_IN || join(ctx.temp, 'voice-in');
	const publicDir = join(ctx.project, 'public');
	ensureDir(publicDir);
	const langs: string[] = [];
	for (const v of st.voice) {
		const name = voiceArtifact(st.request, v.vindex);
		const src = join(inDir, `${name}.tar${key ? '.enc' : ''}`);
		if (!existsSync(src)) throw new FarmError(`the narration ${name} is missing: its voice job failed or was skipped (see that job in this run)`);
		let tar = src;
		if (key) {
			tar = join(ctx.temp, `${name}.tar`);
			decryptFile(src, tar, key);
		}
		try {
			checkTarMembers(tar, voiceOutputDir(v));
			execFileSync('tar', ['-xf', tar, '-C', publicDir, '--no-same-owner', '--no-same-permissions'], {stdio: ['ignore', 'ignore', 'pipe']});
		} finally {
			if (key) rmSync(tar, {force: true});
		}
		if (!existsSync(join(publicDir, voiceOutputDir(v), 'timeline.json'))) throw new FarmError(`the narration ${name} has no timeline.json`);
		langs.push(v.lang);
	}
	saveState(ctx, {...st, voiceTracks: langs.length});
	ctx.log(`unpacked ${langs.length} narration track(s): ${langs.join(', ')}`);
};

/** The Remotion CLI arguments for a job (npx is the command). */
export const remotionArgs = (st: Pick<RenderState, 'jobKind' | 'entry' | 'composition' | 'output' | 'propsPath' | 'frame'>): string[] => {
	if (!COMPOSITION_RE.test(st.composition) || outputProblem(st.output, st.jobKind)) throw new FarmError('refusing to render an unvalidated job');
	const args = ['--no-install', 'remotion', st.jobKind === 'still' ? 'still' : 'render', st.entry, st.composition, st.output, `--props=${st.propsPath}`];
	if (st.jobKind === 'still') args.push(`--frame=${st.frame}`);
	return args;
};

export const cmdRender = async (ctx: Ctx): Promise<void> => {
	const st = readState(ctx, 'render');
	const npx = ctx.env.FARM_NPX || 'npx';
	const r = await runTool(ctx, npx, remotionArgs(st), {logFile: st.encrypt ? logPath(ctx) : null, label: 'render'});
	saveState(ctx, {...st, exitCode: r.code, renderSeconds: r.seconds});
	if (r.code !== 0) throw new FarmError(`Remotion failed (exit ${r.code})${st.encrypt ? '; its log is encrypted into this job\'s artifact' : ''}`);
	if (!existsSync(join(ctx.project, st.output))) {
		saveState(ctx, {...st, exitCode: 1, renderSeconds: r.seconds});
		throw new FarmError('Remotion exited without error but wrote no output file');
	}
	ctx.log(`render finished in ${r.seconds} s`);
};

export const cmdProbe = (ctx: Ctx): void => {
	const st = readState(ctx, 'render');
	const out = join(ctx.project, st.output);
	const ok = st.exitCode === 0 && existsSync(out);
	const raw = ok ? ffprobe(ctx, out, ctx.env.FARM_FFPROBE !== 'system') : null;
	const info: ProbeInfo | null = raw ? parseProbe(raw, st.jobKind) : null;
	const rec: RenderProbe = {
		type: 'render',
		request: st.request,
		index: st.index,
		composition: st.composition,
		kind: st.jobKind,
		lang: st.lang,
		output: st.output,
		artifact: st.artifact,
		encrypted: st.encrypt,
		ok,
		exitCode: st.exitCode ?? null,
		renderSeconds: st.renderSeconds ?? null,
		jobSeconds: Math.round((Date.now() - st.startedAt) / 100) / 10,
		voiceTracks: st.voiceTracks ?? 0,
		info,
	};
	const dir = join(ctx.temp, 'probe-out');
	ensureDir(dir);
	writeFileSync(join(dir, `${renderProbeArtifact(st.request, st.index)}.json`), JSON.stringify(rec));
	addSummary(ctx, jobSummary(rec));
	if (ok && !info) reportError(ctx, 'ffprobe could not read the output');
	ctx.log(
		ok && info
			? `probe: ${info.width}x${info.height}${info.durationSec !== null ? `, ${info.durationSec} s` : ''}${info.fps !== null ? `, ${info.fps} fps` : ''}, ${info.sizeBytes} bytes`
			: 'probe: no output to measure',
	);
};

export const cmdPack = async (ctx: Ctx): Promise<void> => {
	const st = readState(ctx, 'render');
	const key = st.encrypt ? requireKey(ctx.env) : null;
	const stage = join(ctx.temp, 'upload');
	rmSync(stage, {recursive: true, force: true});
	ensureDir(stage);
	const out = join(ctx.project, st.output);
	const rendered = st.exitCode === 0 && existsSync(out);
	if (rendered) {
		const sums = `${await sha256File(out)}  ${st.output}\n`;
		const sumsName = `${st.artifact}.sha256`;
		ensureDir(dirname(join(stage, st.output)));
		if (key) {
			encryptFile(out, join(stage, `${st.output}.enc`), key);
			const plainSums = join(ctx.temp, sumsName);
			writeFileSync(plainSums, sums, {mode: 0o600});
			encryptFile(plainSums, join(stage, `${sumsName}.enc`), key);
			rmSync(plainSums, {force: true});
		} else {
			copyFileSync(out, join(stage, st.output));
			writeFileSync(join(stage, sumsName), sums);
		}
	}
	if (key && existsSync(logPath(ctx))) {
		ensureDir(join(stage, 'logs'));
		encryptFile(logPath(ctx), join(stage, 'logs', `${st.artifact}.log.enc`), key);
	}
	const files = verifyStaging(stage, st.encrypt);
	ctx.log(`pack: ${files.length} file(s) staged${key ? ', all encrypted' : ''}${rendered ? '' : ' (no output: the render failed)'}`);
	setOutput(ctx, 'has_files', files.length ? 'true' : 'false');
};

// ---------------------------------------------------------------------------------------------------------------
// summary

/** Accepts only probe records whose ids, paths and numbers look like the farm's own. */
export const saneProbe = (p: AnyProbe): boolean => {
	if (!ID_RE.test(p.request) || !/^[A-Za-z0-9_-]{1,200}$/.test(p.artifact)) return false;
	if (p.type === 'render') return Number.isInteger(p.index) && COMPOSITION_RE.test(p.composition) && outputProblem(p.output, p.kind) === null && /^[a-z-]{1,5}$/.test(p.lang);
	return Number.isInteger(p.vindex) && /^_?[a-z0-9-]{1,48}$/.test(p.channel) && /^[a-z0-9-]{1,96}$/.test(p.slug) && /^[a-z-]{2,5}$/.test(p.lang);
};

export const cmdSummary = (ctx: Ctx): void => {
	const dir = ctx.env.FARM_PROBES_DIR || join(ctx.temp, 'probes');
	const probes: AnyProbe[] = [];
	for (const f of listFiles(dir)) {
		if (!f.endsWith('.json')) continue;
		try {
			const v: unknown = JSON.parse(readFileSync(join(dir, f), 'utf8'));
			if (isProbe(v) && saneProbe(v)) probes.push(v);
		} catch {
			// a damaged probe file is reported as a missing job below
		}
	}
	const expected = /^\d+$/.test(ctx.env.FARM_RENDER_COUNT ?? '') ? Number(ctx.env.FARM_RENDER_COUNT) : probes.filter((p) => p.type === 'render').length;
	addSummary(ctx, runSummary(probes, expected));
	ctx.log(`summary: ${probes.length} probe record(s)`);
};

// ---------------------------------------------------------------------------------------------------------------
// validate (local)

export const cmdValidate = (ctx: Ctx, files: string[]): void => {
	const reqDir = join(ctx.project, REQUESTS_DIR);
	const targets = files.length ? files : existsSync(reqDir) ? readdirSync(reqDir).filter((f) => f.endsWith('.json')).map((f) => join(reqDir, f)) : [];
	let bad = 0;
	for (const f of targets) {
		const id = basename(f).replace(/\.json$/, '');
		const v = parseRequest(readFileSync(f, 'utf8'), id);
		const errors = v.ok ? checkoutProblems(ctx, v.request) : v.errors;
		if (errors.length) {
			bad++;
			console.error(`${f}:\n${errors.map((e) => `  - ${e}`).join('\n')}`);
		} else if (v.ok) {
			const r = v.request;
			ctx.log(`${f}: ok (${r.jobs.length} job(s), ${r.voice.length} voice, ${r.encrypt ? 'encrypted' : 'NOT encrypted (test)'}, kept ${r.retentionDays} days)`);
		}
	}
	if (!targets.length) ctx.log('no request files');
	if (bad) throw new FarmError(`${bad} invalid request file(s)`);
};

// ---------------------------------------------------------------------------------------------------------------

export const main = async (argv: string[], env: NodeJS.ProcessEnv = process.env): Promise<number> => {
	const [cmd, ...rest] = argv;
	const ctx = makeCtx(env);
	try {
		switch (cmd) {
			case 'plan':
				cmdPlan(ctx);
				break;
			case 'voice-preflight':
				cmdVoicePreflight(ctx);
				break;
			case 'voice-build':
				await cmdVoiceBuild(ctx);
				break;
			case 'voice-pack':
				cmdVoicePack(ctx);
				break;
			case 'preflight':
				cmdPreflight(ctx);
				break;
			case 'voice-unpack':
				cmdVoiceUnpack(ctx);
				break;
			case 'render':
				await cmdRender(ctx);
				break;
			case 'probe':
				cmdProbe(ctx);
				break;
			case 'pack':
				await cmdPack(ctx);
				break;
			case 'summary':
				cmdSummary(ctx);
				break;
			case 'validate':
				cmdValidate(ctx, rest);
				break;
			default:
				console.error('usage: farm.ts plan | voice-preflight | voice-build | voice-pack | preflight | voice-unpack | render | probe | pack | summary | validate [files...]');
				return 2;
		}
		return 0;
	} catch (e) {
		if (e instanceof FarmError) {
			reportError(ctx, e.message);
			return 1;
		}
		throw e;
	}
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	main(process.argv.slice(2)).then((code) => {
		process.exitCode = code;
	});
}
