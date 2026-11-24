"""Our own synthesised voices (the "tech edge" and the glue). Each class has
`render(part, score, length) -> (2, n) stereo audio`, like the engine's PluckString, so it can be a
Track source. Everything is seeded and deterministic.

    TineEP      FM tine electric piano: 1:1 body pair + a fast 14:1 "tine" pair, velocity-dependent
                bark, two-stage decay, felt damper release, stereo tremolo (computed at 2x, decimated)
    Pad         warm analog pad (the engine's supersaw_pad through a slow ladder low-pass)
    Pulse       plucky pulse/saw arpeggiator voice with a per-note filter envelope (SVF)
    BrassStab   detuned saw stack with a fast filter envelope and saturation (late-night hits)
    Sub         sine sub bass with glide (engine sub_bass)
    SynthKick   tuned kick per hit (engine kick), velocity-scaled
    MutedGuitar plucked-string model voiced as a palm-muted electric guitar
Audio helpers (not Part-based): reverse_swell, noise_swell, place.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

import numpy as np

from audiolib import dsp, synth
from audiolib.core import SR, midi_to_hz, rng
from audiolib.reverb import PRESETS as ROOMS
from audiolib.reverb import convolve, impulse_response


def _events(part, score):
    return [(n.pitch, score.seconds(n.start), score.seconds(n.end), n.vel) for n in part.notes]


def _pedal(part, score):
    return [(score.seconds(d), score.seconds(u) if math.isfinite(u) else float("inf")) for d, u in part.pedal_intervals()]


def _held_until(end_s: float, pedal) -> float:
    for d, u in pedal:
        if d <= end_s < u:
            return u
    return end_s


# ------------------------------------------------------------------------------------------ electric piano

@dataclass
class TineEP:
    """FM tine electric piano. brightness scales the bark (FM index), decay_s is T60 at C4."""

    brightness: float = 1.0
    decay_s: float = 5.5
    release_s: float = 0.22
    tremolo_hz: float = 4.2
    tremolo_depth: float = 0.18
    drive_db: float = 3.0
    detune_cents: float = 3.0
    seed: str = "tine"

    def note(self, midi: int, dur: float, vel: int, sr: int = SR) -> np.ndarray:
        os_ = 2
        fs = sr * os_
        f0 = float(midi_to_hz(midi))
        v = max(1, vel) / 127.0
        rel = self.release_s
        n = int((dur + rel * 1.6 + 0.01) * fs)
        t = np.arange(n) / fs
        g = rng(self.seed, midi, round(dur, 3), vel)
        ph = g.random(4) * 2 * math.pi
        # pitch-dependent decay: low notes ring longer
        t60 = self.decay_s * 2 ** (-(midi - 60) / 24.0)
        # body pair (1:1), index falls from bark to a warm sustain
        i_body = self.brightness * (0.35 + 2.0 * v**1.6) * np.exp(-t / (0.18 + 0.25 * (1 - v))) + 0.22 * self.brightness
        det = 2 ** (self.detune_cents / 1200.0)
        body = np.sin(2 * math.pi * f0 * t + i_body * np.sin(2 * math.pi * f0 * t + ph[0]) + ph[1])
        body2 = np.sin(2 * math.pi * f0 * det * t + 0.8 * i_body * np.sin(2 * math.pi * f0 * det * t + ph[2]))
        # tine pair: a bright metallic attack that dies in tens of ms
        mod_hz = 14.0 * f0
        tine_amp = 0.0 if mod_hz > fs * 0.2 else 1.0
        i_tine = (0.6 + 2.4 * v) * np.exp(-t / 0.018)
        tine = tine_amp * np.sin(2 * math.pi * f0 * t + i_tine * np.sin(2 * math.pi * mod_hz * t + ph[3])) * np.exp(-t / 0.22) * (0.15 + 0.35 * v)
        x = 0.62 * body + 0.38 * body2 + tine
        # amplitude: 1.5 ms attack, a fast first decay (-5 dB) then the long ring, felt damper at note-off
        att = np.minimum(1.0, t / 0.0015)
        amp = (0.56 * np.exp(-t / 0.35) + 0.44) * np.exp(-6.907755 * t / t60)
        off = int(dur * fs)
        if off < n:
            k = np.arange(n - off)
            amp[off:] *= np.exp(-6.907755 * k / max(1.0, rel * fs))
        y = x * att * amp * (v ** 1.15)
        y[-int(0.003 * fs):] *= np.linspace(1, 0, int(0.003 * fs))
        return dsp.downsample(y[np.newaxis, :], os_)[0, : int(n / os_)]

    def render(self, part, score, length: float, sr: int = SR) -> np.ndarray:
        n = int(round(length * sr))
        out = np.zeros(n)
        pedal = _pedal(part, score)
        for midi, start, end, vel in _events(part, score):
            held = _held_until(end, pedal) - start
            s0 = int(round(start * sr))
            if s0 >= n:
                continue
            y = self.note(midi, max(0.03, held), vel, sr)
            k = min(n - s0, y.shape[0])
            out[s0 : s0 + k] += y[:k]
        out = dsp.saturate(out, self.drive_db, "asym", bias=0.12)[0] if self.drive_db > 0 else out
        # stereo tremolo (suitcase-style auto-pan): opposite phase per side
        lfo = synth.lfo(n, self.tremolo_hz, "sine", self.tremolo_depth, sr=sr, seed=self.seed)
        return np.vstack([out * (1 + lfo), out * (1 - lfo)]) * 0.5


# ------------------------------------------------------------------------------------------ pad

@dataclass
class Pad:
    """Warm analog pad: the engine's supersaw_pad (7 detuned saws + sub sine per note) through a slow
    ladder low-pass. Low cutoffs (700-1600 Hz) keep it out of the voice's 1-4 kHz pocket."""

    attack: float = 1.2
    release: float = 2.4
    cutoff: float = 1200.0
    cutoff_lfo: float = 0.3
    lfo_rate: float = 0.05
    detune_cents: float = 11.0
    voices: int = 5
    seed: str = "pad"

    def render(self, part, score, length: float, sr: int = SR) -> np.ndarray:
        notes = [(m, s, max(0.05, e - s), (v / 127.0) ** 1.2) for m, s, e, v in _events(part, score)]
        if not notes:
            return np.zeros((2, int(round(length * sr))))
        return synth.supersaw_pad(notes, length, sr, self.attack, self.release, self.cutoff, self.cutoff_lfo, self.lfo_rate,
                                  self.detune_cents, self.voices, seed=self.seed)


# ------------------------------------------------------------------------------------------ pulse

@dataclass
class Pulse:
    """A plucky analog pulse for ostinatos: pulse + saw, a per-note low-pass envelope, short decay.
    Stereo: alternating notes nudged left/right by `spread`."""

    pw: float = 0.32
    saw_mix: float = 0.35
    cutoff_lo: float = 260.0
    cutoff_hi: float = 2600.0
    env_decay: float = 0.09
    amp_decay: float = 0.22
    sustain: float = 0.12
    release: float = 0.06
    q: float = 1.1
    spread: float = 0.25
    seed: str = "pulse"

    def note(self, midi: int, dur: float, vel: int, sr: int = SR) -> np.ndarray:
        f = float(midi_to_hz(midi))
        n = int((dur + self.release * 3 + 0.01) * sr)
        t = np.arange(n) / sr
        g = rng(self.seed, midi, round(dur, 3))
        x = (1 - self.saw_mix) * synth.osc("square", f, n, sr, phase0=float(g.random()), pw=self.pw, oversample=2) \
            + self.saw_mix * synth.osc("saw", f, n, sr, phase0=float(g.random()), oversample=2)
        v = max(1, vel) / 127.0
        fc = self.cutoff_lo + (self.cutoff_hi * (0.4 + 0.6 * v) - self.cutoff_lo) * np.exp(-t / self.env_decay)
        y = synth.svf(x, fc, self.q, "lowpass", sr)
        gate = int(dur * sr)
        env = synth.adsr(n, gate, 0.001, self.amp_decay, self.sustain, self.release, sr)
        return y * env * v

    def render(self, part, score, length: float, sr: int = SR) -> np.ndarray:
        n = int(round(length * sr))
        out = np.zeros((2, n))
        for i, (midi, start, end, vel) in enumerate(sorted(_events(part, score), key=lambda e: e[1])):
            s0 = int(round(start * sr))
            if s0 >= n:
                continue
            y = self.note(midi, max(0.02, end - start), vel, sr)
            k = min(n - s0, y.shape[0])
            p = self.spread * (1 if i % 2 else -1)
            th = (p + 1) * math.pi / 4
            out[0, s0 : s0 + k] += y[:k] * math.cos(th) * math.sqrt(2)
            out[1, s0 : s0 + k] += y[:k] * math.sin(th) * math.sqrt(2)
        return out * 0.5


# ------------------------------------------------------------------------------------------ brass stab

@dataclass
class BrassStab:
    """Synth brass for late-night hits: 4 detuned saws per note (2x oversampled), a fast filter
    envelope (the "blat"), soft saturation. Use short chords; it is a stab, not a lead."""

    detune_cents: float = 9.0
    cutoff_lo: float = 500.0
    cutoff_hi: float = 3800.0
    env_attack: float = 0.018
    env_decay: float = 0.16
    release: float = 0.12
    drive_db: float = 6.0
    seed: str = "brass"

    def note(self, midi: int, dur: float, vel: int, sr: int = SR) -> np.ndarray:
        f = float(midi_to_hz(midi))
        n = int((dur + self.release * 3 + 0.02) * sr)
        t = np.arange(n) / sr
        g = rng(self.seed, midi, round(dur, 3))
        x = np.zeros(n)
        for k in range(4):
            c = (k - 1.5) / 1.5 * self.detune_cents
            x += synth.osc("saw", f * 2 ** (c / 1200), n, sr, phase0=float(g.random()), oversample=2)
        x /= 4
        v = max(1, vel) / 127.0
        rise = np.minimum(1.0, t / self.env_attack)
        fc = self.cutoff_lo + (self.cutoff_hi * (0.5 + 0.5 * v) - self.cutoff_lo) * rise * np.exp(-np.maximum(0, t - self.env_attack) / self.env_decay)
        fc = np.maximum(fc, self.cutoff_lo * (1 + 0.6 * v))
        y = synth.svf(x, fc, 0.9, "lowpass", sr)
        env = synth.adsr(n, int(dur * sr), 0.012, 0.12, 0.7, self.release, sr, attack_curve=2.0)
        return y * env * v

    def render(self, part, score, length: float, sr: int = SR) -> np.ndarray:
        n = int(round(length * sr))
        out = np.zeros(n)
        for midi, start, end, vel in _events(part, score):
            s0 = int(round(start * sr))
            if s0 >= n:
                continue
            y = self.note(midi, max(0.03, end - start), vel, sr)
            k = min(n - s0, y.shape[0])
            out[s0 : s0 + k] += y[:k]
        out = dsp.saturate(out, self.drive_db, "tanh")[0]
        # a touch of width: a 9 ms Haas-free micro-delay on the side channel only
        d = dsp.delay(out, 0.009)[0]
        mid, side = out, 0.18 * (out - d)
        return np.vstack([mid + side, mid - side]) * 0.5


# ------------------------------------------------------------------------------------------ sub, kick, guitar

@dataclass
class Sub:
    glide: float = 0.03
    harmonics: float = 0.18
    release: float = 0.1

    def render(self, part, score, length: float, sr: int = SR) -> np.ndarray:
        notes = [(m, s, max(0.02, e - s), (v / 127.0) ** 1.3) for m, s, e, v in _events(part, score)]
        return synth.sub_bass(notes, length, sr, self.glide, self.harmonics, self.release)


@dataclass
class SynthKick:
    """A tuned kick per hit. f_end is the body pitch (Hz): 55 (A1) sits under a D-minor bass line."""

    f_start: float = 150.0
    f_end: float = 55.0
    pitch_decay: float = 0.032
    amp_decay: float = 0.2
    click: float = 0.22
    drive_db: float = 4.0
    seed: str = "kick"
    _cache: dict = field(default_factory=dict, repr=False)

    def hit(self, sr: int = SR) -> np.ndarray:
        if "x" not in self._cache:
            self._cache["x"] = synth.kick(0.7, sr, self.f_start, self.f_end, self.pitch_decay, self.amp_decay, self.click, self.drive_db, seed=self.seed)[0]
        return self._cache["x"]

    def render(self, part, score, length: float, sr: int = SR) -> np.ndarray:
        n = int(round(length * sr))
        out = np.zeros(n)
        h = self.hit(sr)
        for n_ in part.notes:
            s0 = int(round(score.seconds(n_.start) * sr))
            if s0 >= n:
                continue
            k = min(n - s0, h.shape[0])
            out[s0 : s0 + k] += h[:k] * (n_.vel / 127.0) ** 1.5
        return np.vstack([out, out])


def muted_guitar(seed: str = "mgtr"):
    """Palm-muted electric guitar from the plucked-string model: short ring, picked near the bridge."""
    return synth.PluckString(t60=0.28, damping=0.62, brightness=0.75, pick_pos=0.11, release=0.03, tone_hz=4200.0,
                             body=(220.0, 3.0), mono=False, gain_db=0.0, seed=seed)


def fingered_bass(seed: str = "bass", t60: float = 3.5):
    """The engine's fingered-bass voicing of the plucked string (measured clean, see docs/AUDIO.md)."""
    return synth.PluckString(t60=t60, damping=0.55, brightness=0.45, pick_pos=0.22, release=0.06, tone_hz=2800.0,
                             body=(100.0, 2.0), mono=True, seed=seed)


# ------------------------------------------------------------------------------------------ audio helpers

def place(dst: np.ndarray, clip: np.ndarray, at_s: float, gain_db: float = 0.0, sr: int = SR) -> None:
    """Add a stereo clip into dst at `at_s` seconds (negative drops the head)."""
    from audiolib.core import as_stereo, mix_into

    mix_into(dst, as_stereo(clip), int(round(at_s * sr)), float(10 ** (gain_db / 20)))


def reverse_swell(source: np.ndarray, length_s: float, room: str = "hall", sr: int = SR, curve: float = 1.6) -> np.ndarray:
    """A 'rewind' swell: the source through a reverb, reversed, so it grows into its own attack.
    Returns stereo audio `length_s` long whose loudest point is its last sample region; place it so
    it ends where the downbeat lands."""
    from audiolib.core import as_stereo

    ir = impulse_response(ROOMS[room] if isinstance(room, str) else room, sr)
    wet = convolve(as_stereo(source), ir)
    k = int(round(length_s * sr))
    rev = wet[:, ::-1]
    rev = rev[:, -k:] if rev.shape[1] >= k else np.pad(rev, ((0, 0), (k - rev.shape[1], 0)))
    t = np.linspace(0, 1, k)
    rev *= t**curve
    rev[:, -int(0.004 * sr):] *= np.linspace(1, 0, int(0.004 * sr))
    return rev / max(np.max(np.abs(rev)), 1e-12)


def noise_swell(length_s: float, sr: int = SR, lo_hz: float = 400.0, hi_hz: float = 7000.0, seed: str = "nswell", curve: float = 2.0) -> np.ndarray:
    """A soft filtered-noise swell (air) that opens up and grows into its end; stereo, peak 1."""
    n = int(round(length_s * sr))
    t = np.arange(n) / n
    fc = lo_hz * (hi_hz / lo_hz) ** (t**curve)
    l = synth.svf(synth.noise(n, "pink", seed + "l"), fc, 0.9, "bandpass", sr)
    r = synth.svf(synth.noise(n, "pink", seed + "r"), fc * 1.02, 0.9, "bandpass", sr)
    out = np.vstack([l, r]) * (t**curve)[np.newaxis, :]
    out[:, -int(0.005 * sr):] *= np.linspace(1, 0, int(0.005 * sr))
    return out / max(np.max(np.abs(out)), 1e-12)


def sampled_chord(sampler, notes, dur_s: float, vel: int = 70, length_s: float | None = None, pedal: bool = True) -> np.ndarray:
    """Render a chord on a Sampler (e.g. the piano) as a stereo clip: the source for reverse swells."""
    from audiolib.core import note_number

    ev = [(note_number(n), 0.0, dur_s, vel) for n in notes]
    L = length_s or dur_s + 3.0
    return sampler.render_events(ev, L, SR, pedal=[(0.0, dur_s)] if pedal else None)
