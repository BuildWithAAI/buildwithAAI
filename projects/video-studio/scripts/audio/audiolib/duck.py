"""Ducking: lower a music bed under narration.

    act = voice_activity(voice)                   # or activity_from_intervals([(0.4, 2.1), ...], n)
    gain_db = duck_gain(act, depth_db=6.0)        # 0 dB in pauses, -6 dB under speech
    ducked = apply_gain(bed, gain_db)
    per_frame = frame_gains(gain_db, fps=30)      # linear gains for Remotion's volume callback

Speech detection: RMS of the 150 Hz-4 kHz band in 30 ms windows every 10 ms; a frame is speech when
it is within `range_db` of the voice's loud level (its 95th percentile) and above `floor_dbfs`.
Gaps shorter than `min_gap` (default 0.35 s, the pauses between words and short phrases) are filled
so the bed does not pump on every word; only real pauses let the music up.

Gain: the target is `-depth_db` during speech; the curve moves at most `depth_db / attack` dB per
second going down and `depth_db / release` going up (straight ramps in dB, interpolated per
sample, so there is no zipper noise). Each duck starts `lookahead` early, so it is complete when the
first word lands, and releases only after the speech ends. Starting values (150 ms attack, 500 ms release, 120 ms lookahead, 6 dB) follow common
broadcast practice; tune them by ear per show.
"""

from __future__ import annotations

import math

import numpy as np

from .core import SR, as_channels


def voice_activity(voice, sr: int = SR, hop: float = 0.01, window: float = 0.03, range_db: float = 30.0, floor_dbfs: float = -55.0, min_gap: float = 0.35, min_speech: float = 0.08) -> np.ndarray:
    """Per-sample speech mask (bool, length of `voice`)."""
    from .dsp import apply_sos, butter

    v = as_channels(voice).mean(axis=0)
    n = v.shape[0]
    band = apply_sos(v, butter("bandpass", (150.0, 4000.0), 2, sr))[0]
    h = max(1, int(round(hop * sr)))
    w = max(h, int(round(window * sr)))
    frames = max(1, (n - w) // h + 1)
    idx = np.arange(frames)[:, None] * h + np.arange(w)[None, :]
    idx = np.minimum(idx, n - 1)
    rms = np.sqrt(np.mean(band[idx] ** 2, axis=1))
    db = 20 * np.log10(np.maximum(rms, 1e-12))
    loud = float(np.percentile(db, 95)) if frames else -120.0
    speech = (db > loud - range_db) & (db > floor_dbfs)
    speech = _fill_gaps(speech, int(round(min_gap / hop)))
    speech = _drop_short(speech, int(round(min_speech / hop)))
    mask = np.zeros(n, dtype=bool)
    for i in np.nonzero(speech)[0]:
        mask[i * h : i * h + w] = True
    return mask


def activity_from_intervals(intervals, n: int, sr: int = SR, min_gap: float = 0.35) -> np.ndarray:
    """Per-sample speech mask from [(start_s, end_s), ...] (e.g. word timings), gaps < min_gap filled."""
    mask = np.zeros(n, dtype=bool)
    spans = sorted((max(0.0, a), max(0.0, b)) for a, b in intervals if b > a)
    merged = []
    for a, b in spans:
        if merged and a - merged[-1][1] < min_gap:
            merged[-1][1] = max(merged[-1][1], b)
        else:
            merged.append([a, b])
    for a, b in merged:
        mask[int(round(a * sr)) : int(round(b * sr))] = True
    return mask


def duck_gain(activity: np.ndarray, depth_db: float = 6.0, attack: float = 0.15, release: float = 0.5, lookahead: float = 0.12, sr: int = SR, block: int = 48) -> np.ndarray:
    """Per-sample gain in dB (0 .. -depth_db) from a speech mask."""
    act = np.asarray(activity, dtype=bool)
    n = act.shape[0]
    if n == 0:
        return np.zeros(0)
    nb = (n + block - 1) // block
    padded = np.zeros(nb * block, dtype=bool)
    padded[:n] = act
    target = np.where(padded.reshape(nb, block).any(axis=1), -float(depth_db), 0.0)
    k = int(round(lookahead * sr / block))
    if k > 0:
        # duck early but release on time: the deeper of the target and the target seen `lookahead` ahead
        early = np.concatenate([target[k:], np.full(k, target[-1])])
        target = np.minimum(target, early)
    down = depth_db / max(attack, 1e-3) * block / sr  # dB per block
    up = depth_db / max(release, 1e-3) * block / sr
    g = np.empty(nb)
    cur = 0.0
    for i, t in enumerate(target.tolist()):
        if t < cur:
            cur = max(t, cur - down)
        elif t > cur:
            cur = min(t, cur + up)
        g[i] = cur
    centers = np.arange(nb) * block + (block - 1) / 2.0
    return np.interp(np.arange(n), centers, g)


def apply_gain(audio, gain_db: np.ndarray) -> np.ndarray:
    a = as_channels(audio)
    if gain_db.shape[0] != a.shape[1]:
        raise ValueError("gain curve and audio lengths differ")
    return a * np.power(10.0, gain_db / 20.0)


def frame_gains(gain_db: np.ndarray, fps: int = 30, sr: int = SR) -> list:
    """Mean linear gain per video frame (Remotion: volume={(f) => gains[f]})."""
    per = sr / fps
    frames = int(math.ceil(gain_db.shape[0] / per))
    lin = np.power(10.0, gain_db / 20.0)
    out = []
    for f in range(frames):
        seg = lin[int(round(f * per)) : int(round((f + 1) * per))]
        out.append(round(float(seg.mean()) if seg.size else float(lin[-1]), 4))
    return out


def _fill_gaps(x: np.ndarray, max_gap: int) -> np.ndarray:
    y = x.copy()
    on = np.nonzero(x)[0]
    if on.size < 2:
        return y
    gaps = np.nonzero(np.diff(on) > 1)[0]
    for g in gaps:
        a, b = on[g], on[g + 1]
        if b - a - 1 <= max_gap:
            y[a:b] = True
    return y


def _drop_short(x: np.ndarray, min_len: int) -> np.ndarray:
    y = x.copy()
    d = np.diff(np.concatenate([[0], x.astype(np.int8), [0]]))
    starts = np.nonzero(d == 1)[0]
    ends = np.nonzero(d == -1)[0]
    for s, e in zip(starts, ends):
        if e - s < min_len:
            y[s:e] = False
    return y
