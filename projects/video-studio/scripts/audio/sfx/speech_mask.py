#!/usr/bin/env python3
"""Per-frame speech mask of a narration, for placing UI sounds in the gaps between Zoo's words.

    python3 scripts/audio/sfx/speech_mask.py public/generated/<channel>/<slug>/en/narration.wav \
        --out out/audio/<slug>/speech_frames.json [--fps 30] [--min-gap 0.1]

Writes {"fps": 30, "minGapSec": 0.1, "frames": N, "speech": [0, 1, ...]} (1 = Zoo is speaking during
that frame). In a composition, `nearestGapFrame(speech, frame)` (scripts/audio/sfx/sfx.ts) moves a pop
or tick to the nearest gap within a few frames, and `volumeUnderSpeech(entry)` trims one that has
to stay on a word by the role's `underSpeechTrimDb` (ui: -3 dB). Critic round 1: UI ticks are
centred at 1.7-2.2 kHz, right on his consonants.

Speech detection is the engine's (audiolib.duck.voice_activity), with gaps under `--min-gap`
seconds filled (0.1 s: a pause between words counts as a gap; the ducker uses 0.35 s).
Exit codes: 0 ok, 2 bad arguments or an unreadable file.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
from audiolib.venv import ensure_venv  # noqa: E402

ensure_venv()

import numpy as np  # noqa: E402

from audiolib import duck, io  # noqa: E402
from audiolib.core import SR  # noqa: E402


def speech_frames(voice, fps: int = 30, min_gap: float = 0.1, sr: int = SR) -> list:
    """1 for every video frame during which the voice is active (any sample), else 0."""
    act = duck.voice_activity(voice, sr=sr, min_gap=min_gap)
    per = sr / fps
    frames = int(math.ceil(act.shape[0] / per))
    out = []
    for f in range(frames):
        seg = act[int(round(f * per)) : int(round((f + 1) * per))]
        out.append(int(bool(seg.any())))
    return out


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Per-frame speech mask of a narration (for SFX placement).")
    ap.add_argument("narration")
    ap.add_argument("--out", required=True)
    ap.add_argument("--fps", type=int, default=30)
    ap.add_argument("--min-gap", type=float, default=0.1, help="gaps shorter than this count as speech (seconds, default 0.1)")
    try:
        args = ap.parse_args(argv)
    except SystemExit as e:
        return 2 if e.code else 0
    if not Path(args.narration).is_file():
        print(f"speech_mask: {args.narration} not found", file=sys.stderr)
        return 2
    voice = io.read(args.narration)
    mask = speech_frames(voice, args.fps, args.min_gap)
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    Path(args.out).write_text(json.dumps({"fps": args.fps, "minGapSec": args.min_gap, "frames": len(mask), "speech": mask}) + "\n")
    print(json.dumps({"out": args.out, "frames": len(mask), "speechShare": round(float(np.mean(mask)) if mask else 0.0, 3)}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
