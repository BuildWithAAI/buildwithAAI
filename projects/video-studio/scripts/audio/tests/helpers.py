"""Shared test helpers: signal generators and spectral probes."""

from __future__ import annotations

import math
import shutil

import numpy as np

from audiolib import paths
from audiolib.core import SR


def sine(freq: float, seconds: float, amp: float = 0.5, sr: int = SR, phase: float = 0.0) -> np.ndarray:
    t = np.arange(int(round(seconds * sr))) / sr
    return amp * np.sin(2 * math.pi * freq * t + phase)


def stereo(x: np.ndarray) -> np.ndarray:
    return np.vstack([x, x])


def partial_hz(x: np.ndarray, f_expect: float, sr: int = SR, t0: float = 0.05, dur: float = 1.0) -> float:
    seg = x[int(t0 * sr) : int((t0 + dur) * sr)]
    seg = seg * np.hanning(len(seg))
    n = 1 << 21
    mag = np.abs(np.fft.rfft(seg, n))
    fr = np.fft.rfftfreq(n, 1 / sr)
    band = (fr > f_expect * 0.97) & (fr < f_expect * 1.03)
    k = int(np.argmax(np.where(band, mag, 0)))
    a, b, c = np.log(mag[k - 1 : k + 2] + 1e-30)
    return (k + 0.5 * (a - c) / (a - 2 * b + c)) * sr / n


def cents(f: float, ref: float) -> float:
    return 1200 * math.log2(f / ref)


def gain_at(x: np.ndarray, y: np.ndarray, freq: float, sr: int = SR) -> float:
    """dB gain from x to y at one frequency (both 1-D, same length)."""
    w = np.hanning(len(x))
    X = np.fft.rfft(x * w)
    Y = np.fft.rfft(y * w)
    fr = np.fft.rfftfreq(len(x), 1 / sr)
    k = int(np.argmin(np.abs(fr - freq)))
    return 20 * math.log10(abs(Y[k]) / abs(X[k]))


def have_fluidsynth() -> bool:
    return shutil.which("fluidsynth") is not None and any(sf.path.exists() for sf in paths.SOUNDFONTS.values())


def have_vcsl() -> bool:
    return (paths.VCSL / "LICENSE").exists()


def have_ffmpeg() -> bool:
    return shutil.which("ffmpeg") is not None
