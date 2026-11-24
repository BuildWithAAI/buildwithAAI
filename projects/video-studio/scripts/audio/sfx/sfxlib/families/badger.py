"""Badger's foley: paw taps and steps on a hard floor, and tail thumps. No vocal sounds of any
kind: Badger's real voice will come from recordings of the owner's dog (CLAUDE.md, owner request
2026-11-24), and nothing here imitates a dog.

- paws: each footfall is a soft pad thud (low-passed, 110-340 Hz floor modes, a slow 2 ms contact)
  and one to three claw ticks a few ms later (keratin on hardwood: very short 2.2-4.7 kHz modes,
  a hard 0.06 ms contact), the nails landing one after another. Taps (one, two, three: Badger
  being impatient), a four-step walk and a short scrabble.
- tail: VCSL frame drum, muted hand hits (CC0): the large drum raised 3 semitones and damped short
  for the low thump, the small drum lowered 4 semitones for the padded "fwap", both darkened;
  before each thump a short fur swish (band-passed noise swelling into it). One to four wags at
  a restrained 3.3-3.8 Hz (8-9 frames apart), each a little softer than the last.
All on a hard floor in the set's room. Every footfall and thump is on a 30 fps frame.
"""

from __future__ import annotations

import numpy as np

from audiolib.core import rng

from .. import prims, space, vcsl
from ..core import FPS, FRAME, SYNTH_SOURCE, Sound

FAMILY = "Badger foley: paw taps and steps, tail thumps (no vocals)"

PAD = [(110, 0.050, 0.6), (190, 0.040, 0.5), (340, 0.030, 0.3), (620, 0.018, 0.12)]
CLAW = [(3100, 0.004, 1.0), (4700, 0.003, 0.55), (2200, 0.006, 0.40)]
DRUM_L = "Membranophones/Struck Membranophones/Frame Drum/HDrumL_HitMuted_v3_rr{rr}_Sum.wav"
DRUM_S = "Membranophones/Struck Membranophones/Frame Drum/HDrumS_HitMuted_v3_rr{rr}_Sum.wav"


def footfall(seed: str, vel: float, claws: int) -> np.ndarray:
    g = rng("footfall", seed)
    n = prims.n_samples(0.12)
    pad = prims.strike(prims.jitter_modes(PAD, seed + "-pad", 5, 10, 1.5), 0.12, 0.002)
    pad = prims.lowpass(pad + 0.4 * prims.lowpass(prims.noise_burst(0.12, 0.012, seed + "-padn"), 500), 900)
    pad /= max(np.max(np.abs(pad)), 1e-12)
    out = 0.55 * pad[:n]
    t = 0.0015
    for c in range(claws):
        tick = prims.strike(prims.jitter_modes(CLAW, f"{seed}-claw{c}", 6, 15, 2.0), 0.03, 0.00006)
        tick += 0.3 * prims.bandpass(prims.noise_burst(0.03, 0.0006, f"{seed}-cn{c}"), 2000, 9000)
        tick /= max(np.max(np.abs(tick)), 1e-12)
        k = prims.n_samples(t)
        out[k : k + tick.size] += (0.9 - 0.25 * c) * tick[: n - k]
        t += float(g.uniform(0.002, 0.007))
    return out * vel


def paws(sid: str, steps: list, desc: str, tags) -> Sound:
    """steps: [(frame, velocity, claws)]."""
    length = max(f for f, _, _ in steps) / FPS + 0.16
    n = prims.n_samples(length)
    mono = np.zeros(n)
    events = []
    for i, (f, v, c) in enumerate(steps):
        x = footfall(f"{sid}-{i}", v, c)
        k = f * FRAME
        mono[k : k + x.size] += x[: n - k]
        events.append({"t": f / FPS, "kind": "paw"})
    st = space.add_room(prims.dual(mono), "set", -18.0)
    return Sound(id=sid, group="badger_paw", category="badger", role="foley", audio=st, description=desc,
                 tags=["badger", "dog", "paw", "claws", "foley", "floor", *tags], events=events, sources=[SYNTH_SOURCE], hp_hz=70.0, lp_hz=12000.0)


def thump_voice(seed: str, rr: int, vel: float) -> np.ndarray:
    low = vcsl.shift(vcsl.load(DRUM_L.format(rr=rr), trim_db=-30.0, pre_ms=0.3), 3.0).mean(axis=0)
    mid = vcsl.shift(vcsl.load(DRUM_S.format(rr=rr), trim_db=-30.0, pre_ms=0.3), -4.0).mean(axis=0)
    n = prims.n_samples(0.32)
    low = np.pad(low, (0, max(0, n - low.size)))[:n] / max(np.max(np.abs(low)), 1e-12)
    mid = np.pad(mid, (0, max(0, n - mid.size)))[:n] / max(np.max(np.abs(mid)), 1e-12)
    x = 0.8 * prims.lowpass(low, 700.0) + 0.5 * prims.lowpass(mid, 1400.0)
    x *= prims.ar_env(n, 0.0005, 0.16)
    return x * vel


def swish(seed: str, dur: float = 0.06) -> np.ndarray:
    n = prims.n_samples(dur)
    t = prims.t_axis(n)
    x = prims.bandpass(prims.noise(n, seed, "pink"), 1100, 4500)
    env = (t / dur) ** 2.2
    return x / max(np.max(np.abs(x)), 1e-12) * env


def tail(sid: str, wags: list, desc: str) -> Sound:
    """wags: [(frame, velocity, rr)]; each thump is led in by a fur swish ending on its frame."""
    lead = 0.06
    lead_frames = 2  # the first thump on frame 2 leaves room for its swish (sync = first thump)
    length = (max(f for f, _, _ in wags) + lead_frames) / FPS + 0.34
    n = prims.n_samples(length)
    mono = np.zeros(n)
    events = []
    for i, (f, v, rr) in enumerate(wags):
        at = (f + lead_frames) * FRAME
        sw = swish(f"{sid}-sw{i}", lead) * prims.db(-20.0) * v
        k0 = at - sw.size
        mono[k0 : k0 + sw.size] += sw
        th = thump_voice(f"{sid}-{i}", rr, v)
        mono[at : at + th.size] += th[: n - at]
        events.append({"t": (f + lead_frames) / FPS, "kind": "thump"})
    st = space.add_room(prims.dual(mono), "set", -16.0)
    srcs = sorted({DRUM_L.format(rr=rr) for _, _, rr in wags} | {DRUM_S.format(rr=rr) for _, _, rr in wags})
    return Sound(id=sid, group="badger_tail", category="badger", role="foley", audio=st, description=desc,
                 tags=["badger", "dog", "tail", "thump", "wag", "foley"], sync="hit", sync_s=lead_frames / FPS, events=events,
                 sources=[dict(vcsl.provenance(s), pitchShiftSemitones=(3.0 if "HDrumL" in s else -4.0)) for s in srcs] + [SYNTH_SOURCE],
                 hp_hz=50.0, lp_hz=10000.0)


def render() -> list:
    out = [
        paws("badger_paw_01", [(0, 1.0, 2)], "One paw tap: pad and two claws on a hard floor.", ["tap"]),
        paws("badger_paw_02", [(0, 1.0, 2), (6, 0.85, 2)], "Two paw taps (frames 0 and 6): a pointed, patient hint.", ["tap"]),
        paws("badger_paw_03", [(0, 0.9, 2), (5, 0.95, 3), (10, 0.8, 2)], "Three taps (frames 0, 5, 10): Badger's impatience, restrained.", ["tap"]),
        paws("badger_paw_04", [(0, 0.9, 2), (5, 0.75, 1), (9, 0.95, 2), (14, 0.7, 1)], "Four walking steps on a hard floor (frames 0, 5, 9, 14).", ["steps", "walk"]),
        paws("badger_paw_05", [(0, 0.7, 1), (2, 0.6, 2), (3, 0.75, 1), (5, 0.55, 2), (7, 0.7, 1), (8, 0.5, 1)], "A short scrabble: Badger turning on the spot.", ["scrabble", "turn"]),
        tail("badger_tail_01", [(0, 1.0, 1)], "One tail thump on the floor (the thump on frame 2, after its swish)."),
        tail("badger_tail_02", [(0, 1.0, 1), (8, 0.85, 2)], "Two tail thumps, 8 frames apart: a restrained wag."),
        tail("badger_tail_03", [(0, 1.0, 2), (8, 0.85, 1), (16, 0.7, 2)], "Three tail thumps (8 frames apart), each a little softer."),
        tail("badger_tail_04", [(0, 0.9, 1), (9, 0.8, 2), (18, 0.75, 1), (27, 0.6, 2)], "Four slow wags, 9 frames apart: quietly pleased."),
    ]
    return out
