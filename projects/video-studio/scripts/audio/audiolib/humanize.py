"""Humanization: timing and velocity variance, swing, accents, rolled chords. Deterministic (seeded).

Players are not uniformly random. The timing model here is
    offset(t) = drift(t) + jitter
where `drift` is a slow Ornstein-Uhlenbeck walk (a player pushing and pulling the beat over a bar
or two) and `jitter` is a small independent Gaussian per note, both clipped to `max_ms`. Defaults
are conservative starting points for a tight but alive feel: about 5 ms jitter for drums and
8 ms for keys, with 3-4 ms of drift. They are starting values to tune by ear, not measurements.
All functions return new Note lists; the input is never modified.
"""

from __future__ import annotations

import math
from dataclasses import replace

import numpy as np

from .core import rng


def humanize(notes, score, timing_ms: float = 6.0, drift_ms: float = 3.0, drift_beats: float = 4.0, velocity: float = 5.0, max_ms: float = 20.0, keep_first: bool = True, seed: str = "humanize"):
    """Timing (ms) and velocity (MIDI units, SD) variation.

    drift_beats: correlation length of the drift. keep_first: the very first note stays put, so
    a piece still starts exactly on its first beat."""
    if not notes:
        return []
    g = rng("humanize", seed)
    ordered = sorted(notes, key=lambda n: n.start)
    first_start = ordered[0].start
    end = max(n.start for n in ordered) + 1.0
    # OU process sampled every 1/8 beat
    step = 0.125
    m = int(math.ceil(end / step)) + 2
    theta = step / max(drift_beats, 1e-3)
    ou = np.zeros(m)
    sd_step = math.sqrt(2 * theta) * drift_ms
    for i in range(1, m):
        ou[i] = ou[i - 1] * (1 - theta) + g.normal(0, sd_step)
    out = []
    for n in ordered:
        if keep_first and n.start == first_start:
            out.append(replace(n, meta=dict(n.meta)))
            continue
        d = float(np.interp(n.start / step, np.arange(m), ou))
        off_ms = float(np.clip(d + g.normal(0, timing_ms), -max_ms, max_ms))
        db = score.ms_to_beats(off_ms, n.start)
        start = max(0.0, n.start + db)
        vel = int(np.clip(round(n.vel + g.normal(0, velocity)), 1, 127))
        out.append(replace(n, start=start, vel=vel, meta=dict(n.meta)))  # the whole note moves
    return out


def swing(notes, amount: float = 0.58, grid: float = 0.5, tolerance: float = 0.02):
    """Swing the off-beat subdivision. grid 0.5 = 8th notes, 0.25 = 16ths (beats).

    amount is where the off-beat lands inside its pair: 0.5 = straight, 0.5833 = light swing,
    0.6667 = triplet swing. Only notes within `tolerance` beats of an off-beat move; their
    durations shrink by the same delay so they still end where they did."""
    if not 0.5 <= amount < 0.8:
        raise ValueError("swing amount must be in [0.5, 0.8)")
    pair = 2 * grid
    delay = (amount - 0.5) * pair
    out = []
    for n in notes:
        pos = n.start % pair
        if abs(pos - grid) <= tolerance:
            new_start = n.start + delay
            out.append(replace(n, start=new_start, dur=max(1e-3, n.dur - delay), meta=dict(n.meta)))
        else:
            out.append(replace(n, meta=dict(n.meta)))
    return out


def accent(notes, pattern: dict, period: float = 1.0, tolerance: float = 0.02):
    """Add velocity offsets by position in a cycle: pattern {0: +10, 0.5: -8} with period 1 beat
    accents downbeats and softens off-beats. Positions are beats inside the period."""
    out = []
    for n in notes:
        pos = n.start % period
        add = 0
        for p, v in pattern.items():
            if abs(pos - p) <= tolerance or abs(pos - p - period) <= tolerance:
                add = v
                break
        out.append(replace(n, vel=int(np.clip(n.vel + add, 1, 127)), meta=dict(n.meta)))
    return out


def roll(notes, spread_ms: float, score, up: bool = True):
    """Roll simultaneous notes (a hand spreading a chord): notes starting at the same beat are
    staggered by `spread_ms` in total, lowest first (or highest first with up=False)."""
    groups = {}
    for n in notes:
        groups.setdefault(round(n.start, 6), []).append(n)
    out = []
    for start, grp in groups.items():
        grp = sorted(grp, key=lambda x: x.pitch, reverse=not up)
        k = len(grp)
        for i, n in enumerate(grp):
            off = score.ms_to_beats(spread_ms * (i / max(1, k - 1)), n.start) if k > 1 else 0.0
            out.append(replace(n, start=n.start + off, dur=max(1e-3, n.dur - off), meta=dict(n.meta)))
    return sorted(out, key=lambda n: (n.start, n.pitch))


def velocity_curve(notes, lo: int = 1, hi: int = 127, gamma: float = 1.0):
    """Remap velocities: v' = lo + (hi - lo) * (v/127)^gamma."""
    out = []
    for n in notes:
        v = lo + (hi - lo) * (n.vel / 127.0) ** gamma
        out.append(replace(n, vel=int(np.clip(round(v), 1, 127)), meta=dict(n.meta)))
    return out
