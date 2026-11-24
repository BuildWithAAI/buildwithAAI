"""Desk foley: mouse clicks, a mug set down, chair creaks.

- mouse click: the micro-switch snap (short metallic modes, 2.9-5.6 kHz, 2.5-4 ms) inside a
  plastic shell (0.85-1.9 kHz, 9-12 ms) on a desk; the release a few frames later, lighter and
  higher. Doubles are two press/release pairs 4 frames apart.
- mug: a mug of coffee set on a wooden desk. The desk answers with a damped wooden knock
  (140-780 Hz), the ceramic shell with a short "tink" damped by the liquid (1.1-5.2 kHz,
  20-60 ms), the base's rim makes a second contact a few ms after the first, and the coffee
  moves a little (a faint low slosh). One variation slides the mug in first (the landing is then
  on frame 3).
- chair creak: stick-slip friction: a train of tiny slips whose rate glides (it sets the creak's
  pitch) and whose spacing and strength wander, each slip ringing the chair's plastic and metal
  (0.4-3 kHz); short leans, a long lean back, a two-part shift, a swivel squeak.
"""

from __future__ import annotations

import math

import numpy as np

from audiolib.core import rng

from .. import prims, space
from ..core import FPS, SYNTH_SOURCE, Sound

FAMILY = "Desk foley: mouse clicks, mug set down, chair creaks"

SWITCH = [(2900, 0.0040, 1.0), (4300, 0.0030, 0.55), (5600, 0.0025, 0.30)]
SHELL = [(1350, 0.012, 0.55), (1900, 0.009, 0.35), (850, 0.010, 0.30), (260, 0.010, 0.15)]


def _click(seed: str, vel: float, scale: float = 1.0) -> np.ndarray:
    sw = prims.jitter_modes(SWITCH, seed + "-sw", freq_pct=3, t60_pct=10, amp_db=1.5)
    sh = prims.jitter_modes(SHELL, seed + "-sh", freq_pct=4, t60_pct=10, amp_db=1.5)
    a = prims.strike([(f * scale, t, x) for f, t, x in sw], 0.05, 0.00009)
    b = prims.strike([(f * scale, t, x) for f, t, x in sh], 0.05, 0.00022)
    a /= max(np.max(np.abs(a)), 1e-12)
    b /= max(np.max(np.abs(b)), 1e-12)
    return (0.55 * a + 0.75 * b) * vel


def mouse(sid: str, group: str, seed: str, presses: list, dwell_frames: int, vel: float, desc: str) -> Sound:
    """presses: frames of each press; each is released dwell_frames later (release events listed)."""
    length = (max(presses) + dwell_frames) / FPS + 0.08
    n = prims.n_samples(length)
    mono = np.zeros(n)
    events = []
    for i, f in enumerate(presses):
        pv = vel * (1.0 if i == 0 else 0.93)
        c = _click(f"{seed}-p{i}", pv)
        k = prims.n_samples(f / FPS)
        mono[k : k + c.size] += c[: n - k]
        r = _click(f"{seed}-r{i}", pv * 0.42, scale=1.14)
        kr = prims.n_samples((f + dwell_frames) / FPS)
        mono[kr : kr + r.size] += r[: n - kr]
        events += [{"t": f / FPS, "kind": "press"}, {"t": (f + dwell_frames) / FPS, "kind": "release"}]
    st = space.add_room(prims.dual(mono), "desk", -20.0)
    return Sound(id=sid, group=group, category="desk", role="foley", audio=st, description=desc,
                 tags=["mouse", "click", "ui", "desk", "computer"] + (["double"] if len(presses) > 1 else []),
                 events=events, sources=[SYNTH_SOURCE], hp_hz=150.0, lp_hz=11000.0)


DESK_WOOD = [(140, 0.060, 0.6), (232, 0.050, 0.5), (420, 0.040, 0.4), (780, 0.028, 0.28), (1250, 0.018, 0.15)]
CERAMIC = [(1150, 0.055, 0.45), (2700, 0.040, 0.30), (3900, 0.028, 0.16), (5200, 0.018, 0.08)]


def mug(sid: str, seed: str, force: float, rim_ms: float, slide_frames: int, slosh: float, tink: float, desc: str) -> Sound:
    pre = slide_frames / FPS
    n = prims.n_samples(pre + 0.45)
    out = np.zeros(n)
    g = rng("mug", seed)
    if slide_frames:
        # ceramic base sliding on wood: grainy friction rising into the landing
        sl_n = prims.n_samples(pre)
        t = prims.t_axis(sl_n)
        env = np.sin(np.pi * np.clip(t / pre, 0, 1) * 0.9) ** 1.5 * prims.smoothstep(t / 0.02)
        times = prims.slip_times(pre, 220.0, seed + "-slide", jitter=0.7)
        grain = prims.pulse_train(sl_n, times, g.uniform(0.3, 1.0, times.size), 0.00015)
        grain = prims.convolve(grain, prims.modal([(1700, 0.006, 1.0), (3100, 0.004, 0.5), (900, 0.008, 0.6)], 0.02))
        hiss = prims.bandpass(prims.noise(sl_n, seed + "-hiss", "pink"), 700, 3500)
        sl = (grain / max(np.max(np.abs(grain)), 1e-12) + 0.35 * hiss / max(np.max(np.abs(hiss)), 1e-12)) * env * 0.16
        out[:sl_n] += sl
    k0 = prims.n_samples(pre)
    wood = prims.strike(prims.jitter_modes(DESK_WOOD, seed + "-wood", 4, 10, 1.5), 0.35, 0.0006 - 0.0002 * force)
    cer = prims.strike(prims.jitter_modes(CERAMIC, seed + "-cer", 3, 12, 1.5), 0.35, 0.00015)
    wood /= max(np.max(np.abs(wood)), 1e-12)
    cer /= max(np.max(np.abs(cer)), 1e-12)
    hit = (wood + tink * cer) * force
    out[k0 : k0 + hit.size] += hit[: n - k0]
    if rim_ms > 0:  # the other side of the base lands
        k1 = k0 + prims.n_samples(rim_ms / 1000)
        out[k1 : k1 + hit.size] += 0.45 * hit[: n - k1]
    if slosh > 0:  # the coffee moves
        s_n = prims.n_samples(0.18)
        s = prims.svf(prims.noise(s_n, seed + "-slosh", "pink"), np.linspace(520, 260, s_n), q=1.8, mode="bandpass")
        s *= prims.ar_env(s_n, 0.025, 0.14)
        s /= max(np.max(np.abs(s)), 1e-12)
        k2 = k0 + prims.n_samples(0.012)
        out[k2 : k2 + s_n] += slosh * force * s[: n - k2]
    st = space.add_room(prims.dual(out), "desk", -16.0)
    return Sound(id=sid, group="mug", category="desk", role="foley", audio=st, description=desc,
                 tags=["mug", "coffee", "desk", "foley", "ceramic", "set down"] + (["slide"] if slide_frames else []),
                 sync="hit" if slide_frames else "transient", sync_s=pre if slide_frames else None,
                 events=[{"t": pre, "kind": "landing"}], sources=[SYNTH_SOURCE], hp_hz=60.0, lp_hz=12000.0)


CHAIR = [(420, 0.030, 1.0), (760, 0.025, 0.8), (1350, 0.018, 0.5), (2100, 0.012, 0.3), (3100, 0.008, 0.12)]


def creak(sid: str, seed: str, segments: list, modes_scale: float, desc: str, squeak: bool = False) -> Sound:
    """segments: [(start_s, dur_s, rate_from_hz, rate_to_hz, level)]: each a stick-slip run."""
    end = max(s + d for s, d, *_ in segments) + 0.12
    n = prims.n_samples(end)
    exc = np.zeros(n)
    g = rng("creak", seed)
    for j, (s0, d, r0, r1, lvl) in enumerate(segments):
        def rate(tt, s0=s0, d=d, r0=r0, r1=r1):
            u = min(max((tt - s0) / d, 0.0), 1.0)
            return r0 + (r1 - r0) * (0.5 - 0.5 * math.cos(math.pi * u)) * (1 + 0.08 * math.sin(2 * math.pi * 3.1 * tt))
        times = prims.slip_times(s0 + d, rate, f"{seed}-{j}", jitter=0.18 if squeak else 0.3, start_s=s0)
        u = np.clip((times - s0) / d, 0, 1)
        shape = np.sin(np.pi * u) ** 0.9  # the creak swells and fades
        amps = lvl * shape * g.uniform(0.55, 1.0, times.size)
        exc += prims.pulse_train(n, times, amps, 0.00008 if squeak else 0.00012)
        # each slip also releases a little broadband rasp (the surfaces tearing apart)
        rasp = prims.pulse_train(n, times + 0.0003, amps, 0.00005)
        rasp = prims.convolve(rasp, prims.bandpass(prims.noise_burst(0.003, 0.0008, f"{seed}-rasp{j}"), 1000, 6000))
        exc += 0.5 * rasp
    modes = prims.jitter_modes([(f * modes_scale, t, a) for f, t, a in CHAIR], seed + "-chair", 4, 10, 1.5)
    if squeak:
        modes = [(f * 1.6, t * 1.6, a) for f, t, a in modes]
    body = prims.convolve(exc, prims.modal(modes, 0.08))
    body = prims.highpass(body, 180.0)
    st = space.add_room(prims.dual(body), "set", -16.0)
    return Sound(id=sid, group="chair_creak", category="desk", role="foley", audio=st, description=desc,
                 tags=["chair", "creak", "foley", "office chair", "desk"] + (["squeak", "swivel"] if squeak else ["lean"]),
                 sync="start", sync_s=0.0, sources=[SYNTH_SOURCE], hp_hz=120.0, lp_hz=10000.0)


def render() -> list:
    out = []
    singles = [(2, 0.90, "Mouse click: press on frame 0, release on frame 2."), (3, 0.82, "Mouse click, slightly longer hold (release on frame 3)."),
               (2, 0.95, "Mouse click, firm."), (2, 0.75, "Mouse click, light."), (3, 0.88, "Mouse click, another button feel.")]
    for i, (dw, v, desc) in enumerate(singles, 1):
        out.append(mouse(f"mouse_click_{i:02d}", "mouse_click", f"mc{i}", [0], dw, v, desc))
    doubles = [([0, 4], 1, 0.9, "Double-click: presses on frames 0 and 4."), ([0, 4], 1, 0.82, "Double-click, lighter."), ([0, 5], 1, 0.92, "Double-click, a little slower (frames 0 and 5).")]
    for i, (pr, dw, v, desc) in enumerate(doubles, 1):
        out.append(mouse(f"mouse_double_{i:02d}", "mouse_double", f"md{i}", pr, dw, v, desc))
    mugs = [(0.75, 0.0, 0, 0.10, 0.55, "Mug set down gently on the desk (landing on frame 0)."),
            (1.0, 4.0, 0, 0.14, 0.75, "Mug set down firmly, the base's rim landing a few ms later."),
            (0.85, 0.0, 3, 0.12, 0.60, "Mug slid across the desk, landing on frame 3 (sync = landing)."),
            (0.70, 6.0, 0, 0.18, 0.45, "Mug of coffee put down softly, a little slosh.")]
    for i, (force, rim, slide, slosh, tink, desc) in enumerate(mugs, 1):
        out.append(mug(f"mug_{i:02d}", f"mug{i}", force, rim, slide, slosh, tink, desc))
    creaks = [
        ([(0.0, 0.34, 95, 150, 1.0)], 1.0, "Short chair creak: shifting weight.", False),
        ([(0.0, 0.80, 70, 160, 1.0)], 0.9, "Long creak: leaning back in the chair.", False),
        ([(0.0, 0.26, 110, 160, 0.9), (0.36, 0.30, 140, 90, 1.0)], 1.05, "Two-part creak: settling into the chair.", False),
        ([(0.0, 0.22, 280, 360, 0.8)], 1.0, "Swivel squeak: a short turn of the chair.", True),
    ]
    for i, (segs, sc, desc, sq) in enumerate(creaks, 1):
        out.append(creak(f"chair_creak_{i:02d}", f"ch{i}", segs, sc, desc, sq))
    return out
