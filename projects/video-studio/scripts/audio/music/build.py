#!/usr/bin/env python3
"""Render, master, measure and deliver the show's music cues.

    python3 scripts/audio/music/build.py                      # every cue
    python3 scripts/audio/music/build.py theme-full bed-show-neutral
    python3 scripts/audio/music/build.py --list               # ids, types, lengths
    python3 scripts/audio/music/build.py theme-5s --no-export # render + measure only (out/ only)

Per cue, in out/audio/music/<id>/: <id>.wav (24-bit 48 kHz master), <id>.m4a (AAC preview),
<id>.master.json, <id>.premaster.wav (float), <id>.mid, metrics JSON, spectrogram and waveform PNGs
(and --stems: post-fader stems as FLAC). Delivery (unless --no-export): public/audio/music/<id>.wav or
.flac (see composer/spec.py), <id>.json metadata, manifest.json.

Exit codes: 0 every cue rendered and every fail-level metric passed; 1 a cue failed its metrics;
2 bad arguments.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))  # scripts/audio (audiolib, metrics)
sys.path.insert(0, str(HERE))  # scripts/audio/music (composer)
from audiolib.venv import ensure_venv  # noqa: E402

ensure_venv()

import numpy as np  # noqa: E402

from audiolib import io, master, paths  # noqa: E402
from audiolib.core import SR, seed_from  # noqa: E402
from composer import motif, render, spec  # noqa: E402
from composer.cues import REGISTRY  # noqa: E402

OUT = paths.OUT / "music"
PUBLIC = paths.PUBLIC_AUDIO / "music"
REVIEWS = HERE / "reviews.json"


def deliver(cue, rendered, public: Path) -> dict:
    a = rendered.master
    n = a.shape[1]
    fmt = spec.delivery_format(n)
    public.mkdir(parents=True, exist_ok=True)
    for old in public.glob(f"{cue.id}.*"):
        if old.suffix in (".wav", ".flac"):
            old.unlink()
    if fmt == "wav24":
        path = public / f"{cue.id}.wav"
        io.write(path, a, SR, subtype="PCM_24", seed=seed_from(cue.id) & 0xFFFF)
        bits = 24
    else:
        path = public / f"{cue.id}.flac"
        render.write_flac(path, a, bits=24, seed=7)
        bits = 24
        if path.stat().st_size > spec.MAX_BYTES:
            render.write_flac(path, a, bits=16, seed=7)
            bits = 16
    size = path.stat().st_size
    if size > spec.MAX_BYTES:
        raise RuntimeError(f"{path} is {size} bytes, over the {spec.MAX_BYTES} limit")
    rel = path.relative_to(paths.STUDIO / "public").as_posix()
    return {"file": rel, "format": f"{path.suffix[1:]}-{bits}bit", "bytes": size, "path": str(path)}


def save_midi(score, path: Path) -> list:
    """The score as MIDI (evidence of independent creation). A MIDI file has 15 melodic channels, so
    bigger scores are split: <id>.mid, <id>.2.mid, ..."""
    names = [n for n, p in score.parts.items() if p.notes]
    out = []
    for k in range(0, len(names), 15):
        p = path if k == 0 else path.with_suffix(f".{k // 15 + 1}.mid")
        score.save_midi(p, parts=names[k : k + 15], tail_seconds=1.0)
        out.append(p)
    return out


def build_one(cue, out_root: Path, public: Path | None, metrics_on: bool, stems: bool, reviews: dict, cache: bool = True) -> dict:
    import metrics as metrics_cli

    t0 = time.time()
    out = out_root / cue.id
    out.mkdir(parents=True, exist_ok=True)
    arr = cue.build()
    if abs(arr.length - (cue.bars * 4 * 60 / cue.bpm if (cue.loop and cue.bars) else arr.length)) > 1e-6:
        raise ValueError(f"{cue.id}: loop length {arr.length} s is not {cue.bars} bars at {cue.bpm} BPM")
    save_midi(arr.score, out / f"{cue.id}.mid")
    r = render.render(arr, out / "work", cache=(out_root / "_stem_cache") if cache else None)
    io.write(out / f"{cue.id}.premaster.wav", r.premaster / max(1.0, float(np.max(np.abs(r.premaster))) / 0.999), subtype="FLOAT")
    files = master.export(out / f"{cue.id}.wav", r.master, r.master_report)
    if stems:
        for name, a in r.stems.items():
            pk = float(np.max(np.abs(a)))
            render.write_flac(out / "stems" / f"{name}.flac", a * (0.98 / pk if pk > 0.98 else 1.0), bits=24)
    res = None
    if metrics_on:
        res = metrics_cli.run(Path(files["wav"]), cue.profile, cue.loop, out / cue.id)
        render.save_json(out / f"{cue.id}.metrics.json", res)
    delivered = {"file": None, "format": None, "bytes": None}
    sts = [dict(s, startSec=round(arr.score.seconds(s["starts"][0]), 3)) for s in motif.statements(arr.score, "zoo")]
    bad = [dict(s, startSec=round(arr.score.seconds(s["starts"][0]), 3)) for s in motif.statements(arr.score, "badger")]
    delivered_metrics = res
    if public is not None:
        delivered = deliver(cue, r, public)
        if metrics_on:
            delivered_metrics = metrics_cli.run(Path(delivered["path"]), cue.profile, cue.loop, None)
            render.save_json(out / f"{cue.id}.delivered.metrics.json", delivered_metrics)
    meta = spec.metadata(cue, r, delivered, delivered_metrics, sts, bad, reviews.get(cue.id))
    meta["render"] = {"timings": {**r.timings, "totalS": round(time.time() - t0, 1)}, "mix": r.mix_report,
                      "limiter": r.master_report.get("limiter"), "glue": r.mix_report.get("glue")}
    render.save_json(out / f"{cue.id}.json", meta)
    if public is not None:
        slim = {k: v for k, v in meta.items() if k != "render"}
        render.save_json(public / f"{cue.id}.json", slim)
    return meta


def summary_line(meta: dict) -> str:
    lo = meta["loudness"]
    ch = meta["checks"] or {}
    sp = meta.get("spectrum") or {}
    lufs = lo["shortTermMedianLufs"] if lo["profile"] == "bed" else lo["integratedLufs"]
    return (f"{meta['id']:24s} {meta['durationSec']:7.2f}s {lo['profile']:10s} {lufs if lufs is not None else float('nan'):7.2f} LUFS "
            f"TP {lo['truePeakDbtp']} harsh {sp.get('harshnessDb')} mud {sp.get('mudDb')} box {sp.get('boxinessDb')} pocket {sp.get('voicePocketDb')} "
            f"{'PASS' if ch.get('pass') else 'FAIL'} w{ch.get('warnings')} {ch.get('failed')}")


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("ids", nargs="*", help="cue ids (default: all)")
    ap.add_argument("--list", action="store_true")
    ap.add_argument("--out", default=str(OUT))
    ap.add_argument("--public", default=str(PUBLIC))
    ap.add_argument("--no-export", action="store_true")
    ap.add_argument("--no-metrics", action="store_true")
    ap.add_argument("--stems", action="store_true")
    ap.add_argument("--no-cache", action="store_true", help="re-render every stem (the cache keys on notes and instrument settings)")
    args = ap.parse_args(argv)
    if args.list:
        for c in REGISTRY.values():
            print(f"{c.id:24s} {c.cue_type:12s} {c.channel:15s} {c.key:10s} {c.bpm:6g} BPM  loop={c.loop}  {c.title}")
        return 0
    unknown = [i for i in args.ids if i not in REGISTRY]
    if unknown:
        print(f"unknown cue ids: {unknown}; known: {sorted(REGISTRY)}", file=sys.stderr)
        return 2
    ids = args.ids or list(REGISTRY)
    reviews = json.loads(REVIEWS.read_text(encoding="utf-8")) if REVIEWS.exists() else {}
    public = None if args.no_export else Path(args.public)
    entries = {}
    ok = True
    for cid in ids:
        meta = build_one(REGISTRY[cid], Path(args.out), public, not args.no_metrics, args.stems, reviews, cache=not args.no_cache)
        print(summary_line(meta), flush=True)
        if meta["checks"] is not None and not meta["checks"]["pass"]:
            ok = False
        if public is not None:
            entries[cid] = spec.manifest_entry({k: v for k, v in meta.items() if k != "render"})
    if public is not None and entries:
        spec.write_manifest(public / "manifest.json", entries)
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
