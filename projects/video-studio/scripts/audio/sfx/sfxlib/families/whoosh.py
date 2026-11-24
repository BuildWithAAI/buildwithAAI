"""Whooshes: short, medium and long pass-bys, and reverse whooshes that swell into a cut.

Model: air moving past the listener. The amplitude follows 1 / distance around the closest
approach (a quicker build than release, the usual "whoosh" shape); the band-pass centre rises as
the source gets close (closer = brighter) and drops after it passes (Doppler); a constant-power pan
crosses the image; a brown-noise body adds weight to the longer ones; a quiet resonant "edge" layer
gives the swish its shape; a slow random flutter (9-14 Hz) adds the turbulence of a moving object;
a little decorrelated noise gives width; a touch of the shared "air" room smooths the tail.
Sync: the perceived pass-by (the loudest K-weighted window, a tenth of the sound long) is measured
on the finished design and moved onto the next 30 fps frame boundary by adding at most 33 ms of
silence in front, so `syncMs` is where the whoosh is heard to pass, exactly on a frame.
"""

from __future__ import annotations

import math

import numpy as np

from audiolib import synth

from .. import measure, prims, space
from ..core import FPS, SYNTH_SOURCE, Sound

FAMILY = "Whooshes: pass-bys (short, medium, long) and reverse swells into a cut"


def _air(n: int, seed: str, fc: np.ndarray, q: float, color: str = "pink") -> np.ndarray:
    return prims.svf(prims.noise(n, seed, color), fc, q=q, mode="bandpass")


def passby_whoosh(sid: str, group: str, dur: float, tp_frames: int, w_in: float, w_out: float, f_lo: float, f_hi: float,
                  direction: int, seed: str, body: float = 0.5, edge: float = 0.25, doppler_oct: float = 0.35,
                  sheen: float = 0.08, room_db: float = -16.0, flutter: float = 0.0, tags=(), desc: str = "") -> Sound:
    n = prims.n_samples(dur)
    t = prims.t_axis(n)
    tp = tp_frames / FPS
    amp = prims.passby(n, tp, w_in, w_out, start_s=0.0, end_s=dur - 0.004)
    close = amp**1.3  # proximity drives brightness
    dop = 2 ** (-doppler_oct * np.tanh((t - tp) / max(0.5 * (w_in + w_out), 1e-3)))
    fc = (f_lo + (f_hi - f_lo) * close) * dop
    main = _air(n, seed + "-m", fc, 0.85)
    edge_l = _air(n, seed + "-e", np.minimum(fc * 1.9, 9000.0), 4.5)
    body_l = prims.svf(prims.noise(n, seed + "-b", "brown"), 90 + 380 * close, q=0.7, mode="lowpass")
    sh = prims.highpass(prims.noise(n, seed + "-s", "white"), 4000.0, order=2)
    # level each layer to unit RMS where the envelope is high, then mix
    def unit(x):
        w = amp > 0.5
        r = float(np.sqrt(np.mean(x[w] ** 2))) if w.any() else float(np.sqrt(np.mean(x**2)))
        return x / max(r, 1e-12)
    mono = unit(main) * amp + edge * unit(edge_l) * amp**1.6 + body * unit(body_l) * amp**1.2 + sheen * unit(sh) * amp**2.5
    if flutter > 0:  # turbulence: a band-limited random wobble of the level, faster near the pass
        g = synth.lfo(n, 9.0 + 5.0 * float(np.mean(close)), "smooth", flutter, seed=seed + "-flutter")
        mono = mono * (1.0 + g * (0.4 + 0.6 * close))
    # stereo: pan across the pass (direction +1 = left to right), plus decorrelated width
    pan = direction * 0.72 * np.tanh((t - tp) / max(0.6 * (w_in + w_out), 1e-3))
    st = prims.pan(mono, pan) * math.sqrt(2)  # +3 dB so the centre stays at the mono level
    side = _air(n, seed + "-w", fc, 0.85) * amp
    side = side / max(float(np.sqrt(np.mean(side**2))), 1e-12) * float(np.sqrt(np.mean(mono**2)))
    st[0] += 0.18 * side
    st[1] -= 0.18 * side
    st = space.add_room(st, "air" if room_db > -19.0 or dur > 0.5 else "desk", room_db)
    win = measure.peak_window_s(dur)
    st, sync_s = measure.align_peak_to_frame(st, win)
    return Sound(id=sid, group=group, category="whoosh", role="transition", audio=st, description=desc,
                 tags=["whoosh", "transition", "air", *tags], sync="peak", sync_s=sync_s, sources=[SYNTH_SOURCE], hp_hz=55.0, lp_hz=14000.0,
                 extra={"direction": "left-to-right" if direction > 0 else "right-to-left", "peakWindowMs": round(win * 1000)})


def reverse_whoosh(sid: str, dur_frames: int, rise_s: float, f_lo: float, f_hi: float, seed: str, direction: int,
                   body: float = 0.6, tags=(), desc: str = "") -> Sound:
    """A swell that ends on the sync frame: amplitude rises like a reversed decay (fast at the end),
    the band opens upward, the image closes in to the centre, then a 50 ms fall to silence."""
    T = dur_frames / FPS
    fall = 0.05
    n = prims.n_samples(T + fall + 0.02)
    t = prims.t_axis(n)
    pre = np.clip((T - t) / rise_s, 0.0, None)
    amp = np.where(t <= T, np.exp(-prims.T60 * pre * 0.62), 0.0)  # -37 dB at T - rise_s
    amp *= prims.smoothstep(t / max(0.25 * T, 1e-3))  # starts from exactly 0
    after = (t > T) & (t <= T + fall)
    amp[after] = 0.5 + 0.5 * np.cos(math.pi * (t[after] - T) / fall)
    amp[t > T + fall] = 0.0
    close = np.clip(amp, 0, 1) ** 0.8
    fc = f_lo * (f_hi / f_lo) ** close
    main = _air(n, seed + "-m", fc, 0.9)
    edge_l = _air(n, seed + "-e", np.minimum(fc * 2.1, 9500.0), 5.0)
    body_l = prims.svf(prims.noise(n, seed + "-b", "brown"), 80 + 300 * close, q=0.7, mode="lowpass")

    def unit(x):
        w = amp > 0.3
        return x / max(float(np.sqrt(np.mean(x[w] ** 2))), 1e-12)

    mono = (unit(main) + 0.3 * unit(edge_l) * close + body * unit(body_l)) * amp
    pan = direction * 0.6 * (1 - close)  # from one side into the centre
    st = prims.pan(mono, pan) * math.sqrt(2)
    side = _air(n, seed + "-w", fc, 0.9) * amp
    side = side / max(float(np.sqrt(np.mean(side**2))), 1e-12) * float(np.sqrt(np.mean(mono**2)))
    st[0] += 0.2 * side * (1 - 0.5 * close)
    st[1] -= 0.2 * side * (1 - 0.5 * close)
    return Sound(id=sid, group="whoosh_reverse", category="whoosh", role="transition", audio=st, description=desc,
                 tags=["whoosh", "reverse", "swell", "transition", "riser", *tags], sync="end", sync_s=T, sources=[SYNTH_SOURCE], hp_hz=55.0, lp_hz=14000.0)


def render() -> list:
    out = []
    # short: 0.4 s, pass-by on frame 3-5
    shorts = [
        (4, 0.050, 0.075, 450, 2600, +1, "Quick, airy pass, left to right. Snappy UI transitions, card flips, text slides."),
        (4, 0.045, 0.090, 380, 2300, -1, "Quick pass, right to left, a little softer at the top."),
        (5, 0.060, 0.080, 520, 2900, +1, "Quick pass with a lighter, brighter edge."),
        (3, 0.040, 0.085, 420, 2400, -1, "The fastest: a flick of air for small moves."),
    ]
    for i, (tpf, wi, wo, flo, fhi, d, desc) in enumerate(shorts, 1):
        out.append(passby_whoosh(f"whoosh_short_{i:02d}", "whoosh_short", 0.40, tpf, wi, wo, flo, fhi, d, f"ws{i}", body=0.25, edge=0.22, room_db=-20.0, tags=["short"], desc=desc))
    mediums = [
        (9, 0.085, 0.14, 320, 2000, +1, "Medium pass-by, left to right: scene changes and panel wipes."),
        (9, 0.075, 0.16, 300, 1800, -1, "Medium pass-by, right to left, slightly darker."),
        (8, 0.090, 0.13, 360, 2200, +1, "Medium pass-by with a brighter edge."),
        (10, 0.100, 0.15, 280, 1700, -1, "Medium pass-by, the weightiest of the set."),
    ]
    for i, (tpf, wi, wo, flo, fhi, d, desc) in enumerate(mediums, 1):
        out.append(passby_whoosh(f"whoosh_medium_{i:02d}", "whoosh_medium", 0.80, tpf, wi, wo, flo, fhi, d, f"wm{i}", body=0.5, edge=0.25, flutter=0.18, tags=["medium"], desc=desc))
    longs = [
        (21, 0.15, 0.24, 240, 1600, +1, "Long, smooth pass-by: chapter changes and big reveals."),
        (21, 0.14, 0.27, 220, 1500, -1, "Long pass-by, right to left, a deeper body."),
        (20, 0.16, 0.22, 260, 1750, +1, "Long pass-by, a little brighter and lighter."),
    ]
    for i, (tpf, wi, wo, flo, fhi, d, desc) in enumerate(longs, 1):
        out.append(passby_whoosh(f"whoosh_long_{i:02d}", "whoosh_long", 1.50, tpf, wi, wo, flo, fhi, d, f"wl{i}", body=0.7, edge=0.28, doppler_oct=0.45, flutter=0.25, tags=["long"], desc=desc))
    reverses = [
        (24, 0.55, 300, 3200, +1, "Reverse swell into a cut: 0.8 s, lands on frame 24."),
        (15, 0.36, 340, 3400, -1, "Short reverse swell: 0.5 s, lands on frame 15."),
        (36, 0.80, 260, 3000, +1, "Long reverse swell: 1.2 s, lands on frame 36."),
        (24, 0.50, 280, 2800, -1, "Reverse swell with more body, 0.8 s, lands on frame 24."),
    ]
    for i, (f, rise, flo, fhi, d, desc) in enumerate(reverses, 1):
        out.append(reverse_whoosh(f"whoosh_reverse_{i:02d}", f, rise, flo, fhi, f"wr{i}", d, body=0.5 if i != 4 else 0.85, desc=desc))
    return out
