"""UI sounds: pops and plops for bullets, soft ticks, card and page swipes.

Pitch: the tonal UI sounds use only D, G and A, the pitch classes shared by every bed in the
music direction (D dorian, D minor, D phrygian, F lydian and D major all contain them), so a pop
never clashes with whatever music is under it. The pop set D5-G5-A5-D6 rises in order for a
bullet list (01, 02, 03, 04); 05 and 06 are alternates for repeats.

- pop: a sine that snaps up into its pitch in 6 ms (the "p"), an octave partial, a soft
  low thump and a breath of band-passed noise; 0.15 s.
- plop: a water-drop "bloop": a rounder sine chirp rising into its pitch over 25 ms; 0.2 s.
- tick: a VCSL woodblock (CC0) raised 5 semitones (its main mode lands near A6), shortened to a
  25-40 ms "tok", softened above 6 kHz.
- swipe: friction noise following a flicked card's speed (full speed 38 % in, then a longer glide
  out): the level, the band (Q 1) and a sparse paper grain rise and fall with it; a soft edge
  flick at the end and a short pan across.
"""

from __future__ import annotations

import math

import numpy as np

from audiolib.core import midi_to_hz, note_number, rng

from .. import prims, space, vcsl
from ..core import SYNTH_SOURCE, Sound

FAMILY = "UI: pops, plops, soft ticks, card and page swipes"


def pop(sid: str, note: str, seed: str, cents: float = 0.0, t60: float = 0.085, snap: float = 0.82, octave: float = 0.13,
        puff_db: float = -20.0, thump: float = 0.22, desc: str = "", group: str = "pop", tags=()) -> Sound:
    f0 = float(midi_to_hz(note_number(note))) * 2 ** (cents / 1200)
    dur = 0.16
    n = prims.n_samples(dur)
    t = prims.t_axis(n)
    glide = snap + (1 - snap) * (1 - np.exp(-t / 0.0022))  # snaps up into pitch in ~6 ms
    droop = 1 - 0.008 * np.clip(t / dur, 0, 1)
    f = f0 * glide * droop
    body = prims.chirp(f) * prims.ar_env(n, 0.0006, t60)
    over = prims.chirp(2.0 * f) * prims.ar_env(n, 0.0004, t60 * 0.45) * octave
    low = prims.chirp(0.5 * f) * prims.ar_env(n, 0.0008, 0.03) * thump
    puff = prims.bandpass(prims.noise_burst(0.006, 0.004, seed + "-puff"), 600, 2600)
    mono = body + over + low
    prims_puff = np.zeros(n)
    prims_puff[: puff.size] = puff / max(np.max(np.abs(puff)), 1e-12) * prims.db(puff_db)
    mono = mono + prims_puff
    st = space.add_room(prims.dual(mono), "desk", -32.0)  # dry: a pop must not ring like a bell
    return Sound(id=sid, group=group, category="ui", role="ui", audio=st, description=desc, tags=["pop", "ui", "bullet", "tonal", *tags],
                 pitch=note, sources=[SYNTH_SOURCE], hp_hz=120.0, lp_hz=12000.0)


def plop(sid: str, note: str, seed: str, start_ratio: float = 0.55, rise_s: float = 0.025, t60: float = 0.13, desc: str = "") -> Sound:
    f0 = float(midi_to_hz(note_number(note)))
    dur = 0.22
    n = prims.n_samples(dur)
    t = prims.t_axis(n)
    shape = 1 - np.exp(-t / (rise_s / 3))
    f = f0 * (start_ratio + (1 - start_ratio) * shape)
    body = prims.chirp(f) * prims.ar_env(n, 0.0015, t60)
    second = prims.chirp(1.5 * f) * prims.ar_env(n, 0.001, t60 * 0.3) * 0.06  # a hint of the drop's ring
    sub = prims.chirp(0.5 * f) * prims.ar_env(n, 0.002, 0.04) * 0.15
    st = space.add_room(prims.dual(body + second + sub), "desk", -30.0)
    return Sound(id=sid, group="plop", category="ui", role="ui", audio=st, description=desc, tags=["plop", "ui", "bullet", "drop", "tonal"],
                 pitch=note, sources=[SYNTH_SOURCE], hp_hz=100.0, lp_hz=10000.0)


TICK_SOURCES = [
    "Idiophones/Struck Idiophones/Woodblock/wood_click_f_rr1.wav",
    "Idiophones/Struck Idiophones/Woodblock/wood_click_f_rr2.wav",
    "Idiophones/Struck Idiophones/Woodblock/wood_click_ff.wav",
    "Idiophones/Struck Idiophones/Woodblock/wood_click3_vl2.wav",
    "Idiophones/Struck Idiophones/Woodblock/wood_click_f_rr2.wav",
]


def tick(sid: str, rel: str, semis: float, t60: float, lp: float, desc: str) -> Sound:
    x = vcsl.shift(vcsl.load(rel, trim_db=-30.0, pre_ms=0.2), semis)
    n = min(x.shape[1], prims.n_samples(0.09))
    x = x[:, :n] * prims.ar_env(n, 0.0002, t60)[None, :]
    mono = x.mean(axis=0)
    mono = prims.lowpass(mono, lp, order=2)
    st = space.add_room(prims.dual(mono), "desk", -24.0)
    return Sound(id=sid, group="tick", category="ui", role="ui", audio=st, description=desc, tags=["tick", "ui", "soft", "wood", "click"],
                 sources=[vcsl.provenance(rel)], hp_hz=250.0, lp_hz=11000.0, extra={"pitchShiftSemitones": semis})


def swipe(sid: str, dur: float, f_lo: float, f_hi: float, direction: int, seed: str, grain: float = 0.5, flick: float = 0.35,
          paper: bool = False, desc: str = "") -> Sound:
    n = prims.n_samples(dur + 0.03)
    t = prims.t_axis(n)
    u = np.clip(t / dur, 0, 1)
    # speed profile of a flicked card: a quick push to full speed about 38 % in, then a longer
    # glide out; the level, the band and the grain all follow it
    pk = 0.38
    speed = np.where(u < pk, (u / pk) ** 1.6, ((1 - u) / (1 - pk)) ** 1.1)
    speed = np.clip(speed, 0, 1) * (t <= dur)
    env = speed**1.2 * prims.smoothstep(t / 0.008)
    fc = f_lo * (f_hi / f_lo) ** speed
    base = prims.svf(prims.noise(n, seed + "-b", "pink"), fc, q=1.0, mode="bandpass")
    base /= max(np.sqrt(np.mean(base[env > 0.4] ** 2)), 1e-12)
    # paper grain: sparse slips, denser when faster
    g = rng("swipe-grain", seed)
    times = prims.slip_times(dur, lambda tt: 140 + 260 * float(np.interp(tt, t, speed)), seed + "-g", jitter=0.6)
    amps = g.uniform(0.3, 1.0, times.size) * np.interp(times, t, speed)
    crackle = prims.pulse_train(n, times, amps, 0.00012)
    crackle = prims.bandpass(crackle, 1500, 5000)
    crackle /= max(np.sqrt(np.mean(crackle**2)) * 3, 1e-12)
    mono = base * env + grain * crackle * env
    if paper:  # a page has a soft low flap as it lands
        flap = prims.lowpass(prims.noise_burst(0.06, 0.05, seed + "-flap", "brown"), 400)
        flap /= max(np.max(np.abs(flap)), 1e-12)
        k = prims.n_samples(dur * 0.82)
        mono[k : k + flap.size] += 0.5 * flap[: max(0, n - k)]
    if flick > 0:
        fl = prims.strike([(2350, 0.012, 1.0), (3900, 0.006, 0.4)], 0.03, 0.00025)
        fl /= max(np.max(np.abs(fl)), 1e-12)
        k = prims.n_samples(dur * 0.93)
        mono[k : k + fl.size] += flick * float(np.max(np.abs(mono))) * fl[: max(0, n - k)]
    pan = direction * 0.45 * np.tanh(3 * (u - pk))
    st = prims.pan(mono, pan) * math.sqrt(2)
    st = space.add_room(st, "desk", -22.0)
    return Sound(id=sid, group="swipe", category="ui", role="ui", audio=st, description=desc,
                 tags=["swipe", "ui", "card", "slide", "paper" if paper else "friction"], sync="start", sync_s=0.0,
                 sources=[SYNTH_SOURCE], hp_hz=150.0, lp_hz=9000.0, extra={"direction": "left-to-right" if direction > 0 else "right-to-left"})


def render() -> list:
    out = []
    pops = [
        ("D5", 0.0, 0.085, 0.82, "Bullet pop, step 1 of the D5-G5-A5-D6 set (use 01-04 in order for a list)."),
        ("G5", 0.0, 0.080, 0.82, "Bullet pop, step 2 (G5)."),
        ("A5", 0.0, 0.078, 0.82, "Bullet pop, step 3 (A5)."),
        ("D6", 0.0, 0.070, 0.84, "Bullet pop, step 4 (D6), the brightest."),
        ("A5", -8.0, 0.090, 0.78, "Alternate pop on A5, rounder: for repeats on one pitch."),
        ("D5", 8.0, 0.075, 0.86, "Alternate pop on D5, tighter: for repeats on one pitch."),
    ]
    for i, (note, cents, t60, snap, desc) in enumerate(pops, 1):
        out.append(pop(f"pop_{i:02d}", note, f"pop{i}", cents=cents, t60=t60, snap=snap, desc=desc, tags=[f"step{i}"] if i <= 4 else ["alternate"]))
    plops = [
        ("D4", 0.55, 0.025, 0.13, "Water-drop plop on D4: softer and rounder than the pops."),
        ("G4", 0.58, 0.022, 0.12, "Plop on G4."),
        ("A4", 0.52, 0.028, 0.13, "Plop on A4."),
        ("D5", 0.60, 0.020, 0.10, "Plop on D5, the lightest."),
    ]
    for i, (note, sr_, rise, t60, desc) in enumerate(plops, 1):
        out.append(plop(f"plop_{i:02d}", note, f"plop{i}", sr_, rise, t60, desc))
    ticks = [
        (0, 5.0, 0.030, 6000, "Soft wooden UI tick (woodblock +5 st, main mode near A6)."),
        (1, 5.0, 0.026, 6000, "Soft tick, second strike of the same block."),
        (2, 4.0, 0.024, 5500, "Soft tick, a little lower and firmer."),
        (3, 6.0, 0.022, 6500, "Soft tick, smaller block, lighter."),
        (4, 3.0, 0.030, 3800, "The softest tick: lower and darker (the second strike, 3 st up, low-passed)."),
    ]
    for i, (k, semis, t60, lp, desc) in enumerate(ticks, 1):
        out.append(tick(f"tick_{i:02d}", TICK_SOURCES[k], semis, t60, lp, desc))
    swipes = [
        (0.26, 600, 2500, +1, 0.40, 0.30, False, "Card swipe, left to right: a card sliding off a felt table."),
        (0.24, 560, 2350, -1, 0.40, 0.30, False, "Card swipe, right to left."),
        (0.18, 700, 2800, +1, 0.32, 0.25, False, "Quick card flick."),
        (0.34, 450, 2100, -1, 0.60, 0.15, True, "Page turn: paper grain and a soft flap as it lands."),
        (0.30, 480, 2200, +1, 0.55, 0.10, True, "Page turn, the other way, softer."),
    ]
    for i, (dur, flo, fhi, d, grain, flick, paper, desc) in enumerate(swipes, 1):
        out.append(swipe(f"swipe_{i:02d}", dur, flo, fhi, d, f"sw{i}", grain, flick, paper, desc))
    return out

