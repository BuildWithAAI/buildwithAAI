"""DSP building blocks (offline, float64, (channels, samples) arrays at 48 kHz).

Filters are RBJ "Audio EQ Cookbook" biquads and Butterworth sections run by scipy in float64.
Offline rendering allows zero-phase filtering (`zero_phase=True`, forward-backward) wherever phase
matters, e.g. the bass-mono crossover in `width`: the low and high bands then sum back exactly.
Saturation is computed at 4x oversampling so its harmonics do not alias back into the audio band.
"""

from __future__ import annotations

import math

import numpy as np

from .core import SR, as_channels, db_to_lin

# ---------------------------------------------------------------------------------------- filters


def biquad(kind: str, f0: float, sr: int = SR, q: float = 0.7071, gain_db: float = 0.0) -> np.ndarray:
    """One RBJ cookbook biquad as a scipy sos row [b0 b1 b2 1 a1 a2].

    kind: lowpass, highpass, bandpass (constant 0 dB peak), notch, peak, lowshelf, highshelf, allpass.
    For shelves, `q` is the cookbook Q (0.7071 = the steepest slope without overshoot)."""
    if not 0 < f0 < sr / 2:
        raise ValueError(f"f0 {f0} Hz must be between 0 and Nyquist ({sr / 2} Hz)")
    if q <= 0:
        raise ValueError("q must be positive")
    w0 = 2 * math.pi * f0 / sr
    cw, sw = math.cos(w0), math.sin(w0)
    alpha = sw / (2 * q)
    A = 10 ** (gain_db / 40)
    if kind == "lowpass":
        b = [(1 - cw) / 2, 1 - cw, (1 - cw) / 2]
        a = [1 + alpha, -2 * cw, 1 - alpha]
    elif kind == "highpass":
        b = [(1 + cw) / 2, -(1 + cw), (1 + cw) / 2]
        a = [1 + alpha, -2 * cw, 1 - alpha]
    elif kind == "bandpass":
        b = [alpha, 0.0, -alpha]
        a = [1 + alpha, -2 * cw, 1 - alpha]
    elif kind == "notch":
        b = [1.0, -2 * cw, 1.0]
        a = [1 + alpha, -2 * cw, 1 - alpha]
    elif kind == "allpass":
        b = [1 - alpha, -2 * cw, 1 + alpha]
        a = [1 + alpha, -2 * cw, 1 - alpha]
    elif kind == "peak":
        b = [1 + alpha * A, -2 * cw, 1 - alpha * A]
        a = [1 + alpha / A, -2 * cw, 1 - alpha / A]
    elif kind in ("lowshelf", "highshelf"):
        sq = 2 * math.sqrt(A) * alpha
        if kind == "lowshelf":
            b = [A * ((A + 1) - (A - 1) * cw + sq), 2 * A * ((A - 1) - (A + 1) * cw), A * ((A + 1) - (A - 1) * cw - sq)]
            a = [(A + 1) + (A - 1) * cw + sq, -2 * ((A - 1) + (A + 1) * cw), (A + 1) + (A - 1) * cw - sq]
        else:
            b = [A * ((A + 1) + (A - 1) * cw + sq), -2 * A * ((A - 1) + (A + 1) * cw), A * ((A + 1) + (A - 1) * cw - sq)]
            a = [(A + 1) - (A - 1) * cw + sq, 2 * ((A - 1) - (A + 1) * cw), (A + 1) - (A - 1) * cw - sq]
    else:
        raise ValueError(f"unknown biquad kind {kind!r}")
    b = np.asarray(b) / a[0]
    a = np.asarray(a) / a[0]
    return np.concatenate([b, a])[np.newaxis, :]


def butter(kind: str, fc, order: int = 2, sr: int = SR) -> np.ndarray:
    """Butterworth sos: kind lowpass/highpass (fc scalar) or bandpass (fc = (lo, hi))."""
    from scipy.signal import butter as _butter

    return _butter(order, fc, btype=kind, fs=sr, output="sos")


def linkwitz_riley(kind: str, fc: float, order: int = 4, sr: int = SR) -> np.ndarray:
    """Linkwitz-Riley crossover section (two cascaded Butterworths of half the order): -6 dB at fc,
    and the LR4 low and high outputs sum to an allpass."""
    if order % 2:
        raise ValueError("Linkwitz-Riley order must be even")
    half = butter(kind, fc, order // 2, sr)
    return np.vstack([half, half])


def apply_sos(audio, sos, zero_phase: bool = False) -> np.ndarray:
    from scipy.signal import sosfilt, sosfiltfilt

    a = as_channels(audio)
    sos = np.atleast_2d(np.asarray(sos, dtype=np.float64))
    if zero_phase:
        return sosfiltfilt(sos, a, axis=1)
    return sosfilt(sos, a, axis=1)


def eq(audio, bands, sr: int = SR, zero_phase: bool = False) -> np.ndarray:
    """Apply a list of bands, each a dict like {"kind": "peak", "f": 2500, "q": 0.8, "db": -3}
    or {"kind": "highpass", "f": 40, "order": 4} (Butterworth when "order" is given)."""
    sos = eq_sos(bands, sr)
    if sos is None:
        return as_channels(audio).copy()
    return apply_sos(audio, sos, zero_phase=zero_phase)


def eq_sos(bands, sr: int = SR):
    rows = []
    for b in bands:
        kind = b["kind"]
        if kind in ("highpass", "lowpass") and "order" in b:
            rows.append(butter(kind, b["f"], int(b["order"]), sr))
        else:
            rows.append(biquad(kind, b["f"], sr, b.get("q", 0.7071), b.get("db", 0.0)))
    return np.vstack(rows) if rows else None


def sos_response_db(sos, freqs, sr: int = SR) -> np.ndarray:
    """Magnitude response in dB of an sos cascade at the given frequencies (Hz)."""
    from scipy.signal import sosfreqz

    _, h = sosfreqz(np.atleast_2d(sos), worN=np.asarray(freqs, dtype=np.float64), fs=sr)
    return 20 * np.log10(np.maximum(np.abs(h), 1e-30))


def dc_block(audio, fc: float = 5.0, sr: int = SR) -> np.ndarray:
    """Remove DC with a zero-phase 2nd-order Butterworth high-pass at `fc` Hz."""
    return apply_sos(audio, butter("highpass", fc, 2, sr), zero_phase=True)


def remove_dc_mean(audio) -> np.ndarray:
    a = as_channels(audio)
    return a - a.mean(axis=1, keepdims=True)


# ---------------------------------------------------------------------------------------- gain / pan


def gain(audio, db: float) -> np.ndarray:
    return as_channels(audio) * float(db_to_lin(db))


def pan_mono(audio, pan: float) -> np.ndarray:
    """Constant-power pan of a mono signal to stereo: pan -1 = hard left, 0 = centre (-3 dB per side),
    +1 = hard right. Stereo input is folded to mono first."""
    a = as_channels(audio)
    m = a.mean(axis=0) if a.shape[0] > 1 else a[0]
    p = float(np.clip(pan, -1, 1))
    theta = (p + 1) * math.pi / 4
    return np.vstack([m * math.cos(theta), m * math.sin(theta)])


def balance(audio, pan: float) -> np.ndarray:
    """Stereo balance with a constant-power law normalised to unity at centre:
    pan -1 keeps the left channel at +3 dB and silences the right."""
    a = as_channels(audio)
    if a.shape[0] == 1:
        return pan_mono(a, pan)
    p = float(np.clip(pan, -1, 1))
    theta = (p + 1) * math.pi / 4
    gl = math.cos(theta) * math.sqrt(2)
    gr = math.sin(theta) * math.sqrt(2)
    return np.vstack([a[0] * gl, a[1] * gr])


def ms_encode(audio):
    a = as_channels(audio)
    if a.shape[0] != 2:
        raise ValueError("M/S needs stereo")
    return (a[0] + a[1]) * 0.5, (a[0] - a[1]) * 0.5


def ms_decode(mid, side) -> np.ndarray:
    return np.vstack([mid + side, mid - side])


def width(audio, amount: float = 1.0, bass_mono_hz: float | None = 120.0, sr: int = SR) -> np.ndarray:
    """Stereo width via mid/side: side x amount (0 = mono, 1 = unchanged, 1.5 = wider).

    With `bass_mono_hz`, side content below that frequency is removed (zero-phase split, so the
    rest of the side channel keeps its phase): the low end stays mono, which keeps it solid on
    phones and mono speakers and keeps vinyl-style and club systems happy."""
    a = as_channels(audio)
    if a.shape[0] == 1:
        return np.vstack([a[0], a[0]])
    mid, side = ms_encode(a)
    if bass_mono_hz:
        low = apply_sos(side, butter("lowpass", bass_mono_hz, 4, sr), zero_phase=True)[0]
        side = side - low
    return ms_decode(mid, side * float(amount))


# ---------------------------------------------------------------------------------------- envelopes


def fade(audio, fade_in: float = 0.0, fade_out: float = 0.0, sr: int = SR, curve: str = "sine") -> np.ndarray:
    """Fade in/out over the given seconds. curve: 'sine' (quarter-sine, smooth), 'linear', 'exp'
    (perceptually even for long fade-outs) or 'scurve' (raised cosine)."""
    a = as_channels(audio).copy()
    n = a.shape[1]
    for seconds, rising in ((fade_in, True), (fade_out, False)):
        k = min(n, int(round(seconds * sr)))
        if k <= 0:
            continue
        t = np.linspace(0.0, 1.0, k, endpoint=False) + 0.5 / k
        g = fade_curve(t, curve)
        if not rising:
            g = g[::-1]
            a[:, n - k :] *= g
        else:
            a[:, :k] *= g
    return a


def fade_curve(t, curve: str = "sine") -> np.ndarray:
    t = np.clip(np.asarray(t, dtype=np.float64), 0, 1)
    if curve == "linear":
        return t
    if curve == "sine":
        return np.sin(t * math.pi / 2)
    if curve == "scurve":
        return 0.5 - 0.5 * np.cos(t * math.pi)
    if curve == "exp":
        # -60 dB .. 0 dB, linear in dB, forced to exactly 0 at t=0
        g = np.power(10.0, (t - 1.0) * 3.0)
        return np.where(t <= 0, 0.0, (g - 1e-3) / (1 - 1e-3))
    raise ValueError(f"unknown fade curve {curve!r}")


def crossfade_loop(audio, overlap: float, sr: int = SR) -> np.ndarray:
    """Make a seamless loop: the last `overlap` seconds are equal-power crossfaded into the start,
    and the result is `overlap` seconds shorter. Playing the output back to back has no seam."""
    a = as_channels(audio)
    k = int(round(overlap * sr))
    if k <= 0 or 2 * k > a.shape[1]:
        raise ValueError("overlap must be positive and at most half the length")
    head, body, tail = a[:, :k], a[:, k:-k], a[:, -k:]
    t = (np.arange(k) + 0.5) / k
    fin, fout = np.sin(t * math.pi / 2), np.cos(t * math.pi / 2)
    blended = head * fin + tail * fout
    return np.concatenate([blended, body], axis=1)


# ---------------------------------------------------------------------------------------- saturation


def oversample(audio, factor: int = 4) -> np.ndarray:
    from .io import _poly

    return _poly(as_channels(audio), factor, 1)


def downsample(audio, factor: int = 4, cutoff: float = 1.0) -> np.ndarray:
    from .io import _poly

    return _poly(as_channels(audio), 1, factor, cutoff)


def saturate(audio, drive_db: float = 6.0, kind: str = "tanh", bias: float = 0.0, mix: float = 1.0, factor: int | None = None) -> np.ndarray:
    """Soft saturation with unity small-signal gain, computed at `factor`x oversampling (default 4x,
    8x above 12 dB of drive) and decimated through a filter at 90 % of Nyquist, so harmonics above
    the band cannot fold back. Measured on a 0.8-amplitude 5 kHz sine at 20 dB drive: the largest
    alias below 20 kHz is -109 dB at 8x (-68 dB at 4x).

    kind 'tanh' (smooth, odd harmonics), 'asym' (tanh with `bias`, adds even harmonics like tape and
    tubes; DC is removed after), 'cubic' (gentle polynomial soft clip). `drive_db` sets how hard the
    curve is hit: it is the gain into the curve; the output is scaled back so quiet passages stay at
    the same level. `mix` blends with the dry signal (parallel saturation)."""
    a = as_channels(audio)
    if drive_db <= 0 and kind != "asym":
        return a.copy()
    if factor is None:
        factor = 8 if drive_db > 12 else 4
    g = float(db_to_lin(drive_db))
    up = oversample(a, factor) if factor > 1 else a
    if kind == "tanh":
        y = np.tanh(g * up) / g
    elif kind == "asym":
        b = float(bias) if bias else 0.15
        t0 = math.tanh(b)
        slope = g * (1 - t0 * t0)
        y = (np.tanh(g * up + b) - t0) / slope
    elif kind == "cubic":
        z = np.clip(g * up, -1.0, 1.0)
        y = (1.5 * z - 0.5 * z**3) / (1.5 * g)
    else:
        raise ValueError(f"unknown saturation kind {kind!r}")
    out = downsample(y, factor, cutoff=0.9) if factor > 1 else y
    out = out[:, : a.shape[1]]
    if out.shape[1] < a.shape[1]:
        out = np.pad(out, ((0, 0), (0, a.shape[1] - out.shape[1])))
    if kind == "asym":
        out = dc_block(out)
    return a + (out - a) * float(mix) if mix < 1 else out


def delay(audio, seconds: float, sr: int = SR) -> np.ndarray:
    """Delay by a whole number of samples (rounded), keeping the length (the end is cut)."""
    a = as_channels(audio)
    k = int(round(seconds * sr))
    if k <= 0:
        return a.copy()
    out = np.zeros_like(a)
    out[:, k:] = a[:, : a.shape[1] - k]
    return out


def fractional_delay(signal_1d, delay_samples):
    """Per-sample variable delay of a 1-D signal (linear interpolation), for chorus/flanger/doppler.
    delay_samples: scalar or array (same length as the signal), >= 0."""
    x = np.asarray(signal_1d, dtype=np.float64)
    n = x.shape[0]
    d = np.broadcast_to(np.asarray(delay_samples, dtype=np.float64), (n,))
    pos = np.arange(n) - d
    i0 = np.floor(pos).astype(np.int64)
    frac = pos - i0
    valid0 = (i0 >= 0) & (i0 < n)
    valid1 = (i0 + 1 >= 0) & (i0 + 1 < n)
    x0 = np.where(valid0, x[np.clip(i0, 0, n - 1)], 0.0)
    x1 = np.where(valid1, x[np.clip(i0 + 1, 0, n - 1)], 0.0)
    return x0 * (1 - frac) + x1 * frac
