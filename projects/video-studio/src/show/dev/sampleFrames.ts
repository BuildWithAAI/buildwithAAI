/**
 * Frames worth inspecting in a show render (dev tool, Node): for every scene its first, middle and last frame, each
 * Badger beat at its peak, the Rekt Meter after its sweep and each diagram node after it lands. Used to build the
 * contact sheets (dev/contactSheet.sh). Pure: runs the same planner the render uses, on the mock timeline unless a
 * timeline.json is given.
 *   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON src/show/dev/sampleFrames.ts <storyboard.json> <landscape|vertical> [--timeline t.json] [--short id]
 * Prints JSON: {frames, samples: [{frame, label}], scenes: [{id, segment, shot, from, frames}]}.
 */
import {readFileSync} from 'node:fs';
import type {Format, ShowStoryboard, Timeline} from '../types.ts';
import {showMockTimeline} from './mockTimeline.ts';
import {episodeSpans, shortSpans, spansFrames} from '../timing.ts';
import {planShow} from '../perf/plan.ts';
import {SWEEP_FRAMES} from '../graphics/meterGeometry.ts';

export type Sample = {frame: number; label: string};

export const sampleFrames = (sb: ShowStoryboard, format: Format, tl: Timeline, shortId?: string) => {
	const fps = 30;
	const spans = format === 'vertical' ? shortSpans(sb, tl, shortId ?? sb.shorts?.[0]?.id ?? '', fps) : episodeSpans(sb, tl, fps);
	const frames = spansFrames(spans);
	const plan = planShow({sb, tl, spans, format, fps, frames, seed: `${sb.slug}:${sb.lang}:${format}:${shortId ?? (format === 'vertical' ? sb.shorts?.[0]?.id : 'episode')}`});
	const out: Sample[] = [];
	spans.forEach((s, k) => {
		const last = s.from + s.durationInFrames - 1;
		const r = plan.scenes[k].reveals;
		out.push({frame: s.from + Math.min(8, s.durationInFrames - 1), label: `${s.id} ${s.segment} start`});
		if (s.segment === 'headline' && r.meter !== null) out.push({frame: Math.min(last, s.from + r.meter + SWEEP_FRAMES + 4), label: `${s.id} meter`});
		else if (s.segment === 'howItWorked' && r.items.length) out.push({frame: Math.min(last, s.from + r.items[r.items.length - 1] + 14), label: `${s.id} diagram`});
		else if (s.durationInFrames > 40) out.push({frame: s.from + Math.floor(s.durationInFrames / 2), label: `${s.id} ${s.segment} mid`});
		out.push({frame: last - 2, label: `${s.id} ${s.segment} end`});
	});
	for (const b of plan.beats) out.push({frame: Math.min(frames - 1, b.at + Math.min(24, b.hold - 4)), label: `${b.sceneId} badger ${b.reaction}`});
	const uniq = new Map<number, Sample>();
	for (const s of out.sort((a, b) => a.frame - b.frame)) if (!uniq.has(s.frame)) uniq.set(s.frame, s);
	return {frames, samples: [...uniq.values()], scenes: spans.map((s, k) => ({id: s.id, segment: s.segment, shot: plan.scenes[k].shot, from: s.from, frames: s.durationInFrames}))};
};

const isMain = (() => {
	try {
		return import.meta.url === `file://${process.argv[1]}`;
	} catch {
		return false;
	}
})();

if (isMain) {
	const [file, format = 'landscape', ...rest] = process.argv.slice(2);
	if (!file) {
		console.error('usage: sampleFrames.ts <storyboard.json> <landscape|vertical> [--timeline t.json] [--short id]');
		process.exit(2);
	}
	const sb = JSON.parse(readFileSync(file, 'utf8')) as ShowStoryboard;
	const ti = rest.indexOf('--timeline');
	const si = rest.indexOf('--short');
	const tl = ti >= 0 ? (JSON.parse(readFileSync(rest[ti + 1], 'utf8')) as Timeline) : showMockTimeline(sb);
	console.log(JSON.stringify(sampleFrames(sb, format as Format, tl, si >= 0 ? rest[si + 1] : undefined), null, 1));
}
