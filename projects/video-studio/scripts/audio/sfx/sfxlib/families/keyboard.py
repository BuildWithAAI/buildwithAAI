"""Mechanical keyboard for Zoo typing at the desk: single keys, spacebar, Enter, typing bursts and
seamless typing loops, all locked to 30 fps frames.

Voicing: a lubed, "thocky" board (energy around 0.4-2 kHz, a soft top), which reads as premium and
is far less fatiguing under narration than a clicky one. The low desk and case modes (136-215 Hz)
sit between the mains harmonics (100/120/150/180 Hz), so repeated keys never read as hum. A keystroke is modelled in parts:
- finger contact: a quiet low tap 1.8 ms before the bottom-out (the finger meeting the keycap);
- bottom-out: the stem hits the housing, ringing the keycap and plate modes (inharmonic, 8-25 ms)
  and the case "thock" (380-650 Hz), with a short click of band-passed noise; harder strikes get a
  shorter contact pulse, so they are brighter as well as louder; 2.5-5 ms later the keycap skirt
  touches down and rebounds (a second, quieter impact, -14 to -18 dB, slightly higher);
- release: the upstroke hitting the top housing, a lighter and higher click 2-4 frames later.
Spacebar and Enter are longer stabilised keys: lower modes, and the far end of the bar lands a few
milliseconds after the near end (the stabiliser double hit), on the press and on the release.
Each keyboard position has its own fixed timbre (the same letter sounds the same) with a small
random variation per strike; positions are panned slightly left to right like the hands.

Sync: every press (and every release) is on a 30 fps frame boundary. Bursts and loops follow the
rhythm model in sfxlib.rig and land every key on a frame where one of Zoo's fingers strikes when
they start on a typing-pose frame f with f % 36 == 1 (see `rig` in the manifest). Loops are 144
frames (four rig periods, 4.8 s), so they stay aligned when repeated.
"""

from __future__ import annotations

import numpy as np

from audiolib.core import rng

from .. import prims, rig, space
from ..core import FPS, FRAME, SYNTH_SOURCE, Sound

FAMILY = "Mechanical keyboard: keys, spacebar, Enter, frame-locked typing bursts and loops"

BASE = {
    "alpha": {
        "cap": [(1150, 0.022, 1.0), (1620, 0.016, 0.75), (2350, 0.010, 0.45), (3300, 0.007, 0.22), (4600, 0.005, 0.10)],
        "case": [(440, 0.028, 0.60), (610, 0.020, 0.40), (215, 0.022, 0.25)],
        "stab": None,
        "gain": 1.0,
    },
    "space": {
        "cap": [(520, 0.045, 1.0), (760, 0.035, 0.80), (1180, 0.024, 0.55), (1750, 0.015, 0.35), (2600, 0.009, 0.18), (3700, 0.006, 0.08)],
        "case": [(300, 0.040, 0.60), (420, 0.030, 0.40), (136, 0.030, 0.35)],
        "stab": (0.0045, 0.45),
        "gain": 1.25,
    },
    "enter": {
        "cap": [(760, 0.034, 1.0), (1120, 0.026, 0.75), (1700, 0.017, 0.50), (2500, 0.011, 0.28), (3500, 0.007, 0.12)],
        "case": [(380, 0.032, 0.55), (540, 0.024, 0.40), (207, 0.025, 0.30)],
        "stab": (0.0028, 0.35),
        "gain": 1.2,
    },
}
CONTACT_LEAD_S = 0.0018
RIG = {"source": rig.SOURCE, "period": rig.RIG_PERIOD, "startRigFrameMod36": 1,
       "note": "Start this file on a typing-pose frame f with f % 36 == 1 and every key lands on a frame where one of Zoo's fingers comes down; started anywhere else, every key still lands exactly on a frame boundary."}


def _texture_modes(kind: str, pos: int, n: int = 10):
    """A cloud of short, dense high modes (the keycap shell and stem): the "clack" detail that
    keeps a few main modes from sounding like a tuned block. Fixed per key position."""
    g = rng("key-texture", kind, pos)
    f = np.exp(g.uniform(np.log(900.0), np.log(7000.0), n))
    env = 1.0 / (1.0 + (f / 2600.0) ** 2)  # rolls off above 2.6 kHz
    return [(float(fi), float(g.uniform(0.0015, 0.006)), float(0.28 * e * g.uniform(0.5, 1.0))) for fi, e in zip(f, env, strict=True)]


def _modes_for(kind: str, pos: int, strike_seed: str):
    base = BASE[kind]
    cap = prims.jitter_modes(base["cap"], f"key-{kind}-{pos}", freq_pct=6.0, t60_pct=15.0, amp_db=2.0)  # fixed per key
    cap = cap + _texture_modes(kind, pos)
    case = prims.jitter_modes(base["case"], f"case-{kind}-{pos}", freq_pct=3.0, t60_pct=10.0, amp_db=1.0)
    cap = prims.jitter_modes(cap, strike_seed, freq_pct=0.8, t60_pct=6.0, amp_db=1.0)  # this strike
    return cap, case


def _impact(cap, case, vel: float, seed: str, click_db: float = -10.0, scale: float = 1.0) -> np.ndarray:
    hard = 0.00026 - 0.0001 * vel  # 0.16 ms (hard) .. 0.21 ms (soft)
    dur = 0.09
    body = prims.strike([(f * scale, t, a) for f, t, a in cap], dur, hard) + prims.strike([(f * scale, t, a) for f, t, a in case], dur, hard * 1.6)
    click = prims.bandpass(prims.noise_burst(0.0015, 0.0005, seed + "-click"), 1500, 9000)
    n = body.size
    out = body / max(np.max(np.abs(body)), 1e-12)
    c = np.zeros(n)
    c[: click.size] = click / max(np.max(np.abs(click)), 1e-12) * prims.db(click_db)
    return out + c


def keystroke(kind: str, pos: int, vel: float, dwell_frames: int, seed: str) -> tuple:
    """Press + release of one key, mono. Returns (audio, press_offset_s): the bottom-out (the
    keystroke's sync point) is at `CONTACT_LEAD_S`, the release at press + dwell frames."""
    base = BASE[kind]
    cap, case = _modes_for(kind, pos, seed)
    dwell = dwell_frames / FPS
    n = prims.n_samples(CONTACT_LEAD_S + dwell + 0.16)
    out = np.zeros(n)
    # finger contact: a soft low tap
    tap = prims.lowpass(prims.noise_burst(0.01, 0.0015, seed + "-tap", "pink"), 900) + prims.strike([(600, 0.006, 1.0)], 0.01, 0.0006)
    tap = tap / max(np.max(np.abs(tap)), 1e-12) * prims.db(-24.0)
    out[: tap.size] += tap[: n]
    press = _impact(cap, case, vel, seed)
    k0 = prims.n_samples(CONTACT_LEAD_S)
    out[k0 : k0 + press.size] += press[: n - k0]
    # the keycap skirt touching down and rebounding a few ms after the stem bottoms out: real
    # keystrokes are a cluster of micro-impacts, not one clean strike
    g = rng("rebound", seed)
    rb = _impact(cap, case, vel * 0.5, seed + "-rebound", click_db=-12.0, scale=float(g.uniform(1.03, 1.09)))
    kr0 = k0 + prims.n_samples(float(g.uniform(0.0025, 0.005)))
    out[kr0 : kr0 + rb.size] += float(g.uniform(0.12, 0.2)) * rb[: n - kr0]
    if base["stab"]:
        dt, amp = base["stab"]
        far = _impact(cap, case, vel * 0.85, seed + "-far", click_db=-14.0, scale=1.03)
        k = prims.n_samples(CONTACT_LEAD_S + dt)
        out[k : k + far.size] += amp * far[: n - k]
    # release: upstroke into the top housing, lighter and higher
    rel_cap = [(f * 1.22, t * 0.7, a) for f, t, a in cap]
    rel_case = [(f * 1.1, t * 0.6, a * 0.5) for f, t, a in case]
    rel = _impact(rel_cap, rel_case, 0.6, seed + "-rel", click_db=-12.0)
    kr = prims.n_samples(CONTACT_LEAD_S + dwell)
    g = prims.db(-11.0 if kind == "alpha" else -12.0)
    out[kr : kr + rel.size] += g * rel[: n - kr]
    if base["stab"]:
        kr2 = kr + prims.n_samples(0.003)
        out[kr2 : kr2 + rel.size] += 0.4 * g * rel[: n - kr2]
    return out * base["gain"] * vel**1.4, CONTACT_LEAD_S


def _pan_for(kind: str, pos: int) -> float:
    if kind != "alpha":
        return 0.0
    return -0.22 + 0.44 * (pos % 14) / 13.0


def render_events(events: list, length_s: float, seed: str, wrap: bool = False) -> np.ndarray:
    """Stereo typing from rig.typing_plan events. Every press's bottom-out lands on its frame (the
    contact tap leads it by 1.8 ms, wrapped to the end of a loop for a key on frame 0)."""
    n = prims.n_samples(length_s)
    out = np.zeros((2, n + (0 if wrap else prims.n_samples(0.4))))
    for i, ev in enumerate(events):
        dwell = int(np.clip(round(ev["dwell_s"] * FPS), 2, 4))
        mono, lead = keystroke(ev["key"], ev["pos"], ev["vel"], dwell, f"{seed}-{i}")
        st = prims.pan(mono, _pan_for(ev["key"], ev["pos"])) * np.sqrt(2)
        start = ev["frame"] * FRAME - prims.n_samples(lead)
        if wrap:
            idx = (np.arange(st.shape[1]) + start) % n
            np.add.at(out[0], idx, st[0])
            np.add.at(out[1], idx, st[1])
        else:
            if start < 0:
                st = st[:, -start:]
                start = 0
            out[:, start : start + st.shape[1]] += st[:, : out.shape[1] - start]
    return out


def _with_room(st: np.ndarray, wrap_n: int | None = None) -> np.ndarray:
    if wrap_n is None:
        return space.add_room(st, "desk", -20.0)
    wet = space.add_room(st, "desk", -20.0)
    out = wet[:, :wrap_n].copy()
    tail = wet[:, wrap_n:]
    k = 0
    while k < tail.shape[1]:  # fold the room tail around the loop
        m = min(wrap_n, tail.shape[1] - k)
        out[:, :m] += tail[:, k : k + m]
        k += m
    return out


def one_key(sid: str, group: str, kind: str, pos: int, vel: float, dwell_frames: int, seed: str, desc: str, tags) -> Sound:
    mono, lead = keystroke(kind, pos, vel, dwell_frames, seed)
    # the bottom-out is the sync point: shift so it sits on sample 0 (the contact tap is 1.8 ms
    # long and quiet; it is dropped here so the file starts on the strike)
    k = prims.n_samples(lead)
    mono = mono[k:]
    st = space.add_room(prims.dual(mono), "desk", -20.0)
    events = [{"t": 0.0, "kind": "press", "key": kind}, {"t": dwell_frames / FPS, "kind": "release", "key": kind}]
    return Sound(id=sid, group=group, category="keyboard", role="foley", audio=st, description=desc,
                 tags=["keyboard", "mechanical", "key", "typing", *tags], events=events, sources=[SYNTH_SOURCE], hp_hz=90.0, lp_hz=12000.0)


def burst(sid: str, group: str, words: int, seed: str, enter: bool, desc: str, mean_iki: float = 4.2) -> Sound:
    plan = rig.typing_plan(seed, words, rig_phase=RIG["startRigFrameMod36"], enter_at_end=enter, mean_iki_frames=mean_iki)
    last = max(ev["frame"] for ev in plan)
    length = (last + 6) / FPS
    st = _with_room(render_events(plan, length, seed))
    events = [{"t": ev["frame"] / FPS, "kind": "press", "key": ev["key"], "vel": ev["vel"]} for ev in plan]
    keys_per_s = len(plan) / ((last - plan[0]["frame"]) / FPS) if last > plan[0]["frame"] else 0.0
    return Sound(id=sid, group=group, category="keyboard", role="foley", audio=st, description=desc,
                 tags=["keyboard", "mechanical", "typing", "burst", "rig-synced"], events=events, sources=[SYNTH_SOURCE],
                 hp_hz=90.0, lp_hz=12000.0, rig=RIG, extra={"keys": len(plan), "keysPerSecond": round(keys_per_s, 2), "words": words})


def loop(sid: str, seed: str, desc: str, frames: int = 4 * rig.RIG_PERIOD) -> Sound:
    """A seamless typing loop of `frames` frames (a multiple of 36 keeps the rig alignment)."""
    plan = []
    words = 30
    while True:
        plan = rig.typing_plan(seed + f"-{words}", words, rig_phase=RIG["startRigFrameMod36"], pause_prob=0.15)
        plan = [ev for ev in plan if ev["frame"] <= frames - 3]
        if plan and plan[-1]["frame"] >= frames - 8:
            break
        words += 4
        if words > 80:
            break
    # rotate the loop so its seam falls in the middle of the widest gap between keys (a key on the
    # seam would be a sharp transient there, which reads as a click to any seam check); the rig
    # phase moves with it, so alignment is kept
    fr = sorted(ev["frame"] for ev in plan)
    gaps = [((fr[(i + 1) % len(fr)] - fr[i]) % frames or frames, fr[i]) for i in range(len(fr))]
    width, after = max(gaps)
    shift = (after + width // 2) % frames  # this frame becomes frame 0
    plan = [dict(ev, frame=(ev["frame"] - shift) % frames) for ev in plan]
    plan.sort(key=lambda ev: ev["frame"])
    rig_info = dict(RIG, startRigFrameMod36=(RIG["startRigFrameMod36"] + shift) % rig.RIG_PERIOD)
    length = frames / FPS
    st = _with_room(render_events(plan, length, seed, wrap=True), wrap_n=prims.n_samples(length))
    events = [{"t": ev["frame"] / FPS, "kind": "press", "key": ev["key"], "vel": ev["vel"]} for ev in plan]
    return Sound(id=sid, group="typing_loop", category="keyboard", role="foley", audio=st, description=desc,
                 tags=["keyboard", "mechanical", "typing", "loop", "rig-synced"], events=events, sources=[SYNTH_SOURCE], loop=True,
                 sync="start", sync_s=0.0, hp_hz=90.0, lp_hz=12000.0, rig=rig_info, extra={"keys": len(plan), "loopFrames": frames, "seamGapFrames": width})


def render() -> list:
    out = []
    keys = [(2, 0.78, 3, "a"), (9, 0.70, 3, "b"), (5, 0.85, 2, "c"), (12, 0.66, 4, "d"), (0, 0.74, 3, "e"),
            (7, 0.90, 2, "f"), (11, 0.62, 3, "g"), (4, 0.80, 4, "h"), (13, 0.72, 2, "i"), (6, 0.76, 3, "j")]
    for i, (pos, vel, dwell, _) in enumerate(keys, 1):
        out.append(one_key(f"key_{i:02d}", "key", "alpha", pos, vel, dwell, f"key{i}",
                           f"One letter key (keyboard position {pos}, velocity {vel}), press on frame 0 and release on frame {dwell}.", ["alpha"]))
    spaces = [(0.86, 3), (0.80, 3), (0.92, 2), (0.76, 4)]
    for i, (vel, dwell) in enumerate(spaces, 1):
        out.append(one_key(f"key_space_{i:02d}", "key_space", "space", 100 + i, vel, dwell, f"space{i}",
                           f"Spacebar: deeper, with the stabiliser double hit; release on frame {dwell}.", ["spacebar"]))
    enters = [(0.95, 3), (0.88, 4), (1.0, 3), (0.84, 3)]
    for i, (vel, dwell) in enumerate(enters, 1):
        out.append(one_key(f"key_enter_{i:02d}", "key_enter", "enter", 200 + i, vel, dwell, f"enter{i}",
                           f"Enter: a firm stabilised press; release on frame {dwell}.", ["enter", "return"]))
    bursts = [(2, False, 4.0, "Two quick words (about 1 s)."), (3, False, 4.2, "Three words."), (4, True, 4.2, "Four words, then Enter."),
              (6, False, 4.4, "Six words with a thinking pause."), (6, True, 4.0, "Six words and Enter."), (3, False, 3.6, "Three words, typed fast.")]
    for i, (w, enter, iki, desc) in enumerate(bursts, 1):
        out.append(burst(f"typing_burst_{i:02d}", "typing_burst", w, f"burst{i}", enter, desc + " Every key on a frame (rig-synced: see rig).", iki))
    for i in range(1, 4):
        out.append(loop(f"typing_loop_{i:02d}", f"loop{i}", "Seamless 4.8 s typing loop (144 frames = four rig periods): repeat it under a long typing shot."))
    return out


__all__ = ["render", "keystroke", "render_events"]
