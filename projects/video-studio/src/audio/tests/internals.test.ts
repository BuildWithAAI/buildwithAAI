/**
 * PcmTrack relies on Remotion internals (the render-asset manager and inline audio, as @remotion/media's
 * <Audio> uses them). package.json pins every remotion package to 4.0.541; this test fails loudly if an
 * upgrade removes or renames what PcmTrack needs, before a render silently drops the music.
 */
import assert from 'node:assert/strict';
import {existsSync, readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {describe, it} from 'node:test';
import {Internals, VERSION} from 'remotion';
import {STUDIO} from './helpers.ts';

const require = createRequire(import.meta.url);

describe('Remotion internals PcmTrack uses', () => {
	it('runs on the pinned Remotion version, renderer included', () => {
		assert.equal(VERSION, '4.0.541');
		const pkg = JSON.parse(readFileSync(`${STUDIO}package.json`, 'utf8')) as {dependencies: Record<string, string>};
		assert.equal(pkg.dependencies.remotion, '4.0.541');
		const renderer = JSON.parse(readFileSync(require.resolve('@remotion/renderer/package.json'), 'utf8')) as {version: string};
		assert.equal(renderer.version, VERSION);
	});
	it('exposes the render-asset manager, sequence context, timeline position, audio context and audio switch', () => {
		const i = Internals as unknown as Record<string, unknown>;
		for (const k of ['RenderAssetManager', 'SequenceContext', 'useTimelinePosition', 'SharedAudioContext', 'useAudioEnabled', 'validateRenderAsset']) assert.ok(i[k], `Internals.${k}`);
	});
	it('accepts an inline-audio asset as PcmTrack builds it', () => {
		const validate = (Internals as unknown as {validateRenderAsset: (a: unknown) => void}).validateRenderAsset;
		assert.doesNotThrow(() =>
			validate({type: 'inline-audio', id: 'pcm-test', audio: [0, 0, 0, 0], frame: 0, startInVideo: 0, timestamp: 0, duration: 41.67, toneFrequency: 1}),
		);
	});
	it('the renderer mixes inline audio into the output at floor(frame / fps * sampleRate), 16-bit stereo', () => {
		const dir = require.resolve('@remotion/renderer/package.json').replace(/package\.json$/, '');
		const mixing = `${dir}dist/assets/inline-audio-mixing.js`;
		assert.ok(existsSync(mixing), mixing);
		const src = readFileSync(mixing, 'utf8');
		assert.match(src, /const BIT_DEPTH = 16;/);
		assert.match(src, /const NUMBER_OF_CHANNELS = 2;/);
		assert.match(src, /Math\.floor\(correctFloatingPointError\(positionInRenderInSeconds \* sampleRate\)\)/);
		assert.match(readFileSync(`${dir}dist/filter-asset-types.js`, 'utf8'), /asset\.type === 'inline-audio'/);
	});
});
