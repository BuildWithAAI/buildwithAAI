"""VCSL one-shots for SFX layers (Versilian Community Sample Library, CC0 1.0; pinned in
docs/AUDIO_LICENSES.md and scripts/audio/setup.sh).

Pitch convention (measured 2026-11-24): VCSL file names use the "C3 = middle C" octave numbering,
so a file labelled D4 sounds D5 (587 Hz) in the scientific numbering the engine uses (C4 = MIDI 60).
Across the Kawai piano, vibraphone, marimba, hand chimes and glockenspiel, the energy at the
labelled pitch sits 27-102 dB below the energy one octave higher. This module therefore never
trusts a label: `sounding_midi` adds 12, and the tests measure the fundamental of every pitched
file the SFX use.
"""

from __future__ import annotations

import math
from functools import lru_cache

import numpy as np

from audiolib import io, paths
from audiolib.core import SR, as_stereo, hz_to_midi, midi_to_hz, note_number

SOUNDING_OFFSET = 12  # semitones: VCSL label (C3 = middle C) -> scientific pitch (C4 = 60)
REPO_URL = "https://github.com/sgossner/VCSL"


def sounding_midi(label: str) -> int:
    """MIDI note a VCSL note label actually sounds at (label 'D4' -> 74 = D5)."""
    return note_number(label) + SOUNDING_OFFSET


def provenance(rel: str) -> dict:
    return {
        "kind": "VCSL sample (processed)",
        "path": rel,
        "commit": paths.VCSL_COMMIT,
        "url": REPO_URL,
        "licence": "CC0-1.0",
        "licenceText": ".cache/vcsl/LICENSE (CC0 1.0 legal code, checked by scripts/audio/setup.sh)",
    }


@lru_cache(maxsize=64)
def _load_cached(rel: str, trim_db: float, pre_ms: float) -> np.ndarray:
    path = paths.vcsl_dir(rel)
    a = as_stereo(io.read(path, sr=SR))
    env = np.max(np.abs(a), axis=0)
    pk = float(env.max())
    if pk <= 0:
        raise ValueError(f"{rel} is silent")
    first = int(np.argmax(env >= pk * 10 ** (trim_db / 20)))
    start = max(0, first - int(round(pre_ms * SR / 1000)))
    out = a[:, start:] / pk  # DC and rumble are removed later, in finishing
    out.setflags(write=False)
    return out


def load(rel: str, trim_db: float = -40.0, pre_ms: float = 0.3) -> np.ndarray:
    """A VCSL file at 48 kHz (polyphase resampling from 44.1 kHz), stereo, peak 1.0, the head
    trimmed to `pre_ms` before the first sample above `trim_db` relative to its peak."""
    return _load_cached(rel, float(trim_db), float(pre_ms)).copy()


def shift(audio, semitones: float) -> np.ndarray:
    """Pitch (and speed) change by resampling: +12 = an octave up, half the length."""
    if semitones == 0:
        return as_stereo(audio).copy()
    return io.resample_ratio(as_stereo(audio), 2 ** (semitones / 12.0))


def to_pitch(audio, from_midi: float, to_midi: float) -> np.ndarray:
    return shift(audio, to_midi - from_midi)


def strongest_partial_hz(audio, t0: float = 0.02, dur: float = 0.4, lo: float = 60.0, hi: float = 8000.0) -> float:
    """Frequency of the strongest spectral peak (parabolic interpolation) in a window."""
    a = as_stereo(audio).mean(axis=0)
    s = a[int(t0 * SR) : int((t0 + dur) * SR)]
    if s.size < 256:
        s = a
    n = 1 << 19
    mag = np.abs(np.fft.rfft(s * np.hanning(s.size), n))
    fr = np.fft.rfftfreq(n, 1 / SR)
    band = (fr >= lo) & (fr <= hi)
    k = int(np.argmax(np.where(band, mag, 0)))
    y0, y1, y2 = np.log(mag[k - 1 : k + 2] + 1e-30)
    d = 0.5 * (y0 - y2) / (y0 - 2 * y1 + y2) if (y0 - 2 * y1 + y2) != 0 else 0.0
    return float((k + d) * SR / n)


def cents_off(f_hz: float, midi: float) -> float:
    return float(1200 * math.log2(f_hz / float(midi_to_hz(midi))))


def nearest_midi(f_hz: float) -> int:
    return int(round(float(hz_to_midi(f_hz))))


def varispeed(audio, rate: np.ndarray) -> np.ndarray:
    """Play `audio` with a speed that changes every sample (1 = normal; 0.5 = half speed, an octave
    down). Output length = len(rate). The read position is the running sum of the rate; samples are
    read with 4-point cubic (Catmull-Rom) interpolation. The source is low-passed first at
    0.45 x 48 kHz / max(rate), so speeding up never folds content back below Nyquist."""
    from audiolib.dsp import apply_sos, butter

    a = as_stereo(audio)
    rate = np.asarray(rate, dtype=np.float64)
    if np.any(rate < 0):
        raise ValueError("rate must be >= 0")
    top = float(rate.max()) if rate.size else 1.0
    if top > 1.0:
        a = apply_sos(a, butter("lowpass", 0.45 * SR / top, 8))
    pos = np.concatenate([[0.0], np.cumsum(rate[:-1])])
    i = np.floor(pos).astype(np.int64)
    f = pos - i
    n_src = a.shape[1]

    def tap(k):
        kk = np.clip(k, 0, n_src - 1)
        v = a[:, kk]
        return np.where((k >= 0) & (k < n_src), v, 0.0)

    p0, p1, p2, p3 = tap(i - 1), tap(i), tap(i + 1), tap(i + 2)
    c0 = p1
    c1 = 0.5 * (p2 - p0)
    c2 = p0 - 2.5 * p1 + 2 * p2 - 0.5 * p3
    c3 = 0.5 * (p3 - p0) + 1.5 * (p1 - p2)
    return ((c3 * f + c2) * f + c1) * f + c0
