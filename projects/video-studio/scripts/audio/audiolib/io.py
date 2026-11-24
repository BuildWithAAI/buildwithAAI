"""WAV I/O and resampling.

- `read` returns (channels, samples) float64 at the requested rate (48 kHz by default).
- `write` stores 24-bit PCM by default with TPDF dither (or 32-bit float, or 16-bit PCM with
  TPDF dither). Digital silence stays exactly zero (dither is muted on all-zero blocks), so
  silent heads and tails of SFX stay silent.
- `resample` converts between rates, and `resample_ratio` changes the playback speed by any real
  ratio (the sampler's pitch shift): a polyphase windowed-sinc filter (scipy `resample_poly`,
  Kaiser beta 8.6, which puts the stopband at about -90 dB) with the ratio approximated by a
  fraction whose denominator is at most 4096. That keeps the pitch error under 0.01 cent.
"""

from __future__ import annotations

from fractions import Fraction
from functools import lru_cache
from pathlib import Path

import numpy as np

from .core import SR, as_channels

KAISER_BETA = 8.6
MAX_DENOMINATOR = 4096
SUBTYPES = {"PCM_16": 16, "PCM_24": 24, "FLOAT": None}


def read(path, sr: int | None = SR) -> np.ndarray:
    """Read any soundfile-supported file as (channels, samples) float64, resampled to `sr`
    (None keeps the file's own rate; use `info` to get it)."""
    import soundfile as sf

    data, file_sr = sf.read(str(path), dtype="float64", always_2d=True)
    audio = np.ascontiguousarray(data.T)
    if sr is not None and file_sr != sr:
        audio = resample(audio, file_sr, sr)
    return audio


def info(path) -> dict:
    import soundfile as sf

    i = sf.info(str(path))
    return {"samplerate": i.samplerate, "channels": i.channels, "frames": i.frames, "subtype": i.subtype, "format": i.format, "duration": i.duration}


def write(path, audio, sr: int = SR, subtype: str = "PCM_24", dither: bool = True, seed: int = 0) -> Path:
    """Write (channels, samples) audio. PCM output is dithered (TPDF) unless `dither` is False.
    Values beyond full scale raise: clipping must be fixed upstream, never by the file writer."""
    import soundfile as sf

    if subtype not in SUBTYPES:
        raise ValueError(f"subtype must be one of {sorted(SUBTYPES)}")
    a = as_channels(audio)
    if not np.all(np.isfinite(a)):
        raise ValueError("audio contains NaN or Inf")
    bits = SUBTYPES[subtype]
    if bits is not None:
        peak = float(np.max(np.abs(a))) if a.size else 0.0
        if peak > 1.0:
            raise ValueError(f"sample peak {peak:.4f} is over full scale; limit or lower the gain first")
        a = quantize(a, bits, dither=dither, seed=seed)
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    sf.write(str(path), a.T, sr, subtype=subtype, format="WAV")
    return path


def quantize(audio, bits: int, dither: bool = True, seed: int = 0, block: int = 256) -> np.ndarray:
    """Round to `bits` signed PCM steps (returned as float in [-1, 1)), with TPDF dither of +-1 LSB.

    Blocks of `block` samples that are entirely zero are left at exactly zero ("auto-black")."""
    a = as_channels(audio)
    q = 2.0 ** (bits - 1)
    x = a * q
    if dither:
        rng = np.random.default_rng(seed)
        d = rng.random(x.shape) - rng.random(x.shape)  # triangular, +-1 LSB
        n = x.shape[1]
        nb = (n + block - 1) // block
        padded = np.zeros((x.shape[0], nb * block))
        padded[:, :n] = np.abs(x)
        active = padded.reshape(x.shape[0], nb, block).max(axis=2) > 0
        mask = np.repeat(active, block, axis=1)[:, :n]
        x = x + d * mask
    y = np.round(x)
    y = np.clip(y, -q, q - 1)
    return y / q


def resample(audio, sr_from: int, sr_to: int) -> np.ndarray:
    """Rate conversion between two integer rates (exact rational ratio)."""
    if sr_from == sr_to:
        return as_channels(audio).copy()
    f = Fraction(sr_to, sr_from)
    return _poly(as_channels(audio), f.numerator, f.denominator)


def resample_ratio(audio, ratio: float) -> np.ndarray:
    """Play audio `ratio` times faster (ratio 2.0 = an octave up, half the length).

    Implemented as a rate change by 1/ratio with a rational approximation of the ratio."""
    if ratio <= 0:
        raise ValueError("ratio must be positive")
    f = Fraction(1.0 / ratio).limit_denominator(MAX_DENOMINATOR)
    if f.numerator == f.denominator:
        return as_channels(audio).copy()
    return _poly(as_channels(audio), f.numerator, f.denominator)


@lru_cache(maxsize=64)
def _filter(up: int, down: int, cutoff: float = 1.0) -> np.ndarray:
    """Kaiser-windowed sinc low-pass for resample_poly; `cutoff` is the fraction of the lower
    Nyquist (1.0 for rate conversion; saturation decimates with 0.9, see dsp.downsample)."""
    from scipy.signal import firwin

    max_rate = max(up, down)
    half_len = 16 * max_rate  # 16 zero crossings each side: a sharper transition than scipy's default 10
    # resample_poly multiplies the coefficients by `up` itself (and copies them first)
    return firwin(2 * half_len + 1, cutoff / max_rate, window=("kaiser", KAISER_BETA))


def _poly(a: np.ndarray, up: int, down: int, cutoff: float = 1.0) -> np.ndarray:
    from scipy.signal import resample_poly

    return resample_poly(a, up, down, axis=1, window=_filter(up, down, cutoff))
