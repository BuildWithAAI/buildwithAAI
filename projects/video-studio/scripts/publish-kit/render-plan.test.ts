import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {describe, it} from 'node:test';
import {buildRenders, renderPlanScript, shq} from './render-plan.ts';
import {exampleEpisode} from './test-helpers.ts';

describe('buildRenders', () => {
	it('uses the <Composition>-Short-<n> convention and one still per thumbnail variant for a custom entry', () => {
		const e = exampleEpisode({render: {composition: 'PilotEpisode', entry: 'src/index.ts', thumbnailComposition: 'PilotThumb', thumbnails: 2}});
		const renders = buildRenders(e);
		assert.deepEqual(
			renders.map((r) => [r.id, r.kind]),
			[
				['long', 'long'],
				['short-1', 'short'],
				['short-2', 'short'],
				['thumb-v0', 'thumbnail'],
				['thumb-v1', 'thumbnail'],
			],
		);
		assert.equal(
			renders[1].command,
			`npx remotion render src/index.ts PilotEpisode-Short-1 out/publish/zoora-ai/_example/media/short-1.mp4 --props='{"channel":"zoora-ai","slug":"_example","lang":"en"}'`,
		);
		assert.equal(renders[1].output, 'out/publish/zoora-ai/_example/media/short-1.mp4');
		assert.equal(
			renders[4].command,
			`npx remotion still src/index.ts PilotThumb out/publish/zoora-ai/_example/media/thumb-v1.png --image-format=png --props='{"channel":"zoora-ai","slug":"_example","lang":"en","variant":1}'`,
		);
	});
	it('engine episodes: EpisodeShort with shortId, and thumbnails from the checked thumbnail builder', () => {
		const renders = buildRenders(exampleEpisode());
		assert.match(renders[2].command, /^npx remotion render src\/episode\/index\.ts EpisodeShort .*"shortId":"short2"/);
		const thumbs = renders.filter((r) => r.kind === 'thumbnail');
		assert.deepEqual(
			thumbs.map((r) => r.output),
			[0, 1, 2].map((i) => `out/publish/zoora-ai/_example/media/thumbnails/en/v${i}.png`),
		);
		for (const r of thumbs) assert.equal(r.command, 'node scripts/thumbnails.ts zoora-ai/_example --lang en --out out/publish/zoora-ai/_example/media/thumbnails');
	});
	it('shq quotes for bash', () => {
		assert.equal(shq(`it's`), `'it'\\''s'`);
	});
});

describe('render-plan.sh', () => {
	const script = renderPlanScript(exampleEpisode(), buildRenders(exampleEpisode()), '2026-11-24T12:00:00.000Z');
	it('normalises loudness in two passes to -14 LUFS / -1 dBTP and guards against a missing storyboard', () => {
		assert.ok(script.startsWith('#!/usr/bin/env bash\n'));
		assert.match(script, /loudnorm=I=-14:TP=-1:LRA=11:print_format=json/);
		assert.match(script, /measured_I=/);
		assert.match(script, /linear=true/);
		assert.match(script, /-c:a aac -b:a 192k -ar 48000/);
		assert.match(script, /\[ -f 'content\/zoora-ai\/_example\/storyboard\.json' \]/);
		assert.equal((script.match(/^ {2}loudnorm out\//gm) ?? []).length, 3); // long + 2 Shorts, not the thumbnails
		assert.equal((script.match(/^ {2}node scripts\/thumbnails\.ts /gm) ?? []).length, 1); // one run renders all three
	});
	it('has no storyboard guard for a custom entry point', () => {
		const e = exampleEpisode({render: {entry: 'src/index.ts', composition: 'PilotEpisode'}});
		assert.ok(!renderPlanScript(e, buildRenders(e), 'now').includes('storyboard.json'));
	});
	it('is valid bash (bash -n)', (t) => {
		const bash = spawnSync('bash', ['--version']);
		if (bash.error) return t.skip('bash is not installed');
		const dir = mkdtempSync(join(tmpdir(), 'publish-kit-plan-'));
		try {
			writeFileSync(join(dir, 'render-plan.sh'), script);
			const r = spawnSync('bash', ['-n', join(dir, 'render-plan.sh')], {encoding: 'utf8'});
			assert.equal(r.status, 0, r.stderr);
		} finally {
			rmSync(dir, {recursive: true, force: true});
		}
	});
});
