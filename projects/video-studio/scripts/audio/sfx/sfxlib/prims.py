"""Synthesis primitives for SFX. Mono signals are 1-D float64 at 48 kHz; stereo is (2, n).

Everything starts from silence without a step (sines start at phase 0, noise and pulses rise
through a raised cosine), so no primitive adds a click of its own. Randomness comes only from
seeded generators (audiolib.core.rng), so every render is reproducible.

Physical models used here:
- modal body: an impact is a sum of exponentially decaying sines (one per vibration mode of the
  struck object), excited by a contact pulse; a wider (softer) pulse low-passes the modes, the
  way a soft mallet or a fingertip does (a Hann pulse of width T is -3 dB at about 0.72 / T);
- pass-by: a source passing the listener is loudest at its closest approach, with an amplitude of
  about 1 / distance, and its spectrum falls (Doppler) as it recedes;
- stick-slip: friction creaks are a train of tiny slips whose rate and spacing wander, each one
  ringing the resonances of the wood, plastic or metal that is rubbing.
"""

from __future__ import annotations

import math

import numpy as np

from audiolib import synth
from audiolib.core import SR, as_channels, rng

T60 = 6.907755  # ln(1000): exp(-T60 * t / t60) is -60 dB at t = t60


def n_samples(seconds: float) -> int:
    return max(0, int(round(seconds * SR)))


def t_axis(n: int) -> np.ndarray:
    return np.arange(n) / SR


# ------------------------------------------------------------------------------------------- pulses


def hann_pulse(width_s: float) -> np.ndarray:
    """A raised-cosine contact pulse of unit area: convolving with it keeps low-frequency gain at 1
    and rolls the top off from about 0.72 / width (0.25 ms: -3 dB near 2.9 kHz)."""
    n = max(1, n_samples(width_s))
    w = np.hanning(n + 2)[1:-1]
    return w / w.sum()


def convolve(x: np.ndarray, h: np.ndarray) -> np.ndarray:
    """Causal convolution cut to len(x)."""
    from scipy.signal import oaconvolve

    if h.size == 1:
        return x * float(h[0])
    return oaconvolve(x, h)[: x.shape[0]]


# ------------------------------------------------------------------------------------------- modal bodies


def modal(modes, length_s: float) -> np.ndarray:
    """Impulse response of a resonant body: sum of a * exp(-6.9 t / t60) * sin(2 pi f t + phase).

    modes: [(freq_hz, t60_s, amp)] or [(freq_hz, t60_s, amp, phase_rad)]. Modes at or above
    0.47 x the sample rate are dropped (they would alias)."""
    n = n_samples(length_s)
    t = t_axis(n)
    out = np.zeros(n)
    for m in modes:
        f, t60, a = float(m[0]), float(m[1]), float(m[2])
        ph = float(m[3]) if len(m) > 3 else 0.0
        if f <= 0 or f >= SR * 0.47 or a == 0:
            continue
        out += a * np.exp(-T60 * t / max(t60, 1e-4)) * np.sin(2 * math.pi * f * t + ph)
    return out


def strike(modes, length_s: float, hardness_s: float = 0.0003) -> np.ndarray:
    """A modal body struck by a contact pulse of `hardness_s` (smaller = harder, brighter)."""
    return convolve(modal(modes, length_s), hann_pulse(hardness_s))


def jitter_modes(modes, seed, freq_pct: float = 3.0, t60_pct: float = 15.0, amp_db: float = 2.0):
    """Randomise a mode set a little (another key, another spot on the desk, another hit)."""
    g = rng("jitter-modes", seed)
    out = []
    for m in modes:
        f = m[0] * (1 + g.uniform(-freq_pct, freq_pct) / 100)
        t60 = m[1] * (1 + g.uniform(-t60_pct, t60_pct) / 100)
        a = m[2] * 10 ** (g.uniform(-amp_db, amp_db) / 20)
        out.append((f, t60, a) + tuple(m[3:]))
    return out


# ------------------------------------------------------------------------------------------- noise


def noise(n: int, seed, color: str = "white") -> np.ndarray:
    return synth.noise(n, color, seed=str(seed))


def ar_env(n: int, attack_s: float, t60_s: float, hold_s: float = 0.0) -> np.ndarray:
    """Raised-cosine attack from exactly 0, optional hold, then exponential decay (-60 dB at t60)."""
    t = t_axis(n)
    a = n_samples(attack_s)
    start_decay = attack_s + hold_s
    env = np.exp(-T60 * np.maximum(t - start_decay, 0.0) / max(t60_s, 1e-4))
    if a > 0:
        k = min(a, n)
        env[:k] *= 0.5 - 0.5 * np.cos(math.pi * np.arange(k) / a)
    elif n:
        env[0] = 0.0
    return env


def noise_burst(length_s: float, t60_s: float, seed, color: str = "white", attack_s: float = 0.0002) -> np.ndarray:
    n = n_samples(length_s)
    return noise(n, seed, color) * ar_env(n, attack_s, t60_s)


# ------------------------------------------------------------------------------------------- envelopes


def passby(n: int, t_peak_s: float, width_in_s: float, width_out_s: float, start_s: float = 0.0, end_s: float | None = None) -> np.ndarray:
    """Amplitude of a source passing the listener: 1 / sqrt(1 + ((t - tp) / w)^2), with a separate
    closest-approach width before and after the pass (an approach is usually heard longer), faded
    to exactly 0 at `start_s` and `end_s` with raised-cosine edges. Peak = 1 at t_peak_s."""
    t = t_axis(n)
    w = np.where(t < t_peak_s, width_in_s, width_out_s)
    a = 1.0 / np.sqrt(1.0 + ((t - t_peak_s) / w) ** 2)
    end_s = (n - 1) / SR if end_s is None else end_s
    # edges: the curve is lowest at the ends; subtract that floor so it starts and ends at 0
    a0 = 1.0 / math.sqrt(1.0 + ((start_s - t_peak_s) / width_in_s) ** 2)
    a1 = 1.0 / math.sqrt(1.0 + ((end_s - t_peak_s) / width_out_s) ** 2)
    floor = np.where(t < t_peak_s, a0, a1)
    a = np.clip((a - floor) / np.maximum(1.0 - floor, 1e-9), 0.0, None)
    a[(t < start_s) | (t > end_s)] = 0.0
    return a


def smoothstep(x):
    x = np.clip(x, 0.0, 1.0)
    return x * x * (3 - 2 * x)


def ramp(n: int, points, curve: str = "linear") -> np.ndarray:
    """Breakpoint curve [(seconds, value), ...]; curve 'exp' interpolates in log space."""
    return synth.env_points(n, points, sr=SR, curve=curve)


def bezier_ease(x1: float, y1: float, x2: float, y2: float):
    """CSS-style cubic-bezier easing (0,0)-(x1,y1)-(x2,y2)-(1,1) as a function of t in [0, 1],
    solved by Newton then bisection (the same curve as Remotion's Easing.bezier)."""

    def bx(s):
        return 3 * (1 - s) ** 2 * s * x1 + 3 * (1 - s) * s * s * x2 + s**3

    def by(s):
        return 3 * (1 - s) ** 2 * s * y1 + 3 * (1 - s) * s * s * y2 + s**3

    def dbx(s):
        return 3 * (1 - s) ** 2 * x1 + 6 * (1 - s) * s * (x2 - x1) + 3 * s * s * (1 - x2)

    def ease(t):
        t = np.clip(np.asarray(t, dtype=np.float64), 0.0, 1.0)
        s = t.copy()
        for _ in range(8):
            d = dbx(s)
            ok = np.abs(d) > 1e-6
            s = np.where(ok, s - (bx(s) - t) / np.where(ok, d, 1.0), s)
            s = np.clip(s, 0.0, 1.0)
        lo = np.zeros_like(t)
        hi = np.ones_like(t)
        for _ in range(30):  # polish (and rescue where Newton stalled)
            mid = 0.5 * (lo + hi)
            below = bx(mid) < t
            lo = np.where(below, mid, lo)
            hi = np.where(below, hi, mid)
        s = np.where(np.abs(bx(s) - t) < 1e-7, s, 0.5 * (lo + hi))
        return by(s)

    return ease


# ------------------------------------------------------------------------------------------- tones


def chirp(freq_hz, n: int | None = None) -> np.ndarray:
    """A sine following a per-sample frequency array (or a constant), starting at phase 0."""
    f = np.asarray(freq_hz, dtype=np.float64)
    if f.ndim == 0:
        if n is None:
            raise ValueError("n is required for a constant frequency")
        f = np.full(n, float(f))
    return synth.osc("sine", f, f.shape[0])


# ------------------------------------------------------------------------------------------- filters (causal)


def _sos(kind: str, f, order: int):
    from scipy.signal import butter

    return butter(order, f, btype=kind, fs=SR, output="sos")


def highpass(x: np.ndarray, f: float, order: int = 2) -> np.ndarray:
    from scipy.signal import sosfilt

    return sosfilt(_sos("highpass", f, order), x, axis=-1)


def lowpass(x: np.ndarray, f: float, order: int = 2) -> np.ndarray:
    from scipy.signal import sosfilt

    return sosfilt(_sos("lowpass", min(f, SR * 0.45), order), x, axis=-1)


def bandpass(x: np.ndarray, lo: float, hi: float, order: int = 2) -> np.ndarray:
    from scipy.signal import sosfilt

    return sosfilt(_sos("bandpass", [lo, min(hi, SR * 0.45)], order), x, axis=-1)


def eq(x: np.ndarray, bands) -> np.ndarray:
    """RBJ bands, e.g. [{"kind": "peak", "f": 3000, "q": 1.2, "db": -4}] (audiolib.dsp.eq), causal."""
    from audiolib import dsp

    a = as_channels(x)
    y = dsp.eq(a, bands)
    return y[0] if np.ndim(x) == 1 else y


def svf(x: np.ndarray, cutoff, q: float = 0.707, mode: str = "bandpass") -> np.ndarray:
    """Time-varying TPT state-variable filter (audiolib.synth.svf): cutoff may be per sample."""
    return synth.svf(x, cutoff, q=q, mode=mode)


# ------------------------------------------------------------------------------------------- stereo


def pan(x: np.ndarray, p) -> np.ndarray:
    """Constant-power pan of a mono signal; p in [-1, 1], scalar or per sample. Centre = -3 dB per
    side (the sum of both sides keeps the source's power)."""
    p = np.clip(np.broadcast_to(np.asarray(p, dtype=np.float64), x.shape), -1, 1)
    th = (p + 1) * math.pi / 4
    return np.vstack([x * np.cos(th), x * np.sin(th)])


def dual(x: np.ndarray) -> np.ndarray:
    """A point source in the centre: identical channels at the mono level (correlation 1)."""
    return np.vstack([x, x])


def place(dst: np.ndarray, src: np.ndarray, t_s: float, gain: float = 1.0) -> None:
    """Add src (mono or stereo) into dst (stereo) starting at t_s seconds (sample-rounded)."""
    s = as_channels(src)
    off = n_samples(t_s)
    if off >= dst.shape[1]:
        return
    k = min(s.shape[1], dst.shape[1] - off)
    if s.shape[0] == 1:
        dst[:, off : off + k] += gain * s[0, :k]
    else:
        dst[:, off : off + k] += gain * s[:, :k]


def place_at(dst: np.ndarray, src: np.ndarray, sample: int, gain: float = 1.0) -> None:
    """Like place, at an exact sample index."""
    s = as_channels(src)
    if sample >= dst.shape[1]:
        return
    k = min(s.shape[1], dst.shape[1] - sample)
    if s.shape[0] == 1:
        dst[:, sample : sample + k] += gain * s[0, :k]
    else:
        dst[:, sample : sample + k] += gain * s[:, :k]


# ------------------------------------------------------------------------------------------- friction


def slip_times(duration_s: float, rate_hz, seed, jitter: float = 0.25, start_s: float = 0.0) -> np.ndarray:
    """Times of the slips in a stick-slip creak: the rate (Hz, scalar or callable of time in s)
    sets the mean spacing; each interval is scaled by (1 + jitter * N(0,1)), clipped to stay
    positive. Returns times in seconds from 0."""
    g = rng("slips", seed)
    times = []
    t = start_s
    while t < duration_s:
        r = rate_hz(t) if callable(rate_hz) else float(rate_hz)
        if r <= 0:
            t += 0.001
            continue
        times.append(t)
        t += max(0.15, 1.0 + jitter * g.standard_normal()) / r
    return np.asarray(times)


def pulse_train(n: int, times_s, amps, width_s: float = 0.0002) -> np.ndarray:
    """Hann pulses (unit area x amp) at the given times: the excitation of a creak or a rattle."""
    out = np.zeros(n)
    p = hann_pulse(width_s)
    for t, a in zip(times_s, amps):
        i = n_samples(t)
        if i >= n:
            continue
        k = min(p.size, n - i)
        out[i : i + k] += a * p[:k]
    return out


def db(x: float) -> float:
    return 10 ** (x / 20.0)
