"""Per-key tuning of the soundfont string sections, and the MIDI Tuning Standard messages that correct it.

Critic round 2 measured the MuseScore_General VSCO 2 strings against the MIDI: the celli pizzicato
read +8 to +16 cents on Badger's E-flat 3 and D3, the violas pizzicato -25 to -30 cents on D4 (the
motif's tonic) and +33 cents on G4, the basses pizzicato +14 to +36 cents. The samples are real
players' intonation, and each key of a VSCO preset layers two recordings (soft and loud, cross-faded
by velocity), so the error depends on the key and a little on the velocity. A pitch bend cannot fix
that (one value per channel); the MIDI Tuning Standard can: a real-time single-note tuning change
(SysEx F0 7F 7F 08 02 ...) gives every key its own pitch, and RPN 3 selects that tuning program on
the channel. fluidsynth 2.3 honours both from a MIDI file (measured: a -30 cent entry moved D4 from
-1.1 to -31.2 cents; without the RPN it was ignored).

The measurement: each (preset, key, velocity bucket) rendered alone by fluidsynth with the pinned
soundfont, then the strongest of partials 1-4 within +-60 cents of k*f (parabolic interpolation) over
a window that suits the articulation (a pizzicato is heard in its first 300 ms, a slow bow after its
attack). The results live in gm_tuning.json next to this file (keyed by the soundfont's sha256), so
builds are repeatable; missing entries are measured on first use and added.

`corrections(gm, notes)` gives the cents to apply per key for a part (the median over its notes of
each key's error at their velocity buckets, negated); `mts_messages()` the MIDI messages."""

from __future__ import annotations

import json
import math
import tempfile
import threading
from pathlib import Path

import numpy as np

from audiolib import fluid, paths
from audiolib.core import SR

TABLE = Path(__file__).with_name("gm_tuning.json")
SCHEMA = 1
VEL_STEP = 16
MIN_CORRECTION_CENTS = 1.0  # smaller errors are left alone
MAX_CORRECTION_CENTS = 60.0  # a larger "error" is a measurement problem, not intonation: refuse it
TUNING_PROGRAM = 0
SPACING_S = 2.5
FLUID_OFFSET = 70  # samples: where fluidsynth 2.3 puts a note-on at time 0 (audiolib/fluid.py)

# per GM program (VSCO 2 articulation): (note length s, measurement window from the onset s)
ARTICULATION = {45: (0.6, (0.03, 0.30)),   # pizzicato: what is heard is the pluck's first 300 ms
                48: (0.5, (0.04, 0.32)),   # fast bowing
                44: (1.2, (0.10, 0.70)),   # tremolo
                49: (1.8, (0.30, 1.30))}   # slow bowing (its attack is soft)
DEFAULT_ARTICULATION = (1.2, (0.10, 0.70))
EXPRESSIVE_CC2 = 96  # dynamics of the CC2 ("Expr.") banks while measuring

_LOCK = threading.Lock()


def vel_bucket(vel: int) -> int:
    """Velocity buckets of VEL_STEP (16, 32, ... 112, 127): VSCO cross-fades its two layers by velocity."""
    return int(min(127, max(VEL_STEP, round(vel / VEL_STEP) * VEL_STEP)))


def preset_key(gm) -> str:
    return f"{gm.bank}:{gm.program_number}"


def expressive(gm) -> bool:
    """The CC2 banks (composer.instruments.strings(expressive=True)): 17 and 21, 26, 31, 41, 51."""
    return gm.bank == 17 or gm.bank % 10 in (1, 6)


def _soundfont(gm):
    return paths.soundfont(gm.soundfont)


def _load() -> dict:
    if TABLE.exists():
        doc = json.loads(TABLE.read_text(encoding="utf-8"))
        if doc.get("schema") == SCHEMA:
            return doc
    return {"schema": SCHEMA, "about": "Measured tuning error (cents) of soundfont presets as fluidsynth renders them, per key and "
            "velocity bucket: composer/gmtune.py. Re-measure with `python3 scripts/audio/music/build.py --retune`.",
            "method": {"partials": [1, 2, 3, 4], "searchCents": 60, "velStep": VEL_STEP, "articulationWindowsS": {str(k): v[1] for k, v in ARTICULATION.items()},
                       "expressiveCc2": EXPRESSIVE_CC2, "sampleRate": SR},
            "soundfonts": {}}


def _save(doc: dict) -> None:
    TABLE.write_text(json.dumps(doc, indent=1, sort_keys=True) + "\n", encoding="utf-8")


def cents_of(seg: np.ndarray, key: int):
    """(cents, partial) of a note: the strongest of partials 1-4 within +-60 cents of k*f."""
    n = 1 << int(np.ceil(np.log2(SR / 0.05)))
    spec = np.abs(np.fft.rfft(seg * np.hanning(seg.size), n))
    f = np.fft.rfftfreq(n, 1 / SR)
    f0 = 440.0 * 2 ** ((key - 69) / 12)
    best = None
    for k in (1, 2, 3, 4):
        fc = k * f0
        a, b = int(np.searchsorted(f, fc * 2 ** (-60 / 1200))), int(np.searchsorted(f, fc * 2 ** (60 / 1200)))
        if b - a < 3 or b >= spec.size - 1:
            continue
        j = a + int(np.argmax(spec[a:b]))
        y0, y1, y2 = 20 * np.log10(spec[j - 1: j + 2] + 1e-20)
        d = y0 - 2 * y1 + y2
        p = 0.5 * (y0 - y2) / d if d != 0 else 0.0
        fp = (j + p) * (f[1] - f[0])
        if best is None or spec[j] > best[0]:
            best = (spec[j], 1200 * math.log2(fp / fc), k)
    return None if best is None else (best[1], best[2])


def measure(gm, pairs) -> dict:
    """{(key, vel): cents} for each (key, velocity) of a GM preset, rendered alone by fluidsynth."""
    import mido

    from audiolib.io import read

    pairs = sorted(set((int(k), int(v)) for k, v in pairs))
    if not pairs:
        return {}
    dur, window = ARTICULATION.get(gm.program_number, DEFAULT_ARTICULATION)
    mf = mido.MidiFile(type=1, ticks_per_beat=960)
    t0 = mido.MidiTrack()
    mf.tracks.append(t0)
    t0.append(mido.MetaMessage("set_tempo", tempo=1_000_000, time=0))  # 60 BPM: a beat is a second
    t0.append(mido.MetaMessage("end_of_track", time=int((len(pairs) * SPACING_S + 2.0) * 960)))
    tr = mido.MidiTrack()
    mf.tracks.append(tr)
    ev = [(0, 0, mido.Message("control_change", channel=0, control=0, value=gm.bank & 127)),
          (0, 0, mido.Message("control_change", channel=0, control=32, value=0)),
          (0, 1, mido.Message("program_change", channel=0, program=gm.program_number))]
    if expressive(gm):
        ev.append((0, 2, mido.Message("control_change", channel=0, control=2, value=EXPRESSIVE_CC2)))
    for i, (k, v) in enumerate(pairs):
        on = int(round((0.5 + i * SPACING_S) * 960))
        ev.append((on, 4, mido.Message("note_on", channel=0, note=k, velocity=v)))
        ev.append((on + int(dur * 960), 3, mido.Message("note_off", channel=0, note=k, velocity=0)))
    ev.sort(key=lambda e: (e[0], e[1]))
    now = 0
    for t, _, m in ev:
        tr.append(m.copy(time=t - now))
        now = t
    tr.append(mido.MetaMessage("end_of_track", time=960))
    with tempfile.TemporaryDirectory() as d:
        mid, wav = Path(d) / "tune.mid", Path(d) / "tune.wav"
        mf.save(str(mid))
        fluid.render_midi(mid, _soundfont(gm).path, wav)
        mono = read(wav, sr=SR).mean(axis=0)
    out = {}
    for i, (k, v) in enumerate(pairs):
        s0 = int(round((0.5 + i * SPACING_S) * SR)) + FLUID_OFFSET
        seg = mono[s0 + int(window[0] * SR): s0 + int(window[1] * SR)]
        r = cents_of(seg, k) if seg.size and np.sqrt(np.mean(seg ** 2)) > 1e-6 else None
        out[(k, v)] = None if r is None else round(float(r[0]), 2)
    return out


def errors(gm, pairs, save: bool = True) -> dict:
    """{(key, vel_bucket): cents or None} from the table, measuring (and saving) missing entries."""
    pairs = sorted(set((int(k), vel_bucket(v)) for k, v in pairs))
    with _LOCK:
        doc = _load()
        sf = _soundfont(gm)
        table = doc["soundfonts"].setdefault(sf.sha256[:16], {"key": sf.key, "package": sf.package}).setdefault("presets", {}).setdefault(preset_key(gm), {})
        missing = [(k, v) for k, v in pairs if f"{k}:{v}" not in table]
        if missing:
            for (k, v), c in measure(gm, missing).items():
                table[f"{k}:{v}"] = c
            if save:
                _save(doc)
        return {(k, v): table.get(f"{k}:{v}") for k, v in pairs}


def corrections(gm, notes, save: bool = True) -> dict:
    """{key: cents to add} for a part's notes on a GM preset: minus the median measured error of each
    key over its notes' velocity buckets; errors under MIN_CORRECTION_CENTS are left alone. `save`:
    add newly measured entries to gm_tuning.json."""
    if getattr(gm, "drums", False) or not notes:
        return {}
    err = errors(gm, [(n.pitch, n.vel) for n in notes], save=save)
    per_key = {}
    for n in notes:
        e = err.get((n.pitch, vel_bucket(n.vel)))
        if e is not None:
            per_key.setdefault(n.pitch, []).append(e)
    out = {}
    for k, es in sorted(per_key.items()):
        c = -float(np.median(es))
        if abs(c) > MAX_CORRECTION_CENTS:
            raise ValueError(f"{preset_key(gm)} key {k}: measured {-c:+.1f} cents; check the measurement before correcting it")
        if abs(c) >= MIN_CORRECTION_CENTS:
            out[int(k)] = round(c, 1)
    return out


def mts_data(key: int, cents: float) -> list:
    """[key, semitone, fraction MSB, fraction LSB] of a MIDI Tuning Standard note entry: `key` sounds
    `cents` away from equal temperament (fraction in 100/16384-cent steps)."""
    semis = key + cents / 100.0
    xx = int(math.floor(semis))
    v = int(round((semis - xx) * 16384))
    if v >= 16384:
        xx, v = xx + 1, 0
    if not 0 <= xx <= 127:
        raise ValueError(f"key {key} {cents:+.1f} cents is outside the MIDI range")
    if (xx, v >> 7, v & 0x7F) == (0x7F, 0x7F, 0x7F):  # the "no change" code
        v -= 1
    return [int(key), xx, (v >> 7) & 0x7F, v & 0x7F]


def mts_messages(tuning: dict, channel: int = 0, program: int = TUNING_PROGRAM) -> list:
    """mido messages (all at delta time 0): the real-time single-note tuning changes for `tuning`
    ({key: cents}), then RPN 3 (tuning program select) on `channel`, then the null RPN."""
    import mido

    if not tuning:
        return []
    items = sorted(tuning.items())
    msgs = []
    for i in range(0, len(items), 32):
        chunk = items[i: i + 32]
        data = [0x7F, 0x7F, 0x08, 0x02, program & 0x7F, len(chunk)]
        for k, c in chunk:
            data += mts_data(k, c)
        msgs.append(mido.Message("sysex", data=data, time=0))
    for cc, val in ((101, 0), (100, 3), (6, program & 0x7F), (38, 0), (101, 127), (100, 127)):
        msgs.append(mido.Message("control_change", channel=channel, control=cc, value=val, time=0))
    return msgs


def render_part(score, name: str, length: float, tuning: dict, tail: float = 3.0, gain: float = fluid.DEFAULT_GAIN, workdir=None) -> np.ndarray:
    """audiolib.fluid.render_part with the MIDI Tuning Standard messages for `tuning` inserted after
    the part's program change (the stem is otherwise identical)."""
    import shutil

    from audiolib.core import as_stereo, pad_to
    from audiolib.io import read

    part = score.parts[name]
    sf = paths.soundfont(part.instrument.soundfont)
    tmp = Path(workdir) if workdir else Path(tempfile.mkdtemp(prefix="fluid-"))
    tmp.mkdir(parents=True, exist_ok=True)
    try:
        mf = score.to_midi(parts=[name], tail_seconds=tail)
        track = mf.tracks[1]
        at = next((i + 1 for i, m in enumerate(track) if m.type == "program_change"), 1)
        ch = next((m.channel for m in track if m.type == "program_change"), 0)
        for j, m in enumerate(mts_messages(tuning, ch)):
            track.insert(at + j, m)
        mid = tmp / f"{name}.mid"
        mf.save(str(mid))
        wav = fluid.render_midi(mid, sf.path, tmp / f"{name}.wav", gain=gain)
        audio = as_stereo(read(wav, sr=SR))
    finally:
        if not workdir:
            shutil.rmtree(tmp, ignore_errors=True)
    return pad_to(audio, int(round(length * SR)))
