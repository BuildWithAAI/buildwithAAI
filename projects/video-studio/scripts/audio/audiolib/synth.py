"""Synthesis primitives (numpy, 48 kHz, deterministic with seeds).

Oscillators are anti-aliased with PolyBLEP (2-sample polynomial band-limited step, Valimaki &
Huovilainen 2007): the naive waveform's jumps are smoothed by a polynomial residual, which pushes
aliasing down by roughly 25-40 dB against the naive waveform for typical pitches (see tests).
The triangle is the leaky integral of the PolyBLEP square, so its corners are band-limited too.
All frequency inputs can be arrays (one value per sample) for glide, vibrato and sweeps.

Also here: white/pink/brown noise, an ADSR with analog-style curves, a TPT state-variable filter
(Zavalishin, "The Art of VA Filter Design"; stable under fast cutoff modulation), LFOs, and ready
voices: `supersaw_pad`, `sub_bass`, `riser`, `kick`, and a plucked string (`pluck`, `PluckString`:
extended Karplus-Strong, for bass lines and plucks without sample-loop artefacts).
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np

from .core import SR, midi_to_hz, rng

# ---------------------------------------------------------------------------------------- oscillators


def _freq_array(freq, n: int) -> np.ndarray:
    f = np.asarray(freq, dtype=np.float64)
    if f.ndim == 0:
        return np.full(n, float(f))
    if f.shape[0] != n:
        raise ValueError(f"frequency array has {f.shape[0]} values for {n} samples")
    return f


def phase(freq, n: int, sr: int = SR, phase0: float = 0.0) -> np.ndarray:
    """Running phase in [0, 1) for a (possibly time-varying) frequency."""
    inc = _freq_array(freq, n) / sr
    ph = phase0 + np.concatenate([[0.0], np.cumsum(inc[:-1])])
    return np.mod(ph, 1.0)


def poly_blep(t: np.ndarray, dt: np.ndarray) -> np.ndarray:
    """PolyBLEP residual for phase t in [0, 1) with per-sample increment dt."""
    out = np.zeros_like(t)
    a = t < dt
    x = t[a] / dt[a]
    out[a] = x + x - x * x - 1.0
    b = t > 1.0 - dt
    y = (t[b] - 1.0) / dt[b]
    out[b] = y * y + y + y + 1.0
    return out


def osc(shape: str, freq, n: int, sr: int = SR, phase0: float = 0.0, pw: float = 0.5, oversample: int = 1) -> np.ndarray:
    """Band-limited oscillator. shape: sine, saw, square (pulse width `pw`), triangle.

    oversample > 1 renders at that multiple of `sr` and decimates through the -90 dB polyphase
    filter: PolyBLEP plus 2x oversampling is the choice for bright, high, exposed tones."""
    if oversample > 1:
        from .dsp import downsample

        f_hi = np.repeat(_freq_array(freq, n), oversample)
        hi = osc(shape, f_hi, n * oversample, sr * oversample, phase0, pw)
        return downsample(hi, oversample)[0, :n]
    f = _freq_array(freq, n)
    if np.any(f < 0) or np.any(f >= sr / 2):
        raise ValueError("oscillator frequency must be in [0, Nyquist)")
    ph = phase(f, n, sr, phase0)
    dt = np.maximum(f / sr, 1e-9)
    if shape == "sine":
        return np.sin(2 * np.pi * ph)
    if shape == "saw":
        return 2.0 * ph - 1.0 - poly_blep(ph, dt)
    if shape == "square":
        return _pulse(ph, dt, pw)
    if shape == "triangle":
        # naive triangle (-1 at phase 0, +1 at 0.5) plus PolyBLAMP corrections at both corners:
        # the slope changes by +-8*dt per sample there, and the BLAMP residual (the integral of the
        # PolyBLEP residual) is (1 - |t|)^3 / 6 at t samples from the corner.
        tri = 1.0 - 4.0 * np.abs(ph - 0.5)
        scale = 8.0 * dt / 6.0
        return tri + scale * (poly_blamp(ph, dt) - poly_blamp(np.mod(ph + 0.5, 1.0), dt))
    raise ValueError(f"unknown oscillator shape {shape!r}")


def poly_blamp(t: np.ndarray, dt: np.ndarray) -> np.ndarray:
    """(1 - |x|)^3 around a corner at phase 0, x = distance in samples (needs dt < 0.25)."""
    out = np.zeros_like(t)
    a = t < dt
    x = t[a] / dt[a]
    out[a] = (1.0 - x) ** 3
    b = t > 1.0 - dt
    y = (t[b] - 1.0) / dt[b]
    out[b] = (1.0 + y) ** 3
    return out


def _pulse(ph: np.ndarray, dt: np.ndarray, pw: float) -> np.ndarray:
    pw = float(np.clip(pw, 0.02, 0.98))
    naive = np.where(ph < pw, 1.0, -1.0)
    return naive + poly_blep(ph, dt) - poly_blep(np.mod(ph - pw + 1.0, 1.0), dt)


def naive_saw(freq, n: int, sr: int = SR, phase0: float = 0.0) -> np.ndarray:
    """Aliasing reference for tests only."""
    return 2.0 * phase(freq, n, sr, phase0) - 1.0


def supersaw(freq, n: int, voices: int = 7, detune_cents: float = 18.0, spread: float = 0.8, sr: int = SR, seed: str = "supersaw", oversample: int = 2) -> np.ndarray:
    """Detuned saw stack (stereo). Voices are spread symmetrically in cents and alternately panned;
    each starts at a random phase (seeded), which avoids the phasey 'all in phase' attack.
    Rendered at 2x oversampling by default (aliasing about -55 dB instead of -35 dB at 1.6 kHz)."""
    g = rng("supersaw", seed)
    f = _freq_array(freq, n)
    out = np.zeros((2, n))
    for i in range(voices):
        pos = (i - (voices - 1) / 2) / max(1, (voices - 1) / 2)  # -1..1
        cents = pos * detune_cents
        ratio = 2 ** (cents / 1200)
        s = osc("saw", f * ratio, n, sr, phase0=float(g.random()), oversample=oversample)
        pan = pos * spread
        th = (pan + 1) * math.pi / 4
        w = 1.0 if i == (voices - 1) // 2 else 0.85
        out[0] += s * math.cos(th) * w
        out[1] += s * math.sin(th) * w
    return out / math.sqrt(voices)


# ---------------------------------------------------------------------------------------- noise


def noise(n: int, color: str = "white", seed: str = "noise") -> np.ndarray:
    """Unit-RMS noise. white; pink (-3 dB/oct, exact 1/f power via FFT shaping); brown (-6 dB/oct)."""
    g = rng("noise", color, seed)
    w = g.standard_normal(n)
    if color == "white":
        return w
    if color not in ("pink", "brown"):
        raise ValueError(f"unknown noise color {color!r}")
    spec = np.fft.rfft(w)
    k = np.arange(spec.shape[0], dtype=np.float64)
    k[0] = 1.0
    spec /= np.sqrt(k) if color == "pink" else k
    spec[0] = 0.0
    out = np.fft.irfft(spec, n)
    return out / max(np.sqrt(np.mean(out**2)), 1e-12)


# ---------------------------------------------------------------------------------------- envelopes


def adsr(n: int, gate: int, attack: float = 0.005, decay: float = 0.1, sustain: float = 0.8, release: float = 0.2, sr: int = SR, attack_curve: float = 0.0) -> np.ndarray:
    """ADSR of n samples with the key held for `gate` samples.

    attack: linear (attack_curve 0) or convex (attack_curve > 0, e.g. 3 = fast-then-slow);
    decay: exponential to `sustain` (99 % there after `decay` s);
    release: exponential from wherever the envelope is at gate-off (also mid-attack), -60 dB after
    `release` s, then forced to exactly 0 by a 2 ms tail so nothing is truncated with a click."""
    env = np.zeros(n)
    gate = int(max(0, min(gate, n)))
    na = max(1, int(round(attack * sr)))
    nd = max(1, int(round(decay * sr)))
    t = np.arange(gate)
    a_part = np.minimum(t / na, 1.0)
    if attack_curve > 0:
        k = float(attack_curve)
        a_part = (1 - np.exp(-k * a_part)) / (1 - math.exp(-k))
    d_t = np.maximum(t - na, 0)
    d_part = sustain + (1 - sustain) * np.exp(-4.6 * d_t / nd)
    env[:gate] = np.where(t < na, a_part, d_part)
    level = env[gate - 1] if gate > 0 else 0.0
    nr = n - gate
    if nr > 0:
        rt = np.arange(1, nr + 1)
        rel = level * np.exp(-6.907755 * rt / max(1, release * sr))
        tail = min(nr, int(0.002 * sr))
        cut = min(nr, int(round(release * sr)) + tail)
        rel[cut:] = 0.0
        if cut - tail > 0:
            rel[cut - tail : cut] *= np.linspace(1, 0, tail)
        env[gate:] = rel
    return env


def env_points(n: int, points, sr: int = SR, curve: str = "linear") -> np.ndarray:
    """Breakpoint envelope: points = [(seconds, value), ...]; 'exp' interpolates in log space
    (values must be > 0), which suits frequency sweeps."""
    pts = sorted(points)
    ts = np.array([p[0] for p in pts]) * sr
    vs = np.array([p[1] for p in pts], dtype=np.float64)
    x = np.arange(n)
    if curve == "exp":
        if np.any(vs <= 0):
            raise ValueError("exp breakpoints must be positive")
        return np.exp(np.interp(x, ts, np.log(vs)))
    return np.interp(x, ts, vs)


def lfo(n: int, rate: float, shape: str = "sine", depth: float = 1.0, phase0: float = 0.0, sr: int = SR, delay: float = 0.0, fade: float = 0.0, seed: str = "lfo") -> np.ndarray:
    """Control signal in [-depth, depth]. shapes: sine, triangle, square, saw, sh (sample & hold),
    smooth (band-limited random, a slow drift). `delay` s of nothing, then a `fade` s fade-in."""
    ph = phase(rate, n, sr, phase0)
    if shape == "sine":
        v = np.sin(2 * np.pi * ph)
    elif shape == "triangle":
        v = 1 - 4 * np.abs(ph - 0.5)
    elif shape == "square":
        v = np.where(ph < 0.5, 1.0, -1.0)
    elif shape == "saw":
        v = 2 * ph - 1
    elif shape in ("sh", "smooth"):
        g = rng("lfo", seed)
        steps = int(np.ceil(n * rate / sr)) + 2
        vals = g.uniform(-1, 1, steps)
        idx = np.floor(np.arange(n) * rate / sr).astype(int)
        if shape == "sh":
            v = vals[idx]
        else:
            x = np.arange(n) * rate / sr
            frac = x - idx
            sm = frac * frac * (3 - 2 * frac)
            v = vals[idx] * (1 - sm) + vals[idx + 1] * sm
    else:
        raise ValueError(f"unknown lfo shape {shape!r}")
    env = np.ones(n)
    d = int(round(delay * sr))
    f = int(round(fade * sr))
    env[:d] = 0.0
    if f > 0:
        env[d : d + f] = np.linspace(0, 1, min(f, max(0, n - d)))
    return v * depth * env


# ---------------------------------------------------------------------------------------- filters


def svf(x, cutoff, q: float = 0.7071, mode: str = "lowpass", sr: int = SR) -> np.ndarray:
    """TPT state-variable filter (12 dB/oct), 1-D in/out. `cutoff` may be an array (per sample).
    mode: lowpass, highpass, bandpass (unity gain at the centre), notch, peak.
    Pure-Python loop: about 1 s per 1.5 M samples; use it for modulated filters, use dsp.eq for
    static ones."""
    sig = np.asarray(x, dtype=np.float64)
    n = sig.shape[0]
    fc = np.clip(np.broadcast_to(np.asarray(cutoff, dtype=np.float64), (n,)), 5.0, sr * 0.49)
    g = np.tan(np.pi * fc / sr)
    k = 1.0 / max(q, 1e-3)
    a1 = 1.0 / (1.0 + g * (g + k))
    a2 = g * a1
    a3 = g * a2
    lp = np.empty(n)
    bp = np.empty(n)
    ic1 = 0.0
    ic2 = 0.0
    xs = sig.tolist()
    A1, A2, A3 = a1.tolist(), a2.tolist(), a3.tolist()
    for i in range(n):
        v3 = xs[i] - ic2
        v1 = A1[i] * ic1 + A2[i] * v3
        v2 = ic2 + A2[i] * ic1 + A3[i] * v3
        ic1 = 2.0 * v1 - ic1
        ic2 = 2.0 * v2 - ic2
        lp[i] = v2
        bp[i] = v1
    if mode == "lowpass":
        return lp
    if mode == "bandpass":
        return bp * k
    hp = sig - k * bp - lp
    if mode == "highpass":
        return hp
    if mode == "notch":
        return sig - k * bp
    if mode == "peak":
        return lp - hp
    raise ValueError(f"unknown svf mode {mode!r}")


def ladder(audio, cutoff, resonance: float = 0.2, drive: float = 1.0, mode: str = "LPF24", sr: int = SR, block: int = 64) -> np.ndarray:
    """pedalboard's ladder filter (Moog-style, C++), with the cutoff updated every `block` samples
    while the filter state carries over. Fast for long modulated material (pads)."""
    import pedalboard

    from .core import as_channels

    a = as_channels(audio).astype(np.float32)
    n = a.shape[1]
    fc = np.broadcast_to(np.asarray(cutoff, dtype=np.float64), (n,))
    f = pedalboard.LadderFilter(mode=getattr(pedalboard.LadderFilter.Mode, mode), cutoff_hz=float(fc[0]), resonance=resonance, drive=drive)
    out = np.zeros_like(a)
    for s in range(0, n, block):
        e = min(n, s + block)
        f.cutoff_hz = float(np.clip(fc[s], 20.0, sr * 0.45))
        out[:, s:e] = f(a[:, s:e], sr, buffer_size=block, reset=(s == 0))
    return out.astype(np.float64)


# ---------------------------------------------------------------------------------------- voices


def supersaw_pad(notes, length: float, sr: int = SR, attack: float = 0.8, release: float = 1.6, cutoff: float = 2200.0, cutoff_lfo: float = 0.25, lfo_rate: float = 0.07, detune_cents: float = 14.0, voices: int = 7, seed: str = "pad") -> np.ndarray:
    """A warm, slowly breathing pad. notes: [(midi, start_s, dur_s, velocity 0..1)].
    Per note: a 7-voice supersaw + a sine an octave down for body, slow ADSR. The summed pad goes
    through one 24 dB ladder low-pass whose cutoff drifts with a slow LFO (+-`cutoff_lfo` octaves)."""
    n = int(round(length * sr))
    out = np.zeros((2, n))
    for j, (m, start, dur, vel) in enumerate(notes):
        s0 = int(round(start * sr))
        gate = int(round(dur * sr))
        nn = min(n - s0, gate + int(release * sr * 1.2) + 1)
        if nn <= 0:
            continue
        f = float(midi_to_hz(m))
        body = supersaw(f, nn, voices=voices, detune_cents=detune_cents, sr=sr, seed=f"{seed}-{j}")
        sub = osc("sine", f / 2, nn, sr) * 0.35
        env = adsr(nn, gate, attack, 0.6, 0.85, release, sr, attack_curve=2.0)
        out[:, s0 : s0 + nn] += (body + sub) * env * float(vel)
    mod = lfo(n, lfo_rate, "sine", cutoff_lfo, sr=sr, seed=seed)
    fc = cutoff * np.power(2.0, mod)
    return ladder(out, fc, resonance=0.1, drive=1.0, sr=sr)


def sub_bass(notes, length: float, sr: int = SR, glide: float = 0.04, harmonics: float = 0.25, release: float = 0.08, seed: str = "sub") -> np.ndarray:
    """Clean sine sub-bass with legato glide and a touch of 2nd/3rd harmonic (so it is audible on
    phones). notes: [(midi, start_s, dur_s, velocity 0..1)], monophonic: overlaps glide."""
    n = int(round(length * sr))
    if not notes:
        return np.zeros((2, n))
    notes = sorted(notes, key=lambda x: x[1])
    target = np.zeros(n)
    amp_gate = np.zeros(n)
    vel = np.zeros(n)
    for m, start, dur, v in notes:
        s0 = int(round(start * sr))
        s1 = min(n, int(round((start + dur) * sr)))
        target[s0:s1] = float(midi_to_hz(m))
        amp_gate[s0:s1] = 1.0
        vel[s0:s1] = v
    # hold the last pitch through gaps, so releases keep their pitch
    idx = np.where(target > 0, np.arange(n), 0)
    np.maximum.accumulate(idx, out=idx)
    held = target[idx]
    held[held == 0] = float(midi_to_hz(notes[0][0]))
    # glide: one-pole smoothing of the log-frequency
    from scipy.signal import lfilter

    a = math.exp(-1.0 / max(1.0, glide * sr))
    logf = np.log(held)
    zi = np.array([a * logf[0]])
    sm = np.exp(lfilter([1 - a], [1, -a], logf, zi=zi)[0])
    tone = osc("sine", sm, n, sr)
    if harmonics > 0:
        tone = np.tanh((1 + 3 * harmonics) * tone) / math.tanh(1 + 3 * harmonics)
    # amplitude: 4 ms attack, exponential release, smoothed so steps never click
    att = math.exp(-1.0 / (0.004 * sr))
    rel = math.exp(-1.0 / (release / 6.9 * sr))
    level = amp_gate * np.maximum(vel, 0)
    env = _attack_release(level, att, rel)
    mono = tone * env
    return np.vstack([mono, mono])


def _attack_release(target: np.ndarray, att: float, rel: float) -> np.ndarray:
    out = np.empty_like(target)
    y = 0.0
    for i, v in enumerate(target.tolist()):
        c = att if v > y else rel
        y = c * y + (1 - c) * v
        out[i] = y
    return out


def riser(length: float = 4.0, sr: int = SR, start_hz: float = 300.0, end_hz: float = 9000.0, pitch_from: int = 48, pitch_to: int = 72, noise_mix: float = 0.6, seed: str = "riser") -> np.ndarray:
    """Build-up: filtered noise sweeping up plus a detuned saw stack gliding up an octave or two,
    an exponential swell, and the stereo image widening towards the end."""
    n = int(round(length * sr))
    t = np.arange(n) / n
    curve = t**2.2
    fc = start_hz * (end_hz / start_hz) ** curve
    nz = noise(n, "white", seed)
    nl = svf(nz, fc, q=1.4, mode="bandpass", sr=sr)
    nr = svf(noise(n, "white", seed + "-r"), fc * 1.03, q=1.4, mode="bandpass", sr=sr)
    pitch = pitch_from + (pitch_to - pitch_from) * curve
    saws = supersaw(midi_to_hz(pitch), n, voices=5, detune_cents=22, sr=sr, seed=seed)
    tone = np.vstack([svf(saws[0], fc * 0.8, 0.8, sr=sr), svf(saws[1], fc * 0.8, 0.8, sr=sr)])
    noise_st = np.vstack([nl, nr])
    noise_st /= max(np.sqrt(np.mean(noise_st**2)), 1e-12)
    tone /= max(np.sqrt(np.mean(tone**2)), 1e-12)
    mix = noise_mix * noise_st + (1 - noise_mix) * tone
    amp = np.power(10.0, (-30.0 * (1 - t) ** 1.6) / 20.0)
    # widen: blend from mostly-mono to full stereo
    mid = 0.5 * (mix[0] + mix[1])
    side = 0.5 * (mix[0] - mix[1]) * (0.3 + 0.7 * t)
    out = np.vstack([mid + side, mid - side]) * amp
    k = int(0.01 * sr)
    out[:, -k:] *= np.linspace(1, 0, k)
    return out / max(np.max(np.abs(out)), 1e-12) * 0.5


def kick(length: float = 0.5, sr: int = SR, f_start: float = 160.0, f_end: float = 50.0, pitch_decay: float = 0.035, amp_decay: float = 0.16, click: float = 0.25, drive_db: float = 4.0, seed: str = "kick") -> np.ndarray:
    """Synth kick: sine with an exponential pitch drop, an exponential body decay, a short
    filtered-noise click for the beater, gentle saturation. Mono, returned as stereo.
    Defaults give a tight acoustic-style kick (-20 dB after about 0.4 s); raise `amp_decay`
    to 0.3-0.5 for an 808-style boom."""
    from .dsp import saturate

    n = int(round(length * sr))
    t = np.arange(n) / sr
    f = f_end + (f_start - f_end) * np.exp(-t / pitch_decay)
    body = osc("sine", f, n, sr)  # starts at a zero crossing: no step, no DC
    body *= np.exp(-t / amp_decay) * np.minimum(1.0, t / 0.0015)
    nz = noise(n, "white", seed)
    cl = svf(nz, 3500.0, 0.8, "bandpass", sr) * np.exp(-t / 0.006) * click
    mono = body + cl
    mono = saturate(mono, drive_db, "tanh")[0]
    mono /= max(np.max(np.abs(mono)), 1e-12)
    k = int(0.005 * sr)
    mono[-k:] *= np.linspace(1, 0, k)
    return np.vstack([mono, mono])


# ---------------------------------------------------------------------------------------- plucked strings


def pluck(midi: float, dur: float, vel: float = 0.8, sr: int = SR, t60: float = 3.0, damping: float = 0.45, brightness: float = 0.5, pick_pos: float = 0.18, release: float = 0.07, tail: float = 0.25, seed: str = "pluck") -> np.ndarray:
    """One plucked-string note (extended Karplus-Strong, Jaffe & Smith 1983), mono.

    The loop is a delay of L samples plus a 3-tap FIR that combines the loss low-pass
    ((1 - damping) + damping z^-1, more damping = darker decay) with linear-interpolation tuning,
    so the pitch is exact (the loop's total delay at low frequencies equals sr / f0). Loop gain
    gives `t60` seconds to -60 dB at the fundamental. Excitation: one period of seeded noise,
    low-passed by `brightness` and comb-filtered at `pick_pos` (where along the string it is
    plucked: 0.5 = centre, mellow; 0.1 = near the bridge, twangy). Velocity scales level and
    brightness. The note is muted `dur` seconds in with a `release` fade (a player's hand), and
    rendered for dur + release + `tail`.
    The recursion is vectorised one period at a time: every sample of a period depends only on
    the period before, so a 3 s bass note is about 200 numpy operations."""
    from scipy.signal import lfilter

    f0 = float(midi_to_hz(midi))
    period = sr / f0
    s = float(np.clip(damping, 0.0, 0.95))
    target = period - s  # the FIR's low-frequency group delay is frac + s
    L = int(np.floor(target))
    frac = target - L
    if L < 3:
        raise ValueError("pitch too high for this string model at this sample rate")
    g = 10 ** (-3.0 / (f0 * max(t60, 0.01)))
    c0 = g * (1 - frac) * (1 - s)
    c1 = g * ((1 - frac) * s + frac * (1 - s))
    c2 = g * frac * s
    n = int(round((dur + release + tail) * sr))
    y = np.zeros(n + L + 2)
    off = L + 2  # y[off + i] is output sample i; the first L + 2 values are the empty string
    g_rng = rng("pluck", seed, midi, round(dur, 4), round(vel, 4))
    exc = g_rng.uniform(-1, 1, L)
    vel = float(np.clip(vel, 0.0, 1.0))
    cut = 600 + 5400 * np.clip(brightness * (0.4 + 0.6 * vel), 0.0, 1.0)
    a = math.exp(-2 * math.pi * cut / sr)
    exc = lfilter([1 - a], [1, -a], np.concatenate([exc, exc]))[L:]  # settled one-pole low-pass
    k = max(1, int(round(pick_pos * L)))
    exc = exc - np.concatenate([np.zeros(k), exc[:-k]])
    exc -= exc.mean()
    exc *= vel / max(np.max(np.abs(exc)), 1e-12)
    y[off : off + L] = exc
    pos = off
    while pos < off + n:
        end = min(pos + L, off + n)
        y[pos:end] += c0 * y[pos - L : end - L] + c1 * y[pos - L - 1 : end - L - 1] + c2 * y[pos - L - 2 : end - L - 2]
        pos = end
    out = y[off : off + n]
    # mute: the hand damps the string at `dur`
    m0 = int(round(dur * sr))
    if m0 < n:
        rt = np.arange(n - m0)
        out[m0:] *= np.exp(-6.907755 * rt / max(1.0, release * sr))
    from .dsp import dc_block

    return dc_block(out)[0]


@dataclass
class PluckString:
    """A plucked-string instrument for Parts (bass, guitar-like, harp-like plucks).

    mono=True: a new note mutes the previous one (a bass line on one string); otherwise notes
    ring over each other. `tone_hz` is the pickup/tone low-pass; `body` adds a resonant peak
    (Hz, dB) for the instrument body. Output is stereo (identical channels: pan it in the mix)."""

    t60: float = 2.5
    damping: float = 0.45
    brightness: float = 0.45
    pick_pos: float = 0.2
    release: float = 0.06
    tone_hz: float | None = 3200.0
    body: tuple | None = (110.0, 2.0)
    mono: bool = True
    gain_db: float = 0.0
    seed: str = "pluckstring"

    def render_events(self, events, length: float, sr: int = SR) -> np.ndarray:
        """events: [(midi, start_s, end_s, velocity 1..127)]."""
        from .dsp import biquad, apply_sos

        n = int(round(length * sr))
        out = np.zeros(n)
        evs = sorted(events, key=lambda e: e[1])
        for i, (m, start, end, vel) in enumerate(evs):
            dur = max(0.02, end - start)
            if self.mono and i + 1 < len(evs):
                dur = min(dur, max(0.02, evs[i + 1][1] - start))
            s0 = int(round(start * sr))
            if s0 >= n:
                continue
            v = (max(1, vel) / 127.0) ** 1.4
            note = pluck(m, dur, v, sr, self.t60, self.damping, self.brightness * (0.6 + 0.6 * vel / 127.0), self.pick_pos, self.release, seed=f"{self.seed}-{i}")
            k = min(n - s0, note.shape[0])
            out[s0 : s0 + k] += note[:k]
        rows = []
        if self.tone_hz:
            rows.append(biquad("lowpass", self.tone_hz, sr, 0.7071))
        if self.body:
            rows.append(biquad("peak", self.body[0], sr, 1.2, self.body[1]))
        if rows:
            out = apply_sos(out, np.vstack(rows))[0]
        out *= 10 ** (self.gain_db / 20)
        return np.vstack([out, out])

    def render(self, part, score, length: float, sr: int = SR) -> np.ndarray:
        events = [(n.pitch, score.seconds(n.start), score.seconds(n.end), n.vel) for n in part.notes]
        return self.render_events(events, length, sr)
