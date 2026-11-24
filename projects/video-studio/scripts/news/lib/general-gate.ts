/**
 * Adapter for the GENERAL claim gate in scripts/claims (built by another workflow; not present when this was written).
 * The news gate runs in addition to it: when an entry point exists it is run as a child process and its exit code
 * decides (0 = passed). Either way the news rules are enforced by this gate.
 *
 * Discovery, in order:
 *   1. NEWS_GENERAL_GATE_CMD: a JSON array of argv, with placeholders {channel} {slug} {storyboard} {brief} {root}.
 *   2. scripts/claims/{gate,check,cli,index,run,main,claims}.ts   -> node <file> <channel>/<slug>
 *   3. scripts/claims/{gate,check,cli,run,main,claims}.py or __main__.py -> python3 <file|dir> <channel>/<slug>
 * The call convention <channel>/<slug> follows the planned `npm run make -- <channel>/<slug>`. If the general gate
 * settles on another one, set NEWS_GENERAL_GATE_CMD (see README) until this adapter is updated.
 */
import {spawnSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {join} from 'node:path';
import type {GeneralGateResult} from './types.ts';

export type GeneralGateMode = 'auto' | 'require' | 'off';

const TS_NAMES = ['gate', 'check', 'cli', 'index', 'run', 'main', 'claims'];
const PY_NAMES = ['gate', 'check', 'cli', 'run', 'main', 'claims'];
export const RECURSION_ENV = 'NEWS_GATE_PARENT';
const TIMEOUT_MS = 180_000;

export type GateCall = {channel: string; slug: string; storyboard: string; brief: string; root: string};

export const discoverGeneralGate = (root: string, call: GateCall, env: NodeJS.ProcessEnv = process.env): {argv: string[] | null; looked: string[]; problem?: string} => {
	const looked: string[] = [];
	const override = env.NEWS_GENERAL_GATE_CMD;
	if (override) {
		looked.push('NEWS_GENERAL_GATE_CMD');
		try {
			const arr = JSON.parse(override) as unknown;
			if (!Array.isArray(arr) || !arr.length || arr.some((x) => typeof x !== 'string')) throw new Error('not an array of strings');
			const fill = (s: string) =>
				s.replace(/\{(channel|slug|storyboard|brief|root)\}/g, (_, k: keyof GateCall) => call[k]);
			return {argv: (arr as string[]).map(fill), looked};
		} catch (err) {
			return {argv: null, looked, problem: `NEWS_GENERAL_GATE_CMD must be a JSON array of strings (${err instanceof Error ? err.message : String(err)})`};
		}
	}
	const dir = join(root, 'scripts', 'claims');
	for (const n of TS_NAMES) {
		const f = join(dir, `${n}.ts`);
		looked.push(`scripts/claims/${n}.ts`);
		if (existsSync(f)) return {argv: [process.execPath, '--disable-warning=MODULE_TYPELESS_PACKAGE_JSON', f, `${call.channel}/${call.slug}`], looked};
	}
	for (const n of PY_NAMES) {
		const f = join(dir, `${n}.py`);
		looked.push(`scripts/claims/${n}.py`);
		if (existsSync(f)) return {argv: ['python3', f, `${call.channel}/${call.slug}`], looked};
	}
	looked.push('scripts/claims/__main__.py');
	if (existsSync(join(dir, '__main__.py'))) return {argv: ['python3', dir, `${call.channel}/${call.slug}`], looked};
	return {argv: null, looked};
};

const tail = (s: string, n = 1500): string => (s.length <= n ? s : `…${s.slice(-n)}`);

export const runGeneralGate = (root: string, call: GateCall, mode: GeneralGateMode, env: NodeJS.ProcessEnv = process.env): GeneralGateResult => {
	if (mode === 'off') return {status: 'skipped', note: 'Skipped (--general-gate off). Only the news rules were checked.'};
	if (env[RECURSION_ENV]) return {status: 'skipped', note: 'Skipped: this run was started by another claim gate (recursion guard).'};
	const found = discoverGeneralGate(root, call, env);
	if (found.problem) return {status: 'error', note: found.problem, looked: found.looked};
	if (!found.argv) {
		return {
			status: mode === 'require' ? 'error' : 'not-found',
			note:
				mode === 'require'
					? 'The general claim gate is required (--general-gate require) but scripts/claims has no entry point.'
					: 'Not found: scripts/claims has no entry point yet. The news rules were enforced on their own.',
			looked: found.looked,
		};
	}
	const started = Date.now();
	const res = spawnSync(found.argv[0], found.argv.slice(1), {
		cwd: root,
		encoding: 'utf8',
		timeout: TIMEOUT_MS,
		maxBuffer: 16 * 1024 * 1024,
		env: {...env, [RECURSION_ENV]: '1'},
	});
	const durationMs = Date.now() - started;
	const output = tail(`${res.stdout ?? ''}${res.stderr ? `\n${res.stderr}` : ''}`.trim());
	if (res.error) {
		const timedOut = (res.error as NodeJS.ErrnoException).code === 'ETIMEDOUT';
		return {status: 'error', command: found.argv, exitCode: res.status, durationMs, outputTail: output, note: timedOut ? `Timed out after ${TIMEOUT_MS / 1000} s.` : `Could not run it: ${res.error.message}`, looked: found.looked};
	}
	if (res.status === 0) return {status: 'passed', command: found.argv, exitCode: 0, durationMs, outputTail: output, note: 'Passed.', looked: found.looked};
	return {
		status: 'failed',
		command: found.argv,
		exitCode: res.status,
		durationMs,
		outputTail: output,
		note: res.signal ? `Stopped by signal ${res.signal}.` : `Exited with code ${res.status}. Its own report has the details.`,
		looked: found.looked,
	};
};
