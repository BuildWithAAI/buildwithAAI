/**
 * Runs the pipeline's other tools as child processes. Injectable, so the tests replace every step with a fake and
 * no test ever renders, synthesizes, fetches or uploads anything.
 */
import {spawnSync} from 'node:child_process';
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
