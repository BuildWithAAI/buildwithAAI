/**
 * The audio-plan CLI: computes an Episode's or a Short's sound plan from the files on disk (the same code and inputs
 * calculateMetadata uses in the render) and writes it for the render and the gate.
 *
 *   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON src/episode/dev/audioPlan.ts <channel>/<slug> --lang <lang> \
 *     [--short <shortId>] [--out <plan.json>] [--cues <cues.md>] [--variant '<json>'] [--check <plan.json>]
 *
 * Prints the plan's hash on the last line (render.sh passes it to the render as audioPlanHash; the render refuses a
 * plan that hashes differently). The JSON adds `gainProbe`: each bed's per-band gain at a few hundred times, computed
 * by the same TypeScript the render runs, so the gate can prove its own port of the gain law before it rebuilds the
 * music for the null test (critic F1). `--variant` makes a listening variant (src/episode/audio/plan.ts PlanVariant);
 * its hash never matches a delivery render. `--check` recomputes and compares with a written plan: exit 1 on a
 * difference. Exit 2: bad input.
 */
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import type {Lang} from '../types.ts';
import {planInputFromDisk} from '../node/audioInputs.ts';
import {bedDuckSpec, planEpisodeAudio, type EpisodeAudioPlan, type PlanVariant} from '../audio/plan.ts';
import {cueSheet, timecode} from '../audio/cueSheet.ts';
import {planBed} from '../../audio/core/bed.ts';

type Args = {target: string; lang: Lang; short: string | null; out: string | null; cues: string | null; variant: PlanVariant | null; check: string | null};

const usage = 'usage: audioPlan.ts <channel>/<slug> --lang <lang> [--short <id>] [--out plan.json] [--cues cues.md] [--variant json] [--check plan.json]';

const parse = (argv: string[]): Args => {
	const a: Args = {target: '', lang: 'en', short: null, out: null, cues: null, variant: null, check: null};
	for (let i = 0; i < argv.length; i++) {
		const k = argv[i];
		const v = () => {
			const x = argv[++i];
			if (x === undefined) throw new Error(`${k} needs a value`);
			return x;
		};
		if (k === '--lang') a.lang = v() as Lang;
		else if (k === '--short') a.short = v();
		else if (k === '--out') a.out = v();
		else if (k === '--cues') a.cues = v();
		else if (k === '--variant') a.variant = JSON.parse(v()) as PlanVariant;
		else if (k === '--check') a.check = v();
		else if (k.startsWith('--')) throw new Error(`unknown option ${k}`);
		else a.target = k;
	}
	if (!/^[^/]+\/[^/]+$/.test(a.target)) throw new Error(usage);
	return a;
};

/** Each bed's per-band gain at probe times (absolute seconds), as <MusicBed> computes it. */
export const gainProbe = (plan: EpisodeAudioPlan): Array<{bed: string; t: number[]; gains: number[][]}> =>
	plan.beds.map((b) => {
		const start = b.from / plan.fps;
		const end = (b.from + b.durationInFrames) / plan.fps;
		const bp = planBed({
			start,
			end,
			duck: bedDuckSpec(plan),
			rests: b.rests,
			fadeInMs: (b.fadeInFrames * 1000) / plan.fps,
			fadeOutMs: (b.fadeOutFrames * 1000) / plan.fps,
			fadeCurve: b.fadeInCurve,
			fadeOutCurve: b.fadeOutCurve,
		});
		const ts = new Set<number>();
		for (let i = 0; i < 240; i++) ts.add(start + ((end - start) * (i + 0.5)) / 240);
		const edges = [start, end, start + (b.fadeInFrames * 0.5) / plan.fps, end - (b.fadeOutFrames * 0.5) / plan.fps, ...b.rests.flatMap((r) => [r.start - r.fadeOutMs / 2000, r.start + 0.01, r.end + r.fadeInMs / 2000])];
		for (const s of plan.speech) if (s.end > start && s.start < end) edges.push(s.start - 0.06, s.start, s.end + 0.3, s.end + 0.9);
		for (const e of edges) if (e >= start && e < end) ts.add(e);
		const t = [...ts].sort((x, y) => x - y).map((x) => Math.round(x * 48000) / 48000);
		return {bed: b.key, t, gains: t.map((x) => Array.from({length: bp.gain.bands}, (_, k) => bp.gain.gain(x, k) * 10 ** (b.levelDb / 20)))};
	});

const main = (): number => {
	let a: Args;
	try {
		a = parse(process.argv.slice(2));
	} catch (err) {
		console.error(err instanceof Error ? err.message : String(err));
		return 2;
	}
	const [channel, slug] = a.target.split('/');
	let plan: EpisodeAudioPlan;
	try {
		const input = planInputFromDisk({channel, slug, lang: a.lang, format: a.short ? 'vertical' : 'landscape', shortId: a.short});
		plan = planEpisodeAudio({...input, variant: a.variant});
	} catch (err) {
		console.error(`audio plan: ${err instanceof Error ? err.message : String(err)}`);
		return 2;
	}
	if (a.check) {
		const was = JSON.parse(readFileSync(a.check, 'utf8')) as {hash?: string};
		const same = was.hash === plan.hash;
		console.log(same ? `audio plan ${plan.hash}: unchanged` : `audio plan CHANGED: ${a.check} has ${String(was.hash)}, the files on disk give ${plan.hash}`);
		return same ? 0 : 1;
	}
	if (a.out) {
		mkdirSync(dirname(resolve(a.out)), {recursive: true});
		writeFileSync(a.out, JSON.stringify({...plan, gainProbe: gainProbe(plan)}, null, 1) + '\n');
	}
	if (a.cues) {
		mkdirSync(dirname(resolve(a.cues)), {recursive: true});
		writeFileSync(a.cues, cueSheet(plan));
	}
	const what = a.short ? `Short ${a.short}` : 'Episode';
	console.log(
		`audio plan ${channel}/${slug} ${a.lang} ${what}: ${timecode(plan.durationInFrames)}, ${plan.beds.length} bed segment(s), ${plan.changes.length} change(s), ${plan.sfx.length} effect(s) (${plan.droppedSfx.length} left out), clock phrase ${plan.clock.offsetPhrase} (${plan.clock.source})${plan.silent ? ', SILENT (mock timeline)' : ''}`,
	);
	for (const w of plan.warnings) console.log(`  warning: ${w}`);
	console.log(plan.hash);
	return 0;
};

process.exitCode = main();
