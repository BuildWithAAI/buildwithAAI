/**
 * Gate before push. A request renders a storyboard that is committed to this PUBLIC repository, so the script is
 * public the moment the request is pushed, and history is never rewritten. The claim gate must therefore pass BEFORE
 * the push: `farm.ts validate` (run locally before pushing) and the `plan` job both run it on the storyboard as it is
 * now, for every episode or show the request voices or renders, and refuse the request when it fails.
 *
 *   - scripts/claims/check.ts content/<channel>/<slug> --lang <lang>   (every channel; CLAUDE.md pipeline step 2)
 *   - scripts/news/gate.ts <slug>                                      (zoora-security news items: a brief.json exists)
 *
 * The private names list (data/private/names.txt) is gitignored and never reaches CI. So the claim gate runs in one of
 * two modes:
 *   - 'check' (local `validate`): with the list (--names <project>/data/private/names.txt). The farm reads the gate's
 *     own JSON report back to confirm the names were checked, and `validate` then writes the gate receipt (receipt.ts).
 *   - 'skip'  (the `plan` job on GitHub): --no-names, so every other rule still runs on the pushed commit; the plan
 *     requires a receipt that proves the names were checked locally on exactly this content.
 *
 * The gates run as child processes with their output captured and never printed: in CI the log is public and a gate
 * report quotes the script. Each run writes its report to a fresh folder that is deleted right after. Only the channel,
 * slug, language and the verdict are reported.
 */
import {spawnSync} from 'node:child_process';
import {existsSync, mkdirSync, readdirSync, readFileSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {CONTENT_ENTRIES, FARM_CHANNEL, type RenderRequest} from './request.ts';

export const CLAIM_GATE = 'scripts/claims/check.ts';
export const NEWS_GATE = 'scripts/news/gate.ts';
export const NEWS_CHANNEL = 'zoora-security';
/** The private names list (gitignored; scripts/claims/README.md). Its contents never leave the owner's computer. */
export const NAMES_LIST = 'data/private/names.txt';

const CHANNEL_RE = /^[a-z0-9][a-z0-9-]{0,47}$/;
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,95}$/;

/** One storyboard language the request touches. lang null: the storyboard's own language (the gate's default). */
export type GateTarget = {channel: string; slug: string; lang: string | null};

export type GateStatus = 'pass' | 'fail' | 'error' | 'missing';

/** check: with the private names list (local validate). skip: --no-names (the plan job in CI, where the list never is). */
export type NamesMode = 'check' | 'skip';

/**
 * What one gate run proved about the private names: 'checked' (a passing claim report says the list was read),
 * 'checked-empty' (the same, but the list holds no entries, so nothing was compared), 'unchecked' (anything else:
 * --no-names, a failure, the news gate).
 */
export type NamesResult = 'checked' | 'checked-empty' | 'unchecked';

export type GateRun = {status: GateStatus; names: NamesResult};

export type GateVerdict = {target: GateTarget; gate: 'claims' | 'news'; status: GateStatus; names: NamesResult};

/** Runs one gate; injectable for tests. */
export type GateRunner = (gate: 'claims' | 'news', target: GateTarget, names: NamesMode) => GateRun;

export const contentDir = (t: Pick<GateTarget, 'channel' | 'slug'>): string => `content/${t.channel}/${t.slug}`;

/** "channel/slug/lang" ("*" for the storyboard's own language): how targets are matched and deduplicated. */
export const targetKey = (t: GateTarget): string => `${t.channel}/${t.slug}/${t.lang ?? '*'}`;

/** "channel/slug (lang)": how a target is named in messages. */
export const targetLabel = (t: GateTarget): string => `${t.channel}/${t.slug}${t.lang ? ` (${t.lang})` : ''}`;

/**
 * The storyboards a request voices or renders. Voice entries name them; jobs from an episode or show entry must name
 * channel and slug in their props (the farm cannot tell otherwise which script they render). Test renders and the
 * farm's own fixtures (_farm) are not content.
 */
export const gateTargets = (req: RenderRequest): {targets: GateTarget[]; errors: string[]} => {
	const errors: string[] = [];
	const seen = new Map<string, GateTarget>();
	const add = (t: GateTarget) => {
		const key = targetKey(t);
		if (!seen.has(key)) seen.set(key, t);
	};
	for (const v of req.voice) if (v.channel !== FARM_CHANNEL) add({channel: v.channel, slug: v.slug, lang: v.lang});
	req.jobs.forEach((j, i) => {
		if (!CONTENT_ENTRIES.includes(j.entry)) return;
		const {channel, slug} = j.props;
		if (typeof channel !== 'string' || !CHANNEL_RE.test(channel) || typeof slug !== 'string' || !SLUG_RE.test(slug)) {
			errors.push(`jobs[${i}] renders an episode or show (${j.entry}): its props must name "channel" and "slug" so the farm can check that script's claim gate`);
			return;
		}
		add({channel, slug, lang: j.lang});
	});
	return {targets: [...seen.values()], errors};
};

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Reads the one claim report a run wrote and says whether it proves the private names were checked: a passing report
 * for this very target whose names list was read (a path, not skipped). Only that verdict leaves this function: the
 * report's text, the list's path and its entry count are never returned, logged or stored.
 */
export const reportNames = (dir: string, t: GateTarget): NamesResult => {
	try {
		const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
		if (files.length !== 1) return 'unchecked';
		const r: unknown = JSON.parse(readFileSync(join(dir, files[0]), 'utf8'));
		if (!isRecord(r) || r.tool !== 'claims/check' || r.pass !== true || r.channel !== t.channel || r.slug !== t.slug) return 'unchecked';
		if (t.lang !== null && r.lang !== t.lang) return 'unchecked';
		const n = r.namesList;
		if (!isRecord(n) || typeof n.path !== 'string' || !n.path || n.skipped === true) return 'unchecked';
		return n.count === 0 ? 'checked-empty' : 'checked';
	} catch {
		return 'unchecked';
	}
};

/** The real gates, as child processes of this Node (no shell). Output is captured and dropped; reports are deleted. */
export const spawnGateRunner = (project: string, outDir: string, env: NodeJS.ProcessEnv): GateRunner => {
	let runs = 0;
	return (gate, t, names) => {
		const script = gate === 'claims' ? CLAIM_GATE : NEWS_GATE;
		if (!existsSync(join(project, script))) return {status: 'missing', names: 'unchecked'};
		const dir = join(outDir, `run-${runs++}`);
		rmSync(dir, {recursive: true, force: true});
		mkdirSync(dir, {recursive: true});
		try {
			const namesArgs = names === 'skip' ? ['--no-names'] : ['--names', join(project, NAMES_LIST)];
			const args =
				gate === 'claims'
					? [script, contentDir(t), ...(t.lang ? ['--lang', t.lang] : []), ...namesArgs, '--quiet', '--out-dir', dir]
					: [script, t.slug, '--quiet', '--out', dir, '--general-gate', 'off'];
			const r = spawnSync(process.execPath, ['--disable-warning=MODULE_TYPELESS_PACKAGE_JSON', ...args], {cwd: project, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 16 * 1024 * 1024, timeout: 120_000});
			const status: GateStatus = r.status === 0 ? 'pass' : r.status === 1 ? 'fail' : 'error';
			return {status, names: gate === 'claims' && status === 'pass' && names === 'check' ? reportNames(dir, t) : 'unchecked'};
		} finally {
			rmSync(dir, {recursive: true, force: true}); // the report quotes the script: read once, never kept
		}
	};
};

/** Runs every gate a request needs. Returns one problem per failed gate, never with script text. */
export const checkGates = (project: string, req: RenderRequest, run: GateRunner, names: NamesMode): {problems: string[]; verdicts: GateVerdict[]; targets: GateTarget[]} => {
	const {targets, errors} = gateTargets(req);
	const problems = [...errors];
	const verdicts: GateVerdict[] = [];
	for (const t of targets) {
		const {status, names: proved} = run('claims', t, names);
		verdicts.push({target: t, gate: 'claims', status, names: proved});
		if (status === 'missing') problems.push(`${targetLabel(t)}: the claim gate (${CLAIM_GATE}) is not in this checkout, so the script cannot be checked; a script must pass it before it is pushed`);
		else if (status === 'fail') problems.push(`${targetLabel(t)}: the claim gate FAILS. Fix the script before pushing it (node ${CLAIM_GATE} ${contentDir(t)}${t.lang ? ` --lang ${t.lang}` : ''} prints the report)`);
		else if (status === 'error') problems.push(`${targetLabel(t)}: the claim gate could not check it (a missing storyboard or bad input; run node ${CLAIM_GATE} ${contentDir(t)}${t.lang ? ` --lang ${t.lang}` : ''})`);
		if (t.channel === NEWS_CHANNEL && existsSync(join(project, contentDir(t), 'brief.json')) && !verdicts.some((v) => v.gate === 'news' && v.target.slug === t.slug)) {
			const news = run('news', t, names).status;
			verdicts.push({target: {...t, lang: null}, gate: 'news', status: news, names: 'unchecked'});
			if (news === 'missing') problems.push(`${t.channel}/${t.slug}: the news gate (${NEWS_GATE}) is not in this checkout; a news script must pass it before it is pushed`);
			else if (news !== 'pass') problems.push(`${t.channel}/${t.slug}: the news gate ${news === 'fail' ? 'FAILS' : 'could not check it'} (node ${NEWS_GATE} ${t.slug} prints the report)`);
		}
	}
	return {problems, verdicts, targets};
};
