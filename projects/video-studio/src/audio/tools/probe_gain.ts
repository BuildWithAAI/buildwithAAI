/**
 * Writes the AudioProbe's gain law per sample (float32, 48 kHz, band after band) for probe_compare.py, computed by
 * the same code the probe composition plays (src/audio/dev/probe.ts).
 *   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON src/audio/tools/probe_gain.ts <out.f32> [props json]
 */
import {writeFileSync} from 'node:fs';
import {PROBE_DEFAULTS, PROBE_FPS, PROBE_FRAMES, probeGain, type ProbeProps} from '../dev/probe.ts';

const out = process.argv[2];
if (!out) throw new Error('usage: probe_gain.ts <out.f32> [props json]');
const p: ProbeProps = {...PROBE_DEFAULTS, ...(process.argv[3] ? (JSON.parse(process.argv[3]) as Partial<ProbeProps>) : {})};
const sec = PROBE_FRAMES / PROBE_FPS;
const g = probeGain(p, sec);
const n = Math.round(sec * 48000);
const bands = Array.from({length: g.bands}, () => new Float32Array(n));
g.fill(bands, 0, 48000);
const all = new Float32Array(g.bands * n);
bands.forEach((b, i) => all.set(b, i * n));
writeFileSync(out, Buffer.from(all.buffer));
process.stdout.write(`${g.bands} band(s) x ${n} samples -> ${out}\n`);
