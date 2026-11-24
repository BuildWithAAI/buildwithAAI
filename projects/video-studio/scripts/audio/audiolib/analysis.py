"""Measurements for scripts/audio/metrics.py. Every function takes (channels, samples) audio at 48 kHz.

EBU R128 numbers (integrated, short-term, momentary, LRA, true peak) come from ffmpeg's ebur128
filter (`ffmpeg_ebur128`), the reference the rest of the studio and YouTube-facing checks use; the
numpy meter in loudness.py is reported next to it as a cross-check.

Definitions (also in docs/AUDIO.md):
- crest factor: sample peak over RMS of the whole file, both channels pooled, in dB;
- PSR: per 3 s window (hop 1 s), sample peak in dBFS minus the window's loudness; min and median.
  Once a master is normalised to a loudness and a ceiling, PLR and the crest factor are nearly
  pinned; PSR still shows where transients were squashed;
- DC offset: per-channel mean, linear;
- clipping: samples at or above 0.9999 of full scale, and runs of 3+ consecutive such samples;
- stereo: Pearson correlation of L and R (whole file; and 400 ms windows weighted by energy),
  the same below 150 Hz ("low correlation", which should be ~1: mono bass), and the mono
  fold-down loss = LUFS((L+R)/2 on both channels) - LUFS(stereo);
- spectrum: long-term average spectrum (Welch, 8192-point Hann, 50 % overlap, mean of channel
  powers) as mean power density per octave band (31.5 Hz .. 16 kHz). Pink noise has a density slope
  of -3 dB/octave, which is the target tilt; the reference line has that slope and is fitted
  (offset only) to the 63 Hz-8 kHz bands. Reported: each band's deviation from that line, the
  track's own least-squares slope, "harshness" = mean deviation over 2-5 kHz, "mud" = mean
  deviation over 200-500 Hz, "presence" = 1-4 kHz (positive = more than the target tilt), and the
  "voice pocket" = 1-4 kHz against the tilt of the rest of the spectrum (a line through the
  63-500 Hz and 8 kHz bands; negative = a dip that leaves room for narration; the bed preset
  makes one);
- loop seam: the file is played end-to-start; the largest second difference within 1 ms of the
  seam is compared with the largest one in the 50 ms on either side (click ratio: a hit on the
  downbeat reads about 1-1.5, a cut waveform far more; fail above 2), plus the RMS step across
  the seam (last vs first 100 ms);
- noise floor: minimum statistics: per frequency bin, the 5th percentile over time of the STFT
  power (4096-point Hann, hop 1024, smoothed over 8 frames), bias-corrected so that stationary
  white noise reads its true level, summed over bins, in dBFS (AES17: a full-scale sine is
  0 dBFS). Broadband (40 Hz-16 kHz) it is an upper bound under dense sustained music (the
  reference trio reads about -37 dBFS although its samples are clean to -84 dBFS); the 8-16 kHz
  band is where hiss shows and sustained music is sparse, so the checks use that one;
- hum: prominence of persistent 50/60 Hz peaks (and 2nd/3rd harmonics) over their neighbours;
- silence: leading and trailing digital silence (exact zeros), the time to the first sample above
  -60 dBFS (SFX sync) and the RMS of the last 10 ms (a clean ending is far below -60 dBFS).
"""

from __future__ import annotations

import math
import re
import shutil
import subprocess
from pathlib import Path

import numpy as np

from . import loudness
from .core import SR, as_channels
from .dsp import apply_sos, butter

OCTAVES = [31.5, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000]
TARGET_TILT = -3.0
FIT_BANDS = (63, 8000)

_FRAME = re.compile(r"t:\s*([\d.]+)\s+TARGET:\S+ LUFS\s+M:\s*(\S+)\s+S:\s*(\S+)\s+I:\s*(\S+) LUFS\s+LRA:\s*(\S+) LU")


def _num(s: str) -> float:
    try:
        v = float(s)
    except ValueError:
        return float("nan")
    return v


def ffmpeg_ebur128(path) -> dict:
    """Run ffmpeg's ebur128 (true peak on) over a file. Returns integrated, lra, truePeak and the
    per-100 ms momentary and short-term series (only values whose full window is inside the file)."""
    exe = shutil.which("ffmpeg")
    if not exe:
        raise RuntimeError("ffmpeg not found on PATH")
    proc = subprocess.run(
        [exe, "-hide_banner", "-nostats", "-loglevel", "verbose", "-i", str(path), "-af", "ebur128=peak=true:framelog=verbose", "-f", "null", "-"],
        capture_output=True, text=True,
    )
    if proc.returncode != 0:
        raise RuntimeError(f"ffmpeg ebur128 failed: {proc.stderr[-1500:]}")
    err = proc.stderr
    t, m, s = [], [], []
    for line in err.splitlines():
        mm = _FRAME.search(line)
        if mm:
            t.append(float(mm.group(1)))
            m.append(_num(mm.group(2)))
            s.append(_num(mm.group(3)))
    summary = err[err.rfind("Summary:") :] if "Summary:" in err else ""
    i = re.search(r"I:\s+(-?[\d.]+|-inf|nan) LUFS", summary)
    lra = re.search(r"LRA:\s+(-?[\d.]+|nan) LU", summary)
    tp = re.search(r"Peak:\s+(-?[\d.]+|-inf|nan) dBFS", summary)
    t = np.array(t)
    m = np.array(m)
    s = np.array(s)
    mom = m[(t >= 0.4 - 1e-3)]
    st = s[(t >= 3.0 - 1e-3)]
    return {
        "integrated": _num(i.group(1)) if i else float("nan"),
        "lra": _num(lra.group(1)) if lra else float("nan"),
        "truePeak": _num(tp.group(1)) if tp else float("nan"),
        "momentary": mom[np.isfinite(mom)],
        "shortTerm": st[np.isfinite(st)],
    }


def loudness_block(path, audio, sr: int = SR) -> dict:
    eb = ffmpeg_ebur128(path)
    st = eb["shortTerm"]
    st_active = st[st > -70.0] if st.size else st
    mom = eb["momentary"]
    sp = loudness.sample_peak(audio)
    num = loudness.integrated(audio, sr)
    out = {
        "integrated": _r(eb["integrated"]),
        "lra": _r(eb["lra"]),
        "truePeak": _r(eb["truePeak"]),
        "samplePeak": _r(sp),
        "shortTermMax": _r(float(st.max())) if st.size else None,
        "shortTermMedian": _r(float(np.median(st_active))) if st_active.size else None,
        "shortTermP10": _r(float(np.percentile(st_active, 10))) if st_active.size else None,
        "momentaryMax": _r(float(mom.max())) if mom.size else None,
        "plr": _r(eb["truePeak"] - eb["integrated"]) if math.isfinite(eb["integrated"]) and math.isfinite(eb["truePeak"]) else None,
        "numpyIntegrated": _r(num),
    }
    if math.isfinite(num) and math.isfinite(eb["integrated"]):
        out["meterDeltaLu"] = _r(num - eb["integrated"], 3)
    return out


def psr(audio, sr: int = SR) -> dict:
    """Peak-to-short-term-loudness ratio per 3 s window (hop 1 s): sample peak (dBFS) minus the
    window's loudness (LUFS). Low values mean squashed transients; healthy mixed music usually sits
    around 8-12 dB, heavily limited masters around 5-7 dB."""
    a = as_channels(audio)
    w, hop = 3 * sr, sr
    if a.shape[1] < w:
        return {"minDb": None, "medianDb": None}
    vals = []
    for s0 in range(0, a.shape[1] - w + 1, hop):
        seg = a[:, s0 : s0 + w]
        lk = loudness.integrated(seg, sr)
        pk = float(np.max(np.abs(seg)))
        if math.isfinite(lk) and lk > -50 and pk > 0:
            vals.append(20 * math.log10(pk) - lk)
    if not vals:
        return {"minDb": None, "medianDb": None}
    return {"minDb": _r(min(vals)), "medianDb": _r(float(np.median(vals)))}


def crest_factor_db(audio) -> float | None:
    a = as_channels(audio)
    r = math.sqrt(float(np.mean(a * a))) if a.size else 0.0
    p = float(np.max(np.abs(a))) if a.size else 0.0
    if r <= 0 or p <= 0:
        return None
    return _r(20 * math.log10(p / r))


def dc_offset(audio) -> dict:
    a = as_channels(audio)
    means = [float(x) for x in a.mean(axis=1)]
    return {"perChannel": [round(v, 7) for v in means], "max": round(max(abs(v) for v in means), 7)}


def clipping(audio, threshold: float = 0.9999, run: int = 3) -> dict:
    a = as_channels(audio)
    hot = np.abs(a) >= threshold
    samples = int(hot.sum())
    runs = 0
    for ch in hot:
        if not ch.any():
            continue
        # count runs of `run` or more consecutive hot samples
        d = np.diff(np.concatenate([[0], ch.astype(np.int8), [0]]))
        starts = np.where(d == 1)[0]
        ends = np.where(d == -1)[0]
        runs += int(np.sum((ends - starts) >= run))
    return {"samples": samples, "runs": runs, "threshold": threshold}


def stereo(audio, sr: int = SR) -> dict:
    a = as_channels(audio)
    if a.shape[0] == 1 or np.allclose(a[0], a[1]):
        return {"channels": int(a.shape[0]), "correlation": 1.0, "windowedMin": 1.0, "windowedP5": 1.0, "lowCorrelation": 1.0, "monoLossDb": 0.0, "sideToMidDb": None}
    L = a[0] - a[0].mean()
    R = a[1] - a[1].mean()
    corr = _corr(L, R)
    w = int(0.4 * sr)
    k = L.shape[0] // w
    vals, weights = [], []
    for i in range(k):
        l, r = L[i * w : (i + 1) * w], R[i * w : (i + 1) * w]
        e = float(np.sum(l * l) + np.sum(r * r))
        if e > 1e-10 * w:
            vals.append(_corr(l, r))
            weights.append(e)
    lowL = apply_sos(L, butter("lowpass", 150, 4, sr), zero_phase=True)[0]
    lowR = apply_sos(R, butter("lowpass", 150, 4, sr), zero_phase=True)[0]
    mono = 0.5 * (a[0] + a[1])
    li = loudness.integrated(a, sr)
    lm = loudness.integrated(np.vstack([mono, mono]), sr)
    mid = 0.5 * (L + R)
    side = 0.5 * (L - R)
    pm, ps = float(np.mean(mid**2)), float(np.mean(side**2))
    return {
        "channels": 2,
        "correlation": _r(corr, 3),
        "windowedMin": _r(float(min(vals)), 3) if vals else None,
        "windowedP5": _r(float(np.percentile(vals, 5)), 3) if vals else None,
        "windowedMean": _r(float(np.average(vals, weights=weights)), 3) if vals else None,
        "lowCorrelation": _r(_corr(lowL, lowR), 3),
        "monoLossDb": _r(lm - li) if math.isfinite(li) and math.isfinite(lm) else None,
        "sideToMidDb": _r(10 * math.log10(ps / pm)) if pm > 0 and ps > 0 else None,
    }


def _corr(x, y) -> float:
    sx = float(np.sqrt(np.sum(x * x)))
    sy = float(np.sqrt(np.sum(y * y)))
    if sx == 0 or sy == 0:
        return 1.0 if sx == sy else 0.0
    return float(np.sum(x * y) / (sx * sy))


def spectrum(audio, sr: int = SR) -> dict:
    from scipy.signal import welch

    a = as_channels(audio)
    nper = 8192 if a.shape[1] >= 8192 else max(256, 1 << int(math.log2(max(256, a.shape[1]))))
    f, p = welch(a, fs=sr, window="hann", nperseg=nper, noverlap=nper // 2, axis=1, scaling="density")
    psd = p.mean(axis=0)
    bands = []
    for fc in OCTAVES:
        lo, hi = fc / math.sqrt(2), min(fc * math.sqrt(2), sr / 2 * 0.999)
        m = (f >= lo) & (f < hi)
        dens = float(psd[m].mean()) if m.any() else 0.0
        bands.append(10 * math.log10(dens) if dens > 0 else -300.0)
    bands = np.array(bands)
    x = np.log2(np.array(OCTAVES) / 1000.0)
    fit = (np.array(OCTAVES) >= FIT_BANDS[0]) & (np.array(OCTAVES) <= FIT_BANDS[1]) & (bands > -250)
    if fit.sum() < 3:
        return {"bandsDb": None, "note": "not enough signal for a spectrum"}
    offset = float(np.mean(bands[fit] - TARGET_TILT * x[fit]))
    ref = offset + TARGET_TILT * x
    dev = bands - ref
    slope = float(np.polyfit(x[fit], bands[fit], 1)[0])

    def region(lo, hi):
        m = (f >= lo) & (f <= hi) & (psd > 0)
        if not m.any():
            return None
        ref_r = offset + TARGET_TILT * np.log2(f[m] / 1000.0)
        return _r(float(np.mean(10 * np.log10(psd[m]) - ref_r)))

    centroid = float(np.sum(f * psd) / np.sum(psd)) if np.sum(psd) > 0 else None
    # the voice pocket: 1-4 kHz against the tilt of the REST of the spectrum (a least-squares line
    # through the 63-500 Hz and 8 kHz bands), so it measures a local dip whatever the overall tilt
    # and the dip cannot pull its own reference down; negative = room left for a voice
    m = (f >= 1000) & (f <= 4000) & (psd > 0)
    outside = fit & ((np.array(OCTAVES) < 1000) | (np.array(OCTAVES) > 4000))
    own = np.polyfit(x[outside], bands[outside], 1)
    pocket = float(np.mean(10 * np.log10(psd[m]) - np.polyval(own, np.log2(f[m] / 1000.0)))) if m.any() else None
    return {
        "bandsHz": OCTAVES,
        "bandsDb": [_r(v) for v in bands],
        "deviationDb": [_r(v) for v in dev],
        "targetTiltDbPerOct": TARGET_TILT,
        "slopeDbPerOct": _r(slope),
        "harshnessDb": region(2000, 5000),
        "mudDb": region(200, 500),
        "boxinessDb": region(500, 1000),
        "presenceDb": region(1000, 4000),
        "voicePocketDb": _r(pocket) if pocket is not None else None,
        "centroidHz": _r(centroid, 0) if centroid else None,
    }


def loop_seam(audio, sr: int = SR) -> dict:
    """Play the file end-to-start and measure the join.

    clickRatio: the largest second difference within 1 ms of the seam over the largest second
    difference in the 50 ms on either side of it (excluding that 1 ms). A loop that starts on a
    drum hit is compared with the hit's own noisy continuation (ratio about 1-1.5); a cut through
    a sustained waveform stands far above its smooth surroundings (a 441 Hz sine cut mid-cycle
    reads about 250). A click under dense noise-like material can pass, which is where it is
    masked anyway; levelStepDb (last vs first 100 ms) catches level jumps."""
    a = as_channels(audio)
    n = a.shape[1]
    w = int(0.001 * sr)
    ctx = int(0.05 * sr)
    k = int(0.1 * sr)
    if n < 4 * k:
        return {"note": "too short for a loop check"}
    circ = np.concatenate([a[:, -k:], a[:, :k]], axis=1)  # end | start: the seam is between k-1 and k
    d2 = np.abs(np.diff(circ, n=2, axis=1))  # d2[i] uses circ[i], circ[i+1], circ[i+2]
    seam = slice(k - 2 - w, k + w)
    seam_peak = float(d2[:, seam].max())
    around = np.concatenate([d2[:, k - 2 - w - ctx : k - 2 - w], d2[:, k + w : k + w + ctx]], axis=1)
    ref = float(around.max()) if around.size else 0.0
    ratio = seam_peak / ref if ref > 0 else (0.0 if seam_peak == 0 else float("inf"))
    end_rms = float(np.sqrt(np.mean(a[:, -k:] ** 2)))
    start_rms = float(np.sqrt(np.mean(a[:, :k] ** 2)))
    step = 20 * math.log10(start_rms / end_rms) if end_rms > 0 and start_rms > 0 else None
    jump = float(np.max(np.abs(a[:, 0] - a[:, -1])))
    return {"clickRatio": _r(ratio, 3), "levelStepDb": _r(step) if step is not None else None, "sampleJump": round(jump, 6)}


NOISE_NPER = 4096
NOISE_HOP = 1024
NOISE_SMOOTH = 8  # frames (~170 ms) averaged before taking the percentile
NOISE_PCT = 5.0
_NOISE_BIAS: dict = {}


def _floor_power(a: np.ndarray, sr: int, lo: float = 40.0, hi: float = 16000.0) -> float:
    """Uncalibrated minimum-statistics noise power of (channels, samples) audio in [lo, hi] Hz."""
    from scipy.ndimage import uniform_filter1d
    from scipy.signal import stft

    f, _, z = stft(a, fs=sr, window="hann", nperseg=NOISE_NPER, noverlap=NOISE_NPER - NOISE_HOP, boundary=None, padded=False, axis=-1)
    pw = (np.abs(z) ** 2).mean(axis=0)  # (bins, frames); scipy 'spectrum' scaling: FFT / sum(window)
    pw = uniform_filter1d(pw, size=NOISE_SMOOTH, axis=1, mode="nearest")
    band = (f >= lo) & (f <= hi)
    floor_bins = np.percentile(pw[band], NOISE_PCT, axis=1)
    win = np.hanning(NOISE_NPER)
    enbw_bins = NOISE_NPER * np.sum(win**2) / np.sum(win) ** 2
    return float(np.sum(2.0 * floor_bins) / enbw_bins)  # one-sided, noise-bandwidth corrected


def _noise_bias(sr: int) -> float:
    """Ratio true/estimated power for stationary white Gaussian noise through the same estimator
    (a percentile of a smoothed chi-square power reads low); computed once per rate, seeded.
    Every bin of white noise has the same distribution, so the factor holds for any band."""
    if sr not in _NOISE_BIAS:
        from scipy.signal import welch

        g = np.random.default_rng(12345)
        w = g.standard_normal((2, sr * 20)) * 0.01
        f, p = welch(w, fs=sr, nperseg=NOISE_NPER, axis=1)
        band = (f >= 40) & (f <= 16000)
        true_power = float(np.sum(p.mean(axis=0)[band]) * (f[1] - f[0]))
        _NOISE_BIAS[sr] = true_power / _floor_power(w, sr)
    return _NOISE_BIAS[sr]


def _db_power(power: float):
    return -200.0 if power <= 0 else _r(10 * math.log10(power / 0.5))


HUM_GATE_DBFS = -85.0


def hum(audio, sr: int = SR) -> dict:
    """Mains hum: prominence (dB) of persistent peaks at 50 or 60 Hz and their 2nd/3rd harmonics
    over the neighbouring floor, from minimum statistics on 0.68 s frames (1.5 Hz bins).
    Notes come and go; hum does not, so it survives the 10th-percentile floor. A peak quieter
    than -85 dBFS (sine-equivalent) is not counted: ratios between vanishing levels mean nothing."""
    from scipy.signal import stft

    a = as_channels(audio)
    nper = 32768
    if a.shape[1] < nper * 4:
        return {"humDb": None, "note": "too short for a hum check"}
    f, _, z = stft(a, fs=sr, window="hann", nperseg=nper, noverlap=nper - 8192, boundary=None, padded=False, axis=-1)
    floor = np.percentile((np.abs(z) ** 2).mean(axis=0), 10, axis=1)
    best = (0.0, None, None)
    for mains in (50.0, 60.0):
        for h in (1, 2, 3):
            c = mains * h
            peak = floor[(f > c - 1.6) & (f < c + 1.6)]
            ring = floor[((f > c - 25) & (f < c - 6)) | ((f > c + 6) & (f < c + 25))]
            if not peak.size or peak.max() <= 0:
                continue
            # scipy 'spectrum' scaling: a sine of amplitude A reads A^2 / 4 in its bin
            level = 10 * math.log10(peak.max()) + 6.02
            if level < HUM_GATE_DBFS:
                continue
            prom = 10 * math.log10(peak.max() / np.median(ring)) if ring.size and np.median(ring) > 0 else 60.0
            if prom > best[0]:
                best = (prom, mains, level)
    return {"humDb": _r(best[0]), "mainsHz": best[1], "humLevelDbfs": _r(best[2]) if best[2] is not None else None}


def noise_floor(audio, sr: int = SR) -> dict:
    """Minimum-statistics noise floor in dBFS (AES17 convention: a full-scale sine is 0 dBFS):
    broadband 40 Hz-16 kHz (an upper bound under dense music) and the 8-16 kHz band, where hiss
    shows and sustained music is usually sparse; plus the mains-hum check."""
    a = as_channels(audio)
    if a.shape[1] < NOISE_NPER * (NOISE_SMOOTH + 4):
        return {"floorDbfs": None, "hfFloorDbfs": None, "humDb": None, "note": "too short for a noise estimate"}
    bias = _noise_bias(sr)
    out = {
        "floorDbfs": _db_power(_floor_power(a, sr) * bias),
        "hfFloorDbfs": _db_power(_floor_power(a, sr, 8000.0, 16000.0) * bias),
        "method": f"minimum statistics: {NOISE_PCT:g}th percentile per bin of {NOISE_SMOOTH}-frame smoothed STFT power, white-noise bias corrected",
    }
    out.update(hum(a, sr))
    return out


def silence(audio, sr: int = SR) -> dict:
    a = as_channels(audio)
    env = np.max(np.abs(a), axis=0)
    nz = np.nonzero(env > 0)[0]
    if nz.size == 0:
        return {"allSilent": True}
    above = np.nonzero(env > 10 ** (-60 / 20))[0]
    k = max(1, int(0.01 * sr))
    tail_rms = float(np.sqrt(np.mean(a[:, -k:] ** 2)))
    return {
        "allSilent": False,
        "leadingSilenceMs": _r(nz[0] / sr * 1000, 2),
        "trailingSilenceMs": _r((a.shape[1] - 1 - nz[-1]) / sr * 1000, 2),
        "onsetMs": _r(above[0] / sr * 1000, 2) if above.size else None,
        "tailEndDbfs": _r(20 * math.log10(tail_rms)) if tail_rms > 0 else -200.0,
        "durationS": _r(a.shape[1] / sr, 3),
    }


def analyse(path, loop: bool = False, sr: int = SR) -> dict:
    from .io import info, read

    meta = info(path)
    audio = read(path, sr=None)
    file_sr = meta["samplerate"]
    out = {
        "file": str(Path(path)),
        "format": {"sampleRate": file_sr, "channels": meta["channels"], "subtype": meta["subtype"], "durationS": round(meta["duration"], 3)},
        "loudness": loudness_block(path, audio, file_sr),
        "crestFactorDb": crest_factor_db(audio),
        "psr": psr(audio, file_sr),
        "dcOffset": dc_offset(audio),
        "clipping": clipping(audio),
        "stereo": stereo(audio, file_sr),
        "spectrum": spectrum(audio, file_sr),
        "noise": noise_floor(audio, file_sr),
        "silence": silence(audio, file_sr),
    }
    if loop:
        out["loop"] = loop_seam(audio, file_sr)
    return out


def _r(v, nd: int = 2):
    """Round for JSON; non-finite values (silence reads -inf) become None."""
    if v is None:
        return None
    v = float(v)
    if not math.isfinite(v):
        return None
    return round(v, nd)
