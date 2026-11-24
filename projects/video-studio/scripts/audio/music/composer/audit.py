"""Score audits for writing blind (nobody can listen in this session): find what a producer would hear.

    clashes(score)   sustained semitone / minor-ninth collisions between pitched notes (the usual
                     "wrong note" sound). Intended colour (the motif's blue note) shows up too, so the
                     report is a list to read, not a pass/fail gate.
    ranges(score)    lowest/highest note per part against the instrument's comfortable range.
    density(score)   notes per bar per part (to spot machine-gun repetition and empty bars).
"""

from __future__ import annotations

from audiolib.core import note_name

UNPITCHED = ("kit", "kick")

RANGES = {  # comfortable written ranges (MIDI) for the parts we use
    "bass": (28, 60), "sub": (24, 50), "celli": (36, 76), "violas": (48, 84), "violins": (55, 100), "pizz": (48, 91),
    "celli_pizz": (36, 72), "basses_pizz": (28, 60), "vibes": (53, 89), "piano": (21, 108), "ep": (40, 84), "brass": (48, 84),
    "gtr": (40, 76), "pulse": (36, 84), "pad": (36, 84), "harp": (24, 103), "marimba": (36, 96), "glock": (67, 108),
    "celesta": (60, 108), "kalimba": (59, 84), "bells": (60, 77), "bowed": (57, 91),
}


def clashes(score, min_overlap: float = 0.25, intervals=(1, 13, 25), skip=UNPITCHED, limit: int = 40) -> list:
    notes = []
    for name, part in score.parts.items():
        if name in skip or name.startswith("kit"):
            continue
        notes += [(n.start, n.end, n.pitch, name, n.meta.get("motif")) for n in part.notes]
    notes.sort()
    out = []
    for i, (s1, e1, p1, n1, m1) in enumerate(notes):
        for s2, e2, p2, n2, m2 in notes[i + 1 :]:
            if s2 >= e1:
                break
            ov = min(e1, e2) - max(s1, s2)
            if ov < min_overlap:
                continue
            if abs(p1 - p2) in intervals:
                bar = int(max(s1, s2) // score.beats_per_bar)
                beat = round(max(s1, s2) - bar * score.beats_per_bar, 2)
                out.append({"bar": bar, "beat": beat, "a": f"{n1}:{note_name(p1)}", "b": f"{n2}:{note_name(p2)}", "overlap": round(ov, 2),
                            "motif": bool(m1 or m2)})
    out.sort(key=lambda c: (-c["overlap"], c["bar"]))
    return out[:limit]


def ranges(score) -> list:
    out = []
    for name, part in score.parts.items():
        if not part.notes or name in UNPITCHED:
            continue
        lo = min(n.pitch for n in part.notes)
        hi = max(n.pitch for n in part.notes)
        ok_lo, ok_hi = RANGES.get(name, (0, 127))
        out.append({"part": name, "low": note_name(lo), "high": note_name(hi), "ok": ok_lo <= lo and hi <= ok_hi})
    return out


def density(score) -> dict:
    bpb = score.beats_per_bar
    out = {}
    for name, part in score.parts.items():
        if not part.notes:
            continue
        bars = {}
        for n in part.notes:
            bars[int(n.start // bpb)] = bars.get(int(n.start // bpb), 0) + 1
        out[name] = bars
    return out
