"""Music theory helpers: chord symbols, scales and voice-led voicings.

    chord_pcs("Dmaj9")          -> root 2, intervals (0, 4, 7, 11, 14)
    voicing("Em9", low=52, high=72, prev=[...])  -> MIDI notes nearest the previous voicing
    scale("D", "major")         -> pitch classes

Voicings follow the usual keyboard rules: no notes below `low`, at most `max_notes`, the root can be
left to the bass (`rootless=True`), and among all inversions/drops the one that moves the voices
least from `prev` wins (smooth voice leading). Low intervals are kept open: no 2nds below C3
and no 3rds below G2 (they turn to mud).
"""

from __future__ import annotations

import itertools
import re

from .core import NOTE_NAMES, _FLAT

QUALITIES = {
    "": (0, 4, 7), "maj": (0, 4, 7), "M": (0, 4, 7), "m": (0, 3, 7), "min": (0, 3, 7), "-": (0, 3, 7),
    "dim": (0, 3, 6), "aug": (0, 4, 8), "+": (0, 4, 8), "sus2": (0, 2, 7), "sus4": (0, 5, 7), "sus": (0, 5, 7),
    "5": (0, 7), "6": (0, 4, 7, 9), "m6": (0, 3, 7, 9), "69": (0, 4, 7, 9, 14), "6/9": (0, 4, 7, 9, 14),
    "7": (0, 4, 7, 10), "maj7": (0, 4, 7, 11), "M7": (0, 4, 7, 11), "m7": (0, 3, 7, 10), "-7": (0, 3, 7, 10),
    "mmaj7": (0, 3, 7, 11), "m7b5": (0, 3, 6, 10), "dim7": (0, 3, 6, 9), "7sus4": (0, 5, 7, 10), "7sus": (0, 5, 7, 10),
    "add9": (0, 4, 7, 14), "madd9": (0, 3, 7, 14), "9": (0, 4, 7, 10, 14), "maj9": (0, 4, 7, 11, 14), "m9": (0, 3, 7, 10, 14),
    "11": (0, 4, 7, 10, 14, 17), "m11": (0, 3, 7, 10, 14, 17), "maj7#11": (0, 4, 7, 11, 18), "13": (0, 4, 7, 10, 14, 21),
    "m13": (0, 3, 7, 10, 14, 21), "maj13": (0, 4, 7, 11, 14, 21), "7b9": (0, 4, 7, 10, 13), "7#9": (0, 4, 7, 10, 15),
    "7#11": (0, 4, 7, 10, 18), "7b13": (0, 4, 7, 10, 20), "9sus4": (0, 5, 7, 10, 14), "13sus4": (0, 5, 7, 10, 14, 21),
}

SCALES = {
    "major": (0, 2, 4, 5, 7, 9, 11), "minor": (0, 2, 3, 5, 7, 8, 10), "dorian": (0, 2, 3, 5, 7, 9, 10),
    "mixolydian": (0, 2, 4, 5, 7, 9, 10), "lydian": (0, 2, 4, 6, 7, 9, 11), "phrygian": (0, 1, 3, 5, 7, 8, 10),
    "harmonic_minor": (0, 2, 3, 5, 7, 8, 11), "melodic_minor": (0, 2, 3, 5, 7, 9, 11),
    "pentatonic": (0, 2, 4, 7, 9), "minor_pentatonic": (0, 3, 5, 7, 10), "blues": (0, 3, 5, 6, 7, 10),
}

_SYMBOL = re.compile(r"^([A-G](?:#|b)?)(.*?)(?:/([A-G](?:#|b)?))?$")


def pitch_class(name: str) -> int:
    n = name.strip()
    n = n[0].upper() + n[1:]
    n = _FLAT.get(n, n)
    if n not in NOTE_NAMES:
        raise ValueError(f"bad pitch class {name!r}")
    return NOTE_NAMES.index(n)


def parse_chord(symbol: str):
    """'F#m7b5/C' -> (root_pc 6, intervals (0, 3, 6, 10), bass_pc 0). Bass is None without a slash."""
    m = _SYMBOL.match(symbol.strip())
    if not m:
        raise ValueError(f"bad chord symbol {symbol!r}")
    root, qual, bass = m.groups()
    if qual not in QUALITIES:
        raise ValueError(f"unknown chord quality {qual!r} in {symbol!r}; known: {sorted(QUALITIES)}")
    return pitch_class(root), QUALITIES[qual], (pitch_class(bass) if bass else None)


def chord_pcs(symbol: str):
    root, ivs, _ = parse_chord(symbol)
    return root, ivs


def scale(tonic: str, mode: str = "major") -> list:
    t = pitch_class(tonic)
    return [(t + i) % 12 for i in SCALES[mode]]


def bass_note(symbol: str, low: int = 33, high: int = 52) -> int:
    """The chord's bass (slash bass if given, else the root) in [low, high], as low as fits."""
    root, _, bass = parse_chord(symbol)
    pc = root if bass is None else bass
    n = low + ((pc - low) % 12)
    if n > high:
        n -= 12
    return n


def _ok_low_intervals(notes) -> bool:
    s = sorted(notes)
    for a, b in zip(s, s[1:]):
        d = b - a
        if d <= 2 and a < 48:
            return False
        if d <= 4 and a < 43:
            return False
    return True


def voicing(symbol: str, low: int = 48, high: int = 76, prev=None, max_notes: int = 5, rootless: bool = False, drop_fifth: bool = True) -> list:
    """Voice-led voicing of `symbol` (sorted MIDI notes) within [low, high].

    Chooses the chord-tone subset (dropping the 5th first, then the root when `rootless`), and among
    every placement within range picks the one with the least total movement from `prev` (or, with
    no `prev`, the one centred lowest in the range with even spacing)."""
    root, ivs, _ = parse_chord(symbol)
    tones = [(root + i) % 12 for i in ivs]
    core = list(dict.fromkeys(tones))
    if rootless and len(core) > 3:
        core = [t for t in core if t != root % 12]
    if drop_fifth and len(core) > max_notes and (root + 7) % 12 in core:
        core.remove((root + 7) % 12)
    while len(core) > max_notes:
        core.pop(len(core) // 2)
    candidates = []
    for pcs in itertools.permutations(core):
        # stack upward from each starting octave, each note the next pitch above the previous
        for start in range(low, low + 12):
            if start % 12 != pcs[0]:
                continue
            notes = [start]
            for pc in pcs[1:]:
                n = notes[-1] + 1
                while n % 12 != pc:
                    n += 1
                notes.append(n)
            if notes[-1] > high:
                continue
            if notes[-1] - notes[0] > 19:
                continue
            if not _ok_low_intervals(notes):
                continue
            candidates.append(notes)
            up = [x + 12 for x in notes]
            if up[-1] <= high and _ok_low_intervals(up):
                candidates.append(up)
    if not candidates:
        raise ValueError(f"no voicing of {symbol!r} fits in [{low}, {high}]")
    if prev:
        p = sorted(prev)

        def cost(c):
            c = sorted(c)
            # match voices by order; unequal counts compare against the nearest previous note
            return sum(min(abs(x - y) for y in p) for x in c) + 0.5 * abs(len(c) - len(p))

        return sorted(min(candidates, key=lambda c: (cost(c), c)))
    centre = low + (high - low) * 0.4
    return sorted(min(candidates, key=lambda c: (abs(sum(c) / len(c) - centre), c)))


def progression(symbols, low: int = 50, high: int = 74, **kw) -> list:
    """Voice-led voicings for a list of chord symbols."""
    out = []
    prev = None
    for s in symbols:
        v = voicing(s, low, high, prev, **kw)
        out.append(v)
        prev = v
    return out
