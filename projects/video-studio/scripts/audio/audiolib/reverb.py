"""Convolution reverb with a synthesised (algorithmic) impulse response.

Why not pedalboard.Reverb: it is Freeverb (JUCE), whose comb-filter tail rings metallically on
sustained piano and pads. A synthesised IR gives a smooth, dense, natural tail with control over
decay per frequency band, and it is deterministic (seeded).

IR model (per channel, independent noise so L and R are decorrelated):
- pre-delay, then ~14 early reflections spread over `er_ms` with 1/(1+t) level fall-off and
  per-channel timing, each one low-passed a little more the later it arrives;
- a late tail of Gaussian noise split into octave bands with complementary zero-phase low-passes
  (the bands sum back exactly), each band with its own exponential decay: RT60 rises to
  `rt60 * low_ratio` at 63 Hz and falls to `rt60 * (1 - 0.75 * damping)` at 16 kHz, like a
  real room where air and surfaces absorb highs first;
- a diffusion build-up (the tail fades in over `build_ms`);
- return EQ applied to the IR itself: high-pass `hp_hz` and low-pass `lp_hz` (the classic
  "keep the low end and the sibilance out of the reverb" move);
- each channel normalised to unit energy, so a send at -12 dB returns about 12 dB under the dry
  signal for broadband material.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from .core import SR, as_channels, rng
from .dsp import apply_sos, butter

BANDS = [63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000]


@dataclass(frozen=True)
class Room:
    rt60: float = 1.6
    predelay_ms: float = 18.0
    er_ms: float = 40.0
    er_level_db: float = -6.0
    build_ms: float = 25.0
    damping: float = 0.5
    low_ratio: float = 1.1
    width: float = 1.0
    hp_hz: float = 180.0
    lp_hz: float = 9500.0
    seed: str = "room"


PRESETS = {
    # small, tight, bright-ish: drums, plucks
    "room": Room(rt60=0.7, predelay_ms=6, er_ms=22, er_level_db=-3, build_ms=10, damping=0.45, low_ratio=1.0, hp_hz=220, lp_hz=10000, seed="room"),
    # smooth plate-like: piano, keys, snare
    "plate": Room(rt60=1.6, predelay_ms=18, er_ms=12, er_level_db=-12, build_ms=6, damping=0.35, low_ratio=0.9, hp_hz=200, lp_hz=11000, seed="plate"),
    # medium hall: pads, strings, stings
    "hall": Room(rt60=2.4, predelay_ms=28, er_ms=60, er_level_db=-7, build_ms=40, damping=0.55, low_ratio=1.15, hp_hz=160, lp_hz=8500, seed="hall"),
    # long, dark: cinematic risers and ambient beds
    "cathedral": Room(rt60=4.5, predelay_ms=40, er_ms=90, er_level_db=-9, build_ms=70, damping=0.65, low_ratio=1.2, hp_hz=140, lp_hz=7000, seed="cathedral"),
}


def _rt_at(f: float, room: Room) -> float:
    """RT60 at frequency f: low_ratio at 63 Hz, 1.0 at 500 Hz-1 kHz, (1 - 0.75 damping) at 16 kHz,
    log-frequency interpolation."""
    lf = np.log2(f)
    pts = np.log2([63.0, 500.0, 1000.0, 16000.0])
    mult = np.interp(lf, pts, [room.low_ratio, 1.0, 1.0, 1.0 - 0.75 * room.damping])
    return max(0.05, room.rt60 * float(mult))


def impulse_response(room: Room | str = "plate", sr: int = SR) -> np.ndarray:
    """Stereo IR, (2, n) float64."""
    if isinstance(room, str):
        room = PRESETS[room]
    longest = max(_rt_at(f, room) for f in BANDS)
    pre = int(round(room.predelay_ms * sr / 1000))
    n_tail = int(np.ceil(longest * 1.25 * sr))
    n = pre + n_tail
    t = np.arange(n_tail) / sr
    out = np.zeros((2, n))
    edges = [np.sqrt(BANDS[i] * BANDS[i + 1]) for i in range(len(BANDS) - 1)]
    for ch in range(2):
        g = rng("reverb", room.seed, ch)
        noise = g.standard_normal(n_tail)
        # complementary band split: band_k = LP(e_k) - LP(e_{k-1}); the bands sum to `noise`
        lows = [apply_sos(noise, butter("lowpass", e, 4, sr), zero_phase=True)[0] for e in edges]
        tail = np.zeros(n_tail)
        prev = np.zeros(n_tail)
        for k, f in enumerate(BANDS):
            cur = lows[k] if k < len(edges) else noise
            band = cur - prev
            prev = cur
            tail += band * np.exp(-6.907755 * t / _rt_at(f, room))
        build = 1.0 - np.exp(-t / max(room.build_ms / 1000.0, 1e-4))
        tail *= build
        # early reflections
        er = np.zeros(n_tail)
        k_count = 14
        times = np.sort(g.uniform(0.08, 1.0, k_count)) * room.er_ms / 1000.0
        for i, tt in enumerate(times):
            idx = int(round(tt * sr))
            if idx < n_tail:
                er[idx] += g.choice([-1.0, 1.0]) * (1.0 / (1.0 + 25.0 * tt)) * g.uniform(0.6, 1.0)
        if np.any(er):
            er = apply_sos(er, butter("lowpass", 7000, 2, sr))[0]
            tail_e = float(np.sum(tail**2))
            er_e = float(np.sum(er**2))
            if er_e > 0 and tail_e > 0:
                er *= np.sqrt(tail_e / er_e) * 10 ** (room.er_level_db / 20)
        out[ch, pre:] = tail + er
    if room.width < 1.0:
        w = max(0.0, float(room.width))
        m = 0.5 * (out[0] + out[1])
        out = np.vstack([m + w * (out[0] - m), m + w * (out[1] - m)])
    rows = []
    if room.hp_hz:
        rows.append(butter("highpass", room.hp_hz, 2, sr))
    if room.lp_hz:
        rows.append(butter("lowpass", room.lp_hz, 2, sr))
    if rows:
        out = apply_sos(out, np.vstack(rows))
    # fade the last 5% so the IR ends at exactly zero
    k = max(1, n // 20)
    out[:, -k:] *= np.cos(np.linspace(0, np.pi / 2, k)) ** 2
    e = np.sqrt(np.sum(out**2, axis=1, keepdims=True))
    return out / np.maximum(e, 1e-12)


def convolve(audio, ir: np.ndarray) -> np.ndarray:
    """Stereo convolution: left with ir[0], right with ir[1]. Output is len(audio) + len(ir) - 1."""
    from scipy.signal import oaconvolve

    a = as_channels(audio)
    if a.shape[0] == 1:
        a = np.vstack([a, a])
    h = as_channels(ir)
    if h.shape[0] == 1:
        h = np.vstack([h, h])
    return np.vstack([oaconvolve(a[0], h[0]), oaconvolve(a[1], h[1])])


def rt60_estimate(ir_1d: np.ndarray, sr: int = SR) -> float:
    """Schroeder backward integration, T30 fit (-5 to -35 dB) x 2. For tests and reports."""
    e = np.cumsum(np.asarray(ir_1d, dtype=np.float64)[::-1] ** 2)[::-1]
    edc = 10 * np.log10(np.maximum(e / e[0], 1e-30))
    i5 = int(np.argmax(edc <= -5))
    i35 = int(np.argmax(edc <= -35))
    if i35 <= i5:
        return float("nan")
    x = np.arange(i5, i35) / sr
    slope = np.polyfit(x, edc[i5:i35], 1)[0]
    return float(-60.0 / slope)
