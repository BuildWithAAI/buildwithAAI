"""Zoo's typing rig and a frame-locked typing rhythm.

Copied from src/characters/zoo/views/Typing.tsx, `fingerLift` (read 2026-11-24; that file belongs
to the character workflow and is never edited from here):

    period = 9 + ((finger * 5 + hand * 3) % 5)   // 9 frames (near hand 0) or 12 frames (far hand 1)
    phase  = (finger * 7 + hand * 11) % period
    t      = (frame + phase) % period
    lift   = t < 4 ? sin(PI * t / 4) * 16 : 0

A finger rises over t = 1..3 and lands back on its key at t = 4: that frame is a strike. The pattern
repeats every 36 frames (the least common multiple of 9 and 12); 23 of the 36 frames have at least
one strike. A typing burst built with `typing_plan(..., rig_phase=1)` puts every key on a strike
frame when the burst starts on a typing-pose frame f with f % 36 == 1; started anywhere else, every
key still lands exactly on a frame boundary (the keys are 1600-sample multiples at 30 fps).
"""

from __future__ import annotations

import math

from audiolib.core import rng

RIG_PERIOD = 36
HANDS = (0, 1)
FINGERS = (0, 1, 2, 3)
SOURCE = "src/characters/zoo/views/Typing.tsx fingerLift (read 2026-11-24)"


def finger_lift(frame: int, hand: int, finger: int) -> float:
    period = 9 + ((finger * 5 + hand * 3) % 5)
    phase = (finger * 7 + hand * 11) % period
    t = (frame + phase) % period
    return math.sin(math.pi * t / 4) * 16 if t < 4 else 0.0


def strikes_at(frame: int) -> list:
    """(hand, finger) pairs whose finger lands on its key at this rig frame."""
    out = []
    for h in HANDS:
        for f in FINGERS:
            if finger_lift(frame, h, f) == 0.0 and finger_lift(frame - 1, h, f) > 0.0:
                out.append((h, f))
    return out


def strike_residues() -> list:
    """Rig frames (mod 36) with at least one strike."""
    return [k for k in range(RIG_PERIOD) if strikes_at(k)]


def is_strike(file_frame: int, rig_phase: int) -> bool:
    return bool(strikes_at(file_frame + rig_phase))


# word lengths of running English text (letters), roughly: short function words are common
_WORD_LEN = [(2, 0.17), (3, 0.21), (4, 0.18), (5, 0.14), (6, 0.11), (7, 0.09), (8, 0.06), (9, 0.04)]


def _word_length(g) -> int:
    r = g.random()
    acc = 0.0
    for n, p in _WORD_LEN:
        acc += p
        if r <= acc:
            return n
    return _WORD_LEN[-1][0]


def typing_plan(seed, words: int, rig_phase: int | None = 1, enter_at_end: bool = False, pause_prob: float = 0.12,
                mean_iki_frames: float = 4.2, n_positions: int = 14) -> list:
    """A realistic typing rhythm on whole frames (30 fps).

    Inter-key intervals are log-normal around `mean_iki_frames` (4.2 frames = 140 ms, about 70
    words a minute) and never shorter than 2 frames (67 ms, a fast roll); a word starts a little
    later than its letters follow each other; a thinking pause of 8-14 frames follows some spaces.
    With `rig_phase`, each key moves to the nearest frame (never more than 1 frame away) on which
    one of Zoo's fingers strikes. Keys get a keyboard position (its own pitch and colour, so a
    repeated letter sounds the same) and a velocity. Returns events
    [{"frame", "key": "alpha"|"space"|"enter", "pos", "vel", "dwell_s"}], starting at frame 0."""
    g = rng("typing-plan", seed)
    events = []

    def ok(fr):
        return rig_phase is None or is_strike(fr, rig_phase)

    def snap(target: int, earliest: int) -> int:
        cands = [c for c in range(max(earliest, target - 1), max(earliest, target + 1) + 3) if ok(c)]
        if not cands:
            c = max(earliest, target)
            while not ok(c):
                c += 1
            return c
        return min(cands, key=lambda c: (abs(c - target), c))

    def iki(mean: float) -> int:
        v = mean * math.exp(0.28 * g.standard_normal() - 0.5 * 0.28**2)
        return int(min(8, max(2, round(v))))

    def dwell() -> float:
        return float(min(0.16, max(0.055, 0.09 * math.exp(0.25 * g.standard_normal()))))

    frame = None
    last_pos = None
    for w in range(words):
        length = _word_length(g)
        for i in range(length):
            if frame is None:
                frame = snap(0, 0)
            else:
                mean = mean_iki_frames + (0.7 if i == 0 else 0.0)
                frame = snap(frame + iki(mean), frame + 2)
            pos = int(g.integers(0, n_positions))
            if pos == last_pos:
                pos = (pos + 1 + int(g.integers(0, n_positions - 1))) % n_positions
            last_pos = pos
            vel = float(min(1.0, max(0.45, g.normal(0.72, 0.09) + (0.06 if i == 0 else 0.0))))
            events.append({"frame": frame, "key": "alpha", "pos": pos, "vel": round(vel, 3), "dwell_s": round(dwell(), 4)})
        if w < words - 1:
            frame = snap(frame + iki(mean_iki_frames - 0.2), frame + 2)
            events.append({"frame": frame, "key": "space", "pos": 100, "vel": round(float(min(1.0, g.normal(0.86, 0.06))), 3), "dwell_s": round(dwell() + 0.015, 4)})
            if g.random() < pause_prob:
                frame += int(g.integers(8, 15))
    if enter_at_end:
        frame = snap(frame + int(g.integers(5, 8)), frame + 3)
        events.append({"frame": frame, "key": "enter", "pos": 200, "vel": 0.97, "dwell_s": 0.11})
    return events
