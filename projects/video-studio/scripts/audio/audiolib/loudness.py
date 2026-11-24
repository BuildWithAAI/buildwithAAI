"""Loudness per ITU-R BS.1770-4 / EBU R128 (Tech 3341, 3342), in numpy.

Used inside the mastering loop, where calling ffmpeg for every iteration would be slow. The metrics
tool (scripts/audio/metrics.py) measures with ffmpeg's ebur128 filter, and the tests check that the
two agree (within 0.1 LU for loudness and 0.2 dB for true peak on the test signals).

- K-weighting: the two BS.1770 biquads. At 48 kHz the coefficients are the published ones; other
  rates use the same analog prototype (as libebur128 does).
- Momentary: 400 ms windows; short-term: 3 s windows; both every 100 ms.
- Integrated: 400 ms blocks with 75 % overlap, absolute gate -70 LUFS, relative gate -10 LU.
- LRA (Tech 3342): short-term values, absolute gate -70, relative gate -20 LU, 10th..95th percentile.
- True peak: 4x oversampling (polyphase windowed sinc), the maximum absolute sample, in dBTP.
"""

from __future__ import annotations

import math

import numpy as np

from .core import SR, as_channels

ABS_GATE = -70.0
REL_GATE_I = -10.0
REL_GATE_LRA = -20.0

_K48 = (
    np.array([[1.53512485958697, -2.69169618940638, 1.19839281085285, 1.0, -1.69065929318241, 0.73248077421585],
              [1.0, -2.0, 1.0, 1.0, -1.99004745483398, 0.99007225036621]])
)


def k_weighting_sos(sr: int = SR) -> np.ndarray:
    if sr == 48000:
        return _K48.copy()
    # pre-filter: high shelf (from the published 48 kHz design, re-derived at `sr`)
    f0, G, Q = 1681.974450955533, 3.999843853973347, 0.7071752369554196
    K = math.tan(math.pi * f0 / sr)
    Vh = 10 ** (G / 20)
    Vb = Vh**0.4996667741545416
    a0 = 1 + K / Q + K * K
    b = [(Vh + Vb * K / Q + K * K) / a0, 2 * (K * K - Vh) / a0, (Vh - Vb * K / Q + K * K) / a0]
    a = [1.0, 2 * (K * K - 1) / a0, (1 - K / Q + K * K) / a0]
    # RLB high-pass
    f1, Q1 = 38.13547087602444, 0.5003270373238773
    K1 = math.tan(math.pi * f1 / sr)
    a01 = 1 + K1 / Q1 + K1 * K1
    b2 = [1.0, -2.0, 1.0]
    a2 = [1.0, 2 * (K1 * K1 - 1) / a01, (1 - K1 / Q1 + K1 * K1) / a01]
    return np.array([b + a, b2 + a2])


def _weighted_power(audio, sr: int) -> np.ndarray:
    """Per-channel K-weighted squared signal, (channels, samples)."""
    from scipy.signal import sosfilt

    a = as_channels(audio)
    y = sosfilt(k_weighting_sos(sr), a, axis=1)
    return y * y


def _block_means(power: np.ndarray, sr: int, window_s: float, hop_s: float) -> np.ndarray:
    """Mean K-weighted power per window, summed over channels (all weights 1.0 for L/R/mono).
    Returns an array of block powers (windows that would run past the end are dropped)."""
    win = int(round(window_s * sr))
    hop = int(round(hop_s * sr))
    n = power.shape[1]
    if n < win:
        return np.zeros(0)
    csum = np.concatenate([np.zeros((power.shape[0], 1)), np.cumsum(power, axis=1)], axis=1)
    starts = np.arange(0, n - win + 1, hop)
    sums = csum[:, starts + win] - csum[:, starts]
    return (sums / win).sum(axis=0)


def _to_lufs(p):
    p = np.asarray(p, dtype=np.float64)
    with np.errstate(divide="ignore"):
        return -0.691 + 10.0 * np.log10(np.maximum(p, 1e-30))


def integrated(audio, sr: int = SR) -> float:
    """Integrated loudness (LUFS). -inf for silence or anything shorter than 400 ms."""
    blocks = _block_means(_weighted_power(audio, sr), sr, 0.4, 0.1)
    return _gated(blocks)


def _gated(blocks: np.ndarray) -> float:
    if blocks.size == 0:
        return float("-inf")
    lk = _to_lufs(blocks)
    keep = blocks[lk > ABS_GATE]
    if keep.size == 0:
        return float("-inf")
    rel = _to_lufs(keep.mean()) + REL_GATE_I
    keep2 = keep[_to_lufs(keep) > rel]
    if keep2.size == 0:
        return float("-inf")
    return float(_to_lufs(keep2.mean()))


def momentary(audio, sr: int = SR) -> np.ndarray:
    """Momentary loudness (400 ms) every 100 ms, LUFS."""
    return _to_lufs(_block_means(_weighted_power(audio, sr), sr, 0.4, 0.1))


def short_term(audio, sr: int = SR) -> np.ndarray:
    """Short-term loudness (3 s) every 100 ms, LUFS."""
    return _to_lufs(_block_means(_weighted_power(audio, sr), sr, 3.0, 0.1))


def loudness_range(audio, sr: int = SR) -> float:
    """LRA in LU (EBU Tech 3342). 0 when there are fewer than two gated short-term values."""
    st = _block_means(_weighted_power(audio, sr), sr, 3.0, 0.1)
    if st.size == 0:
        return 0.0
    lk = _to_lufs(st)
    keep = st[lk > ABS_GATE]
    if keep.size < 2:
        return 0.0
    rel = _to_lufs(keep.mean()) + REL_GATE_LRA
    vals = _to_lufs(keep[_to_lufs(keep) > rel])
    if vals.size < 2:
        return 0.0
    lo, hi = np.percentile(vals, [10, 95])
    return float(hi - lo)


def true_peak(audio, factor: int = 4) -> float:
    """True peak in dBTP (max over channels) via `factor`x oversampling. -inf for silence."""
    a = as_channels(audio)
    if not a.size:
        return float("-inf")
    from .dsp import oversample

    up = oversample(a, factor)
    p = float(np.max(np.abs(up)))
    p = max(p, float(np.max(np.abs(a))))
    return 20.0 * math.log10(p) if p > 0 else float("-inf")


def sample_peak(audio) -> float:
    a = as_channels(audio)
    p = float(np.max(np.abs(a))) if a.size else 0.0
    return 20.0 * math.log10(p) if p > 0 else float("-inf")


def summary(audio, sr: int = SR) -> dict:
    """I, max/median short-term, max momentary, LRA, true and sample peak, PLR."""
    a = as_channels(audio)
    p = _weighted_power(a, sr)
    blocks = _block_means(p, sr, 0.4, 0.1)
    st_p = _block_means(p, sr, 3.0, 0.1)
    st = _to_lufs(st_p) if st_p.size else np.zeros(0)
    mom = _to_lufs(blocks) if blocks.size else np.zeros(0)
    i = _gated(blocks)
    tp = true_peak(a)
    st_active = st[st > ABS_GATE] if st.size else st
    return {
        "integrated": i,
        "shortTermMax": float(st.max()) if st.size else float("-inf"),
        "shortTermMedian": float(np.median(st_active)) if st_active.size else float("-inf"),
        "momentaryMax": float(mom.max()) if mom.size else float("-inf"),
        "lra": loudness_range(a, sr),
        "truePeak": tp,
        "samplePeak": sample_peak(a),
        "plr": (tp - i) if math.isfinite(i) and math.isfinite(tp) else None,
    }
