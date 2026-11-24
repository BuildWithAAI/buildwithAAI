"""Notification sounds: the ding, success, error and the DEVELOPING pulse.

Brand pitch (scripts/audio/music/DIRECTION.md): everything is in D. The ding uses the motif's
head, 1-1-5 (D-D-A, "ZOO and BAD-"), and its confident leap D up to A; success uses only D, G
and A (open, resolved, and consonant over every bed in the direction, major or minor); the error
falls a semitone, E-flat to D: the shape of Badger's "side-eye" figure, used here as a dry,
comedic "nope"; the DEVELOPING pulse is the tonic D at the show-bed tempo (90 BPM, 20 frames a
beat), the "ticker" of the DEVELOPING bumper.

Sources:
- ding: VCSL vibraphone, soft mallets (CC0), the same instrument as the music's noir colour.
  VCSL names use C3 = middle C, so the file labelled D4 sounds D5 (587 Hz) and A4 sounds A5
  (880 Hz): the D5-A5 chime needs no pitch shift. Each note is held 0.25 s then damped, so the
  ding is a notification, not a ring-out; a little of the shared air room; the fourth partial of
  A5 (3.5 kHz) is eased 3 dB so the ding stays soft on phone speakers.
- success: VCSL marimba (CC0), dry and short (damped after 60 ms).
- error: a band-limited pulse and saw (2x oversampled), low-passed at 1.6 kHz with a nasal bump
  at 650 Hz and a 28 Hz buzz flutter: present but small, never a game-show buzzer.
- DEVELOPING: a sine D4 with its octave and twelfth (D5 at -4 dB, A5 at -12 dB), a soft sonar-like
  bloom in the air room, and a tiny band-passed tick on the attack. Critic round 1: with only a
  -12 dB octave the body sat at D4 (294 Hz, under a phone speaker's range) and the blip lost
  4.6-6.2 dB on a phone, so the tick carried it; the partials keep the loss within 3 dB.
"""

from __future__ import annotations

import math

import numpy as np

from audiolib import synth
from audiolib.core import midi_to_hz, note_number

from .. import prims, space, vcsl
from ..core import FPS, FRAME, SYNTH_SOURCE, Sound

FAMILY = "Notifications: brand-pitched ding, success, error buzz, DEVELOPING pulse"

VIBES = "Idiophones/Struck Idiophones/Vibraphone/Soft Mallets/Vibes_soft_{label}_v2_rr1_Main.wav"
VIBES_LABELS = ["F2", "A2", "C3", "E3", "G3", "B3", "D4", "F4", "A4", "C5", "E5"]
MARIMBA = "Idiophones/Struck Idiophones/Marimba/Marimba_hit_Outrigger_{label}_{layer}_01.wav"
MARIMBA_LABELS = ["F1", "C2", "G2", "B2", "F3", "C4", "G4", "B4", "F5", "C6"]


def pick_root(labels: list, target_midi: int) -> tuple:
    """(label, semitone shift) for the sample whose SOUNDING pitch is nearest the target, preferring
    the one at or below it (a small upward shift keeps the mallet's attack natural)."""
    best = None
    for lab in labels:
        d = target_midi - vcsl.sounding_midi(lab)
        key = (0 if d >= 0 else 1, abs(d))
        if best is None or key < best[0]:
            best = (key, lab, d)
    return best[1], best[2]


def mallet_note(kind: str, note: str, layer: str = "med") -> tuple:
    target = note_number(note)
    if kind == "vibes":
        lab, d = pick_root(VIBES_LABELS, target)
        rel = VIBES.format(label=lab)
    else:
        lab, d = pick_root(MARIMBA_LABELS, target)
        rel = MARIMBA.format(label=lab, layer=layer)
    x = vcsl.shift(vcsl.load(rel, trim_db=-36.0, pre_ms=0.4), d)
    return x, rel, d


def damp(x: np.ndarray, hold_s: float, t60_s: float, length_s: float) -> np.ndarray:
    n = min(x.shape[1], prims.n_samples(length_s))
    t = prims.t_axis(n)
    env = np.exp(-prims.T60 * np.maximum(t - hold_s, 0.0) / t60_s)
    return x[:, :n] * env[None, :]


def narrow(st: np.ndarray, width: float) -> np.ndarray:
    m = 0.5 * (st[0] + st[1])
    s = 0.5 * (st[0] - st[1]) * width
    return np.vstack([m + s, m - s])


def ding(sid: str, notes: list, desc: str, shimmer: float = 0.0, tags=()) -> Sound:
    """notes: [(note, frame, gain)]."""
    length = max(f for _, f, _ in notes) / FPS + 1.6
    out = np.zeros((2, prims.n_samples(length)))
    sources, events = [], []
    for note, frame, gain in notes:
        x, rel, d = mallet_note("vibes", note)
        x = damp(x, 0.25, 0.75, 1.2)
        prims.place(out, narrow(x, 0.4) * gain, frame / FPS)
        sources.append(dict(vcsl.provenance(rel), pitchShiftSemitones=d, note=note))
        events.append({"t": frame / FPS, "kind": "note", "note": note})
    if shimmer > 0:  # a glassy sine an octave above the last note, for the UI sparkle
        note, frame, _ = notes[-1]
        f = float(midi_to_hz(note_number(note) + 12))
        n = prims.n_samples(0.9)
        s = prims.chirp(f, n) * prims.ar_env(n, 0.002, 0.6) * shimmer
        prims.place(out, prims.dual(s), frame / FPS)
    out = prims.eq(out, [{"kind": "peak", "f": 3500, "q": 2.0, "db": -3.0}])
    out = space.add_room(out, "air", -20.0)
    uniq = {s["path"]: s for s in sources}
    return Sound(id=sid, group="ding", category="notify", role="notify", audio=out, description=desc,
                 tags=["ding", "notification", "chime", "vibraphone", "brand", "tonal", *tags], events=events,
                 pitch="-".join(n for n, _, _ in notes), sources=list(uniq.values()) + ([SYNTH_SOURCE] if shimmer else []), hp_hz=180.0, lp_hz=12000.0)


def success(sid: str, notes: list, desc: str) -> Sound:
    """notes: [(note or [notes], frame, gain)] on dry marimba."""
    length = max(f for _, f, _ in notes) / FPS + 0.7
    out = np.zeros((2, prims.n_samples(length)))
    sources, events = {}, []
    for chord, frame, gain in notes:
        for note in (chord if isinstance(chord, list) else [chord]):
            x, rel, d = mallet_note("marimba", note, "med")
            x = damp(x, 0.06, 0.38, 0.6)
            prims.place(out, narrow(x, 0.0) * gain, frame / FPS)  # mid only: the stereo pair combs in mono
            sources[rel] = dict(vcsl.provenance(rel), pitchShiftSemitones=d)
        events.append({"t": frame / FPS, "kind": "note", "note": "+".join(chord) if isinstance(chord, list) else chord})
    out = space.add_room(out, "desk", -24.0)
    return Sound(id=sid, group="success", category="notify", role="notify", audio=out, description=desc,
                 tags=["success", "tada", "positive", "marimba", "tonal", "dry"], events=events,
                 pitch=" ".join(e["note"] for e in events), sources=list(sources.values()), hp_hz=150.0, lp_hz=11000.0)


def buzz_tone(f_start: float, f_end: float, dur: float, seed: str) -> np.ndarray:
    n = prims.n_samples(dur)
    t = prims.t_axis(n)
    f = f_start * (f_end / f_start) ** prims.smoothstep(t / dur)
    sq = synth.osc("square", f, n, pw=0.36, oversample=2)
    sw = synth.osc("saw", f * 1.003, n, oversample=2)
    x = 0.7 * sq + 0.35 * sw
    x = prims.lowpass(x, 1600.0, order=2)
    x = prims.eq(x, [{"kind": "peak", "f": 650, "q": 1.4, "db": 5.0}, {"kind": "highpass", "f": 110, "order": 2}])
    flutter = 1 + 0.14 * np.sin(2 * math.pi * 28 * t + 0.7)
    sag = 10 ** (-4.0 * (t / dur) / 20)  # sags 4 dB: a deflating "nope", not a flat tone
    env = prims.ar_env(n, 0.004, 10.0) * flutter * sag
    k = prims.n_samples(0.014)
    env[-k:] *= 0.5 + 0.5 * np.cos(math.pi * np.arange(1, k + 1) / k)
    return x * env


def error(sid: str, buzzes: list, desc: str) -> Sound:
    """buzzes: [(frame, note_from, note_to, dur_s, gain)]."""
    length = max(f / FPS + d for f, _, _, d, _ in buzzes) + 0.05
    n = prims.n_samples(length)
    mono = np.zeros(n)
    events = []
    for i, (frame, a, b, dur, gain) in enumerate(buzzes):
        x = buzz_tone(float(midi_to_hz(note_number(a))), float(midi_to_hz(note_number(b))), dur, f"{sid}-{i}") * gain
        k = frame * FRAME
        mono[k : k + x.size] += x[: n - k]
        events.append({"t": frame / FPS, "kind": "buzz", "note": a if a == b else f"{a}->{b}"})
    st = space.add_room(prims.dual(mono), "desk", -22.0)
    return Sound(id=sid, group="error", category="notify", role="notify", audio=st, description=desc,
                 tags=["error", "denied", "buzz", "wrong", "comedic", "nope"], events=events, sources=[SYNTH_SOURCE], hp_hz=100.0, lp_hz=9000.0)


DEVELOPING_OCTAVE_DB = -2.0  # D5 over a D4 pulse
DEVELOPING_TWELFTH_DB = -10.0  # A5


def pulse_voice(note: str, t60: float, octave_db: float = DEVELOPING_OCTAVE_DB, twelfth_db: float = DEVELOPING_TWELFTH_DB, tick_db: float = -24.0,
                seed: str = "p") -> np.ndarray:
    f = float(midi_to_hz(note_number(note)))
    n = prims.n_samples(t60 + 0.05)
    body = prims.chirp(f, n) * prims.ar_env(n, 0.004, t60)
    up = prims.chirp(2 * f, n) * prims.ar_env(n, 0.003, t60 * 0.7) * prims.db(octave_db)
    up = up + prims.chirp(3 * f, n) * prims.ar_env(n, 0.003, t60 * 0.45) * prims.db(twelfth_db)
    tick = prims.bandpass(prims.noise_burst(0.006, 0.003, seed + "-tick"), 900, 2800)
    tick = tick / max(np.max(np.abs(tick)), 1e-12) * prims.db(tick_db)
    x = body + up
    x[: tick.size] += tick
    return x


def developing(sid: str, hits: list, desc: str, room_db: float = -16.0) -> Sound:
    """hits: [(frame, note, t60, gain)]."""
    length = max(f / FPS + t for f, _, t, _ in hits) + 0.05
    n = prims.n_samples(length)
    mono = np.zeros(n)
    events = []
    for i, (frame, note, t60, gain) in enumerate(hits):
        x = pulse_voice(note, t60, seed=f"{sid}-{i}") * gain
        k = frame * FRAME
        mono[k : k + x.size] += x[: n - k]
        events.append({"t": frame / FPS, "kind": "pulse", "note": note})
    st = space.add_room(prims.dual(mono), "air", room_db)
    return Sound(id=sid, group="developing_pulse", category="notify", role="notify", audio=st, description=desc,
                 tags=["developing", "pulse", "news", "ticker", "tonal"], events=events, pitch=hits[0][1], sources=[SYNTH_SOURCE], hp_hz=120.0, lp_hz=10000.0)


def developing_loop(sid: str, accents: list, desc: str, beats: int = 4, frames_per_beat: int = 20, offset: int = 10) -> Sound:
    """A seamless loop of `beats` pulses at 90 BPM (20 frames a beat); the first pulse sits
    `offset` frames into the file so the loop seam falls between pulses."""
    frames = beats * frames_per_beat
    n = frames * FRAME
    mono = np.zeros(n)
    events = []
    for b in range(beats):
        note, t60, gain = accents[b % len(accents)]
        x = pulse_voice(note, t60, seed=f"{sid}-{b}") * gain
        k = (offset + b * frames_per_beat) * FRAME
        idx = (np.arange(x.size) + k) % n
        np.add.at(mono, idx, x)
        events.append({"t": (offset + b * frames_per_beat) / FPS, "kind": "beat", "note": note})
    wet = space.add_room(prims.dual(mono), "air", -16.0)
    st = wet[:, :n].copy()
    tail = wet[:, n:]
    k = 0
    while k < tail.shape[1]:
        m = min(n, tail.shape[1] - k)
        st[:, :m] += tail[:, k : k + m]
        k += m
    return Sound(id=sid, group="developing_loop", category="notify", role="notify", audio=st, description=desc,
                 tags=["developing", "pulse", "loop", "news", "ticker", "90bpm"], events=events, loop=True, sync="start", sync_s=0.0,
                 pitch="D", sources=[SYNTH_SOURCE], hp_hz=120.0, lp_hz=10000.0, extra={"bpm": 90, "loopFrames": frames, "firstBeatFrame": offset})


def render() -> list:
    out = [
        ding("ding_01", [("D5", 0, 0.85), ("A5", 3, 1.0)], "Notification ding: D5 then A5 a frame-locked 100 ms later (the motif's confident leap)."),
        ding("ding_02", [("A5", 0, 1.0)], "Single soft ding on A5 with a glassy octave shimmer.", shimmer=0.18),
        ding("ding_03", [("D5", 0, 0.8), ("D5", 2, 0.6), ("A5", 3, 1.0)], "Motif-head ding: D5 D5 A5 on frames 0, 2 and 3 ('ZOO and BAD-').", tags=["motif"]),
        ding("ding_04", [("A4", 0, 0.85), ("D5", 3, 1.0)], "Warmer, lower ding: A4 up to D5."),
        success("success_01", [("A4", 0, 0.8), ("D5", 3, 1.0)], "Small, dry 'ta-da': A4 then D5 (frames 0 and 3)."),
        success("success_02", [("D5", 0, 0.75), ("A5", 2, 0.85), ("D6", 4, 1.0)], "Quick rising D5-A5-D6 on marimba: done, sorted."),
        success("success_03", [("A4", 0, 0.6), (["D5", "A5"], 2, 1.0)], "A grace A4 into a D5+A5 dyad: a small, confident 'yes'."),
        success("success_04", [("G5", 0, 0.8), ("A5", 2, 0.85), ("D6", 4, 0.95)], "G5-A5-D6: a lighter, open success."),
        error("error_01", [(0, "Eb3", "Eb3", 0.11, 1.0), (5, "D3", "D3", 0.13, 0.95)], "Denied: two soft buzzes falling a semitone (Eb3 then D3), comedic but small."),
        error("error_02", [(0, "Eb3", "D3", 0.24, 1.0)], "A single falling 'bzzt' from Eb3 to D3."),
        error("error_03", [(0, "D3", "D3", 0.08, 1.0), (4, "D3", "D3", 0.08, 0.85)], "Two short, soft D3 buzzes: a quiet 'nope'."),
        error("error_04", [(0, "Eb3", "Eb3", 0.07, 1.0), (3, "D3", "D3", 0.07, 0.9), (6, "D3", "Db3", 0.12, 0.85)], "Three quick buzzes stepping down: 'nuh-uh-uh'."),
        developing("developing_pulse_01", [(0, "D4", 0.40, 1.0)], "DEVELOPING pulse: one soft tonal blip on D4 with a sonar-like bloom."),
        developing("developing_pulse_02", [(0, "D4", 0.30, 1.0), (4, "D4", 0.40, 0.7)], "DEVELOPING double pulse ('du-dum', frames 0 and 4)."),
        developing("developing_pulse_03", [(0, "D5", 0.45, 1.0)], "DEVELOPING pulse, higher and lighter (D5)."),
        developing("developing_pulse_04", [(0, "D4", 0.22, 1.0), (5, "D4", 0.22, 0.75), (10, "D4", 0.22, 0.6), (15, "D4", 0.30, 0.5)], "DEVELOPING ticker: four D4 pulses a sixteenth apart at 90 BPM (5 frames), fading."),
        developing_loop("developing_loop_01", [("D4", 0.40, 1.0), ("D4", 0.30, 0.55), ("D4", 0.30, 0.65), ("D4", 0.30, 0.55)], "Seamless DEVELOPING loop: a pulse on every beat at 90 BPM (beat 1 accented), first beat on frame 10."),
        developing_loop("developing_loop_02", [("D4", 0.40, 1.0), ("A4", 0.30, 0.45), ("D4", 0.30, 0.6), ("A4", 0.30, 0.45)], "Seamless DEVELOPING loop alternating D4 and a softer A4 at 90 BPM, first beat on frame 10."),
        developing_loop("developing_loop_03", [("D4", 0.45, 0.9), ("D4", 0.30, 0.45)], "Seamless, sparser DEVELOPING loop: two pulses per bar at 90 BPM (half-time feel), first beat on frame 10.", beats=2, frames_per_beat=40),
    ]
    return out

