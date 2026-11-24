/** The radar command line, the episode lock and the status report. */
import {strict as assert} from 'node:assert';
import {existsSync} from 'node:fs';
import {join} from 'node:path';
import {describe, it} from 'node:test';
import {acquireLock} from '../lib/lock.ts';
import {episodePaths} from '../lib/paths.ts';
import {readRadarFile, runRadar} from '../lib/radar.ts';
import {statusOf} from '../lib/status.ts';
import {DATE, fakeExec, fixtureSwap, NOW, radarFile, SLUG, tempRoot, touch, writeJsonFile} from './helpers.ts';

describe('radar step', () => {
	it('builds the polite command line for each mode', () => {
		const {root, cleanup} = tempRoot();
		try {
			touch(join(root, 'scripts', 'radar', 'radar.py'));
			const live = fakeExec();
			assert.ok(runRadar({root, date: DATE, mode: 'live', exec: live.exec}).ok);
			assert.deepEqual(live.calls[0].args, ['scripts/radar/radar.py', 'collect', '--date', DATE, '--quiet']);
			assert.equal(live.calls[0].cwd, root);
			const off = fakeExec();
			runRadar({root, date: DATE, mode: 'offline', exec: off.exec});
			assert.ok(off.calls[0].args.includes('--offline-fixtures'));
			const reuse = fakeExec();
			assert.ok(runRadar({root, date: DATE, mode: 'reuse', exec: reuse.exec}).ok);
			assert.equal(reuse.calls.length, 0, 'reuse fetches nothing');
			const timeout = fakeExec({radar: () => ({status: null, error: 'spawnSync ETIMEDOUT', timedOut: true})});
			assert.match(runRadar({root, date: DATE, mode: 'live', exec: timeout.exec}).note, /timed out/);
		} finally {
			cleanup();
		}
	});
	it('drops malformed incidents and refuses unknown schemas', () => {
		const {root, cleanup} = tempRoot();
		try {
			const p = join(root, 'r.json');
			writeJsonFile(p, {...radarFile([fixtureSwap()]), alsoSeen: [{id: 'broken'}]});
			const r = readRadarFile(p, DATE, 'live');
			assert.ok(r.ok);
			if (r.ok) {
				assert.equal(r.file.top.length, 1);
				assert.match(r.problems.join(' '), /1 malformed incident/);
			}
			writeJsonFile(p, {...radarFile([fixtureSwap()]), schema: 'something-else@9'});
			assert.ok(!readRadarFile(p, DATE, 'live').ok);
		} finally {
			cleanup();
		}
	});
});

describe('episode lock', () => {
	it('blocks a second run and takes over a stale lock', () => {
		const {root, cleanup} = tempRoot();
		try {
			const path = join(root, 'out', 'daily', SLUG, '.lock');
			writeJsonFile(path, {pid: process.ppid, startedAt: NOW.toISOString()});
			const busy = acquireLock(path, () => NOW);
			assert.ok(!busy.ok);
			writeJsonFile(path, {pid: process.ppid, startedAt: '2026-11-24T00:00:00Z'}); // more than 2 hours old
			const stale = acquireLock(path, () => NOW);
			assert.ok(stale.ok);
			if (stale.ok) stale.release();
			assert.ok(!existsSync(path));
			writeJsonFile(path, {pid: 999999999, startedAt: NOW.toISOString()}); // that process does not exist
			const dead = acquireLock(path, () => NOW);
			assert.ok(dead.ok);
		} finally {
			cleanup();
		}
	});
});

describe('status', () => {
	it('says what is missing at each stage', () => {
		const {root, cleanup} = tempRoot();
		try {
			assert.equal(statusOf(root, SLUG).stage, 'no-brief');
			const ep = episodePaths(root, SLUG);
			writeJsonFile(ep.brief, {status: 'confirmed', incident: {id: 'x'}});
			assert.equal(statusOf(root, SLUG).stage, 'brief-ready');
			writeJsonFile(ep.storyboard, {});
			assert.equal(statusOf(root, SLUG).stage, 'storyboard-written');
		} finally {
			cleanup();
		}
	});
});

describe('hub tool override', () => {
	it('fills {input}, {out} and {dryRun} in DAILY_THREAT_BRIEF_CMD', async () => {
		const {runPostApproval} = await import('../lib/postapproval.ts');
		const {root, cleanup} = tempRoot();
		try {
			const fx = fakeExec();
			const r = runPostApproval({tool: 'threat-brief', outDir: join(root, 'out'), hubRoot: join(root, 'hub'), root, files: {'a.txt': 'x'}, input: {a: 1}, credentialEnv: ['KIT_API_KEY'], videoKnown: false, exec: fx.exec, env: {DAILY_THREAT_BRIEF_CMD: '["node","tb.ts","--in","{input}","{dryRun}","--to","{out}"]'}});
			assert.equal(r.mode, 'hub-dry-run');
			assert.deepEqual(fx.calls[0].args, ['tb.ts', '--in', join(root, 'out', 'threat-brief', 'input.json'), '--dry-run', '--to', join(root, 'out', 'threat-brief')]);
			const bad = runPostApproval({tool: 'announcer', outDir: join(root, 'out'), hubRoot: join(root, 'hub'), root, files: {}, input: {}, credentialEnv: [], videoKnown: true, exec: fx.exec, env: {DAILY_ANNOUNCER_CMD: 'not json'}});
			assert.equal(bad.status, 'failed');
			assert.equal(bad.mode, 'local-draft');
		} finally {
			cleanup();
		}
	});
});
