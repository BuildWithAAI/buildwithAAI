"""Per-file measurements for the manifest and the QA checks.

Definitions:
- onsetMs: first sample above -60 dBFS (the same rule as scripts/audio/metrics.py).
- transientMs: the attack point of the first event: the first sample at half (-6 dB) of the local
  maximum within 15 ms of where the sound first rises to -30 dB re its peak.
- peakMs: the sample peak. loudPeakMs: centre of the loudest 50 ms (K-weighted): a whoosh's
  pass-by as heard.
- lufsMomentaryMax: BS.1770 K-weighted loudness in a 400 ms window, maximised over every sample
  position, with silence around the file (so a 30 ms click is measured whole). This is what any
  EBU R128 meter shows as "M max" and what `suggestedGainDb` is based on. lufs100Max is the same
  with a 100 ms window, for reference (short clicks read relatively louder on it).
- presence2to5Db: energy in 2-5 kHz minus energy in 200 Hz-2 kHz; above about +6 dB a sound gets
  edgy on phone speakers and earbuds.
- resonances: narrow peaks (>= 8 dB above the spectrum smoothed over a third of an octave) between
  1.5 and 8 kHz with their level re the loudest spectral peak and their ring time (-30 dB in a
  sixth-of-an-octave band). A peak counts as harsh when it sits in 2-6 kHz, stands 12 dB or more
  above its surroundings, is within 12 dB of the loudest peak and rings for 80 ms or more.
"""

from __future__ import annotations

import math

import numpy as np

from audiolib import loudness
from audiolib.core import SR, as_stereo

from .core import FPS, FRAME, PEAK_DBFS, ROLES, Sound, on_frame


def design_tail_db(audio, window_s: float = 0.01) -> float:
    """RMS of the last `window_s` of a design buffer re its peak: how far the sound had decayed
    when the buffer ended. Above about -60 dB the buffer was too short for the sound."""
    a = as_stereo(np.asarray(audio, dtype=np.float64))
    pk = float(np.max(np.abs(a)))
    seg = a[:, -max(1, int(round(window_s * SR))) :]
    r = float(np.sqrt(np.mean(seg**2)))
    return -200.0 if r <= 0 or pk <= 0 else 20 * math.log10(r / pk)


def _r(v, nd=2):
    if v is None:
        return None
    v = float(v)
    return round(v, nd) if math.isfinite(v) else None


def _db(x):
    return 20 * math.log10(x) if x > 0 else -200.0


def envelope(a: np.ndarray) -> np.ndarray:
    return np.max(np.abs(as_stereo(a)), axis=0)


def transient_index(a: np.ndarray, start_db: float = -30.0, look_s: float = 0.015) -> int:
    env = envelope(a)
    pk = float(env.max())
    first = int(np.argmax(env >= pk * 10 ** (start_db / 20)))
    win = env[first : first + max(1, int(look_s * SR))]
    lp = float(win.max())
    return first + int(np.argmax(win >= 0.5 * lp))


def onset_index(a: np.ndarray, dbfs: float = -60.0) -> int | None:
    env = envelope(a)
    above = np.nonzero(env > 10 ** (dbfs / 20))[0]
    return int(above[0]) if above.size else None


def window_loudness_max(a: np.ndarray, window_s: float) -> tuple:
    """Max K-weighted loudness (LUFS) over every `window_s` window, silence-padded; and the window
    centre (s) where it occurs."""
    p = loudness._weighted_power(as_stereo(a), SR).sum(axis=0)
    w = max(1, int(round(window_s * SR)))
    padded = np.concatenate([np.zeros(w), p, np.zeros(w)])
    cs = np.concatenate([[0.0], np.cumsum(padded)])
    sums = cs[w:] - cs[:-w]
    k = int(np.argmax(sums))  # window k covers padded[k : k + w] = original samples [k - w, k)
    mean = sums[k] / w
    lufs = -0.691 + 10 * math.log10(max(mean, 1e-30))
    centre = (k - w / 2.0) / SR
    return lufs, centre


def peak_window_s(duration_s: float) -> float:
    """Window for the perceived peak of a swell: a tenth of the sound, 50-150 ms."""
    return float(min(0.15, max(0.05, duration_s / 10.0)))


def perceived_peak_s(a: np.ndarray, window_s: float | None = None) -> float:
    """Centre (s) of the loudest K-weighted window: where a whoosh is heard to pass."""
    n = as_stereo(a).shape[1]
    return window_loudness_max(a, window_s or peak_window_s(n / SR))[1]


def align_peak_to_frame(a: np.ndarray, window_s: float | None = None) -> tuple:
    """Pad silence at the start so the perceived peak lands exactly on the next 30 fps frame
    boundary (at most one frame, 33 ms, of added lead-in). Returns (audio, sync_s). The window is
    fixed from the unpadded length, so measuring the result again finds the same peak."""
    a = as_stereo(a)
    w = window_s or peak_window_s(a.shape[1] / SR)
    c = int(round(perceived_peak_s(a, w) * SR))
    target = -(-c // FRAME) * FRAME
    pad = target - c
    out = np.concatenate([np.zeros((2, pad)), a], axis=1) if pad else a.copy()
    return out, target / SR


def spectrum_db(a: np.ndarray):
    """Power spectrum (dB) of the active part of the mid signal, and its frequencies."""
    mid = as_stereo(a).mean(axis=0)
    env = np.abs(mid)
    pk = float(env.max())
    act = np.nonzero(env > pk * 1e-3)[0]
    seg = mid[act[0] : act[-1] + 1] if act.size else mid
    n = 1 << int(math.ceil(math.log2(max(seg.size, 8192))))
    spec = np.abs(np.fft.rfft(seg * np.hanning(seg.size), n)) ** 2
    fr = np.fft.rfftfreq(n, 1 / SR)
    return fr, 10 * np.log10(spec + 1e-30)


def band_energy_db(fr, s_db, lo, hi) -> float:
    m = (fr >= lo) & (fr < hi)
    return 10 * math.log10(float(np.sum(10 ** (s_db[m] / 10))) + 1e-30)


def ring_ms(a: np.ndarray, f: float, drop_db: float = 30.0) -> float:
    from scipy.signal import butter, sosfilt

    mid = as_stereo(a).mean(axis=0)
    lo, hi = f / 2 ** (1 / 12), min(f * 2 ** (1 / 12), SR * 0.45)
    y = sosfilt(butter(2, [lo, hi], btype="bandpass", fs=SR, output="sos"), mid)
    hop = int(0.005 * SR)
    k = y.size // hop
    if k < 2:
        return 0.0
    e = np.sqrt(np.mean(y[: k * hop].reshape(k, hop) ** 2, axis=1))
    i = int(np.argmax(e))
    after = np.nonzero(e[i:] < e[i] * 10 ** (-drop_db / 20))[0]
    return float((after[0] if after.size else (k - i)) * hop / SR * 1000)


def resonances(a: np.ndarray, lo: float = 1500.0, hi: float = 8000.0) -> list:
    from scipy.ndimage import median_filter
    from scipy.signal import find_peaks

    fr, s = spectrum_db(a)
    grid = 1000.0 * 2 ** np.arange(-4.4, 4.0, 1 / 48)  # 47 Hz .. 16 kHz, 1/48 octave
    # mean power per 1/48-octave cell (averaging the bins of a cell removes the random +-10 dB
    # bin-to-bin scatter of noise spectra, which would otherwise read as narrow "peaks")
    p = 10 ** (s / 10)
    lo_e, hi_e = grid * 2 ** (-1 / 96), grid * 2 ** (1 / 96)
    i0, i1 = np.searchsorted(fr, lo_e), np.searchsorted(fr, hi_e)
    cs = np.concatenate([[0.0], np.cumsum(p)])
    cnt = np.maximum(i1 - i0, 1)
    cell = np.where(i1 > i0, (cs[i1] - cs[i0]) / cnt, np.interp(grid, fr, p))
    s_log = 10 * np.log10(cell + 1e-30)
    smooth = median_filter(s_log, size=33, mode="nearest")  # +-1/3 octave
    prom = s_log - smooth
    top = float(s_log.max())
    band = (grid >= lo) & (grid <= hi)
    idx, _ = find_peaks(np.where(band, prom, -99), height=8.0, distance=4)
    out = []
    for k in sorted(idx, key=lambda j: -prom[j])[:5]:
        f = float(grid[k])
        out.append({"hz": round(f), "prominenceDb": _r(prom[k], 1), "relLevelDb": _r(s_log[k] - top, 1), "ringMs": round(ring_ms(a, f))})
    return out


def harsh(res: list) -> list:
    return [r for r in res if 2000 <= r["hz"] <= 6000 and r["prominenceDb"] >= 12 and r["relLevelDb"] >= -12 and r["ringMs"] >= 80]


def correlation(a: np.ndarray):
    a = as_stereo(a)
    if np.allclose(a[0], a[1]):
        return 1.0
    l, r = a[0] - a[0].mean(), a[1] - a[1].mean()
    d = math.sqrt(float(np.sum(l * l)) * float(np.sum(r * r)))
    return float(np.sum(l * r) / d) if d > 0 else 1.0


def event_onset_errors_ms(a: np.ndarray, events: list) -> list:
    """For each designed event time, how far (ms) the measured attack point lies from it."""
    env = envelope(a)
    errs = []
    for ev in events:
        i0 = int(round(ev["t"] * SR))
        win = env[max(0, i0 - int(0.002 * SR)) : i0 + int(0.012 * SR)]
        if win.size == 0:
            errs.append(None)
            continue
        lp = float(win.max())
        j = int(np.argmax(win >= 0.5 * lp)) + max(0, i0 - int(0.002 * SR))
        errs.append(round((j - i0) / SR * 1000, 2))
    return errs


def analyse(final: np.ndarray, sound: Sound) -> dict:
    a = as_stereo(final)
    n = a.shape[1]
    env = envelope(a)
    pk = float(env.max())
    tr = transient_index(a)
    on = onset_index(a)
    lufs_m, m_centre = window_loudness_max(a, 0.4)
    lufs_100, _ = window_loudness_max(a, 0.1)
    pw = sound.extra.get("peakWindowMs")
    loud_centre = perceived_peak_s(a, pw / 1000.0 if pw else None)
    fr, s = spectrum_db(a)
    total = band_energy_db(fr, s, 20, 20000)
    centroid = float(np.sum(fr * 10 ** (s / 10)) / np.sum(10 ** (s / 10)))
    res = resonances(a)
    if sound.sync_s is not None:
        sync_ms = sound.sync_s * 1000.0
    elif sound.sync == "transient":
        sync_ms = 0.0
    else:
        raise ValueError(f"{sound.id}: sync '{sound.sync}' needs sync_s")
    tail = a[:, -max(1, int(0.01 * SR)) :]
    target = ROLES[sound.role]["targetLufsM"]
    out = {
        "durationMs": _r(n / SR * 1000, 1),
        "samples": n,
        "onsetMs": _r(on / SR * 1000, 2) if on is not None else None,
        "transientMs": _r(tr / SR * 1000, 2),
        "peakMs": _r(int(np.argmax(env)) / SR * 1000, 1),
        "loudPeakMs": _r(loud_centre * 1000, 1),
        "syncMs": _r(sync_ms, 2),
        "syncFrame30": int(round(sync_ms * FPS / 1000.0)),
        "syncOnFrame": on_frame(sync_ms / 1000.0),
        "samplePeakDbfs": _r(_db(pk), 3),
        "truePeakDbtp": _r(loudness.true_peak(a), 2),
        "lufsMomentaryMax": _r(lufs_m, 2),
        "lufsMomentaryMaxAtMs": _r(m_centre * 1000, 0),
        "lufs100Max": _r(lufs_100, 2),
        "suggestedGainDb": _r(target - lufs_m, 1),
        "targetLufsM": target,
        "centroidHz": round(centroid),
        "presence2to5Db": _r(band_energy_db(fr, s, 2000, 5000) - band_energy_db(fr, s, 200, 2000), 1),
        "lowShareDb": _r(band_energy_db(fr, s, 20, 200) - total, 1),
        "airShareDb": _r(band_energy_db(fr, s, 8000, 20000) - total, 1),
        "resonances": res,
        "harshResonances": harsh(res),
        "correlation": _r(correlation(a), 3),
        "dcMax": float(round(float(np.max(np.abs(a.mean(axis=1)))), 7)),
        "clippedSamples": int(np.sum(np.abs(a) >= 0.9999)),
        "tailEndDbfs": _r(_db(float(np.sqrt(np.mean(tail**2)))), 1),
        "designTailDb": _r(design_tail_db(sound.audio), 1) if not sound.loop else None,
    }
    if sound.events:
        errs = event_onset_errors_ms(a, sound.events)
        out["eventErrorsMs"] = errs
        out["eventsOnFrames"] = all(on_frame(ev["t"]) for ev in sound.events) if sound.frame_locked else None
    return out


def checks(m: dict, sound: Sound) -> list:
    """QA checks for one finished file: (id, pass, severity, detail)."""
    c = []

    def add(cid, ok, sev, detail):
        c.append({"id": cid, "pass": bool(ok), "severity": sev, "detail": detail})

    add("peak", abs(m["samplePeakDbfs"] - PEAK_DBFS) <= 0.05, "fail", f"sample peak {m['samplePeakDbfs']} dBFS (want {PEAK_DBFS})")
    add("truePeak", m["truePeakDbtp"] is not None and m["truePeakDbtp"] <= -1.0, "fail", f"true peak {m['truePeakDbtp']} dBTP (<= -1)")
    add("clipping", m["clippedSamples"] == 0, "fail", f"{m['clippedSamples']} samples at full scale")
    add("dc", m["dcMax"] <= 1e-4, "fail", f"DC {m['dcMax']}")
    if not sound.loop:
        add("tailEnd", m["tailEndDbfs"] <= -60, "fail", f"last 10 ms at {m['tailEndDbfs']} dBFS (<= -60)")
        add("designDecayed", m["designTailDb"] <= -60, "warn", f"the design had decayed to {m['designTailDb']} dB re peak when its buffer ended (<= -60: finishing never cuts an audible tail)")
    add("syncOnFrame", m["syncOnFrame"], "fail", f"sync {m['syncMs']} ms = frame {m['syncMs'] * FPS / 1000:.3f} at 30 fps")
    if sound.sync == "transient":
        add("transientAtStart", m["transientMs"] <= 3.0, "fail", f"transient at {m['transientMs']} ms (<= 3)")
    if sound.sync == "peak":
        add("peakNearSync", abs(m["loudPeakMs"] - m["syncMs"]) <= 1000 / FPS, "warn", f"loudest 50 ms centred at {m['loudPeakMs']} ms vs sync {m['syncMs']} ms (within one frame)")
    if sound.events and sound.frame_locked:
        add("eventsOnFrames", m.get("eventsOnFrames"), "fail", "every event on a 30 fps frame boundary")
        errs = [e for e in m.get("eventErrorsMs", []) if e is not None]
        worst = max((abs(e) for e in errs), default=0.0)
        add("eventsAttack", worst <= 4.0, "warn", f"worst event attack {worst} ms from its frame (<= 4)")
    add("harshResonance", not m["harshResonances"], "fail", f"harsh resonances: {m['harshResonances']}")
    add("presence", m["presence2to5Db"] <= 6.0, "warn", f"2-5 kHz vs 0.2-2 kHz {m['presence2to5Db']} dB (<= +6)")
    add("correlation", m["correlation"] >= 0.0, "fail", f"L/R correlation {m['correlation']} (>= 0)")
    return c


def group_summary(entries: list) -> dict:
    """Loudness spread inside each variation group (after peak normalisation)."""
    groups = {}
    for e in entries:
        groups.setdefault(e["group"], []).append(e["loudness"]["lufsMomentaryMax"])
    return {g: {"n": len(v), "lufsMin": round(min(v), 2), "lufsMax": round(max(v), 2), "spreadDb": round(max(v) - min(v), 2)} for g, v in groups.items()}


FRAME_SAMPLES = FRAME
