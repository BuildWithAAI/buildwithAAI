/** Shared test helpers: the dev fixture, deep clones and issue filters. */
import {readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import type {Issue, ShowStoryboard, Timeline} from '../types.ts';
import {showMockTimeline} from '../dev/mockTimeline.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
export const FIXTURES = join(HERE, '..', 'dev', 'fixtures');
export const REPO = join(HERE, '..', '..', '..');

export const fixture = (slug = 'zoo-badger-demo'): ShowStoryboard => JSON.parse(readFileSync(join(FIXTURES, slug, 'storyboard.json'), 'utf8')) as ShowStoryboard;
export const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
export const codes = (issues: Issue[], level: 'error' | 'warning' = 'error'): string[] => issues.filter((i) => i.level === level).map((i) => i.code);
export const mock = (sb: ShowStoryboard): Timeline => showMockTimeline(sb, {fps: 30});

/** A "real" (non-mock) timeline for channel checks: the mock with the voice step's shape. */
export const voiced = (sb: ShowStoryboard, voice = 'im_nicola'): Timeline => ({...mock(sb), mock: undefined, voice, model: {file: 'kokoro-v1.0.int8.onnx', sha256: 'x'}});
