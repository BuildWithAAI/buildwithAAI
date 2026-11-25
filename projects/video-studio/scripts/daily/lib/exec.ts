/**
 * Runs the pipeline's other tools as child processes. Injectable, so the tests replace every step with a fake and
 * no test ever renders, synthesizes, fetches or uploads anything.
 */
import {spawnSync} from 'node:child_process';
import {realpathSync, statSync} from 'node:fs';
import {resolve} from 'node:path';
import {tail} from './util.ts';

export type ExecRequest = {cmd: string; args: string[]; cwd: string; env?: NodeJS.ProcessEnv; timeoutMs: number};
export type ExecResult = {status: number | null; stdout: string; stderr: string; durationMs: number; error?: string; timedOut?: boolean};
export type Exec = (req: ExecRequest) => ExecResult;

export const realExec: Exec = (req) => {
	const started = Date.now();
	const res = spawnSync(req.cmd, req.args, {
		cwd: req.cwd,
		env: req.env ?? process.env,
		encoding: 'utf8',
		timeout: req.timeoutMs,
		maxBuffer: 64 * 1024 * 1024,
		stdio: ['ignore', 'pipe', 'pipe'],
	});
	const durationMs = Date.now() - started;
	if (res.error) {
		const code = (res.error as NodeJS.ErrnoException).code;
		return {status: res.status, stdout: res.stdout ?? '', stderr: res.stderr ?? '', durationMs, error: res.error.message, timedOut: code === 'ETIMEDOUT'};
	}
	return {status: res.status, stdout: res.stdout ?? '', stderr: res.signal ? `${res.stderr ?? ''}\nstopped by ${res.signal}` : res.stderr ?? '', durationMs};
};

/** stdout + stderr, trimmed to the end (where the error usually is). */
export const outputTail = (r: ExecResult, n = 2000): string => tail(`${r.stdout ?? ''}${r.stderr ? `\n${r.stderr}` : ''}`.trim(), n);

/** Minutes → ms, for readable timeouts. */
export const minutes = (n: number): number => Math.round(n * 60_000);

/**
 * A script's real path. Node gives a CLI the path it was launched by (process.argv[1]) but the module its real path
 * (import.meta.url), so a tool that compares the two (the hub's announcer, the publish kit) skips main() when launched
 * through a symlink, prints nothing and exits 0. Launching by the real path avoids that; a path that cannot be resolved
 * is kept as it is (the caller's output check then catches a run that did nothing).
 */
export const realScript = (path: string, cwd = process.cwd()): string => {
	try {
		return realpathSync(resolve(cwd, path));
	} catch {
		return path;
	}
};

/** An argv (an owner's override command) with each script file in it (.ts, .js, .mjs, .cjs) launched by its real path. */
export const realScripts = (argv: string[], cwd: string): string[] =>
	argv.map((a, i) => {
		if (i === 0 || !/\.(?:[cm]?[jt]s)$/i.test(a)) return a;
		try {
			return statSync(resolve(cwd, a)).isFile() ? realScript(a, cwd) : a;
		} catch {
			return a;
		}
	});
