#!/usr/bin/env python3
"""Writes src/episode/audio/bedLevels.json: how loud each Zoora AI story bed is, every 0.4 s of its 64 s loop, as
played and under the Episode's band-split duck (2 / 12 / 4 dB below 700 Hz / 700 Hz-5 kHz / above 5 kHz).

    .venv-audio/bin/python src/episode/tools/bed_levels.py            # rewrite the table
    .venv-audio/bin/python src/episode/tools/bed_levels.py --check    # exit 1 when the table is stale

The episode planner (src/episode/audio/plan.ts) reads it in the render and in Node, where the beds cannot be decoded
(FLAC), to:
  - choose the clock offset: the bed's level under each spoken phrase, against the voice (critic F10: after the duck
    the loop's sections differ by up to 4 LU, so the offset decides the voice-over-bed margin of a short episode);
  - cap each transition whoosh at 6 LU over the bed that plays under it (critic F8).

Each value is BS.1770 K-weighted loudness of one 0.4 s hop (19200 samples, 12 frames at 30 fps) of the looped bed,
channels summed (-0.691 + 10 log10 of the mean square), the hops tiling the loop from sample 0. The K-weighting and the
band split are run on the bed tiled three times and the middle copy is kept, so both wrap like the render's loop.
The table records each file's sha256: src/episode/tests/audio.test.ts fails when a bed changed and this was not re-run.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

STUDIO = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(STUDIO / "scripts" / "audio"))

import numpy as np  # noqa: E402
import soundfile as sf  # noqa: E402
from scipy.signal import sosfilt  # noqa: E402

from audiolib import duck, loudness  # noqa: E402

SR = 48000
HOP = 19200  # 0.4 s = 12 frames at 30 fps
DEPTHS = (2.0, 12.0, 4.0)
CROSSOVERS = (700.0, 5000.0)
BEDS = [f"bed-story-{m}{v}" for m in ("curious", "tension", "ominous", "resolve") for v in ("-underscore", "")]
OUT = STUDIO / "src" / "episode" / "audio" / "bedLevels.json"


def hop_lufs(x: np.ndarray) -> list:
    """K-weighted loudness of each 0.4 s hop of a loop (channels, samples), wrapped like the render's loop."""
    n = x.shape[1]
    t3 = np.tile(x, (1, 3))
    y = sosfilt(loudness.k_weighting_sos(SR), t3, axis=1)[:, n:2 * n]
    p = (y * y).reshape(y.shape[0], n // HOP, HOP).mean(axis=2).sum(axis=0)
    return [round(float(v), 2) for v in (-0.691 + 10 * np.log10(np.maximum(p, 1e-30)))]


def table() -> dict:
    manifest = json.loads((STUDIO / "public" / "audio" / "music" / "manifest.json").read_text())
    cues = {c["id"]: c for c in manifest["cues"]}
    beds = {}
    for bid in BEDS:
        c = cues[bid]
        path = STUDIO / "public" / c["file"]
        raw = path.read_bytes()
        x, sr = sf.read(str(path), always_2d=True, dtype="float64")
        x = x.T
        if sr != SR or x.shape[1] % HOP:
            raise SystemExit(f"{bid}: {sr} Hz, {x.shape[1]} samples; expected 48 kHz and a whole number of 0.4 s hops")
        n = x.shape[1]
        bands = [b[:, n:2 * n] for b in duck.split_bands(np.tile(x, (1, 3)), crossovers=CROSSOVERS)]
        ducked = sum(b * 10 ** (-d / 20) for b, d in zip(bands, DEPTHS))
        beds[bid] = {
            "file": c["file"],
            "sha256": hashlib.sha256(raw).hexdigest(),
            "loopSec": round(n / SR, 6),
            "lufs": hop_lufs(x),
            "lufsDucked": hop_lufs(ducked),
        }
    return {
        "version": 1,
        "generator": "src/episode/tools/bed_levels.py",
        "about": "K-weighted loudness (LUFS) of every 0.4 s hop of each story bed's loop, as played and under the Episode's band-split duck",
        "sampleRate": SR,
        "hopSamples": HOP,
        "hopFrames": 12,
        "duck": {"crossoversHz": list(CROSSOVERS), "depthsDb": list(DEPTHS)},
        "beds": beds,
    }


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--check", action="store_true", help="compare with the committed table instead of writing it")
    a = ap.parse_args(argv)
    t = table()
    text = json.dumps(t, indent=1) + "\n"
    if a.check:
        ok = OUT.exists() and json.loads(OUT.read_text()) == t
        print("bedLevels.json is current" if ok else "bedLevels.json is STALE: run src/episode/tools/bed_levels.py")
        return 0 if ok else 1
    OUT.write_text(text)
    for bid, b in t["beds"].items():
        d = np.array(b["lufsDucked"])
        print(f"{bid:32s} played {np.median(b['lufs']):6.1f} LUFS median; ducked {np.median(d):6.1f} median, 4-bar phrases "
              + " ".join(f"{-0.691 + 10 * np.log10(np.mean(10 ** ((d[k * 32:(k + 1) * 32] + 0.691) / 10))):6.1f}" for k in range(5)))
    print(f"-> {OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
