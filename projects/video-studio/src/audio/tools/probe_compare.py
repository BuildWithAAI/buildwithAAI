#!/usr/bin/env python3
"""Compare AudioProbe renders with the ideal per-sample duck (src/audio/tools/probe_duck.sh runs it).

    .venv-audio/bin/python src/audio/tools/probe_compare.py --render probe/html5.wav --gain probe/gain.f32 [--json out.json]

The ideal is the bed (from its first sample, unlooped: the probe runs 10 s of a 64 s loop) times the probe's
gain law per sample, exactly what PcmTrack is meant to render. Reported per render:
  - residual against the ideal (RMS and peak, dBFS);
  - zipper / click proxy: in 5 ms windows, the high-passed (> 3 kHz) residual against the high-passed ideal;
    a window where the residual is within 20 dB of the signal is audible stepping;
  - the effective gain the render applied, in 32-sample blocks, and its largest jump.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
import soundfile as sf
from scipy.signal import butter, sosfilt

STUDIO = Path(__file__).resolve().parents[3]
SR = 48000


def db(x: float) -> float:
    return float(20 * np.log10(max(float(x), 1e-12)))


def compare(render: np.ndarray, bed: np.ndarray, gain: np.ndarray) -> dict:
    n = min(render.shape[1], gain.shape[1], bed.shape[1])
    ideal = bed[:, :n] * gain[0, :n][None, :] if gain.shape[0] == 1 else None
    if ideal is None:
        raise SystemExit("probe_compare handles the broadband probe (split=false)")
    r = render[:, :n]
    res = r - ideal
    sos = butter(4, 3000, "highpass", fs=SR, output="sos")
    hr = sosfilt(sos, res.mean(axis=0))
    hi = sosfilt(sos, ideal.mean(axis=0))
    w = 240
    k = n // w
    er = np.sqrt(np.mean(hr[:k * w].reshape(k, w) ** 2, axis=1))
    ei = np.sqrt(np.mean(hi[:k * w].reshape(k, w) ** 2, axis=1))
    ratio = 20 * np.log10((er + 1e-12) / (ei + 1e-12))
    b = 32
    kb = n // b
    rb = r[:, :kb * b].reshape(r.shape[0], kb, b)
    sb = bed[:, :kb * b].reshape(bed.shape[0], kb, b)
    geff = (rb * sb).sum(axis=(0, 2)) / np.maximum((sb * sb).sum(axis=(0, 2)), 1e-12)
    gdb = 20 * np.log10(np.maximum(geff, 1e-6))
    jumps = np.abs(np.diff(gdb))
    worst = int(np.argmax(jumps))
    return {
        "residualRmsDbfs": round(db(np.sqrt(np.mean(res ** 2))), 2),
        "residualPeakDbfs": round(db(np.abs(res).max()), 2),
        "zipperWindows": int(np.sum(ratio > -20)),
        "windows": int(k),
        "worstWindowDb": round(float(ratio.max()), 1),
        "worstWindowSec": round(float(np.argmax(ratio)) * w / SR, 3),
        "largestGainJumpDb": round(float(jumps[worst]), 2),
        "largestGainJumpAtSample": int((worst + 1) * b),
    }


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--render", action="append", required=True, help="a probe render (repeatable)")
    ap.add_argument("--gain", required=True, help="probe_gain.ts output")
    ap.add_argument("--bed", default="audio/music/bed-show-neutral-underscore.flac", help="the probe's bed under public/")
    ap.add_argument("--json")
    a = ap.parse_args(argv)
    bed, sr = sf.read(str(STUDIO / "public" / a.bed), always_2d=True, dtype="float64")
    if sr != SR:
        print(f"bed is {sr} Hz", file=sys.stderr)
        return 2
    raw = np.fromfile(a.gain, dtype=np.float32).astype(np.float64)
    n = int(round(10 * SR))
    gain = raw.reshape(-1, n) if raw.size % n == 0 else raw.reshape(1, -1)
    out = {}
    for path in a.render:
        x, sr = sf.read(path, always_2d=True, dtype="float64")
        out[Path(path).stem] = compare(x.T, bed.T, gain)
    text = json.dumps(out, indent=1)
    if a.json:
        Path(a.json).write_text(text + "\n")
    print(text)
    return 0


if __name__ == "__main__":
    sys.exit(main())
