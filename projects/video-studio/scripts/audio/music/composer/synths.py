"""Our own synthesised voices (the "tech edge" and the glue). Each class has
`render(part, score, length) -> (2, n) stereo audio`, like the engine's PluckString, so it can be a
Track source. Everything is seeded and deterministic.

    TineEP      FM tine electric piano: 1:1 body pair + a fast 14:1 "tine" pair, velocity-dependent
                bark, two-stage decay, felt damper release, stereo tremolo (computed at 2x, decimated)
    Pad         warm analog pad (the engine's supersaw_pad through a slow ladder low-pass)
    Pulse       plucky pulse/saw arpeggiator voice with a per-note filter envelope (SVF)
    BrassStab   detuned saw stack with a fast filter envelope and saturation (late-night hits)
    Sub         sine sub bass with glide (engine sub_bass)
    SynthKick   the kick (engine kick), velocity-scaled; kick_tuning() gives every hit one fixed body pitch (52 Hz)
    FingerBass  the bass: a finger-plucked string (waveguide loop with frequency-dependent loss, finger excitation)
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
    """A synth kick. f_end is the body pitch (Hz); a hit whose note carries meta `tune_hz` (see
    `kick_tuning`: since critic round 2 one fixed 52 Hz for every hit) is tuned to that instead.

    Critic round 1 (KICK-FIX): the body decays in 0.11 s (was 0.2 s, an 808-style boom that rang
    into the bass and beat against B-flat, A-flat and G roots at 3-6 Hz) with 2 dB of drive (was 4)."""

    f_start: float = 150.0
    f_end: float = 55.0
    pitch_decay: float = 0.032
    amp_decay: float = 0.11
    click: float = 0.22
    drive_db: float = 2.0
    seed: str = "kick"
    _cache: dict = field(default_factory=dict, repr=False)

    def hit(self, sr: int = SR, f_end: float | None = None) -> np.ndarray:
        f = round(float(self.f_end if f_end is None else f_end), 3)
        if f not in self._cache:
            self._cache[f] = synth.kick(0.7, sr, self.f_start, f, self.pitch_decay, self.amp_decay, self.click, self.drive_db, seed=self.seed)[0]
        return self._cache[f]

    def render(self, part, score, length: float, sr: int = SR) -> np.ndarray:
        n = int(round(length * sr))
        out = np.zeros(n)
        for n_ in part.notes:
            s0 = int(round(score.seconds(n_.start) * sr))
            if s0 >= n:
                continue
            h = self.hit(sr, n_.meta.get("tune_hz"))
            k = min(n - s0, h.shape[0])
            out[s0 : s0 + k] += h[:k] * (n_.vel / 127.0) ** 1.5
        return np.vstack([out, out])


KICK_RANGE_HZ = (45.0, 62.0)


def kick_pitch_for(bass_midi: int, default_hz: float = 55.0, lo: float = KICK_RANGE_HZ[0], hi: float = KICK_RANGE_HZ[1]) -> float:
    """The kick body pitch that agrees with a bass note: its own pitch class in 45-62 Hz (G1, A1,
    B-flat 1, B1, ...), else its fifth in 45-66 Hz (D -> A1, E-flat -> B-flat 1, F -> C2), else
    `default_hz`. A kick a semitone or a tone from the bass beats at 3-6 Hz in the sub."""
    for interval, top in ((0, hi), (7, hi + 4.0)):
        pc = (bass_midi + interval) % 12
        for octave in range(0, 4):
            m = pc + 12 * octave
            f = float(midi_to_hz(m))
            if lo <= f <= top:
                return round(f, 3)
    return default_hz


KICK_FIXED_HZ = 52.0


def kick_tuning(score, kick: str = "kick", bass: str = "bass", default_hz: float = 55.0, fixed_hz: float | None = KICK_FIXED_HZ) -> int:
    """Tune the hits in `kick` (meta `tune_hz`). Returns how many hits were tuned away from `default_hz`.

    fixed_hz (the default, critic round 2): every hit gets the same body pitch, 52 Hz. Retuned per
    hit, the kick's spectral peak wandered over 61-75 Hz (3.6 semitones in the theme), an 808 idiom
    the direction rules out; with its 0.11 s body any beat against the bass lasts under one cycle.
    fixed_hz=None (round 1): each hit follows the bass note sounding with it (the note held at the
    hit, else the next one starting within half a beat; kick_pitch_for). Run before humanising (it
    reads the written beats)."""
    if fixed_hz is not None:
        if kick not in score.parts:
            return 0
        for h in score.parts[kick].notes:
            h.meta["tune_hz"] = float(fixed_hz)
        return len(score.parts[kick].notes) if abs(fixed_hz - default_hz) > 1e-6 else 0
    if kick not in score.parts or bass not in score.parts:
        return 0
    notes = sorted(score.parts[bass].notes, key=lambda x: x.start)
    changed = 0
    for h in score.parts[kick].notes:
        held = [b for b in notes if b.start <= h.start + 1e-6 < b.start + b.dur]
        if not held:
            held = [b for b in notes if 0.0 <= b.start - h.start <= 0.5]
        if not held:
            continue
        b = min(held, key=lambda x: x.pitch)
        f = kick_pitch_for(b.pitch, default_hz)
        h.meta["tune_hz"] = f
        changed += abs(f - default_hz) > 1e-6
    return changed


def muted_guitar(seed: str = "mgtr"):
    """Palm-muted electric guitar from the plucked-string model: short ring, picked near the bridge."""
    return synth.PluckString(t60=0.28, damping=0.62, brightness=0.75, pick_pos=0.11, release=0.03, tone_hz=4200.0,
                             body=(220.0, 3.0), mono=False, gain_db=0.0, seed=seed)


STRING_KNEE_HZ = 230.0  # FingerBass: a partial at this frequency decays twice as fast as the fundamental


def string_loss(f0: float, t60: float, knee_hz: float = STRING_KNEE_HZ, sr: int = SR) -> tuple:
    """(g, a) of the one-pole loss filter g (1 - a) / (1 - a z^-1) in a string loop at `f0`: the
    fundamental decays to -60 dB in `t60` seconds and a partial at f decays at about
    R0 (1 + (f / knee_hz)^2) dB/s (R0 = 60 / t60; matched exactly at 2 * knee_hz), as a real string's
    losses grow with frequency. Per period the loop takes |H| of a partial, so its decay rate is
    -20 log10 |H(f)| * f0 dB/s."""
    r0 = 60.0 / max(t60, 0.01)
    g = 10 ** (-r0 / (20.0 * f0))
    fr = min(2.0 * knee_hz, 0.4 * sr)
    q = 10 ** (r0 * (fr / knee_hz) ** 2 / (10.0 * f0))
    c = math.cos(2 * math.pi * fr / sr)
    b = 2.0 * (q - c) / (q - 1.0)
    a = (b - math.sqrt(b * b - 4.0)) / 2.0
    return g, a


def _allpass_delay(eta: float, w: float) -> float:
    """Phase delay (samples) at w of the first-order allpass (eta + z^-1) / (1 + eta z^-1)."""
    ph = math.atan2(-math.sin(w), eta + math.cos(w)) - math.atan2(-eta * math.sin(w), 1 + eta * math.cos(w))
    return -ph / w


def _allpass_for(d: float, w: float) -> float:
    """The allpass coefficient whose phase delay at w is d samples (Thiran's start, then secant steps)."""
    e0 = (1 - d) / (1 + d)
    e1 = e0 + 1e-4
    f0, f1 = _allpass_delay(e0, w) - d, _allpass_delay(e1, w) - d
    for _ in range(6):
        if abs(f1) < 1e-10 or f1 == f0:
            break
        e0, e1 = e1, e1 - f1 * (e1 - e0) / (f1 - f0)
        f0, f1 = f1, _allpass_delay(e1, w) - d
    return e1


def finger_pluck(midi: float, dur: float, vel: float = 0.8, sr: int = SR, t60: float = 3.5, knee_hz: float = STRING_KNEE_HZ, pick_pos: float = 0.22,
                 release: float = 0.06, tail: float = 0.25, harm_cut: float = 6.0, noise_mix: float = 0.5, seed: str = "finger") -> np.ndarray:
    """One finger-plucked string note, mono: a digital-waveguide string (Karplus-Strong loop) with a
    frequency-dependent loss and a finger excitation.

    The loop (critic round 2): a delay of N samples, a first-order allpass for the fractional delay and
    a one-pole loss low-pass (string_loss), so each partial decays exponentially at its own rate,
    faster the higher it is: with the default knee (230 Hz) and t60 3.5 s, the 8th and 16th harmonics
    decay 3.1 and 7.8 times faster than the fundamental on E1, 4.4 and 11 times on A1, 6.4 and 16
    times on D2 (measured; the critic asked for at least 3 and 5). The round-1 string used the
    engine's 3-tap loss filter, which is almost flat at 30-90 Hz, so every harmonic decayed at the
    fundamental's 17 dB/s and the note kept its attack brightness to the note-off: an organ's static
    spectrum, not a plucked string's. The total loop delay at f0 (N + the allpass's and the low-pass's
    phase delays) is exactly sr / f0, so the fundamental is in tune; the upper partials sit a few
    cents flat-to-sharp of harmonic, as a real string's do.

    The excitation (round 1): a finger pushes the string into a smooth triangle (harmonics falling as
    1/n^2), mixed (`noise_mix`) with contact noise low-passed at `harm_cut` times the fundamental and
    comb-filtered at the pick position; harder plucks open that cut a little. The note is muted `dur`
    seconds in with a `release` fade and rendered for dur + release + `tail`. The recursion runs one
    loop length at a time (every sample depends only on samples N or more earlier), with the filters'
    states carried across blocks."""
    from scipy.signal import lfilter

    f0 = float(midi_to_hz(midi))
    period = sr / f0
    g, a = string_loss(f0, t60, knee_hz, sr)
    w0 = 2 * math.pi * f0 / sr
    tau_lp = math.atan2(a * math.sin(w0), 1 - a * math.cos(w0)) / w0
    N = int(math.floor(period - tau_lp - 0.5))
    if N < 8:
        raise ValueError("pitch too high for this string model at this sample rate")
    eta = _allpass_for(period - tau_lp - N, w0)
    n = int(round((dur + release + tail) * sr))
    L = max(4, int(round(period)))  # one period of string displacement
    v = float(np.clip(vel, 0.0, 1.0))
    p = float(np.clip(pick_pos, 0.05, 0.95))
    x = np.arange(L) / L
    tri = np.where(x < p, x / p, (1.0 - x) / (1.0 - p))
    tri = tri - tri.mean()
    tri /= max(float(np.max(np.abs(tri))), 1e-12)
    nz = rng("finger", seed, midi, round(dur, 4), round(v, 4)).uniform(-1, 1, L)
    cut = min(harm_cut * f0 * (0.5 + 0.8 * v), 0.45 * sr)
    c1 = math.exp(-2 * math.pi * cut / sr)
    nz = lfilter([1 - c1], [1, -c1], np.concatenate([nz, nz]))[L:]  # settled one-pole low-pass
    k = max(1, int(round(p * L)))
    nz = nz - np.concatenate([np.zeros(k), nz[:-k]])
    nz /= max(float(np.max(np.abs(nz))), 1e-12)
    exc = (1.0 - noise_mix) * tri + noise_mix * nz
    exc -= exc.mean()
    exc *= v / max(float(np.max(np.abs(exc))), 1e-12)
    y = np.zeros(n + N)
    off = N  # y[off + i] is output sample i; the first N values are the string before the pluck
    m = min(L, n)
    y[off: off + m] = exc[:m]
    b_ap, a_ap = [eta, 1.0], [1.0, eta]
    b_lp, a_lp = [g * (1.0 - a)], [1.0, -a]
    zi_ap, zi_lp = np.zeros(1), np.zeros(1)
    pos = off
    while pos < off + n:
        end = min(pos + N, off + n)
        u, zi_ap = lfilter(b_ap, a_ap, y[pos - N: end - N], zi=zi_ap)
        w, zi_lp = lfilter(b_lp, a_lp, u, zi=zi_lp)
        y[pos:end] += w
        pos = end
    out = y[off: off + n]
    m0 = int(round(dur * sr))
    if m0 < n:
        rt = np.arange(n - m0)
        out[m0:] *= np.exp(-6.907755 * rt / max(1.0, release * sr))
    return dsp.dc_block(out)[0]


@dataclass
class FingerBass:
    """A fingered bass line on `finger_pluck` (one string: a new note mutes the previous one), with
    a body resonance (Hz, dB). Same interface as the engine's PluckString."""

    t60: float = 3.5
    knee_hz: float = STRING_KNEE_HZ
    pick_pos: float = 0.22
    release: float = 0.06
    harm_cut: float = 6.0
    noise_mix: float = 0.5
    body: tuple | None = (100.0, 2.0)
    seed: str = "bass"

    def render_events(self, events, length: float, sr: int = SR) -> np.ndarray:
        n = int(round(length * sr))
        out = np.zeros(n)
        evs = sorted(events, key=lambda e: e[1])
        for i, (m, start, end, vel) in enumerate(evs):
            dur = max(0.02, end - start)
            if i + 1 < len(evs):
                dur = min(dur, max(0.02, evs[i + 1][1] - start))
            s0 = int(round(start * sr))
            if s0 >= n:
                continue
            v = (max(1, vel) / 127.0) ** 1.4
            note = finger_pluck(m, dur, v, sr, self.t60, self.knee_hz, self.pick_pos, self.release, harm_cut=self.harm_cut,
                                noise_mix=self.noise_mix, seed=f"{self.seed}-{i}")
            k = min(n - s0, note.shape[0])
            out[s0 : s0 + k] += note[:k]
        if self.body:
            out = dsp.apply_sos(out, dsp.biquad("peak", self.body[0], sr, 1.2, self.body[1]))[0]
        return np.vstack([out, out])

    def render(self, part, score, length: float, sr: int = SR) -> np.ndarray:
        return self.render_events([(n.pitch, score.seconds(n.start), score.seconds(n.end), n.vel) for n in part.notes], length, sr)


def fingered_bass(seed: str = "bass", t60: float = 3.5):
    """The composer's bass voice (BASS-FIX, critic round 1): `FingerBass`, a finger-plucked string
    whose harmonics roll off from the note's own fundamental. It replaces the engine's plucked
    string (PluckString, brightness 0.45, tone 2.8 kHz), which put 44 % of the bass's power at
    1-4 kHz and made the bass the beds' main masker of Zoo's consonants."""
    return FingerBass(t60=t60, seed=seed)


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
