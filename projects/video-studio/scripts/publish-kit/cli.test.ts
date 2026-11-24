import assert from 'node:assert/strict';
import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {after, describe, it} from 'node:test';
import {run, type CliIO} from './cli.ts';
import {NOW, PROJECT, TEST_REGISTRY_PATH} from './test-helpers.ts';

const io = (env: Record<string, string | undefined> = {}) => {
	const out: string[] = [];
	const err: string[] = [];
	const value: CliIO = {log: (l) => out.push(l), error: (l) => err.push(l), env, now: () => NOW, cwd: PROJECT};
	return {value, out, err};
};

describe('cli', () => {
	const dir = mkdtempSync(join(tmpdir(), 'publish-kit-cli-'));
	after(() => rmSync(dir, {recursive: true, force: true}));

	it('writes the kit and exits 0 when every check passes', () => {
		const out = join(dir, 'ok');
		mkdirSync(out);
		writeFileSync(join(out, 'shorts-9.txt'), 'stale');
		writeFileSync(join(out, 'notes.txt'), 'not ours');
		const t = io();
		const code = run(['zoora-ai/_example', '--offers', TEST_REGISTRY_PATH, '--out', out], t.value);
		assert.equal(code, 0, [...t.out, ...t.err].join('\n'));
		for (const name of ['kit.json', 'youtube-description.txt', 'pinned-comment.txt', 'shorts-1.txt', 'shorts-2.txt', 'tiktok.txt', 'reels.txt', 'x.txt', 'instagram.txt', 'captions.srt', 'captions.vtt', 'render-plan.sh', 'checklist.md']) {
			assert.ok(existsSync(join(out, name)), name);
		}
		assert.equal(existsSync(join(out, 'shorts-9.txt')), false, 'stale generated files are removed');
		assert.equal(existsSync(join(out, 'notes.txt')), true, 'other files are kept');
		assert.equal(statSync(join(out, 'render-plan.sh')).mode & 0o111, 0o111);
		assert.match(t.out.join('\n'), /22\/22 checks pass/);
		assert.match(t.out.join('\n'), /Nothing was rendered or uploaded/);
	});

	it('exits 1 with the failing checks when the registry offers are placeholders', () => {
		const t = io();
		const code = run(['zoora-ai/_example', '--offers', join(PROJECT, '../creator-hub/config/offers.example.json'), '--out', join(dir, 'example')], t.value);
		assert.equal(code, 1);
		assert.match(t.out.join('\n'), /FAIL offers-live: "hardware-wallet" is inactive or expired/);
	});

	it('takes the YouTube id and the hub from flags or HUB_BASE_URL', () => {
		const out = join(dir, 'id');
		const t = io({HUB_BASE_URL: 'https://links.zoora.test'});
		assert.equal(run(['zoora-ai/_example', '--offers', TEST_REGISTRY_PATH, '--out', out, '--youtube-id', 'AbCdEfGh123'], t.value), 0, t.err.join('\n'));
		const kit = JSON.parse(readFileSync(join(out, 'kit.json'), 'utf8'));
		assert.equal(kit.youtubeVideoId, 'AbCdEfGh123');
		assert.equal(kit.offers[0].hubUrl, 'https://links.zoora.test/go/hardware-wallet?v=_example&s=yt');
		assert.match(readFileSync(join(out, 'x.txt'), 'utf8'), /Full episode: https:\/\/youtu\.be\/AbCdEfGh123/);
		assert.match(readFileSync(join(out, 'tiktok.txt'), 'utf8'), /Link in bio: links\.zoora\.test/);
	});

	it('exits 2 and writes nothing on bad input', () => {
		const cases: [string[], RegExp][] = [
			[['zoora-ai/no-such-episode'], /no episode\.json/],
			[['not-a-ref'], /expected <channel>\/<slug>/],
			[['zoora-ai/_example', '--youtube-id', 'short'], /11-character YouTube video id/],
			[['zoora-ai/_example', '--hub', 'http://go.zoora.ai'], /must use https/],
			[['zoora-ai/_example', '--offers', join(dir, 'missing.json')], /offer registry not found/],
			[['zoora-ai/_example', '--bogus'], /Unknown option/],
			[[], /Usage:/],
		];
		for (const [argv, message] of cases) {
			const out = join(dir, 'bad');
			const t = io();
			assert.equal(run([...argv, ...(argv.length ? ['--out', out] : [])], t.value), 2, argv.join(' '));
			assert.match(t.err.join('\n'), message, argv.join(' '));
			assert.equal(existsSync(out), false, `nothing written for ${argv.join(' ')}`);
		}
	});

	it('prints help', () => {
		const t = io();
		assert.equal(run(['--help'], t.value), 0);
		assert.match(t.out.join('\n'), /node scripts\/publish-kit\/cli\.ts <channel>\/<slug>/);
	});
});
