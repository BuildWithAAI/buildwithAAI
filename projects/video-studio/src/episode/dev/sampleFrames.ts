/**
 * Dev tool (Node, no browser): which frames to inspect for an episode or Short. Prints JSON lines
 * {scene, type, frame, label} for the start, key beats (reveals, reaction, press) and end of every scene, computed
 * with the same pure modules the compositions use. With --props it also writes a props file whose timelineOverride
 * is the mock timeline (so a render needs no voice step).
 *   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON src/episode/dev/sampleFrames.ts <storyboard.json> [landscape|vertical] [--props out.json]
 */
import {readFileSync, writeFileSync} from 'node:fs';
import type {Storyboard, Timeline} from '../types.ts';
import {mockTimeline} from './mockTimeline.ts';
import {episodeSpans, shortSpans} from '../timing.ts';
import {directScene} from '../scenes/direction.ts';
import {LAYOUTS, type Format} from '../layout/specs.ts';

const [file, fmtArg, ...rest] = process.argv.slice(2);
if (!file) {
	console.error('usage: sampleFrames.ts <storyboard.json> [landscape|vertical] [--props out.json] [--timeline timeline.json]');
	process.exit(2);
}
const format: Format = fmtArg === 'vertical' ? 'vertical' : 'landscape';
const sb = JSON.parse(readFileSync(file, 'utf8')) as Storyboard;
const tlArg = rest.indexOf('--timeline');
const tl: Timeline = tlArg >= 0 ? (JSON.parse(readFileSync(rest[tlArg + 1], 'utf8')) as Timeline) : mockTimeline(sb, {fps: 30});
const spans = format === 'vertical' ? shortSpans(sb, tl, sb.shorts?.[0]?.id ?? '', 30) : episodeSpans(sb, tl, 30);
const out: Array<{scene: string; type: string; frame: number; label: string}> = [];
for (const s of spans) {
	const sc = sb.scenes[s.index];
	const t = tl.scenes[s.index];
	const L = (LAYOUTS as Record<string, Record<Format, {badger?: unknown}>>)[sc.type][format];
	const insert = format === 'vertical' || (sc.type === 'chart' && !LAYOUTS.chart[format].pair);
	const dir = directScene({
		sc,
		tl: t,
		format,
		lang: sb.lang,
		fps: 30,
		frames: s.durationInFrames,
		seed: `${sb.slug}:${sc.id}:${format}`,
		zooView: sc.type === 'chart' ? (format === 'vertical' ? 'threeQuarter' : 'front') : 'front',
		badgerPlace: sc.badger?.present ? ((L.badger ?? LAYOUTS.hook[format].badger) as never) : null,
		badgerInsert: insert,
	});
	const add = (f: number, label: string) => out.push({scene: sc.id, type: sc.type, frame: s.from + Math.max(0, Math.min(s.durationInFrames - 1, f)), label});
	add(2, 'start');
	dir.reveals.slice(-1).forEach((r) => add(r + 12, 'all items'));
	if (dir.press !== null) add(dir.press + 4, 'press');
	add(Math.round(s.durationInFrames / 2), 'mid');
	if (sc.badger?.present) add(dir.insert ? dir.insert.from + 30 : dir.reactionAt + 24, 'badger reaction');
	add(s.durationInFrames - 3, 'end');
}
for (const o of out) console.log(JSON.stringify(o));
const pi = rest.indexOf('--props');
if (pi >= 0) {
	writeFileSync(rest[pi + 1], JSON.stringify({channel: sb.channel, slug: sb.slug, lang: sb.lang, timelineOverride: tl, ...(format === 'vertical' ? {shortId: sb.shorts?.[0]?.id} : {})}));
	console.error(`wrote ${rest[pi + 1]}`);
}
