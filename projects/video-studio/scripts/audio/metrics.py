#!/usr/bin/env python3
"""Audio quality metrics + pass/fail against the targets in docs/AUDIO.md (scripts/audio/targets.json).

    python3 scripts/audio/metrics.py out/audio/reference/reference_standalone.wav --profile standalone
    python3 scripts/audio/metrics.py bed_loop.wav --profile bed --loop --json bed.metrics.json
    python3 scripts/audio/metrics.py whoosh.wav --profile sfx --no-png
    python3 scripts/audio/metrics.py --targets-table          # the markdown table in docs/AUDIO.md

Measures: integrated / short-term / momentary loudness, LRA and true peak (ffmpeg ebur128), PSR,
crest factor, DC offset, clipping, stereo correlation and mono compatibility, octave-band balance
against a -3 dB/oct target tilt with harshness (2-5 kHz), mud (200-500 Hz) and voice-pocket
indicators, loop-seam discontinuity (--loop), noise floor and silence/onset timing. Writes a
spectrogram PNG (log frequency, 120 dB range) and a waveform PNG unless --no-png.

Output: JSON on stdout (or --json FILE) with "metrics", "checks" and "pass". A human summary goes
to stderr unless --quiet. Exit codes: 0 every fail-level check passed, 1 a fail-level check failed,
2 bad arguments or an unreadable file.
"""

from __future__ import annotations

import argparse
import json
import math
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from audiolib.venv import ensure_venv  # noqa: E402

ensure_venv()

from audiolib import analysis, paths  # noqa: E402


def load_targets(path=None) -> dict:
    with open(path or paths.TARGETS, encoding="utf-8") as f:
        t = json.load(f)
    if t.get("version") != 1 or "profiles" not in t:
        raise ValueError("unsupported targets file")
    return t


def get_path(d: dict, dotted: str):
    cur = d
    for part in dotted.split("."):
        if not isinstance(cur, dict) or part not in cur:
            return None
        cur = cur[part]
    return cur


def evaluate(metrics: dict, targets: dict, profile: str, loop: bool = False) -> list:
    if profile not in targets["profiles"]:
        raise ValueError(f"unknown profile {profile!r}; known: {sorted(targets['profiles'])}")
    checks = []
    for c in targets["common"] + targets["profiles"][profile]["checks"]:
        if c.get("when") == "loop" and not loop:
            continue
        v = get_path(metrics, c["id"])
        ok = v is not None and isinstance(v, (int, float)) and math.isfinite(v)
        if ok and "min" in c and v < c["min"]:
            ok = False
        if ok and "max" in c and v > c["max"]:
            ok = False
        checks.append({
            "id": c["id"], "value": v, "min": c.get("min"), "max": c.get("max"),
            "severity": c["severity"], "pass": bool(ok), "why": c["why"],
            **({"note": "metric not available"} if v is None else {}),
        })
    return checks


def bounds_text(c: dict) -> str:
    lo, hi = c.get("min"), c.get("max")
    if lo is not None and hi is not None:
        return f"{_fmt(lo)} (exact)" if lo == hi else f"{_fmt(lo)} to {_fmt(hi)}"
    if lo is not None:
        return f">= {_fmt(lo)}"
    return f"<= {_fmt(hi)}"


def _fmt(v) -> str:
    return f"{v:g}" if isinstance(v, (int, float)) else str(v)


def targets_table(targets: dict) -> str:
    lines = ["| Profile | Metric | Pass when | Severity | Why |", "| --- | --- | --- | --- | --- |"]
    for c in targets["common"]:
        lines.append(f"| all | `{c['id']}` | {bounds_text(c)} | {c['severity']} | {c['why']} |")
    for name, prof in targets["profiles"].items():
        for c in prof["checks"]:
            extra = " (with `--loop`)" if c.get("when") == "loop" else ""
            lines.append(f"| {name} | `{c['id']}`{extra} | {bounds_text(c)} | {c['severity']} | {c['why']} |")
    return "\n".join(lines) + "\n"


def pictures(wav: Path, base: Path) -> dict:
    base.parent.mkdir(parents=True, exist_ok=True)
    spec = base.with_name(base.name + ".spectrogram.png")
    wave = base.with_name(base.name + ".waveform.png")
    for out, filt in (
        (spec, "showspectrumpic=s=1600x720:legend=1:fscale=log:scale=log:color=intensity:drange=120:start=20:stop=20000:win_func=hann"),
        (wave, "showwavespic=s=1600x320:split_channels=1:colors=0x29B8AD|0xC9CED6:scale=lin:filter=peak"),
    ):
        proc = subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(wav), "-lavfi", filt, "-frames:v", "1", str(out)], capture_output=True, text=True)
        if proc.returncode != 0:
            raise RuntimeError(f"ffmpeg picture failed: {proc.stderr[-800:]}")
    return {"spectrogram": str(spec), "waveform": str(wave)}


def run(wav, profile: str = "none", loop: bool = False, png_base=None, targets_path=None) -> dict:
    targets = load_targets(targets_path)
    metrics = analysis.analyse(wav, loop=loop)
    checks = evaluate(metrics, targets, profile, loop)
    fails = [c for c in checks if not c["pass"] and c["severity"] == "fail"]
    warns = [c for c in checks if not c["pass"] and c["severity"] == "warn"]
    out = {"profile": profile, "loop": loop, "pass": not fails, "failures": len(fails), "warnings": len(warns), "metrics": metrics, "checks": checks}
    if png_base is not None:
        out["pictures"] = pictures(Path(wav), Path(png_base))
    return out


def summary_text(res: dict) -> str:
    m = res["metrics"]
    lo = m["loudness"]
    lines = [
        f"{m['file']}  [{res['profile']}{', loop' if res['loop'] else ''}]  {'PASS' if res['pass'] else 'FAIL'}"
        f" ({res['failures']} failed, {res['warnings']} warnings)",
        f"  loudness I {lo['integrated']} LUFS, S median {lo['shortTermMedian']} / max {lo['shortTermMax']}, LRA {lo['lra']} LU,"
        f" true peak {lo['truePeak']} dBTP, PSR median {m['psr']['medianDb']} dB",
        f"  stereo corr {m['stereo']['correlation']}, low corr {m['stereo']['lowCorrelation']}, mono loss {m['stereo']['monoLossDb']} dB;"
        f" tilt {m['spectrum'].get('slopeDbPerOct')} dB/oct, harsh {m['spectrum'].get('harshnessDb')}, mud {m['spectrum'].get('mudDb')},"
        f" voice pocket {m['spectrum'].get('voicePocketDb')}; noise floor {m['noise'].get('floorDbfs')} dBFS",
    ]
    for c in res["checks"]:
        if not c["pass"]:
            lines.append(f"  {c['severity'].upper():4s} {c['id']} = {c['value']} (want {bounds_text(c)}): {c['why']}")
    if "pictures" in res:
        lines.append(f"  pictures: {res['pictures']['spectrogram']}, {res['pictures']['waveform']}")
    return "\n".join(lines)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Audio quality metrics with pass/fail against docs/AUDIO.md targets.")
    ap.add_argument("wav", nargs="?", help="audio file (WAV/FLAC; anything soundfile reads)")
    ap.add_argument("--profile", default="none", help="standalone | sting | bed | sfx | none (default)")
    ap.add_argument("--loop", action="store_true", help="also check the loop seam (end -> start)")
    ap.add_argument("--json", help="write the JSON here instead of stdout")
    ap.add_argument("--png", help="base path for the pictures (default: next to --json, else out/audio/metrics/<name>)")
    ap.add_argument("--no-png", action="store_true", help="skip the spectrogram and waveform pictures")
    ap.add_argument("--targets", help="another targets.json")
    ap.add_argument("--targets-table", action="store_true", help="print the markdown targets table and exit")
    ap.add_argument("-q", "--quiet", action="store_true", help="no human summary on stderr")
    try:
        args = ap.parse_args(argv)
    except SystemExit as e:
        return 2 if e.code else 0
    try:
        if args.targets_table:
            sys.stdout.write(targets_table(load_targets(args.targets)))
            return 0
        if not args.wav:
            ap.print_usage(sys.stderr)
            return 2
        wav = Path(args.wav)
        if not wav.is_file():
            print(f"metrics: {wav} not found", file=sys.stderr)
            return 2
        png_base = None
        if not args.no_png:
            if args.png:
                png_base = Path(args.png)
            elif args.json:
                png_base = Path(args.json).with_suffix("")
            else:
                png_base = paths.OUT / "metrics" / wav.stem
        res = run(wav, args.profile, args.loop, png_base, args.targets)
    except ValueError as e:
        print(f"metrics: {e}", file=sys.stderr)
        return 2
    except RuntimeError as e:
        print(f"metrics: {e}", file=sys.stderr)
        return 2
    text = json.dumps(res, indent=2) + "\n"
    if args.json:
        Path(args.json).parent.mkdir(parents=True, exist_ok=True)
        Path(args.json).write_text(text)
    else:
        sys.stdout.write(text)
    if not args.quiet:
        print(summary_text(res), file=sys.stderr)
    return 0 if res["pass"] else 1


if __name__ == "__main__":
    sys.exit(main())
