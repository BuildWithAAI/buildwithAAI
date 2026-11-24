/**
 * Gate before push. A request renders a storyboard that is committed to this PUBLIC repository, so the script is
 * public the moment the request is pushed, and history is never rewritten. The claim gate must therefore pass BEFORE
 * the push: `farm.ts validate` (run locally before pushing) and the `plan` job both run it on the storyboard as it is
 * now, for every episode or show the request voices or renders, and refuse the request when it fails.
 *
 *   - scripts/claims/check.ts content/<channel>/<slug> --lang <lang>   (every channel; CLAUDE.md pipeline step 2)
 *   - scripts/news/gate.ts <slug>                                      (zoora-security news items: a brief.json exists)
 *
 * The gates run as child processes with their output captured and never printed: in CI the log is public and a gate
 * report quotes the script. Only the channel, slug, language and the verdict are reported.
 */
import {spawnSync} from 'node:child_process';
import {existsSync, mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {CONTENT_ENTRIES, FARM_CHANNEL, type RenderRequest} from './request.ts';

export const CLAIM_GATE = 'scripts/claims/check.ts';
export const NEWS_GATE = 'scripts/news/gate.ts';
export const NEWS_CHANNEL = 'zoora-security';

const CHANNEL_RE = /^[a-z0-9][a-z0-9-]{0,47}$/;
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,95}$/;

/** One storyboard language the request touches. lang null: the storyboard's own language (the gate's default). */
export type GateTarget = {channel: string; slug: string; lang: string | null};

export type GateVerdict = {target: GateTarget; gate: 'claims' | 'news'; status: 'pass' | 'fail' | 'error' | 'missing'};

/** Runs one gate; injectable for tests. */
export type GateRunner = (gate: 'claims' | 'news', target: GateTarget) => GateVerdict['status'];

export const contentDir = (t: Pick<GateTarget, 'channel' | 'slug'>): string => `content/${t.channel}/${t.slug}`;

/**
 * The storyboards a request voices or renders. Voice entries name them; jobs from an episode or show entry must name
 * channel and slug in their props (the farm cannot tell otherwise which script they render). Test renders and the
 * farm's own fixtures (_farm) are not content.
 */
export const gateTargets = (req: RenderRequest): {targets: GateTarget[]; errors: string[]} => {
	const errors: string[] = [];
	const seen = new Map<string, GateTarget>();
	const add = (t: GateTarget) => {
		const key = `${t.channel}/${t.slug}/${t.lang ?? '*'}`;
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

/** The real gates, as child processes of this Node (no shell). Output is captured and dropped. */
export const spawnGateRunner = (project: string, outDir: string, env: NodeJS.ProcessEnv): GateRunner => (gate, t) => {
	const script = gate === 'claims' ? CLAIM_GATE : NEWS_GATE;
	if (!existsSync(join(project, script))) return 'missing';
	mkdirSync(outDir, {recursive: true});
	const args =
		gate === 'claims'
			? [script, contentDir(t), ...(t.lang ? ['--lang', t.lang] : []), '--quiet', '--out-dir', outDir]
			: [script, t.slug, '--quiet', '--out', outDir, '--general-gate', 'off'];
	const r = spawnSync(process.execPath, ['--disable-warning=MODULE_TYPELESS_PACKAGE_JSON', ...args], {cwd: project, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 16 * 1024 * 1024, timeout: 120_000});
	return r.status === 0 ? 'pass' : r.status === 1 ? 'fail' : 'error';
};

const label = (t: GateTarget) => `${t.channel}/${t.slug}${t.lang ? ` (${t.lang})` : ''}`;

/** Runs every gate a request needs. Returns one problem per failed gate, never with script text. */
export const checkGates = (project: string, req: RenderRequest, run: GateRunner): {problems: string[]; verdicts: GateVerdict[]} => {
	const {targets, errors} = gateTargets(req);
	const problems = [...errors];
	const verdicts: GateVerdict[] = [];
	for (const t of targets) {
		const status = run('claims', t);
		verdicts.push({target: t, gate: 'claims', status});
		if (status === 'missing') problems.push(`${label(t)}: the claim gate (${CLAIM_GATE}) is not in this checkout, so the script cannot be checked; a script must pass it before it is pushed`);
		else if (status === 'fail') problems.push(`${label(t)}: the claim gate FAILS. Fix the script before pushing it (node ${CLAIM_GATE} ${contentDir(t)}${t.lang ? ` --lang ${t.lang}` : ''} prints the report)`);
		else if (status === 'error') problems.push(`${label(t)}: the claim gate could not check it (a missing storyboard or bad input; run node ${CLAIM_GATE} ${contentDir(t)}${t.lang ? ` --lang ${t.lang}` : ''})`);
		if (t.channel === NEWS_CHANNEL && existsSync(join(project, contentDir(t), 'brief.json')) && !verdicts.some((v) => v.gate === 'news' && v.target.slug === t.slug)) {
			const news = run('news', t);
			verdicts.push({target: {...t, lang: null}, gate: 'news', status: news});
			if (news === 'missing') problems.push(`${t.channel}/${t.slug}: the news gate (${NEWS_GATE}) is not in this checkout; a news script must pass it before it is pushed`);
			else if (news !== 'pass') problems.push(`${t.channel}/${t.slug}: the news gate ${news === 'fail' ? 'FAILS' : 'could not check it'} (node ${NEWS_GATE} ${t.slug} prints the report)`);
		}
	}
	return {problems, verdicts};
};
