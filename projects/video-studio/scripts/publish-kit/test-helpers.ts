/** Shared test fixtures: the fictional example episode and a test offer registry (fixtures/offers.test.json). */
import {readFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {parseEpisode} from './episode.ts';
import type {Episode, OfferRegistry} from './types.ts';

export const PROJECT = resolve(import.meta.dirname, '../..');
export const EXAMPLE_DIR = join(PROJECT, 'content', 'zoora-ai', '_example');
export const TEST_REGISTRY_PATH = join(import.meta.dirname, 'fixtures', 'offers.test.json');
export const NOW = new Date('2026-11-24T12:00:00Z');
export const HUB = 'https://go.zoora.ai';
export const CHANNEL_INFO = {displayName: 'Zoora AI', handle: '@ZooraTechnologies'};

export const exampleJson = (): Record<string, unknown> => JSON.parse(readFileSync(join(EXAMPLE_DIR, 'episode.json'), 'utf8'));
export const exampleCaptions = (): unknown => JSON.parse(readFileSync(join(EXAMPLE_DIR, 'captions.json'), 'utf8'));
export const testRegistry = (): OfferRegistry => JSON.parse(readFileSync(TEST_REGISTRY_PATH, 'utf8'));

/** The example episode with some fields replaced; captions are the example's unless overridden. */
export const exampleEpisode = (over: Record<string, unknown> = {}, extra: {captions?: unknown; timeline?: unknown} = {}): Episode =>
	parseEpisode({
		episode: {...exampleJson(), ...over},
		channel: 'zoora-ai',
		slug: '_example',
		captions: 'captions' in extra ? extra.captions : exampleCaptions(),
		timeline: extra.timeline,
		channelInfo: CHANNEL_INFO,
	});
