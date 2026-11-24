"""The Rekt Meter: the needle sweep and the alarm rise (never shrill).

Needle: follows the Show's own motion (src/show/graphics/meterGeometry.ts SWEEP_FRAMES = 24 and
RektMeter.tsx: EASE.inOut = bezier(0.45, 0, 0.25, 1), one sweep, no overshoot; read 2026-11-24).
A detent ticks each time the needle crosses another 1/40 of the dial, a louder, lower one at each of
the six decade marks ($100K ... $10B), so the ticks are sparse at the start, run together into a
ratchet whirr at mid-sweep and spread out again as the needle settles; a servo hum follows the
needle's speed; a soft clunk lands on frame 24 when it stops. Four readings: a quarter, half,
three quarters and the whole dial (the travel sets how many detents pass). Start the file on the
meter's `start` frame.

Alarm rise: a rounded tone (band-limited triangle and square, detuned 6 cents, with a sub octave)
rising toward D, a tremolo that speeds up from 3 to 8 Hz, and a low-pass that opens only to
2.4 kHz, so it builds tension without hurting on a phone speaker; an octave-up layer (mostly
triangle, a little saw, low-passed at 3 kHz) as loud as the body and a lighter sub octave put its energy
where a phone speaker plays it (critic round 1: centred at 260-340 Hz, it lost 7.1 dB on a phone;
the gate now is a loss within 4 dB). It reaches its top exactly on its sync frame
(syncKind 'end'), holds two frames and releases in 40 ms.
"""

from __future__ import annotations

import math

import numpy as np

from audiolib import synth
from audiolib.core import midi_to_hz, note_number, rng

from .. import prims, space
from ..core import FPS, FRAME, SYNTH_SOURCE, Sound

FAMILY = "Rekt Meter: needle sweeps synced to the Show's 24-frame ease, and alarm rises"

SWEEP_FRAMES = 24
EASE = prims.bezier_ease(0.45, 0.0, 0.25, 1.0)
DETENTS = 40
MAJOR_EVERY = 8  # 40 detents / 5 decades
TOOTH = [(2600, 0.005, 1.0), (3800, 0.004, 0.45), (1500, 0.008, 0.40), (650, 0.015, 0.45), (980, 0.012, 0.30)]
MAJOR = [(1900, 0.008, 1.0), (2900, 0.006, 0.45), (1100, 0.012, 0.50), (480, 0.020, 0.55), (760, 0.016, 0.35)]
CLUNK = [(180, 0.060, 0.8), (320, 0.045, 0.6), (700, 0.030, 0.4), (1500, 0.020, 0.18)]
ALARM_OCTAVE_DB = 0.0


def needle_track(target: float, n: int):
    """Dial position (0..target) per sample for the 24-frame eased sweep, and its speed (per s)."""
    t = prims.t_axis(n)
    u = np.clip(t / (SWEEP_FRAMES / FPS), 0, 1)
    pos = target * EASE(u)
    speed = np.gradient(pos) * prims.n_samples(1.0)
    return pos, speed


def needle(sid: str, target: float, seed: str, desc: str) -> Sound:
    dur = SWEEP_FRAMES / FPS + 0.35
    n = prims.n_samples(dur)
    pos, speed = needle_track(target, n)
    vmax = float(speed.max())
    vn = speed / vmax if vmax > 0 else speed
    out = np.zeros(n)
    g = rng("needle", seed)
    # detent crossings
    idx = np.floor(pos * DETENTS + 1e-9).astype(int)
    cross = np.nonzero(np.diff(idx) > 0)[0] + 1
    detents_ms = []
    for k, i in enumerate(cross):
        major = idx[i] % MAJOR_EVERY == 0
        modes = prims.jitter_modes(MAJOR if major else TOOTH, f"{seed}-{k}", 2.5, 8, 1.0)
        tick = prims.strike(modes, 0.05, 0.00012 if not major else 0.0002)
        tick /= max(np.max(np.abs(tick)), 1e-12)
        amp = (0.55 + 0.45 * float(vn[i])) * (1.6 if major else 1.0) * g.uniform(0.85, 1.0)
        out[i : i + tick.size] += amp * tick[: n - i]
        detents_ms.append(round(i / prims.n_samples(1.0) * 1000, 1))
    # servo hum following the speed
    f = 80 + 160 * vn
    hum = 0.8 * prims.chirp(f) + 0.25 * synth.osc("saw", f * 2, n, oversample=2)
    hum = prims.lowpass(hum, 500.0, order=2) * np.clip(vn, 0, 1) ** 1.2 * 0.12
    out += hum
    # the mechanism engaging as the needle leaves its rest (frame 0)
    eng = prims.strike(prims.jitter_modes(TOOTH, seed + "-engage", 2.5, 8, 1.0), 0.05, 0.00015)
    out[: eng.size] += 0.5 * eng / max(np.max(np.abs(eng)), 1e-12)
    # the stop: a soft clunk and a tiny spring
    k = SWEEP_FRAMES * FRAME
    cl = prims.strike(prims.jitter_modes(CLUNK, seed + "-clunk", 3, 8, 1.0), 0.3, 0.0005)
    cl /= max(np.max(np.abs(cl)), 1e-12)
    spring = prims.modal([(2400, 0.08, 1.0)], 0.12) * prims.db(-24.0)
    out[k : k + cl.size] += 0.9 * cl[: n - k]
    out[k : k + spring.size] += spring[: n - k]
    st = space.add_room(prims.dual(out), "set", -18.0)
    return Sound(id=sid, group="rekt_needle", category="rekt", role="meter", audio=st, description=desc,
                 tags=["rekt meter", "needle", "gauge", "dial", "ratchet", "sweep"], sync="start", sync_s=0.0,
                 events=[{"t": 0.0, "kind": "sweepStart"}, {"t": SWEEP_FRAMES / FPS, "kind": "needleStop"}],
                 sources=[SYNTH_SOURCE], hp_hz=60.0, lp_hz=11000.0,
                 extra={"reading": target, "sweepFrames": SWEEP_FRAMES, "easing": "bezier(0.45, 0, 0.25, 1)", "detents": len(cross), "detentsMs": detents_ms,
                        "follows": "src/show/graphics/meterGeometry.ts SWEEP_FRAMES, src/show/graphics/RektMeter.tsx EASE.inOut (read 2026-11-24)"})


def alarm(sid: str, frames: int, note_from: str, note_to: str, seed: str, desc: str, steps=None) -> Sound:
    T = frames / FPS
    hold = 2 / FPS
    rel = 0.04
    n = prims.n_samples(T + hold + rel + 0.02)
    t = prims.t_axis(n)
    u = np.clip(t / T, 0, 1)
    m0, m1 = note_number(note_from), note_number(note_to)
    if steps:  # a stepped ladder: each step a short glide into the next pitch
        pts = np.array(steps, dtype=float)
        k = np.minimum((u * len(pts)).astype(int), len(pts) - 1)
        frac = u * len(pts) - k
        prev = np.where(k > 0, pts[np.maximum(k - 1, 0)], pts[0])
        midi = prev + (pts[k] - prev) * prims.smoothstep(frac / 0.25)
    else:
        midi = m0 + (m1 - m0) * u**1.6
    f = midi_to_hz(midi)
    tri = synth.osc("triangle", f, n, oversample=2)
    sq = synth.osc("square", f * 2 ** (6 / 1200), n, oversample=2)
    sub = prims.chirp(f / 2)
    x = tri + 0.5 * sq + 0.1 * sub  # a lighter sub octave (it was 0.2): a phone speaker plays none of it
    cutoff = 800 * (2400 / 800) ** u
    x = prims.svf(x, cutoff, q=0.9, mode="lowpass")
    x = prims.highpass(x, 160.0, order=2)  # less of the low fundamental, which a phone speaker drops anyway
    # the octave-up layer: phone presence. Mostly triangle (round, like the body) with a saw for the
    # 1-3 kHz edge, through a 3 kHz low-pass; rms-matched to the body, ALARM_OCTAVE_DB under it
    f2 = f * 2 * 2 ** (-4 / 1200)
    octv = 0.75 * synth.osc("triangle", f2, n, oversample=2) + 0.25 * synth.osc("saw", f2, n, oversample=2)
    octv = prims.lowpass(octv, 3000.0, order=2)
    x = x + octv * prims.db(ALARM_OCTAVE_DB) * float(np.sqrt(np.mean(x ** 2)) / max(np.sqrt(np.mean(octv ** 2)), 1e-12))
    # tremolo speeding up: the urgency
    rate = 3 + 5 * u**1.3
    phase = np.cumsum(rate) / prims.n_samples(1.0)
    trem = 1 - 0.35 * (0.5 + 0.5 * np.sin(2 * math.pi * phase - math.pi / 2)) * (0.4 + 0.6 * u)
    level = 10 ** ((-18 + 18 * u**0.8) / 20)  # swells 18 dB into the top
    env = level * trem * prims.smoothstep(t / 0.03)
    end = T + hold
    after = t > end
    env[after] *= 0.5 + 0.5 * np.cos(math.pi * np.clip((t[after] - end) / rel, 0, 1))
    env[t > end + rel] = 0.0
    st = space.add_room(prims.dual(x * env), "set", -18.0)
    return Sound(id=sid, group="rekt_alarm", category="rekt", role="meter", audio=st, description=desc,
                 tags=["rekt meter", "alarm", "rise", "warning", "tension", "riser"], sync="end", sync_s=T,
                 events=[{"t": 0.0, "kind": "riseStart", "marker": True}, {"t": T, "kind": "top", "marker": True}], pitch=note_to,
                 sources=[SYNTH_SOURCE], hp_hz=70.0, lp_hz=9000.0, extra={"riseFrames": frames})


def render() -> list:
    out = []
    readings = [(0.25, "Rekt Meter needle to a quarter of the dial (a small loss): sparse detents."),
                (0.50, "Needle to half the dial."),
                (0.75, "Needle to three quarters: the detents run together mid-sweep."),
                (1.00, "Needle across the whole dial ($10B): a full ratchet whirr, then the stop.")]
    for i, (r, desc) in enumerate(readings, 1):
        out.append(needle(f"rekt_needle_{i:02d}", r, f"needle{i}", desc + " 24-frame sweep, stop clunk on frame 24."))
    alarms = [
        (24, "D3", "A3", None, "Alarm rise over 24 frames (the needle's sweep), D3 up to A3."),
        (36, "D3", "D4", None, "Alarm rise over 36 frames (1.2 s), up an octave to D4."),
        (48, "A2", "D4", None, "Long alarm rise over 48 frames (1.6 s)."),
        (48, "D3", "D4", [50, 55, 57, 62], "Stepped warning ladder over 48 frames: D3, G3, A3, D4."),
    ]
    for i, (fr, a, b, steps, desc) in enumerate(alarms, 1):
        out.append(alarm(f"rekt_alarm_{i:02d}", fr, a, b, f"alarm{i}", desc + " Lands on its last frame (syncKind 'end').", steps))
    return out
