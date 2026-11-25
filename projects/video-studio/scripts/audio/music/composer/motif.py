"""Zoo's signature motif and Badger's figure (see ../DIRECTION.md, section 2).

The motif sits on the rhythm of the show's name, "Zoo and Bad-ger Show" (stressed: Zoo, Bad-, Show):

    degrees (minor)  1   1    5   b5   b3      D D A Ab F in D minor
    degrees (major)  1   1    5   #4   3       D D A G# F# in D major
    onsets (beats)   0   .75  1   1.5  2
    lengths          .75 .25  .5  .5   2 (held)

Successive intervals are 0, +7, -1, -3 (minor) or 0, +7, -1, -2 (major): the fingerprint.
Forms: full, head (1 1 5), tail (5 b5 b3), retro (the full motif backwards, "rewind").
`stretch` scales the rhythm (augmentation > 1, diminution < 1).

Every note `place` writes carries meta {"motif": "zoo", "form": ..., "mode": ..., "idx": i,
"statement": n}, so `statements(score)` can find and verify each statement after humanisation.
Badger's figure (b2 then 1, two dry low notes a beat apart) is tagged {"motif": "badger"}.
"""

from __future__ import annotations

from dataclasses import dataclass

from audiolib.core import note_number

DEGREES = {"minor": (0, 0, 7, 6, 3), "major": (0, 0, 7, 6, 4)}
ONSETS = (0.0, 0.75, 1.0, 1.5, 2.0)
LENGTHS = (0.75, 0.25, 0.5, 0.5, 2.0)
# velocity shape: "Zoo" firm, "and" light, "Bad-" accented (the leap), "-ger" lighter, "Show" lands
ACCENTS = (0, -16, 8, -6, 6)
FORMS = {"full": (0, 1, 2, 3, 4), "head": (0, 1, 2), "tail": (2, 3, 4)}

INTERVALS = {
    ("full", "minor"): (0, 7, -1, -3),
    ("full", "major"): (0, 7, -1, -2),
    ("head", "minor"): (0, 7),
    ("head", "major"): (0, 7),
    ("tail", "minor"): (-1, -3),
    ("tail", "major"): (-1, -2),
    ("retro", "minor"): (3, 1, -7, 0),
    ("retro", "major"): (2, 1, -7, 0),
}

BADGER_STEPS = (1, 0)  # b2 then the tonic
BADGER_ONSETS = (0.0, 1.0)
BADGER_LENGTHS = (0.32, 0.55)


@dataclass(frozen=True)
class MotifNote:
    pitch: int
    onset: float  # beats from the statement's start
    dur: float
    accent: int


def notes(tonic, mode: str = "minor", form: str = "full", stretch: float = 1.0, last_dur: float | None = None) -> list:
    """The motif as MotifNotes. `tonic` is a MIDI number or a name (the pitch of the first note, "Zoo")."""
    if mode not in DEGREES:
        raise ValueError(f"mode must be one of {sorted(DEGREES)}")
    t = note_number(tonic)
    deg = DEGREES[mode]
    if form == "retro":
        idx = (4, 3, 2, 1, 0)
        # backwards: each note keeps its own length, laid end to end in reverse order
        out = []
        pos = 0.0
        for k, i in enumerate(idx):
            d = LENGTHS[i] * stretch
            if k == 4 and last_dur is not None:
                d = last_dur
            out.append(MotifNote(t + deg[i], pos, d, ACCENTS[i]))
            pos += LENGTHS[i] * stretch
        return out
    if form not in FORMS:
        raise ValueError(f"form must be one of {sorted(FORMS) + ['retro']}")
    idx = FORMS[form]
    base = ONSETS[idx[0]]
    out = []
    for k, i in enumerate(idx):
        d = LENGTHS[i] * stretch
        if k == len(idx) - 1 and last_dur is not None:
            d = last_dur
        out.append(MotifNote(t + deg[i], (ONSETS[i] - base) * stretch, d, ACCENTS[i]))
    return out


def length_beats(form: str = "full", stretch: float = 1.0) -> float:
    """Beats from the first onset to the end of the last note's slot."""
    if form == "retro":
        return sum(LENGTHS) * stretch
    idx = FORMS[form]
    return (ONSETS[idx[-1]] + LENGTHS[idx[-1]] - ONSETS[idx[0]]) * stretch


_counter = {"n": 0}


def place(part, start: float, tonic, mode: str = "minor", form: str = "full", vel: int = 84, stretch: float = 1.0,
          last_dur: float | None = None, staccato: float = 0.95, octaves=(0,), statement: str | None = None,
          rhythm=None) -> float:
    """Write a motif statement into `part` at `start` (beats). `octaves` doubles it (e.g. (0, 12)).
    `rhythm` = [(onset, length), ...] replaces the form's rhythm (the pitches, and so the fingerprint,
    stay). Returns the beat where the statement's last note ends."""
    _counter["n"] += 1
    sid = statement or f"s{_counter['n']}"
    end = start
    mns = notes(tonic, mode, form, stretch, last_dur)
    if rhythm is not None:
        if len(rhythm) != len(mns):
            raise ValueError(f"rhythm has {len(rhythm)} notes, the {form} form has {len(mns)}")
        mns = [MotifNote(m.pitch, float(o), float(d), m.accent) for m, (o, d) in zip(mns, rhythm)]
    for k, mn in enumerate(mns):
        is_last = k == (4 if form in ("full", "retro") else 2)
        dur = mn.dur if is_last else max(0.03, mn.dur * staccato)
        for o in octaves:
            part.note(mn.pitch + o, start + mn.onset, dur, int(max(1, min(127, vel + mn.accent))),
                      motif="zoo", form=form, mode=mode, idx=k, statement=sid, octave=o)
        end = max(end, start + mn.onset + dur)
    return end


def place_badger(part, start: float, tonic, vel: int = 96, spacing: float = 1.0, octaves=(0,), statement: str | None = None) -> float:
    """Badger's figure: the flat second then the tonic, short and dry, `spacing` beats apart."""
    _counter["n"] += 1
    sid = statement or f"b{_counter['n']}"
    t = note_number(tonic)
    end = start
    for k, (step, onset, dur) in enumerate(zip(BADGER_STEPS, (0.0, spacing), BADGER_LENGTHS)):
        for o in octaves:
            part.note(t + step + o, start + onset, dur, int(max(1, min(127, vel - 6 * k))),
                      motif="badger", idx=k, statement=sid, octave=o)
        end = max(end, start + onset + dur)
    return end


def statements(score, kind: str = "zoo") -> list:
    """Every tagged statement in a score: [{part, statement, form, mode, pitches, starts, ok}].
    `ok` is True when the pitch intervals (octave 0 copy, in idx order) match the fingerprint."""
    found = {}
    for pname, part in score.parts.items():
        for n in part.notes:
            if n.meta.get("motif") != kind or n.meta.get("octave", 0) != 0:
                continue
            key = (pname, n.meta["statement"])
            found.setdefault(key, []).append(n)
    out = []
    for (pname, sid), ns in found.items():
        ns = sorted(ns, key=lambda x: x.meta["idx"])
        pitches = [x.pitch for x in ns]
        ivs = tuple(b - a for a, b in zip(pitches, pitches[1:]))
        if kind == "zoo":
            form, mode = ns[0].meta["form"], ns[0].meta["mode"]
            ok = INTERVALS.get((form, mode)) == ivs
        else:
            form, mode = "badger", None
            ok = ivs == (-1,)
        out.append({"part": pname, "statement": sid, "form": form, "mode": mode, "pitches": pitches,
                    "starts": [round(x.start, 4) for x in ns], "ok": ok})
    return sorted(out, key=lambda s: (s["starts"][0], s["part"]))
