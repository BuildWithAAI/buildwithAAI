/**
 * Finding an episode (or a channel-copy file) and its translation on disk.
 *
 * Targets:
 *   <channel>/<slug>           content/<channel>/<slug>/storyboard.json + storyboard.<lang>.json
 *   _dev/<slug>                the dev fixtures: src/episode/dev/fixtures/<slug>, src/show/dev/fixtures/<slug>,
 *                              src/thumbnails/dev/fixtures/<slug> (first that exists)
 *   <dir>                      any folder holding storyboard.json (a scratch copy, a test fixture)
 *   <file>.md                  a channel-copy file: fenced blocks "```text id=<id>" with translations "id=<id>-<lang>"
 */
import {existsSync, readFileSync, statSync} from 'node:fs';
import {basename, dirname, join, relative, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import type {TargetLang} from './types.ts';

export class InputError extends Error {}

export const STUDIO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
export const CONTENT = join(STUDIO, 'content');

const DEV_DIRS = ['src/episode/dev/fixtures', 'src/show/dev/fixtures', 'src/thumbnails/dev/fixtures'];

export type StoryboardTarget = {
	kind: 'storyboard';
	dir: string;
	channel: string;
	slug: string;
	sourcePath: string;
	translationPath: string;
	/** true when the episode lives under content/ (the back-translation record is kept next to its dub sheet). */
	inContent: boolean;
};

export type CopyTarget = {kind: 'copy'; file: string; channel: string; slug: string};

export type Target = StoryboardTarget | CopyTarget;

const readJson = (path: string): unknown => {
	let text: string;
	try {
		text = readFileSync(path, 'utf8');
	} catch (e) {
		throw new InputError(`cannot read ${path}: ${(e as Error).message}`);
	}
	try {
		return JSON.parse(text);
	} catch (e) {
		throw new InputError(`${path} is not valid JSON: ${(e as Error).message}`);
	}
};

export const loadJson = readJson;

const isDir = (p: string): boolean => existsSync(p) && statSync(p).isDirectory();

export const resolveTarget = (spec: string, lang: TargetLang, cwd = process.cwd()): Target => {
	if (!spec) throw new InputError('give an episode (<channel>/<slug>, _dev/<slug> or a folder) or a channel-copy .md file');
	if (spec.endsWith('.md')) {
		const file = resolve(cwd, spec);
		if (!existsSync(file)) throw new InputError(`no file ${spec}`);
		const rel = relative(CONTENT, file);
		const channel = !rel.startsWith('..') && rel.includes(sep) ? rel.split(sep)[0] : basename(dirname(file));
		return {kind: 'copy', file, channel, slug: basename(file, '.md')};
	}
	let dir: string | null = null;
	const direct = resolve(cwd, spec);
	if (isDir(direct) && existsSync(join(direct, 'storyboard.json'))) dir = direct;
	else {
		const parts = spec.replace(/^content\//, '').split('/').filter(Boolean);
		if (parts.length === 2) {
			const [channel, slug] = parts;
			if (channel === '_dev') {
				for (const d of DEV_DIRS) {
					const p = join(STUDIO, d, slug);
					if (existsSync(join(p, 'storyboard.json'))) {
						dir = p;
						break;
					}
				}
			} else if (existsSync(join(CONTENT, channel, slug, 'storyboard.json'))) dir = join(CONTENT, channel, slug);
		}
	}
	if (!dir) throw new InputError(`no storyboard.json for "${spec}" (looked in ${direct}, content/<channel>/<slug> and the _dev fixture folders)`);
	const sourcePath = join(dir, 'storyboard.json');
	const src = readJson(sourcePath) as {channel?: unknown; slug?: unknown};
	const relContent = relative(CONTENT, dir);
	const inContent = !relContent.startsWith('..') && relContent.split(sep).length === 2;
	const channel = typeof src.channel === 'string' && src.channel ? src.channel : inContent ? relContent.split(sep)[0] : '_unknown';
	const slug = typeof src.slug === 'string' && src.slug ? src.slug : basename(dir);
	return {kind: 'storyboard', dir, channel, slug, sourcePath, translationPath: join(dir, `storyboard.${lang}.json`), inContent};
};

export const defaultWorkDir = (t: Target, lang: TargetLang): string => join(STUDIO, 'out', 'backtranslate', t.channel, t.slug, lang);

/** Where the imported back-translation is kept: next to the dub sheet for content episodes, else in the work dir. */
export const defaultRecordPath = (t: Target, lang: TargetLang, workDir: string): string =>
	t.kind === 'storyboard' && t.inContent ? join(t.dir, 'dub', `backtranslation.${lang}.json`) : join(workDir, 'backtranslation.json');

export const loadStoryboards = (t: StoryboardTarget, lang: TargetLang): {source: Record<string, unknown>; translation: Record<string, unknown>} => {
	const source = readJson(t.sourcePath) as Record<string, unknown>;
	if (!existsSync(t.translationPath)) {
		const have = ['es', 'pt-br', 'hi', 'it', 'zh', 'ja'].filter((l) => existsSync(join(t.dir, `storyboard.${l}.json`)));
		throw new InputError(`no ${relative(STUDIO, t.translationPath)}${have.length ? ` (this episode has: ${have.join(', ')})` : ''}. Translate it first (scripts/dub).`);
	}
	const translation = readJson(t.translationPath) as Record<string, unknown>;
	if (!source || typeof source !== 'object' || !Array.isArray(source.scenes)) throw new InputError(`${t.sourcePath}: not a storyboard (no scenes[])`);
	if (!translation || typeof translation !== 'object' || !Array.isArray(translation.scenes)) throw new InputError(`${t.translationPath}: not a storyboard (no scenes[])`);
	if (source.lang !== undefined && source.lang !== 'en') throw new InputError(`${t.sourcePath}: lang is "${String(source.lang)}"; the source must be English`);
	if (translation.lang !== lang) throw new InputError(`${t.translationPath}: lang is "${String(translation.lang)}", expected "${lang}"`);
	return {source, translation};
};

/** Fenced blocks of a channel-copy Markdown file: "```text id=description" ... "```". */
export const copyBlocks = (markdown: string): Map<string, string> => {
	const out = new Map<string, string>();
	const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
	for (let i = 0; i < lines.length; i++) {
		const m = /^```[\w-]*\s+id=([\w.-]+)\s*$/.exec(lines[i]);
		if (!m) continue;
		const body: string[] = [];
		let j = i + 1;
		while (j < lines.length && !/^```\s*$/.test(lines[j])) body.push(lines[j++]);
		out.set(m[1], body.join('\n').trim());
		i = j;
	}
	return out;
};
