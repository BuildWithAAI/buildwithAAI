"""Dynamics: a linked-stereo compressor and a verified true-peak limiter.

Compressor: feed-forward, soft knee, peak or RMS detection, stereo-linked (one gain for both
channels, so the image never shifts), optional sidechain high-pass (so the bass does not pump the
bus), parallel mix and look-ahead. Gain smoothing is the "smooth decoupled" peak detector of
Giannoulis, Massberg & Reiss, "Digital Dynamic Range Compressor Design - A Tutorial and Analysis"
(JAES 60(6), 2012), run at a block rate of 8 samples (6 kHz at 48 kHz) and interpolated back to
the sample rate. pedalboard's Compressor (JUCE) detects each channel separately, which moves a
stereo image around, so it is not used on stereo material.

Limiter: pedalboard's BrickwallLimiter with 4x oversampled (true-peak) detection, then a check
with this package's own true-peak meter; if the ceiling is not met the limiter re-runs with a lower
internal ceiling (at most 4 passes), and as a last resort the whole file is trimmed down.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np

from .core import SR, as_channels, db_to_lin

BLOCK = 8


@dataclass
class Compressor:
    threshold_db: float = -18.0
    ratio: float = 2.0
    attack_ms: float = 10.0
    release_ms: float = 120.0
    knee_db: float = 6.0
    makeup_db: float = 0.0
    detector: str = "peak"  # or "rms"
    rms_ms: float = 10.0
    sidechain_hp_hz: float | None = None
    lookahead_ms: float = 0.0
    mix: float = 1.0  # 1 = fully compressed, <1 = parallel ("New York") compression

    def gain_computer(self, level_db: np.ndarray) -> np.ndarray:
        """Static curve: gain change in dB (<= 0) for a detector level in dB."""
        T, R, W = self.threshold_db, max(1.0, float(self.ratio)), max(0.0, float(self.knee_db))
        x = np.asarray(level_db, dtype=np.float64)
        over = x - T
        out = np.where(over > W / 2, T + over / R, x)
        if W > 0:
            knee = np.abs(over) <= W / 2
            out = np.where(knee, x + (1 / R - 1) * (over + W / 2) ** 2 / (2 * W), out)
        return out - x

    def process(self, audio, sr: int = SR, sidechain=None):
        """Return (output, gain_db) where gain_db is the per-sample gain change (<= 0, before makeup)."""
        a = as_channels(audio)
        sc = as_channels(sidechain) if sidechain is not None else a
        if sc.shape[1] != a.shape[1]:
            raise ValueError("sidechain length must match the audio")
        if self.sidechain_hp_hz:
            from .dsp import apply_sos, butter

            sc = apply_sos(sc, butter("highpass", self.sidechain_hp_hz, 2, sr))
        if self.detector == "rms":
            from scipy.ndimage import uniform_filter1d

            k = max(1, int(round(self.rms_ms * sr / 1000)))
            level = np.sqrt(uniform_filter1d(np.mean(sc * sc, axis=0), size=k, mode="nearest"))
        elif self.detector == "peak":
            level = np.max(np.abs(sc), axis=0)
        else:
            raise ValueError("detector must be 'peak' or 'rms'")
        gain_db = smooth_gain(self.gain_computer(20 * np.log10(np.maximum(level, 1e-12))), sr, self.attack_ms, self.release_ms)
        if self.lookahead_ms > 0:
            k = int(round(self.lookahead_ms * sr / 1000))
            gain_db = np.concatenate([gain_db[k:], np.full(k, gain_db[-1] if gain_db.size else 0.0)])
        g = np.power(10.0, (gain_db + self.makeup_db) / 20.0)
        wet = a * g
        if self.mix >= 1:
            return wet, gain_db
        dry = a * float(db_to_lin(self.makeup_db))
        return dry + (wet - dry) * float(self.mix), gain_db


def smooth_gain(gain_db: np.ndarray, sr: int, attack_ms: float, release_ms: float, block: int = BLOCK) -> np.ndarray:
    """Smooth a static gain-change curve (dB, <= 0) with attack/release ballistics.

    Works on the gain-reduction amount r = -gain (>= 0): per block, the largest demand is taken
    (so a short peak can never slip through between blocks), then
        y1 = max(r, aR*y1 + (1-aR)*r);  y = aA*y + (1-aA)*y1
    and the block values are linearly interpolated back to one value per sample."""
    r = -np.asarray(gain_db, dtype=np.float64)
    n = r.shape[0]
    if n == 0:
        return r
    nb = (n + block - 1) // block
    padded = np.zeros(nb * block)
    padded[:n] = r
    demand = padded.reshape(nb, block).max(axis=1)
    fs_b = sr / block
    aA = math.exp(-1.0 / (max(attack_ms, 0.01) * 1e-3 * fs_b))
    aR = math.exp(-1.0 / (max(release_ms, 0.01) * 1e-3 * fs_b))
    out = np.empty(nb)
    y1 = 0.0
    y = 0.0
    bA, bR = 1 - aA, 1 - aR
    for i, d in enumerate(demand.tolist()):
        v = aR * y1 + bR * d
        y1 = d if d > v else v
        y = aA * y + bA * y1
        out[i] = y
    centers = np.arange(nb) * block + (block - 1) / 2.0
    smoothed = np.interp(np.arange(n), centers, out)
    return -smoothed


def compress(audio, sr: int = SR, **kw):
    """Shortcut: Compressor(**kw).process(audio) -> (output, gain_db)."""
    return Compressor(**kw).process(audio, sr)


# ---------------------------------------------------------------------------------------- limiter


def limit(audio, ceiling_dbtp: float = -1.0, release_ms: float = 120.0, lookahead_ms: float = 5.0, sr: int = SR, margin_db: float = 0.3, max_passes: int = 4):
    """Brick-wall true-peak limiting to `ceiling_dbtp`, verified with `loudness.true_peak`.

    Returns (output, report) with report = {ceiling, internalCeiling, passes, truePeak,
    grMaxDb, grMeanDb, grOver1dBPct, trimDb}. The gain-reduction statistics compare 10 ms block
    peaks of the input and output (blocks that needed no reduction count as 0 dB)."""
    import pedalboard

    from .loudness import true_peak

    a = as_channels(audio).astype(np.float64)
    internal = ceiling_dbtp - margin_db
    out = a
    tp = true_peak(a)
    passes = 0
    if tp > ceiling_dbtp - 0.05:
        while passes < max_passes:
            passes += 1
            lim = pedalboard.BrickwallLimiter(ceiling_db=internal, release_ms=release_ms, lookahead_ms=lookahead_ms, true_peak=True)
            out = lim(a.astype(np.float32), sr).astype(np.float64)
            tp = true_peak(out)
            if tp <= ceiling_dbtp - 0.02:
                break
            internal -= (tp - ceiling_dbtp) + 0.1
    trim = 0.0
    if tp > ceiling_dbtp - 0.02:
        trim = (ceiling_dbtp - 0.05) - tp
        out = out * float(db_to_lin(trim))
        tp = true_peak(out)
    rep = gain_reduction_stats(a, out, sr)
    rep.update({"ceiling": ceiling_dbtp, "internalCeiling": round(internal, 3), "passes": passes, "truePeak": round(tp, 3), "trimDb": round(trim, 3)})
    return out, rep


def gain_reduction_stats(before, after, sr: int = SR, block_ms: float = 10.0) -> dict:
    b = as_channels(before)
    c = as_channels(after)
    k = max(1, int(round(block_ms * sr / 1000)))
    n = min(b.shape[1], c.shape[1]) // k * k
    if n == 0:
        return {"grMaxDb": 0.0, "grMeanDb": 0.0, "grOver1dBPct": 0.0}
    pb = np.abs(b[:, :n]).max(axis=0).reshape(-1, k).max(axis=1)
    pc = np.abs(c[:, :n]).max(axis=0).reshape(-1, k).max(axis=1)
    active = pb > 1e-6
    gr = np.zeros_like(pb)
    gr[active] = np.maximum(0.0, 20 * np.log10(pb[active] / np.maximum(pc[active], 1e-12)))
    return {
        "grMaxDb": round(float(gr.max()), 2),
        "grMeanDb": round(float(gr[active].mean()) if active.any() else 0.0, 2),
        "grOver1dBPct": round(100.0 * float((gr > 1.0).mean()), 2),
    }
