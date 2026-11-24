/**
 * Runs the news claim gate for one slug: reads storyboard.json, brief.json, corrections.json and the allowlist,
 * applies the news rules, runs the general claim gate when it exists, and writes out/claims/news-<slug>.md and .json.
 */
import {join, relative} from 'node:path';
import {runGeneralGate, type GeneralGateMode} from './general-gate.ts';
import {readJson, writeAtomic, type JsonRead} from './io.ts';
import {renderMarkdown} from './report.ts';
import {GATE_VERSION, runRules, sortFindings, summarize, type RulesOutput} from './rules.ts';
import type {Finding, GateResult} from './types.ts';

export const SLUG_RE = /^[A-Za-z0-9_][A-Za-z0-9_-]{0,80}$/;
export const CHANNEL = 'zoora-security';

export type GateOptions = {
	slug: string;
	studioRoot: string;
	storyboardPath?: string;
	briefPath?: string;
	contentRoot?: string;
	correctionsPath?: string;
	allowlistPath?: string;
	/** null: do not write the report files */
	outDir?: string | null;
	generalGate?: GeneralGateMode;
	/** with a radar daily file as --brief: the incident id to read */
	incident?: string;
	now?: string;
	env?: NodeJS.ProcessEnv;
};

export type GateRun = {result: GateResult; markdown: string; mdPath: string | null; jsonPath: string | null};

const rel = (root: string, p: string) => {
	const r = relative(root, p);
	return r.startsWith('..') ? p : r;
};

export const runGate = (o: GateOptions): GateRun => {
	const root = o.studioRoot;
	const contentRoot = o.contentRoot ?? join(root, 'content', CHANNEL);
	const storyboardPath = o.storyboardPath ?? join(contentRoot, o.slug, 'storyboard.json');
	const briefPath = o.briefPath ?? join(contentRoot, o.slug, 'brief.json');
	const correctionsPath = o.correctionsPath ?? join(contentRoot, 'corrections.json');
	const allowlistPath = o.allowlistPath ?? join(root, 'scripts', 'news', 'allowlist.json');
	const env = o.env ?? process.env;

	const pre: Finding[] = [];
	const inputErr = (surface: string, message: string, fix: string) => pre.push({rule: 'INPUT', code: 'INPUT.read', severity: 'error', where: {surface}, message, fix});
	const sb = readJson(storyboardPath);
	const br = readJson(briefPath);
	const co = readJson(correctionsPath);
	const al = readJson(allowlistPath);
	if (!sb.ok) inputErr('storyboard', `storyboard.json: ${sb.error}`, sb.missing ? `Write ${rel(root, storyboardPath)} first.` : 'Fix the JSON syntax.');
	if (!br.ok && !br.missing) inputErr('brief', `brief.json: ${br.error}`, 'Fix the JSON syntax (the radar writes this file).');
	if (!al.ok) inputErr('allowlist', `allowlist.json: ${al.error}`, 'Restore scripts/news/allowlist.json.');
	if (!co.ok && !co.missing) pre.push({rule: 'R8', code: 'R8.corrections-file', severity: 'error', where: {surface: 'corrections'}, message: `corrections.json: ${co.error}`, fix: 'Fix the JSON syntax.'});

	const data = (r: JsonRead) => (r.ok ? r.data : null);
	let rules: RulesOutput = {findings: [], claims: [], developing: {incidents: [], label: null, labelVia: null, spokenIn: null}, analysis: [], corrections: {applicable: [], pinnedComments: []}, citedSourceIds: []};
	if (sb.ok) rules = runRules({storyboard: sb.data, brief: br.ok ? br.data : br.missing ? null : {}, corrections: data(co), allowlist: al.ok ? al.data : {}, slug: o.slug, incidentId: o.incident});
	// a brief that exists but does not parse is reported once (above), not again as "missing"
	const findings = [...pre, ...rules.findings.filter((f) => !(f.code === 'INPUT.brief-missing' && !br.ok && !br.missing))];

	const generalGate = runGeneralGate(root, {channel: CHANNEL, slug: o.slug, storyboard: storyboardPath, brief: briefPath, root}, o.generalGate ?? 'auto', env);
	if (generalGate.status === 'failed' || generalGate.status === 'error')
		findings.push({rule: 'GEN', code: `GEN.${generalGate.status}`, severity: 'error', where: {surface: 'general-gate'}, message: `The general claim gate ${generalGate.status === 'failed' ? 'failed' : 'could not run'}: ${generalGate.note}`, fix: 'Fix what its report lists (its output is at the end of this report), or see README "General claim gate".'});
	else if (generalGate.status === 'not-found' || generalGate.status === 'skipped')
		findings.push({rule: 'GEN', code: `GEN.${generalGate.status}`, severity: 'warning', where: {surface: 'general-gate'}, message: generalGate.note, fix: 'Nothing to fix here; the news rules ran in full. Run the general gate when scripts/claims lands.'});

	const sorted = sortFindings(findings);
	const errors = sorted.filter((f) => f.severity === 'error').length;
	const result: GateResult = {
		version: 1,
		gate: 'news-claim-gate',
		gateVersion: GATE_VERSION,
		channel: CHANNEL,
		slug: o.slug,
		checkedAt: o.now ?? new Date().toISOString(),
		verdict: errors ? 'fail' : 'pass',
		inputs: {
			storyboard: {path: rel(root, storyboardPath), sha256: sb.sha256},
			brief: {path: rel(root, briefPath), sha256: br.sha256},
			corrections: {path: rel(root, correctionsPath), sha256: co.sha256},
			allowlist: {path: rel(root, allowlistPath), sha256: al.sha256},
		},
		counts: {
			errors,
			warnings: sorted.filter((f) => f.severity === 'warning').length,
			infos: sorted.filter((f) => f.severity === 'info').length,
			claims: rules.claims.length,
			claimsOk: rules.claims.filter((c) => c.ok).length,
		},
		rules: summarize(sorted),
		findings: sorted,
		claims: rules.claims,
		developing: rules.developing,
		analysis: rules.analysis,
		corrections: rules.corrections,
		generalGate,
	};
	const markdown = renderMarkdown(result);
	let mdPath: string | null = null;
	let jsonPath: string | null = null;
	const outDir = o.outDir === undefined ? join(root, 'out', 'claims') : o.outDir;
	if (outDir !== null) {
		mdPath = join(outDir, `news-${o.slug}.md`);
		jsonPath = join(outDir, `news-${o.slug}.json`);
		writeAtomic(jsonPath, `${JSON.stringify(result, null, 2)}\n`);
		writeAtomic(mdPath, markdown);
	}
	return {result, markdown, mdPath, jsonPath};
};
