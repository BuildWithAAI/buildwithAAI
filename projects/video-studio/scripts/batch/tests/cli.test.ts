import assert from 'node:assert/strict';
import {existsSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import {test} from 'node:test';
import {EXIT, main} from '../cli.ts';
import {buildEpisode, HUB, logs, makeWorkspace, NOW, STUDIO, testBacklog, testIdea} from './helpers.ts';

const backlogs = () => ({
	'zoora-ai': testBacklog('zoora-ai', [testIdea('alpha', 'pov-story', 1), testIdea('beta', 'pov-story', 2)]),
	'zoora-security': testBacklog('zoora-security', [testIdea('sec-expl', 'explainer', 1), testIdea('sec-sotw', 'scam-of-the-week', 1)]),
});

const run = async (args: string[], o: {prompt?: (q: string) => Promise<string>} = {}) => {
	const out = logs();
	const err = logs();
	const code = await main(args, {log: out.log, err: err.log, now: () => NOW, prompt: o.prompt ?? null, env: {}});
	return {code, out: out.text(), err: err.text()};
};

test('help and usage errors', async () => {
	assert.equal((await run(['--help'])).code, EXIT.ok);
	assert.equal((await run([])).code, EXIT.usage);
	assert.equal((await run(['launch'])).code, EXIT.usage);
	assert.equal((await run(['plan', '--bogus'])).code, EXIT.usage);
	const r = await run(['plan', '--week', '2026-W99']);
	assert.equal(r.code, EXIT.usage);
	assert.match(r.err, /"2026-W99" is not an ISO week/);
	assert.match((await run(['approve', '--week', '2026-W49', '--items', 'ai1;rm'])).err, /not item ids/);
	assert.match((await run(['approve', '--week', '2026-W49', '--items', 'all,ai1'])).err, /either "all" or a list/);
	assert.match((await run(['plan', '--week', '2026-W49', '--now', '2026-11-24 12:00'])).err, /--now must be an ISO 8601 time with Z or an offset/);
});

test('"this" and "next" weeks are read in the owner\'s zone', async (t) => {
	const ws = makeWorkspace({backlogs: backlogs()});
	t.after(ws.cleanup);
	const base = ['--root', ws.root, '--config', ws.configPath];
	// 2026-11-24 18:00 UTC is Tuesday of 2026-W48 in Chicago; "next" is 2026-W49
	const r = await run(['plan', '--week', 'next', '--dry-run', ...base]);
	assert.equal(r.code, EXIT.ok);
	assert.match(r.out, /2026-11-30 11:00 CST {2}ai1/);
	assert.equal((await run(['plan', '--week', 'this', '--dry-run', ...base])).code, EXIT.usage, '2026-W48 is before the start week');
});

test('the whole week from the command line: plan, status, review, approve; nothing is uploaded', async (t) => {
	const ws = makeWorkspace({backlogs: backlogs()});
	t.after(ws.cleanup);
	const base = ['--root', ws.root, '--config', ws.configPath, '--hub', HUB, '--channels', ws.channelsPath, '--state-dir', ws.stateDir, '--now', new Date(NOW).toISOString()];
	assert.equal((await run(['plan', '--week', '2026-W49', ...base])).code, EXIT.ok);
	buildEpisode(ws, {channel: 'zoora-ai', slug: 'alpha', shorts: 3});
	const status = await run(['status', '--week', '2026-W49', '--json', ...base]);
	assert.equal(status.code, EXIT.partial, 'not everything is ready');
	const rows = (JSON.parse(status.out) as {items: Array<{id: string; ready: boolean}>}).items;
	assert.deepEqual(rows.filter((r) => r.ready).map((r) => r.id), ['ai1', 'ai1-s1', 'ai1-s2', 'ai1-s3']);
	assert.equal((await run(['review', '--week', '2026-W49', ...base])).code, EXIT.partial);
	assert.ok(existsSync(join(ws.root, 'out/approval/week-2026-W49/index.html')));
	const noOwner = await run(['approve', '--week', '2026-W49', '--items', 'ai1', ...base]);
	assert.equal(noOwner.code, EXIT.notApproved);
	assert.match(noOwner.out, /Without a terminal, pass the owner's own reply/);
	const typed = await run(['approve', '--week', '2026-W49', '--items', 'ai1-s2', ...base], {prompt: async () => 'no'});
	assert.equal(typed.code, EXIT.notApproved);
	const ok = await run(['approve', '--week', '2026-W49', '--items', 'ai1,ai1-s1', '--reply', 'APPROVE 2026-W49 ai1 ai1-s1', ...base]);
	assert.equal(ok.code, EXIT.ok, ok.out + ok.err);
	assert.match(ok.out, /Nothing was uploaded/);
	assert.ok(existsSync(join(ws.root, 'out/publish/zoora-ai/alpha/approval-long.json')));
	assert.ok(existsSync(join(ws.root, 'out/publish/zoora-ai/alpha/approval-short-1.json')));
	assert.equal(existsSync(join(ws.stateDir, 'ledger.json')), false);
});

test('calendar --check passes on the committed calendar and fails on a stale one', async (t) => {
	assert.equal((await run(['calendar', '--from', '2026-W49', '--weeks', '4', '--check'])).code, EXIT.ok);
	const ws = makeWorkspace();
	t.after(ws.cleanup);
	const stale = ws.write('CONTENT_CALENDAR.md', '# old\n');
	const r = await run(['calendar', '--from', '2026-W49', '--weeks', '4', '--check', '--out', stale]);
	assert.equal(r.code, EXIT.partial);
	assert.match(r.err, /is stale: run node scripts\/batch\/cli\.ts calendar/);
	assert.equal(readFileSync(join(STUDIO, 'docs/CONTENT_CALENDAR.md'), 'utf8').startsWith('# Content calendar: 4 weeks from 30 Nov 2026 (proposal)'), true);
});
