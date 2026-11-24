"""Mastering presets and export.

| preset      | loudness target                     | true-peak ceiling | character                                  |
|-------------|-------------------------------------|-------------------|--------------------------------------------|
| bed         | median short-term -26 LUFS (S)      | -6 dBTP           | broad 1-4 kHz dip (room for the voice), even dynamics |
| sting       | -16 LUFS integrated                 | -1 dBTP           | jingles, intro stings, logo hits           |
| standalone  | -14 LUFS integrated                 | -1 dBTP           | music heard on its own (trailer, end card) |

Chain: stage to -18 LUFS -> rumble high-pass + preset EQ -> gentle compressor (bed and
standalone) -> gain to target -> pedalboard BrickwallLimiter (true peak) -> verify; the gain into the
limiter is re-aimed (secant steps) until the measured loudness is within 0.1 LU of target.

Loops (`loop=True`): processing runs on [tail | audio | head] and the middle is kept, so the
compressor and limiter see the wrap-around and the loop point stays seamless; no fades are added.
Non-loops get 2 ms (in) and 10 ms (out) fades so the file never starts or ends on a step.

The bed's -26 LUFS-S sits about 12 LU under narration normalised to -14 LUFS, and the video mix
ducks it further under speech (see docs/AUDIO.md, "Beds under voice").
"""

from __future__ import annotations

import json
import math
import subprocess
from dataclasses import asdict, dataclass
from pathlib import Path

import numpy as np

from . import dsp, loudness
from .core import SR, as_stereo, db_to_lin
from .dynamics import Compressor, limit

STAGE = -18.0


@dataclass(frozen=True)
class Preset:
    name: str
    target: float
    measure: str  # "integrated" or "short_term_median"
    ceiling_dbtp: float
    eq: tuple = ()
    comp: Compressor | None = None
    release_ms: float = 120.0
    tolerance_lu: float = 0.1
    notes: str = ""


RUMBLE = {"kind": "highpass", "f": 28.0, "order": 4}

PRESETS = {
    "bed": Preset(
        "bed", -26.0, "short_term_median", -6.0,
        eq=(RUMBLE,
            # the voice pocket: a broad dip centred on 2 kHz covering about 1-4 kHz
            {"kind": "peak", "f": 2000.0, "q": 0.7, "db": -3.5},
            # a little less low-mid weight so the voice's chest stays clear
            {"kind": "peak", "f": 300.0, "q": 0.9, "db": -1.0},
            {"kind": "highshelf", "f": 9000.0, "q": 0.7, "db": -1.0}),
        comp=Compressor(threshold_db=-24.0, ratio=2.0, attack_ms=40.0, release_ms=400.0, knee_db=8.0, detector="rms", rms_ms=50.0, sidechain_hp_hz=80.0),
        release_ms=300.0,
        notes="sits under narration; keep the dynamics even so ducking is predictable"),
    "sting": Preset(
        "sting", -16.0, "integrated", -1.0,
        eq=(RUMBLE,),
        comp=None, release_ms=80.0,
        notes="short jingles and logo stings; transients preserved"),
    "standalone": Preset(
        "standalone", -14.0, "integrated", -1.0,
        eq=(RUMBLE,),
        comp=Compressor(threshold_db=-20.0, ratio=1.5, attack_ms=30.0, release_ms=250.0, knee_db=8.0, detector="rms", rms_ms=30.0, sidechain_hp_hz=90.0),
        release_ms=120.0,
        notes="YouTube's widely reported reference: -14 LUFS integrated, -1 dBTP"),
}


def measure(audio, how: str, sr: int = SR) -> float:
    if how == "integrated":
        return loudness.integrated(audio, sr)
    if how == "short_term_median":
        st = loudness.short_term(audio, sr)
        st = st[st > -70.0]
        return float(np.median(st)) if st.size else float("-inf")
    raise ValueError(f"unknown measure {how!r}")


def master(audio, preset="standalone", sr: int = SR, loop: bool = False, pad_seconds: float = 3.0):
    """Master `audio` with a preset (name or Preset). Returns (audio, report)."""
    p = PRESETS[preset] if isinstance(preset, str) else preset
    a = as_stereo(audio)
    n = a.shape[1]
    if loop:
        k = min(n, int(pad_seconds * sr))
        work = np.concatenate([a[:, n - k :], a, a[:, :k]], axis=1)
        core = slice(k, k + n)
    else:
        work = a
        core = slice(0, n)
    i0 = loudness.integrated(work[:, core], sr)
    if not math.isfinite(i0):
        raise ValueError("cannot master silence")
    work = work * float(db_to_lin(STAGE - i0))
    if p.eq:
        work = dsp.eq(work, list(p.eq), sr)
    comp_rep = None
    if p.comp is not None:
        work, gr = p.comp.process(work, sr)
        comp_rep = {"grMaxDb": round(float(-gr[core].min()), 2), "grMeanDb": round(float(-gr[core].mean()), 2)}
    # loudness loop: gain into the limiter until the limited result hits the target
    tries = []
    g = p.target - measure(work[:, core], p.measure, sr)
    out = None
    lim_rep = None
    for _ in range(6):
        staged = work * float(db_to_lin(g))
        limited, lim_rep = limit(staged, p.ceiling_dbtp, release_ms=p.release_ms, sr=sr)
        got = measure(limited[:, core], p.measure, sr)
        tries.append((round(g, 3), round(got, 3)))
        out = limited
        err = p.target - got
        if abs(err) <= p.tolerance_lu:
            break
        if len(tries) >= 2 and abs(tries[-1][0] - tries[-2][0]) > 1e-6:
            slope = (tries[-1][1] - tries[-2][1]) / (tries[-1][0] - tries[-2][0])
            slope = min(1.0, max(0.25, slope))
        else:
            slope = 1.0
        g = g + err / slope
    res = out[:, core]
    if not loop:
        res = dsp.fade(res, 0.002, 0.010, sr)
    summ = loudness.summary(res, sr)
    report = {
        "preset": p.name,
        "target": {"loudness": p.target, "measure": p.measure, "ceilingDbtp": p.ceiling_dbtp},
        "loop": loop,
        "inputIntegrated": round(float(i0), 2),
        "compressor": comp_rep,
        "limiter": lim_rep,
        "gainSteps": tries,
        "result": {k: (round(v, 2) if isinstance(v, float) and math.isfinite(v) else v) for k, v in summ.items()},
        "measured": round(float(measure(res, p.measure, sr)), 2),
    }
    report["ok"] = bool(abs(report["measured"] - p.target) <= max(0.5, p.tolerance_lu) and summ["truePeak"] <= p.ceiling_dbtp + 1e-6)
    return res, report


def export(path, audio, report: dict | None = None, sr: int = SR, preview: bool = True) -> dict:
    """Write the 24-bit 48 kHz WAV master, an optional AAC preview (.m4a, 256 kb/s) next to it,
    and the report as JSON. Returns the paths."""
    from .io import write

    path = Path(path)
    write(path, audio, sr, subtype="PCM_24")
    out = {"wav": str(path)}
    if preview:
        m4a = path.with_suffix(".m4a")
        proc = subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(path), "-c:a", "aac", "-b:a", "256k", "-movflags", "+faststart", str(m4a)], capture_output=True, text=True)
        if proc.returncode != 0:
            raise RuntimeError(f"ffmpeg AAC preview failed: {proc.stderr[-800:]}")
        out["m4a"] = str(m4a)
    if report is not None:
        rp = path.with_suffix(".master.json")
        rp.write_text(json.dumps(report, indent=2, default=_json_default) + "\n")
        out["report"] = str(rp)
    return out


def _json_default(o):
    if isinstance(o, Compressor):
        return asdict(o)
    if isinstance(o, (np.floating, np.integer)):
        return o.item()
    raise TypeError(f"not JSON serialisable: {type(o)}")


def presets_table() -> list:
    return [{"name": p.name, "target": p.target, "measure": p.measure, "ceilingDbtp": p.ceiling_dbtp, "notes": p.notes} for p in PRESETS.values()]

