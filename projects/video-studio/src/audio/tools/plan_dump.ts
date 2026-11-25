/**
 * Writes what the measurement needs to know about the AudioDemo, computed by the same code the
 * composition runs: the plan (plan.json) and the bed's per-band gain per sample (bed_gains.f32: band
 * after band, float32 at 48 kHz from the bed's first frame), so measure_mix.py can rebuild the ideal
 * bed and null-test the render against it.
 *
 *   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON src/audio/tools/plan_dump.ts [narrationDir] [outDir]
 */
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {asManifest} from '../../../scripts/audio/sfx/sfx.ts';
import {parseManifest} from '../../../scripts/audio/music/manifest.ts';
import {demoBedPlan, demoPlan, planSfx, type DemoTimeline} from '../demo/plan.ts';

const STUDIO = fileURLToPath(new URL('../../../', import.meta.url));
const narrationDir = process.argv[2] ?? 'generated/zoora-security/_audio-demo/en';
const outDir = process.argv[3] ?? join(STUDIO, 'out', 'audio', 'integration');
const read = (rel: string) => JSON.parse(readFileSync(join(STUDIO, 'public', rel), 'utf8'));

const tl = read(`${narrationDir}/timeline.json`) as DemoTimeline;
const plan = demoPlan(tl, asManifest(read('audio/sfx/manifest.json')), parseManifest(read('audio/music/manifest.json')), 30);
const fps = plan.fps;
const SR = 48000;
const bed = demoBedPlan(plan);
const n = Math.round((plan.bed.durationInFrames / fps) * SR);
const bands = Array.from({length: bed.gain.bands}, () => new Float32Array(n));
bed.gain.fill(bands, plan.bed.from / fps, SR);
mkdirSync(outDir, {recursive: true});
const all = new Float32Array(bands.length * n);
bands.forEach((b, i) => all.set(b, i * n));
writeFileSync(join(outDir, 'bed_gains.f32'), Buffer.from(all.buffer));
const doc = {
	fps,
	sampleRate: SR,
	durationInFrames: plan.durationInFrames,
	durationSec: plan.durationInFrames / fps,
	narrationDir,
	bed: {...plan.bed, file: `audio/music/${plan.bed.id}.flac`, bands: bed.gain.bands, depthsDb: bed.depthsDb, crossovers: bed.crossovers ?? null, lifts: bed.lifts, gainSamples: n, startSample: Math.round((plan.bed.from / fps) * SR)},
	lines: plan.lines.map((l) => ({id: l.id, audio: l.audio, from: l.from, durationInFrames: l.durationInFrames, text: l.text})),
	stingers: [plan.sting, plan.bumper, plan.outro].map((s) => ({id: s.cue.id, file: s.cue.file, from: s.from, downbeat: s.downbeat, durationInFrames: s.durationInFrames, hits: s.hits, truePeakDbtp: s.cue.truePeakDbtp})),
	sfx: planSfx(plan),
	sections: plan.sections,
};
writeFileSync(join(outDir, 'plan.json'), JSON.stringify(doc, null, 1) + '\n');
console.log(`plan: ${doc.durationSec.toFixed(2)} s, ${doc.sfx.length} SFX cues, ${plan.bed.speech.length} speech spans, bed ${plan.bed.durationInFrames} frames -> ${outDir}`);
