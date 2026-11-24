"""The finishing chain every effect goes through, so the whole library behaves the same way.

1. Causal Butterworth high-pass (removes DC and rumble; 2nd order, the family's corner per sound)
   and an optional gentle low-pass (keeps the very top from fizzing on phones and earbuds). Causal
   filters never smear energy before a transient, so impacts stay crisp and on time.
2. No step at the start: a sound whose first sample is not ~0 gets a 0.25 ms raised-cosine fade-in.
3. A clean end: the file is cut 2 ms after the last sample above -72 dB re its peak (at least
   -78 dBFS, far under any bed or voice) and the last few milliseconds are faded to exactly zero
   (raised cosine), so nothing ends on a cut.
4. Sample peak normalised to -6 dBFS.
5. 512 samples (10.7 ms) of digital silence appended: the 24-bit writer dithers every 256-sample
   block that holds any sound and leaves all-zero blocks exactly zero, so the file ends in true
   digital silence rather than on 1-LSB dither.
Loops are filtered circularly (three copies, keep the middle) and never faded, so the seam stays
seamless. Finishing never moves audio in time: designed sync points stay on their frames.
"""

from __future__ import annotations

import math

import numpy as np

from audiolib.core import SR, as_stereo

from . import prims
from .core import PEAK_DBFS, Sound

TAIL_FLOOR_DB = -72.0
SILENT_PAD = 512  # two of the writer's 256-sample dither blocks
TAIL_KEEP_S = 0.002
FADE_IN_S = 0.00025


def finalize(sound: Sound) -> np.ndarray:
    a = as_stereo(np.asarray(sound.audio, dtype=np.float64))
    if a.shape[1] < 16:
        raise ValueError(f"{sound.id}: too short to finish")
    if not np.all(np.isfinite(a)):
        raise ValueError(f"{sound.id}: audio has NaN or Inf")
    if float(np.max(np.abs(a))) <= 0:
        raise ValueError(f"{sound.id}: audio is silent")
    if sound.loop:
        return _finish_loop(a, sound)
    a = _filter(a, sound)
    a = _soft_start(a)
    a = clean_tail(a)
    a = normalize(a)
    return np.concatenate([a, np.zeros((a.shape[0], SILENT_PAD))], axis=1)


def _filter(a: np.ndarray, sound: Sound) -> np.ndarray:
    a = prims.highpass(a, sound.hp_hz if sound.hp_hz else 10.0, order=2)
    if sound.lp_hz:
        a = prims.lowpass(a, sound.lp_hz, order=2)
    return a


def _soft_start(a: np.ndarray) -> np.ndarray:
    pk = float(np.max(np.abs(a)))
    if float(np.max(np.abs(a[:, 0]))) <= pk * 1e-4:
        return a
    k = max(2, int(round(FADE_IN_S * SR)))
    out = a.copy()
    out[:, :k] *= 0.5 - 0.5 * np.cos(math.pi * np.arange(k) / k)
    return out


def clean_tail(a: np.ndarray, floor_db: float = TAIL_FLOOR_DB, fade_s: float | None = None) -> np.ndarray:
    env = np.max(np.abs(a), axis=0)
    pk = float(env.max())
    above = np.nonzero(env > pk * 10 ** (floor_db / 20))[0]
    end = min(a.shape[1], int(above[-1]) + 1 + int(round(TAIL_KEEP_S * SR))) if above.size else a.shape[1]
    out = a[:, :end].copy()
    if fade_s is None:
        fade_s = min(0.02, max(0.002, 0.08 * end / SR))
    k = min(end, max(2, int(round(fade_s * SR))))
    out[:, end - k :] *= 0.5 + 0.5 * np.cos(math.pi * np.arange(1, k + 1) / k)
    out[:, -1] = 0.0
    return out


def normalize(a: np.ndarray, peak_dbfs: float = PEAK_DBFS) -> np.ndarray:
    pk = float(np.max(np.abs(a)))
    return a * (10 ** (peak_dbfs / 20.0) / pk)


def _finish_loop(a: np.ndarray, sound: Sound) -> np.ndarray:
    n = a.shape[1]
    x = np.concatenate([a, a, a], axis=1)
    x = _filter(x, sound)
    return normalize(x[:, n : 2 * n].copy())


def tail_headroom_db(a: np.ndarray, window_s: float = 0.012) -> float:
    """Level (RMS) of the window just before the final fade, re the peak: how far the sound had
    decayed before finishing cut it. Designs keep this under -60 dB so no fade is ever heard."""
    pk = float(np.max(np.abs(a)))
    w = int(round(window_s * SR))
    end = a.shape[1]
    seg = a[:, max(0, end - 2 * w) : max(1, end - w)]
    r = float(np.sqrt(np.mean(seg**2))) if seg.size else 0.0
    return -200.0 if r <= 0 else 20 * math.log10(r / pk)
