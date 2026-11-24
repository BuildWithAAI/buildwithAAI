#!/usr/bin/env python3
"""Duck a music bed under narration (and export the gain curve for Remotion).

    python3 scripts/audio/duck.py --bed out/audio/reference/reference_bed.wav \
        --voice public/generated/<channel>/<slug>/en/narration.wav \
        --out out/audio/ducked_bed.wav --frames out/audio/ducked_bed.gain.json --fps 30

The bed is looped or cut to the narration's length (looping assumes a seamless loop: master it
with loop=True). Writes the ducked bed (24-bit WAV), optionally the per-frame linear gains as JSON
({"fps": 30, "gains": [...]}, for <Audio volume={(f) => gains[f]} /> when the bed plays
un-ducked in Remotion), and prints a summary: speech share, gain under speech and in pauses, and
the voice-to-bed loudness gap under speech.
Exit codes: 0 ok, 2 bad arguments or unreadable files.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from audiolib.venv import ensure_venv  # noqa: E402

ensure_venv()

import numpy as np  # noqa: E402

from audiolib import duck, io, loudness  # noqa: E402
from audiolib.core import SR, as_stereo  # noqa: E402


def fit_length(bed: np.ndarray, n: int) -> np.ndarray:
    if bed.shape[1] >= n:
        return bed[:, :n]
    reps = int(np.ceil(n / bed.shape[1]))
    return np.tile(bed, (1, reps))[:, :n]


def run(bed_path, voice_path, out_path, depth=6.0, attack=0.15, release=0.5, lookahead=0.12, min_gap=0.35, frames_path=None, fps=30) -> dict:
    voice = io.read(voice_path)
    bed = as_stereo(io.read(bed_path))
    n = voice.shape[1]
    bed = fit_length(bed, n)
    act = duck.voice_activity(voice, min_gap=min_gap)
    gain = duck.duck_gain(act, depth, attack, release, lookahead)
    out = duck.apply_gain(bed, gain)
    io.write(out_path, out)
    res = {"out": str(out_path), "durationS": round(n / SR, 3), "speechShare": round(float(act.mean()), 3)}
    if act.any():
        res["gainUnderSpeechDb"] = round(float(np.median(gain[act])), 2)
        # the voice is measured as one channel, i.e. as an equal-power (-3 dB per side) upmix, which
        # is what ffmpeg does with mono sources; a unity copy to both channels would read 3 LU louder
        mono = voice.mean(axis=0, keepdims=True)
        v_l = loudness.integrated(mono[:, act]) if act.sum() > SR // 2 else float("nan")
        b_l = loudness.integrated(out[:, act]) if act.sum() > SR // 2 else float("nan")
        if np.isfinite(v_l) and np.isfinite(b_l):
            res["voiceOverBedLu"] = round(float(v_l - b_l), 1)
    if (~act).any():
        res["gainInPausesDb"] = round(float(np.median(gain[~act])), 2)
    if frames_path:
        Path(frames_path).parent.mkdir(parents=True, exist_ok=True)
        Path(frames_path).write_text(json.dumps({"fps": fps, "gains": duck.frame_gains(gain, fps)}) + "\n")
        res["frames"] = str(frames_path)
    return res


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Duck a music bed under narration.")
    ap.add_argument("--bed", required=True)
    ap.add_argument("--voice", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--depth", type=float, default=6.0, help="dB of ducking under speech (default 6)")
    ap.add_argument("--attack", type=float, default=0.15, help="seconds to reach full depth (default 0.15)")
    ap.add_argument("--release", type=float, default=0.5, help="seconds to recover (default 0.5)")
    ap.add_argument("--lookahead", type=float, default=0.12, help="seconds the duck starts early (default 0.12)")
    ap.add_argument("--min-gap", type=float, default=0.35, help="pauses shorter than this stay ducked (default 0.35)")
    ap.add_argument("--frames", help="write per-frame linear gains as JSON here")
    ap.add_argument("--fps", type=int, default=30)
    try:
        args = ap.parse_args(argv)
    except SystemExit as e:
        return 2 if e.code else 0
    for p in (args.bed, args.voice):
        if not Path(p).is_file():
            print(f"duck: {p} not found", file=sys.stderr)
            return 2
    try:
        res = run(args.bed, args.voice, args.out, args.depth, args.attack, args.release, args.lookahead, args.min_gap, args.frames, args.fps)
    except (ValueError, RuntimeError) as e:
        print(f"duck: {e}", file=sys.stderr)
        return 2
    print(json.dumps(res))
    return 0


if __name__ == "__main__":
    sys.exit(main())
