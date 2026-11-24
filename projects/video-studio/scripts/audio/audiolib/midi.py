"""Scores in code: notes in beats, a tempo map, parts bound to instruments, and MIDI via mido.

    score = Score(bpm=96, time_sig=(4, 4))
    keys = score.part("keys", GM("Acoustic Grand Piano"))
    keys.chord(["D3", "F#3", "A3", "C#4"], start=0, dur=4, vel=72)
    keys.sustain(0, 3.9)
    score.save_midi("out/audio/demo.mid")

Times are in beats (quarter notes) from the start; `Score.seconds(beat)` converts through the
tempo map. Every MIDI export writes one tempo/time-signature track plus one track per part, at
960 ticks per beat (sub-millisecond resolution at any normal tempo).
"""

from __future__ import annotations

import bisect
from dataclasses import dataclass, field, replace
from typing import Any

from .core import note_number

TPB = 960

GM_PROGRAMS = [
    "Acoustic Grand Piano", "Bright Acoustic Piano", "Electric Grand Piano", "Honky-tonk Piano", "Electric Piano 1", "Electric Piano 2", "Harpsichord", "Clavinet",
    "Celesta", "Glockenspiel", "Music Box", "Vibraphone", "Marimba", "Xylophone", "Tubular Bells", "Dulcimer",
    "Drawbar Organ", "Percussive Organ", "Rock Organ", "Church Organ", "Reed Organ", "Accordion", "Harmonica", "Tango Accordion",
    "Acoustic Guitar (nylon)", "Acoustic Guitar (steel)", "Electric Guitar (jazz)", "Electric Guitar (clean)", "Electric Guitar (muted)", "Overdriven Guitar", "Distortion Guitar", "Guitar Harmonics",
    "Acoustic Bass", "Electric Bass (finger)", "Electric Bass (pick)", "Fretless Bass", "Slap Bass 1", "Slap Bass 2", "Synth Bass 1", "Synth Bass 2",
    "Violin", "Viola", "Cello", "Contrabass", "Tremolo Strings", "Pizzicato Strings", "Orchestral Harp", "Timpani",
    "String Ensemble 1", "String Ensemble 2", "Synth Strings 1", "Synth Strings 2", "Choir Aahs", "Voice Oohs", "Synth Voice", "Orchestra Hit",
    "Trumpet", "Trombone", "Tuba", "Muted Trumpet", "French Horn", "Brass Section", "Synth Brass 1", "Synth Brass 2",
    "Soprano Sax", "Alto Sax", "Tenor Sax", "Baritone Sax", "Oboe", "English Horn", "Bassoon", "Clarinet",
    "Piccolo", "Flute", "Recorder", "Pan Flute", "Blown Bottle", "Shakuhachi", "Whistle", "Ocarina",
    "Lead 1 (square)", "Lead 2 (sawtooth)", "Lead 3 (calliope)", "Lead 4 (chiff)", "Lead 5 (charang)", "Lead 6 (voice)", "Lead 7 (fifths)", "Lead 8 (bass + lead)",
    "Pad 1 (new age)", "Pad 2 (warm)", "Pad 3 (polysynth)", "Pad 4 (choir)", "Pad 5 (bowed)", "Pad 6 (metallic)", "Pad 7 (halo)", "Pad 8 (sweep)",
    "FX 1 (rain)", "FX 2 (soundtrack)", "FX 3 (crystal)", "FX 4 (atmosphere)", "FX 5 (brightness)", "FX 6 (goblins)", "FX 7 (echoes)", "FX 8 (sci-fi)",
    "Sitar", "Banjo", "Shamisen", "Koto", "Kalimba", "Bagpipe", "Fiddle", "Shanai",
    "Tinkle Bell", "Agogo", "Steel Drums", "Woodblock", "Taiko Drum", "Melodic Tom", "Synth Drum", "Reverse Cymbal",
    "Guitar Fret Noise", "Breath Noise", "Seashore", "Bird Tweet", "Telephone Ring", "Helicopter", "Applause", "Gunshot",
]

# General MIDI percussion key map (channel 10)
GM_DRUMS = {
    "kick2": 35, "kick": 36, "sidestick": 37, "snare": 38, "clap": 39, "snare2": 40, "tom_low2": 41, "hat_closed": 42,
    "tom_low": 43, "hat_pedal": 44, "tom_mid2": 45, "hat_open": 46, "tom_mid": 47, "tom_high2": 48, "crash": 49, "tom_high": 50,
    "ride": 51, "china": 52, "ride_bell": 53, "tambourine": 54, "splash": 55, "cowbell": 56, "crash2": 57, "vibraslap": 58,
    "ride2": 59, "bongo_high": 60, "bongo_low": 61, "conga_mute": 62, "conga_open": 63, "conga_low": 64, "timbale_high": 65, "timbale_low": 66,
    "agogo_high": 67, "agogo_low": 68, "cabasa": 69, "maracas": 70, "shaker": 70, "whistle_short": 71, "whistle_long": 72, "guiro_short": 73,
    "guiro_long": 74, "claves": 75, "woodblock_high": 76, "woodblock_low": 77, "cuica_mute": 78, "cuica_open": 79, "triangle_mute": 80, "triangle_open": 81,
}


def gm_program(name_or_number) -> int:
    if isinstance(name_or_number, int):
        if not 0 <= name_or_number <= 127:
            raise ValueError("GM program must be 0..127")
        return name_or_number
    key = str(name_or_number).strip().lower()
    for i, n in enumerate(GM_PROGRAMS):
        if n.lower() == key:
            return i
    matches = [i for i, n in enumerate(GM_PROGRAMS) if key in n.lower()]
    if len(matches) == 1:
        return matches[0]
    raise ValueError(f"unknown or ambiguous GM program {name_or_number!r}" + (f" (matches {[GM_PROGRAMS[i] for i in matches]})" if matches else ""))


def drum_key(name_or_number) -> int:
    if isinstance(name_or_number, int):
        return name_or_number
    try:
        return GM_DRUMS[str(name_or_number)]
    except KeyError:
        raise ValueError(f"unknown drum {name_or_number!r}; known: {sorted(GM_DRUMS)}") from None


@dataclass(frozen=True)
class GM:
    """A soundfont preset rendered by fluidsynth. `soundfont` is a key of paths.SOUNDFONTS."""

    program: Any = 0
    bank: int = 0
    soundfont: str = "musescore"
    drums: bool = False

    @property
    def program_number(self) -> int:
        return 0 if self.drums and self.program in (0, None) else gm_program(self.program)


@dataclass
class Note:
    pitch: int
    start: float  # beats
    dur: float  # beats
    vel: int = 90
    meta: dict = field(default_factory=dict)

    @property
    def end(self) -> float:
        return self.start + self.dur


@dataclass
class Part:
    name: str
    instrument: Any = None
    notes: list = field(default_factory=list)
    ccs: list = field(default_factory=list)  # (beat, controller, value)
    bends: list = field(default_factory=list)  # (beat, value -8192..8191)

    def note(self, pitch, start: float, dur: float, vel: int = 90, **meta) -> Note:
        p = drum_key(pitch) if isinstance(self.instrument, GM) and self.instrument.drums and isinstance(pitch, str) and pitch in GM_DRUMS else note_number(pitch)
        if dur <= 0:
            raise ValueError(f"{self.name}: note duration must be positive")
        if start < 0:
            raise ValueError(f"{self.name}: note start must be >= 0")
        n = Note(p, float(start), float(dur), int(max(1, min(127, vel))), dict(meta))
        self.notes.append(n)
        return n

    def hit(self, drum, start: float, vel: int = 100, dur: float = 0.25, **meta) -> Note:
        """A drum hit by GM name ('kick', 'snare', 'hat_closed', ...) or key number."""
        n = Note(drum_key(drum), float(start), float(dur), int(max(1, min(127, vel))), dict(meta))
        self.notes.append(n)
        return n

    def chord(self, pitches, start: float, dur: float, vel: int = 80, strum: float = 0.0, **meta) -> list:
        """Notes together; `strum` (beats) staggers them low to high (a rolled chord)."""
        ps = sorted(note_number(p) for p in pitches)
        return [self.note(p, start + i * strum, max(1e-3, dur - i * strum), vel, **meta) for i, p in enumerate(ps)]

    def cc(self, controller: int, value: int, at: float) -> None:
        if not (0 <= controller <= 127 and 0 <= value <= 127):
            raise ValueError("CC numbers and values are 0..127")
        self.ccs.append((float(at), int(controller), int(value)))

    def sustain(self, down: float, up: float) -> None:
        """Sustain pedal (CC64) down at `down`, up at `up` (beats)."""
        if up <= down:
            raise ValueError("pedal up must come after pedal down")
        self.cc(64, 127, down)
        self.cc(64, 0, up)

    def bend(self, value: int, at: float) -> None:
        self.bends.append((float(at), int(max(-8192, min(8191, value)))))

    def pedal_intervals(self) -> list:
        """[(down_beat, up_beat)] from the CC64 events (value >= 64 is down)."""
        out = []
        down = None
        for beat, c, v in sorted(self.ccs):
            if c != 64:
                continue
            if v >= 64 and down is None:
                down = beat
            elif v < 64 and down is not None:
                out.append((down, beat))
                down = None
        if down is not None:
            out.append((down, float("inf")))
        return out

    def end_beat(self) -> float:
        ends = [n.end for n in self.notes] + [b for b, _, _ in self.ccs]
        return max(ends) if ends else 0.0

    def copy(self, name: str | None = None) -> "Part":
        return Part(name or self.name, self.instrument, [replace(n, meta=dict(n.meta)) for n in self.notes], list(self.ccs), list(self.bends))


class Score:
    def __init__(self, bpm: float = 120.0, time_sig=(4, 4), tempo_changes=None, key: str | None = None):
        """tempo_changes: [(beat, bpm), ...] after the initial `bpm` at beat 0 (step changes)."""
        self.time_sig = (int(time_sig[0]), int(time_sig[1]))
        self.key = key
        changes = [(0.0, float(bpm))] + [(float(b), float(t)) for b, t in (tempo_changes or [])]
        changes.sort()
        if any(t <= 0 for _, t in changes):
            raise ValueError("tempo must be positive")
        self._beats = [b for b, _ in changes]
        self._bpm = [t for _, t in changes]
        self._secs = [0.0]
        for i in range(1, len(changes)):
            self._secs.append(self._secs[-1] + (self._beats[i] - self._beats[i - 1]) * 60.0 / self._bpm[i - 1])
        self.parts: dict[str, Part] = {}

    # -- time
    @property
    def beats_per_bar(self) -> float:
        return self.time_sig[0] * 4.0 / self.time_sig[1]

    def bar(self, n: float) -> float:
        """Beat at which bar n (0-based) starts."""
        return n * self.beats_per_bar

    def bpm_at(self, beat: float) -> float:
        return self._bpm[max(0, bisect.bisect_right(self._beats, beat) - 1)]

    def seconds(self, beat: float) -> float:
        i = max(0, bisect.bisect_right(self._beats, beat) - 1)
        return self._secs[i] + (beat - self._beats[i]) * 60.0 / self._bpm[i]

    def beat_at(self, seconds: float) -> float:
        i = max(0, bisect.bisect_right(self._secs, seconds) - 1)
        return self._beats[i] + (seconds - self._secs[i]) * self._bpm[i] / 60.0

    def ms_to_beats(self, ms: float, at_beat: float) -> float:
        return ms / 1000.0 * self.bpm_at(at_beat) / 60.0

    # -- parts
    def part(self, name: str, instrument=None) -> Part:
        if name in self.parts:
            raise ValueError(f"part {name!r} exists")
        p = Part(name, instrument)
        self.parts[name] = p
        return p

    def end_beat(self) -> float:
        return max((p.end_beat() for p in self.parts.values()), default=0.0)

    def length_seconds(self) -> float:
        return self.seconds(self.end_beat())

    # -- MIDI
    def to_midi(self, parts=None, tail_seconds: float = 0.0):
        """mido.MidiFile type 1: track 0 = tempo map + time signature (+ key), one track per part.
        GM parts get bank select + program change; drum parts use channel 10 (index 9).
        `tail_seconds` extends every track (end_of_track) so renderers keep release tails."""
        import mido

        names = list(self.parts) if parts is None else list(parts)
        mf = mido.MidiFile(type=1, ticks_per_beat=TPB)
        t0 = mido.MidiTrack()
        mf.tracks.append(t0)
        meta = [(0, mido.MetaMessage("time_signature", numerator=self.time_sig[0], denominator=self.time_sig[1], time=0))]
        if self.key:
            meta.append((0, mido.MetaMessage("key_signature", key=self.key, time=0)))
        for b, bpm in zip(self._beats, self._bpm):
            meta.append((self._tick(b), mido.MetaMessage("set_tempo", tempo=mido.bpm2tempo(bpm), time=0)))
        end_tick = self._tick(self.beat_at(self.seconds(self.end_beat()) + tail_seconds))
        _write_track(t0, meta, end_tick)
        melodic_ch = 0
        for name in names:
            part = self.parts[name]
            inst = part.instrument
            drums = isinstance(inst, GM) and inst.drums
            if drums:
                ch = 9
            else:
                ch = melodic_ch
                melodic_ch += 1
                if melodic_ch == 9:
                    melodic_ch = 10
                if ch > 15:
                    raise ValueError("more than 15 melodic parts in one MIDI file")
            tr = mido.MidiTrack()
            tr.append(mido.MetaMessage("track_name", name=name, time=0))
            evs = []
            if isinstance(inst, GM):
                evs.append((0, 0, mido.Message("control_change", channel=ch, control=0, value=inst.bank & 127)))
                evs.append((0, 0, mido.Message("control_change", channel=ch, control=32, value=0)))
                evs.append((0, 1, mido.Message("program_change", channel=ch, program=inst.program_number)))
            for beat, c, v in part.ccs:
                evs.append((self._tick(beat), 2, mido.Message("control_change", channel=ch, control=c, value=v)))
            for beat, v in part.bends:
                evs.append((self._tick(beat), 2, mido.Message("pitchwheel", channel=ch, pitch=v)))
            for n, on, off in _note_ticks(part.notes, self._tick):
                # order key: at equal ticks note-offs (3) come before note-ons (4), so repeated
                # notes retrigger instead of being cut by their own previous note-off
                evs.append((off, 3, mido.Message("note_off", channel=ch, note=n.pitch, velocity=0)))
                evs.append((on, 4, mido.Message("note_on", channel=ch, note=n.pitch, velocity=n.vel)))
            evs.sort(key=lambda e: (e[0], e[1]))
            _write_track(tr, [(t, m) for t, _, m in evs], end_tick)
            mf.tracks.append(tr)
        return mf

    def save_midi(self, path, parts=None, tail_seconds: float = 0.0):
        from pathlib import Path

        p = Path(path)
        p.parent.mkdir(parents=True, exist_ok=True)
        self.to_midi(parts, tail_seconds).save(str(p))
        return p

    def _tick(self, beat: float) -> int:
        return int(round(beat * TPB))


def _note_ticks(notes, tick):
    """(note, on_tick, off_tick) with same-pitch overlaps resolved: a note that starts before the
    previous note on the same key has ended cuts that previous note at its own start (a piano
    re-strikes the key; MIDI would otherwise end the new note at the old note-off)."""
    order = sorted(notes, key=lambda n: (n.start, n.pitch))
    spans = [[n, tick(n.start), max(tick(n.start) + 1, tick(n.end))] for n in order]
    last = {}
    for s in spans:
        p = s[0].pitch
        if p in last:
            prev = last[p]
            if prev[2] > s[1]:
                prev[2] = max(prev[1] + 1, s[1])
        last[p] = s
    return [tuple(s) for s in spans]


def _write_track(track, timed, end_tick: int) -> None:
    import mido

    now = 0
    for tick, msg in sorted(timed, key=lambda e: e[0]) if not _is_sorted(timed) else timed:
        track.append(msg.copy(time=max(0, tick - now)))
        now = max(now, tick)
    track.append(mido.MetaMessage("end_of_track", time=max(0, end_tick - now)))


def _is_sorted(timed) -> bool:
    return all(timed[i][0] <= timed[i + 1][0] for i in range(len(timed) - 1))
