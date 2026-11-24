#!/usr/bin/env python3
"""Build the SFX library: render every family, finish, write 48 kHz 24-bit WAVs, measure, review.

    python3 scripts/audio/sfx/build.py                     # everything -> out/audio/sfx/
    python3 scripts/audio/sfx/build.py --only whoosh,ui    # some families (no export)
    python3 scripts/audio/sfx/build.py --export            # full build, then copy to public/audio/sfx/

Writes out/audio/sfx/wav/<category>/<id>.wav, manifest.json (the public manifest's content),
report.json (every measurement, QA check and the engine's `metrics.py --profile sfx` result per
file) and review/<category>.png (spectrogram + envelope sheets with the 30 fps frame grid).
--export copies the WAVs to public/audio/sfx/<category>/ and writes public/audio/sfx/manifest.json
(stale WAVs under public/audio/sfx/ are removed). Exit code 0 when every fail-level check passes,
1 when one fails, 2 on bad arguments.
"""

from __future__ import annotations

import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))  # scripts/audio (audiolib)
sys.path.insert(0, str(HERE))  # scripts/audio/sfx (sfxlib)
from audiolib.venv import ensure_venv  # noqa: E402

ensure_venv()

import argparse  # noqa: E402
import datetime  # noqa: E402
import importlib.util  # noqa: E402
import json  # noqa: E402
import shutil  # noqa: E402
import time  # noqa: E402

from audiolib import analysis, io, paths  # noqa: E402
from audiolib.core import seed_from  # noqa: E402
from sfxlib import families, finish, manifest, measure, review  # noqa: E402

OUT = paths.OUT / "sfx"
PUBLIC = paths.PUBLIC_AUDIO / "sfx"
SHORT_FILE_METRICS = {"noise.floorDbfs", "noise.humDb", "loudness.meterDeltaLu"}  # undefined for very short files


def _engine_metrics():
    spec = importlib.util.spec_from_file_location("engine_metrics", HERE.parent / "metrics.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def engine_check(mod, wav: Path, loop: bool) -> dict:
    res = mod.run(wav, "sfx", loop=False, png_base=None)
    real_fail, real_warn, na = [], [], []
    for c in res["checks"]:
        if c["pass"]:
            continue
        if c.get("note") == "metric not available" and c["id"] in SHORT_FILE_METRICS:
            na.append(c["id"])
        elif c["severity"] == "fail":
            real_fail.append(f"{c['id']}={c['value']}")
        else:
            real_warn.append(f"{c['id']}={c['value']}")
    out = {"pass": res["pass"], "failures": real_fail, "warnings": real_warn, "notApplicable": na,
           "truePeak": res["metrics"]["loudness"]["truePeak"], "onsetMs": res["metrics"]["silence"].get("onsetMs"),
           "tailEndDbfs": res["metrics"]["silence"].get("tailEndDbfs"), "momentaryMax": res["metrics"]["loudness"]["momentaryMax"]}
    if loop:
        out["loop"] = analysis.loop_seam(io.read(wav))
    return out


def build(only=None, run_metrics=True, sheets=True, quiet=False) -> dict:
    names = only or families.NAMES
    OUT.mkdir(parents=True, exist_ok=True)
    em = _engine_metrics() if run_metrics else None
    entries, rows, sheet_items = [], [], {}
    t0 = time.time()
    for name in names:
        fam = families.load(name)
        tf = time.time()
        sounds = fam.render()
        for s in sounds:
            final = finish.finalize(s)
            wav = OUT / "wav" / s.category / f"{s.id}.wav"
            io.write(wav, final, subtype="PCM_24", dither=True, seed=seed_from("sfx", s.id) % (2**32))
            written = io.read(wav)  # measure what is on disk (24-bit, dithered)
            m = measure.analyse(written, s)
            qa = measure.checks(m, s)
            if s.loop:
                seam = analysis.loop_seam(written)
                qa.append({"id": "loopSeam", "pass": seam.get("clickRatio", 99) <= 2.0, "severity": "fail", "detail": f"loop seam {seam}"})
            eng = engine_check(em, wav, s.loop) if em else None
            entry = manifest.entry(s, m, f"audio/sfx/{s.category}/{s.id}.wav", manifest.sha256_file(wav))
            entries.append(entry)
            rows.append({"id": s.id, "family": name, "measure": m, "qa": qa, "engineMetrics": eng})
            sheet_items.setdefault(s.category, []).append({
                "audio": written,
                "label": f"{s.id}  {m['durationMs']:.0f} ms  sync {m['syncMs']:.0f} ms (f{m['syncFrame30']})  M-max {m['lufsMomentaryMax']} LUFS  gain {m['suggestedGainDb']:+.1f} dB  centroid {m['centroidHz']} Hz",
                "sync_s": m["syncMs"] / 1000.0,
                "events_s": [ev["t"] for ev in s.events],
            })
        if not quiet:
            print(f"  {name:9s} {len(sounds):3d} sounds in {time.time() - tf:5.1f} s", file=sys.stderr)
    if sheets:
        for cat, items in sheet_items.items():
            for k in range(0, len(items), 12):
                suffix = "" if len(items) <= 12 else f"_{k // 12 + 1}"
                review.sheet(items[k : k + 12], OUT / "review" / f"{cat}{suffix}.png")
    today = datetime.date.today().isoformat()
    man = manifest.build(entries, today)
    problems = manifest.validate(man) if not only else []
    (OUT / "manifest.json").write_text(json.dumps(man, indent=2) + "\n")
    fails = [(r["id"], c["id"], c["detail"]) for r in rows for c in r["qa"] if not c["pass"] and c["severity"] == "fail"]
    warns = [(r["id"], c["id"], c["detail"]) for r in rows for c in r["qa"] if not c["pass"] and c["severity"] == "warn"]
    eng_fails = [(r["id"], f) for r in rows if r["engineMetrics"] for f in r["engineMetrics"]["failures"]]
    eng_warns = [(r["id"], w) for r in rows if r["engineMetrics"] for w in r["engineMetrics"]["warnings"]]
    report = {
        "generated": today, "sounds": len(entries), "seconds": round(time.time() - t0, 1),
        "groupLoudness": measure.group_summary(entries), "manifestProblems": problems,
        "qaFailures": fails, "qaWarnings": warns, "engineFailures": eng_fails, "engineWarnings": eng_warns, "files": rows,
    }
    (OUT / "report.json").write_text(json.dumps(report, indent=2, default=float) + "\n")
    if not quiet:
        print(f"{len(entries)} sounds, {len(fails)} QA failures, {len(warns)} QA warnings, engine metrics: {len(eng_fails)} failures, {len(eng_warns)} warnings, manifest problems: {len(problems)} ({time.time() - t0:.1f} s)", file=sys.stderr)
        for f in fails + [(i, "engine", d) for i, d in eng_fails]:
            print(f"  FAIL {f[0]} {f[1]}: {f[2]}", file=sys.stderr)
        for w in warns + [(i, "engine", d) for i, d in eng_warns]:
            print(f"  warn {w[0]} {w[1]}: {w[2]}", file=sys.stderr)
        for p in problems:
            print(f"  MANIFEST {p}", file=sys.stderr)
    return {"manifest": man, "report": report, "ok": not fails and not eng_fails and not problems}


def export(man: dict) -> list:
    """Copy the built WAVs to public/audio/sfx/ and write the public manifest; remove stale WAVs."""
    PUBLIC.mkdir(parents=True, exist_ok=True)
    keep = set()
    for e in man["sounds"]:
        src = OUT / "wav" / e["category"] / f"{e['id']}.wav"
        dst = paths.STUDIO / "public" / e["file"]
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(src, dst)
        if manifest.sha256_file(dst) != e["sha256"]:
            raise RuntimeError(f"copy of {e['id']} does not match its sha256")
        keep.add(dst.resolve())
    removed = []
    for old in PUBLIC.rglob("*.wav"):
        if old.resolve() not in keep:
            old.unlink()
            removed.append(str(old))
    (PUBLIC / "manifest.json").write_text(json.dumps(man, indent=2) + "\n")
    return removed


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Build the SFX library (scripts/audio/sfx).")
    ap.add_argument("--only", help=f"comma-separated families ({', '.join(families.NAMES)})")
    ap.add_argument("--no-metrics", action="store_true", help="skip the engine's metrics.py run per file")
    ap.add_argument("--no-review", action="store_true", help="skip the review sheets")
    ap.add_argument("--export", action="store_true", help="copy to public/audio/sfx/ and write its manifest (full builds only)")
    ap.add_argument("-q", "--quiet", action="store_true")
    try:
        args = ap.parse_args(argv)
    except SystemExit as e:
        return 2 if e.code else 0
    only = [x.strip() for x in args.only.split(",") if x.strip()] if args.only else None
    if only:
        bad = [x for x in only if x not in families.NAMES]
        if bad:
            print(f"build: unknown families {bad}; known: {families.NAMES}", file=sys.stderr)
            return 2
        if args.export:
            print("build: --export needs a full build (no --only), so the public manifest is complete", file=sys.stderr)
            return 2
    res = build(only, run_metrics=not args.no_metrics, sheets=not args.no_review, quiet=args.quiet)
    if args.export:
        if not res["ok"]:
            print("build: not exporting: a fail-level check failed", file=sys.stderr)
            return 1
        removed = export(res["manifest"])
        if not args.quiet:
            print(f"exported {len(res['manifest']['sounds'])} files to {PUBLIC} ({len(removed)} stale removed)", file=sys.stderr)
    return 0 if res["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
