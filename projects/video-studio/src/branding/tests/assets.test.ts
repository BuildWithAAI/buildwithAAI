/**
 * Render-manifest tests: every channel gets the full kit, committed files stay small and under public/brand,
 * everything else goes to out/ (gitignored), and ids and outputs are unique.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {ASSETS, assetById} from '../assets.ts';
import {SERIES, SERIES_IDS} from '../series.ts';
import {CHANNEL_KEYS} from '../tokens.ts';

test('assets: ids and output paths are unique', () => {
	assert.equal(new Set(ASSETS.map((a) => a.id)).size, ASSETS.length);
	assert.equal(new Set(ASSETS.map((a) => a.out)).size, ASSETS.length);
	assert.throws(() => assetById('nope'), /unknown/);
});

test('assets: every channel has banner, avatar, watermark, end-screen frame and video, sting and its badges', () => {
	for (const ch of CHANNEL_KEYS) {
		for (const role of ['banner', 'avatar', 'watermark', 'endscreen', 'sting'] as const) {
			assert.ok(ASSETS.some((a) => a.channel === ch && a.role === role), `${ch} ${role}`);
		}
		const badges = SERIES_IDS.filter((s) => SERIES[s].channel === ch);
		for (const s of badges) for (const tone of ['dark', 'light']) assert.ok(ASSETS.some((a) => a.id === `${ch}/badge/${s}-${tone}`), `${ch} ${s} ${tone}`);
	}
});

test('assets: committed deliverables are PNG stills under public/brand; videos, alternates and QA layers go to out/', () => {
	for (const a of ASSETS) {
		if (a.out.startsWith('public/')) {
			assert.ok(a.out.startsWith('public/brand/'), a.out);
			assert.equal(a.kind, 'still', `${a.id}: only stills are committed`);
			assert.ok(a.out.endsWith('.png'), a.out);
			assert.ok(['banner', 'avatar', 'watermark', 'endscreen', 'badge'].includes(a.role), a.id);
		} else {
			assert.ok(a.out.startsWith('out/brand/'), a.out);
		}
		if (a.kind === 'video') {
			assert.ok(a.out.endsWith('.mp4'));
			assert.equal(a.silentAudio, true, `${a.id}: videos carry an empty audio track`);
		}
		if (a.role === 'badge') assert.equal(a.trim, true);
	}
});
