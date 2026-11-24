#!/usr/bin/env python3
"""Duck a music bed under narration (and export the gain curves).

    python3 scripts/audio/duck.py --bed public/audio/music/bed-show-neutral-underscore.flac \
        --voice public/generated/<channel>/<slug>/en/narration.wav \
        --out out/audio/ducked_bed.wav --frames out/audio/ducked_bed.gain.json --fps 30

Modes:
- `split` (default): the band-split duck for the voice. The bed is split at 700 Hz and 5 kHz
  (zero-phase Linkwitz-Riley magnitude; the bands sum back to the bed exactly) and each band is
  ducked by its own depth under speech, 2 / 12 / 4 dB (`--depths`). Only the consonant band goes
  far down, so the voice stays clear while the music keeps its body (audiolib/duck.py).
- `broadband`: the whole bed by `--depth` dB (default 6). Passing `--depth` without `--mode`
  selects it, as before.

The bed is looped or cut to the narration's length (looping assumes a seamless loop: master it
with loop=True). Writes the ducked bed (24-bit WAV) and prints a summary: speech share, gain under
speech and in pauses, and the voice-to-bed loudness gap under speech. `--frames` writes the gains
per video frame as JSON: broadband {"fps", "mode", "gains": [...]} for
<Audio volume={(f) => gains[f]} />; split {"fps", "mode", "crossoversHz", "depthsDb",
"bands": {"low", "mid", "high"}}. A band-split duck cannot be applied with one volume curve, so in
Remotion play the ducked WAV this script writes.
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

BAND_NAMES = ("low", "mid", "high")


def fit_length(bed: np.ndarray, n: int) -> np.ndarray:
    if bed.shape[1] >= n:
        return bed[:, :n]
    reps = int(np.ceil(n / bed.shape[1]))
    return np.tile(bed, (1, reps))[:, :n]


def run(bed_path, voice_path, out_path, depth=6.0, attack=0.15, release=0.5, lookahead=0.12, min_gap=0.35, frames_path=None, fps=30,
        mode: str = "split", depths=duck.VOICE_DEPTHS, crossovers=duck.VOICE_CROSSOVERS) -> dict:
    if mode not in ("split", "broadband"):
        raise ValueError(f"mode must be split or broadband, not {mode!r}")
    voice = io.read(voice_path)
    bed = as_stereo(io.read(bed_path))
    n = voice.shape[1]
    bed = fit_length(bed, n)
    act = duck.voice_activity(voice, min_gap=min_gap)
    if mode == "split":
        out, gains = duck.split_duck(bed, act, tuple(depths), tuple(crossovers), attack, release, lookahead)
        ref = gains[1] if len(gains) > 1 else gains[0]  # the mid (voice) band's curve, for the summary
    else:
        ref = duck.duck_gain(act, depth, attack, release, lookahead)
        gains = [ref]
        out = duck.apply_gain(bed, ref)
    io.write(out_path, out)
    res = {"out": str(out_path), "mode": mode, "durationS": round(n / SR, 3), "speechShare": round(float(act.mean()), 3)}
    if mode == "split":
        res["crossoversHz"] = [float(f) for f in crossovers]
        res["depthsDb"] = [float(d) for d in depths]
    if act.any():
        res["gainUnderSpeechDb"] = round(float(np.median(ref[act])), 2) if mode == "broadband" else [round(float(np.median(g[act])), 2) for g in gains]
        # the voice is measured as one channel, i.e. as an equal-power (-3 dB per side) upmix, which
        # is what ffmpeg does with mono sources; a unity copy to both channels would read 3 LU louder
        mono = voice.mean(axis=0, keepdims=True)
        v_l = loudness.integrated(mono[:, act]) if act.sum() > SR // 2 else float("nan")
        b_l = loudness.integrated(out[:, act]) if act.sum() > SR // 2 else float("nan")
        if np.isfinite(v_l) and np.isfinite(b_l):
            res["voiceOverBedLu"] = round(float(v_l - b_l), 1)
    if (~act).any():
        res["gainInPausesDb"] = round(float(np.median(ref[~act])), 2)
    if frames_path:
        Path(frames_path).parent.mkdir(parents=True, exist_ok=True)
        if mode == "broadband":
            doc = {"fps": fps, "mode": mode, "gains": duck.frame_gains(ref, fps)}
        else:
            names = BAND_NAMES if len(gains) == 3 else tuple(f"band{k}" for k in range(len(gains)))
            doc = {"fps": fps, "mode": mode, "crossoversHz": [float(f) for f in crossovers], "depthsDb": [float(d) for d in depths],
                   "bands": {name: duck.frame_gains(g, fps) for name, g in zip(names, gains)}}
        Path(frames_path).write_text(json.dumps(doc) + "\n")
        res["frames"] = str(frames_path)
    return res


def _floats(text: str, count: int, what: str) -> tuple:
    try:
        vals = tuple(float(x) for x in text.split(","))
    except ValueError as e:
        raise argparse.ArgumentTypeError(f"{what}: comma-separated numbers, e.g. {','.join(['1'] * count)}") from e
    if len(vals) != count:
        raise argparse.ArgumentTypeError(f"{what}: {count} values, got {len(vals)}")
    return vals


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Duck a music bed under narration.")
    ap.add_argument("--bed", required=True)
    ap.add_argument("--voice", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--mode", choices=("split", "broadband"), help="split (default): 3 bands ducked 2/12/4 dB; broadband: the whole bed by --depth")
    ap.add_argument("--depths", type=lambda s: _floats(s, 3, "--depths"), default=duck.VOICE_DEPTHS, help="split mode: dB under speech for the low, mid, high bands (default 2,12,4)")
    ap.add_argument("--crossovers", type=lambda s: _floats(s, 2, "--crossovers"), default=duck.VOICE_CROSSOVERS, help="split mode: band edges in Hz (default 700,5000)")
    ap.add_argument("--depth", type=float, help="broadband mode: dB of ducking under speech (default 6; given alone, it selects broadband)")
    ap.add_argument("--attack", type=float, default=0.15, help="seconds to reach full depth (default 0.15)")
    ap.add_argument("--release", type=float, default=0.5, help="seconds to recover (default 0.5)")
    ap.add_argument("--lookahead", type=float, default=0.12, help="seconds the duck starts early (default 0.12)")
    ap.add_argument("--min-gap", type=float, default=0.35, help="pauses shorter than this stay ducked (default 0.35)")
    ap.add_argument("--frames", help="write the per-frame linear gains as JSON here")
    ap.add_argument("--fps", type=int, default=30)
    try:
        args = ap.parse_args(argv)
    except SystemExit as e:
        return 2 if e.code else 0
    mode = args.mode or ("broadband" if args.depth is not None else "split")
    for p in (args.bed, args.voice):
        if not Path(p).is_file():
            print(f"duck: {p} not found", file=sys.stderr)
            return 2
    try:
        res = run(args.bed, args.voice, args.out, 6.0 if args.depth is None else args.depth, args.attack, args.release, args.lookahead, args.min_gap,
                  args.frames, args.fps, mode=mode, depths=args.depths, crossovers=args.crossovers)
    except (ValueError, RuntimeError) as e:
        print(f"duck: {e}", file=sys.stderr)
        return 2
    print(json.dumps(res))
    return 0


if __name__ == "__main__":
    sys.exit(main())
