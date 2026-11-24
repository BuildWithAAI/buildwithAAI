"""A compact text notation for writing parts in code.

Melodies (`line`): space-separated tokens, each `PITCH:BEATS`, optionally `@VEL` (absolute velocity)
or `@+N`/`@-N` (relative to the line's velocity), and a trailing `~` for legato (the note runs
into the next onset). `r:BEATS` is a rest. A chord is `[D4,F4,A4]:BEATS`. Durations are beats
(quarter notes) and may be decimals or fractions (`1/3`).

    line(piano, 0, "D4:.75 D4:.25@-14 A4:.5@+8 Ab4:.5 F4:2@+6", vel=84)

`staccato` shortens every sounding note to that fraction of its slot (default 0.92 keeps a hair of
air between notes). Returns the beat after the last token.

Drum grids (`grid`): one string per instrument on a 16th-note grid, `|` and spaces ignored.
    X accent, x normal, o ghost, . rest; `velocities` maps the letters to MIDI velocities.

    grid(kit, bar_start, {"snare": "....X.......X...", "hat": "x.o.x.o.x.o.x.o."}, keys={...})
"""

from __future__ import annotations

from fractions import Fraction

from audiolib.core import note_number

DEFAULT_VELOCITIES = {"X": 112, "x": 92, "o": 52, "g": 38}


def parse_beats(text: str) -> float:
    t = text.strip()
    if not t:
        raise ValueError("empty duration")
    if "/" in t:
        return float(Fraction(t))
    return float(t)


def _velocity(spec: str | None, base: int) -> int:
    if spec is None:
        return base
    s = spec.strip()
    if s.startswith(("+", "-")):
        return int(max(1, min(127, base + int(s))))
    return int(max(1, min(127, int(s))))


def tokens(text: str) -> list:
    """Parse a line into [(pitches or None for a rest, beats, velocity spec or None, legato)]."""
    out = []
    for tok in text.split():
        legato = tok.endswith("~")
        if legato:
            tok = tok[:-1]
        vel = None
        if "@" in tok:
            tok, vel = tok.split("@", 1)
        if ":" not in tok:
            raise ValueError(f"token {tok!r} needs PITCH:BEATS")
        head, beats = tok.rsplit(":", 1)
        dur = parse_beats(beats)
        if dur <= 0:
            raise ValueError(f"token {tok!r}: duration must be positive")
        if head.lower() == "r":
            out.append((None, dur, None, False))
            continue
        if head.startswith("["):
            if not head.endswith("]"):
                raise ValueError(f"bad chord token {tok!r}")
            pitches = [note_number(p) for p in head[1:-1].split(",") if p.strip()]
        else:
            pitches = [note_number(head)]
        out.append((pitches, dur, vel, legato))
    return out


def line(part, start: float, text: str, vel: int = 80, transpose: int = 0, staccato: float = 0.92, **meta) -> float:
    """Write a melody or chord line into `part` from `start` (beats). Returns the end beat."""
    t = float(start)
    for pitches, dur, vspec, legato in tokens(text):
        if pitches is not None:
            v = _velocity(vspec, vel)
            length = dur if legato else max(0.02, dur * staccato)
            for p in pitches:
                part.note(p + transpose, t, length, v, **meta)
        t += dur
    return t


def length_of(text: str) -> float:
    return sum(d for _, d, _, _ in tokens(text))


def grid(part, start: float, rows: dict, keys: dict, velocities: dict | None = None, step: float = 0.25, dur: float = 0.2, **meta) -> float:
    """Write 16th-note drum grids. rows: {name: pattern}; keys: {name: MIDI drum key}.
    Returns the beat after the longest row."""
    vmap = {**DEFAULT_VELOCITIES, **(velocities or {})}
    longest = 0.0
    for name, pattern in rows.items():
        cells = [c for c in pattern if c not in " |"]
        key = keys[name]
        for i, c in enumerate(cells):
            if c == ".":
                continue
            if c not in vmap:
                raise ValueError(f"unknown grid letter {c!r} in {name!r}")
            part.hit(key, start + i * step, vmap[c], dur=dur, **meta)
        longest = max(longest, len(cells) * step)
    return start + longest
