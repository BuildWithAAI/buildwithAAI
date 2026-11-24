#!/usr/bin/env python3
"""End-to-end frame-sync check through Remotion's own audio mixer.

    python3 scripts/audio/sfx/sync_check.py              # render SfxSyncCheck (audio only), then measure
    python3 scripts/audio/sfx/sync_check.py --no-render  # measure an existing out/audio/sfx/sync/sync_check.wav

The composition (scripts/audio/sfx/remotion/SyncCheck.tsx) places library files with the TS helper
`startFrame(entry, frame)`, so each file's sync point should land on a planned frame. This script
reads the same plan from the .tsx, finds where each file actually sits in the render by
cross-correlation (exact to the sample), and measures each attack (impacts) or perceived pass-by
(whooshes) against its frame. Exit 0 when every file is placed within 1 ms of where startFrame()
puts it and every sync point is within 5 ms of its frame; 1 otherwise; 2 on errors.
"""

from __future__ import annotations

import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
sys.path.insert(0, str(HERE))
from audiolib.venv import ensure_venv  # noqa: E402

ensure_venv()

import argparse  # noqa: E402
import json  # noqa: E402
import re  # noqa: E402
import subprocess  # noqa: E402

import numpy as np  # noqa: E402

from audiolib import io, paths  # noqa: E402
from audiolib.core import SR  # noqa: E402
from sfxlib import measure  # noqa: E402
from sfxlib.core import FPS, FRAME  # noqa: E402

TSX = HERE / "remotion" / "SyncCheck.tsx"
OUT = paths.OUT / "sfx" / "sync" / "sync_check.wav"
PLAN_RE = re.compile(r"\['([a-z0-9_]+)',\s*(\d+)\]")


def plan() -> list:
    text = TSX.read_text(encoding="utf-8")
    block = text[text.index("SYNC_PLAN") : text.index("];", text.index("SYNC_PLAN"))]
    return [(m.group(1), int(m.group(2))) for m in PLAN_RE.finditer(block)]


def render() -> None:
    cmd = ["npx", "remotion", "render", "scripts/audio/sfx/remotion/index.ts", "SfxSyncCheck", str(OUT), "--codec=wav",
           "--config=scripts/audio/sfx/remotion/remotion.config.ts", "--log=error"]
    OUT.parent.mkdir(parents=True, exist_ok=True)
    proc = subprocess.run(cmd, cwd=paths.STUDIO, capture_output=True, text=True)
    if proc.returncode != 0:
        raise RuntimeError(f"remotion render failed:\n{proc.stdout[-1500:]}\n{proc.stderr[-1500:]}")


def placement(mix: np.ndarray, clip: np.ndarray, expected: int, search: int = 4800) -> int:
    """Sample offset where `clip` best matches `mix` (normalised cross-correlation), searched
    within +-search samples of `expected`."""
    from scipy.signal import correlate

    lo = max(0, expected - search)
    seg = mix[lo : expected + search + clip.size]
    c = correlate(seg, clip, mode="valid")
    e_seg = np.convolve(seg * seg, np.ones(clip.size), mode="valid")
    norm = c / np.sqrt(np.maximum(e_seg, 1e-20) * float(np.sum(clip * clip)))
    return lo + int(np.argmax(norm))


def check(render_path: Path) -> dict:
    man = json.loads((paths.PUBLIC_AUDIO / "sfx" / "manifest.json").read_text())
    by_id = {e["id"]: e for e in man["sounds"]}
    mix = io.read(render_path)
    if mix.shape[1] == 0:
        raise RuntimeError("empty render")
    mono = mix.mean(axis=0)
    rows = []
    for sid, frame in plan():
        e = by_id[sid]
        clip = io.read(paths.STUDIO / "public" / e["file"]).mean(axis=0)
        expected_start = (frame - e["syncFrame30"]) * FRAME
        found = placement(mono, clip, expected_start)
        sync_t = frame / FPS
        if e["syncKind"] in ("transient", "hit"):
            err = measure.event_onset_errors_ms(mix, [{"t": sync_t}])[0]
            what = "attack"
        else:
            seg = mix[:, found : found + clip.size]
            pw = (e.get("extra") or {}).get("peakWindowMs")
            peak = found / SR + measure.perceived_peak_s(seg, pw / 1000.0 if pw else None)
            err = round((peak - sync_t) * 1000, 2)
            what = "pass-by"
        rows.append({"id": sid, "frame": frame, "syncKind": e["syncKind"], "placementErrorSamples": found - expected_start,
                     "measured": what, "syncErrorMs": err,
                     "pass": abs(found - expected_start) <= SR // 1000 and err is not None and -1.0 <= err <= 5.0})
    return {"render": str(render_path), "rows": rows, "pass": all(r["pass"] for r in rows)}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Render SfxSyncCheck through Remotion and measure where every sound lands.")
    ap.add_argument("--no-render", action="store_true", help="measure the existing render")
    args = ap.parse_args(argv)
    try:
        if not args.no_render:
            render()
        res = check(OUT)
    except (RuntimeError, FileNotFoundError, KeyError, ValueError) as exc:
        print(f"sync_check: {exc}", file=sys.stderr)
        return 2
    (OUT.parent / "sync_check.json").write_text(json.dumps(res, indent=2) + "\n")
    for r in res["rows"]:
        print(f"  {'ok  ' if r['pass'] else 'FAIL'} {r['id']:18s} frame {r['frame']:3d}  placed {r['placementErrorSamples']:+d} samples from startFrame(); "
              f"{r['measured']} {r['syncErrorMs']:+.2f} ms from the frame", file=sys.stderr)
    print("PASS" if res["pass"] else "FAIL", file=sys.stderr)
    return 0 if res["pass"] else 1


if __name__ == "__main__":
    sys.exit(main())
