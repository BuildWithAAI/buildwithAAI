"""HUD layout regression in the cycle (backlog P3 "Shot-diff in the cycle/healthcheck").

A blessed baseline PNG per layout lives in docs/screenshots/baseline/<layout>.png. After a restart, an out-of-band
script (scripts/zoora_shot_check.sh) takes fresh headless shots and calls `aai shot-check check LAYOUT PNG`, which runs
the pure-Python grid diff (aai.shotdiff) and records only the verdict facts in data/shotdiff_last.json (a small
per-layout ring buffer). The healthcheck row and the HUD pipelines row read that file; nothing here ever takes a
screenshot, so the HUD and healthcheck stay fast. Read-only on the HUD side; writes only the result file and, on an
explicit `bless`, the baseline copy."""
from __future__ import annotations

import json
import os
import re
import shutil
import tempfile
import time
from pathlib import Path

from . import shotdiff

ROOT = Path(__file__).resolve().parent.parent
BASELINE_DIR = ROOT / "docs" / "screenshots" / "baseline"
RESULT_PATH = ROOT / "data" / "shotdiff_last.json"
# layout id -> window size and the /zoora URL suffix zoora_shot.sh appends. Keep in sync with scripts/zoora_shot_check.sh.
# `regions`: named panel rects (x0, y0, x1, y1 as page fractions) measured on the blessed baselines, so a FAIL names the
# panel that moved or went blank. Each grid cell (12x8) belongs to the region holding its centre (aai.shotdiff.region_cells).
# Re-measure them when you bless a deliberately different layout.
DESK_REGIONS = [
    ("risk", 0.0, 0.0, 0.32, 0.215), ("positions", 0.0, 0.215, 0.32, 0.505),
    ("long-term", 0.0, 0.505, 0.32, 0.715), ("data freshness", 0.0, 0.715, 0.32, 1.0),
    ("voice orb", 0.32, 0.0, 0.68, 0.36), ("ideas", 0.32, 0.36, 0.68, 0.535), ("audit log", 0.32, 0.535, 0.68, 0.72),
    ("pipelines", 0.68, 0.0, 1.0, 0.45), ("meme-risk/security", 0.68, 0.45, 1.0, 0.615), ("economy ladder", 0.68, 0.615, 1.0, 1.0),
]
PHONE_REGIONS = [
    ("header", 0.0, 0.0, 1.0, 0.14), ("alarm strip", 0.0, 0.14, 1.0, 0.30),
    ("voice orb", 0.0, 0.30, 1.0, 0.64), ("voice console", 0.0, 0.64, 1.0, 1.0),
]
LAYOUTS = {
    "desk": {"size": [1440, 2600], "suffix": "?nosse=1", "label": "DESK", "regions": DESK_REGIONS},
    "phone": {"size": [390, 844], "suffix": "?nosse=1", "label": "PHONE", "regions": PHONE_REGIONS},
}
HISTORY = 10
STALE_SEC = 7 * 86400          # no check for a week -> STALE (cycles run far more often than that)
_SAFE = re.compile(r"[^\w./ :;,%()+-]")


def _layout(name: str) -> str:
    if name not in LAYOUTS:
        raise ValueError(f"unknown layout {name!r}; one of: {', '.join(LAYOUTS)}")
    return name


def baseline_path(layout: str) -> Path:
    return BASELINE_DIR / f"{_layout(layout)}.png"


def load(path: Path | None = None) -> dict:
    p = Path(path or RESULT_PATH)
    try:
        d = json.loads(p.read_text())
    except (OSError, ValueError):
        return {"layouts": {}}
    if not isinstance(d, dict) or not isinstance(d.get("layouts"), dict):
        return {"layouts": {}}
    return d


def _save(d: dict, path: Path | None = None) -> None:
    p = Path(path or RESULT_PATH)
    p.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=str(p.parent), prefix=".shotdiff-", suffix=".json")
    with os.fdopen(fd, "w") as fh:
        json.dump(d, fh, indent=1)
    os.replace(tmp, p)


def _clip(s, n: int = 160) -> str:
    return _SAFE.sub("", str(s or "").replace(" > ", " over ").replace("(> ", "(over "))[:n]


def _names(v, n: int = 6) -> list:
    """Region names from a verdict (or a hand-edited result file), cleaned and capped; never raises."""
    return [_clip(x, 40) for x in v[:n] if isinstance(x, str) and x] if isinstance(v, list) else []


def check(layout: str, new_png, *, baseline_dir: Path | None = None, path: Path | None = None, now: float | None = None) -> dict:
    """Diff `new_png` against the blessed baseline for `layout` and record the verdict (facts only, no pixels)."""
    _layout(layout)
    base = Path(baseline_dir or BASELINE_DIR) / f"{layout}.png"
    if not base.exists():
        res = {"ok": False, "verdict": "NO_BASELINE", "reason": f"no blessed baseline; run aai shot-check bless {layout} PNG"}
    else:
        res = shotdiff.compare_files(base, new_png, regions=LAYOUTS[layout].get("regions"))
    entry = {"at": float(now if now is not None else time.time()), "verdict": str(res.get("verdict", "ERROR"))[:12],
             "reason": _clip(res.get("reason")), "changed_frac": res.get("changed_frac") if isinstance(res.get("changed_frac"), (int, float)) else None,
             "new_blank": len(res.get("new_blank") or []), "shot": Path(str(new_png)).name[:120],
             "panels_moved": _names(res.get("panels_moved")), "panels_blank": _names(res.get("panels_blank"))}
    d = load(path)
    lay = d["layouts"].setdefault(layout, {})
    hist = [e for e in (lay.get("history") or []) if isinstance(e, dict)][-(HISTORY - 1):]
    lay["last"], lay["history"] = entry, hist + [entry]
    _save(d, path)
    return {**res, "recorded": entry}


def _audit_entry(audit: dict) -> dict:
    """Facts-only record of a region audit (names cleaned and capped) for the result file / HUD."""
    per = audit.get("regions") if isinstance(audit.get("regions"), dict) else {}
    return {"regions_stale": _names(audit.get("regions_stale"), 12), "regions_partial": _names(audit.get("regions_partial"), 12),
            "regions": {_clip(k, 40): {kk: int(v.get(kk, 0)) for kk in ("cells", "live", "flat")}
                        for k, v in list(per.items())[:16] if isinstance(v, dict)}}


def audit_regions(layout: str, png=None, *, baseline_dir: Path | None = None) -> dict:
    """Region fit on `png` (default: the blessed baseline): which named panel rects sit on empty page (re-measure)."""
    _layout(layout)
    src = Path(str(png)) if png else Path(baseline_dir or BASELINE_DIR) / f"{layout}.png"
    if not src.exists():
        raise ValueError(f"no image to audit for {layout}: {src.name}")
    audit = shotdiff.region_audit(shotdiff.read_png(str(src)), LAYOUTS[layout].get("regions") or [])
    out = {"layout": layout, "image": src.name[:120], **_audit_entry(audit)}
    out["ok"] = not out["regions_stale"]
    if out["regions_stale"]:
        out["warning"] = (f"{layout}: re-measure region(s) " + ", ".join(out["regions_stale"]) +
                          " in aai/shotcheck.py (rect is mostly empty page; its blank-panel check is blind)")
    return out


def record_audit(layout: str, audit: dict, *, path: Path | None = None, now: float | None = None) -> None:
    """Store a baseline region audit on the layout's `blessed` record (kept across checks)."""
    d = load(path)
    b = d["layouts"].setdefault(layout, {}).setdefault("blessed", {})
    if not isinstance(b, dict):
        b = d["layouts"][layout]["blessed"] = {}
    b["regions_audit"] = {"at": float(now if now is not None else time.time()), **_audit_entry(audit)}
    _save(d, path)


def bless(layout: str, src_png, *, baseline_dir: Path | None = None, path: Path | None = None, now: float | None = None) -> dict:
    """Make `src_png` the baseline for `layout` (explicit owner/cycle action). Refuses a PNG that won't decode or has the wrong size.

    Also audits the named panel regions against the new baseline and returns a `warning` when a rect now sits on empty
    page (the bless still succeeds: the owner re-measures the rects in this file)."""
    _layout(layout)
    w, h, _ch, _rows = shotdiff.read_png(str(src_png))
    want = LAYOUTS[layout]["size"]
    if [w, h] != want:
        raise ValueError(f"{layout} baseline must be {want[0]}x{want[1]}, got {w}x{h}")
    dst = Path(baseline_dir or BASELINE_DIR) / f"{layout}.png"
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(src_png, dst)
    t = float(now if now is not None else time.time())
    d = load(path)
    d["layouts"].setdefault(layout, {})["blessed"] = {"at": t, "from": Path(str(src_png)).name[:120]}
    _save(d, path)
    audit = audit_regions(layout, dst)
    record_audit(layout, audit, path=path, now=t)
    out = {"ok": True, "layout": layout, "baseline": str(dst), "size": [w, h],
           "regions_stale": audit["regions_stale"], "regions_partial": audit["regions_partial"]}
    if audit.get("warning"):
        out["warning"] = audit["warning"]
    return out


def summary(path: Path | None = None, now: float | None = None) -> dict:
    """State for the healthcheck and the HUD row: OK / FAIL / STALE / MISSING, plus per-layout facts."""
    now = float(now if now is not None else time.time())
    d = load(path)
    lays, worst, newest = [], "OK", None
    rank = {"OK": 0, "STALE": 1, "MISSING": 2, "FAIL": 3}
    for name, meta in LAYOUTS.items():
        rec = d["layouts"].get(name) if isinstance(d["layouts"].get(name), dict) else {}
        last = rec.get("last") if isinstance(rec.get("last"), dict) else None
        bl = rec.get("blessed") if isinstance(rec.get("blessed"), dict) else {}
        ra = bl.get("regions_audit") if isinstance(bl.get("regions_audit"), dict) else {}
        restale = _names(ra.get("regions_stale"), 6)
        if not last or not isinstance(last.get("at"), (int, float)):
            lays.append({"layout": name, "label": meta["label"], "verdict": None, "state": "MISSING", "regions_stale": restale})
            st = "MISSING"
        else:
            v = str(last.get("verdict"))
            age = max(0.0, now - float(last["at"]))
            st = "OK" if v == "PASS" else "FAIL"
            if st == "OK" and age > STALE_SEC:
                st = "STALE"
            hist = [str(e.get("verdict"))[:12] for e in (rec.get("history") or []) if isinstance(e, dict)][-HISTORY:]
            lays.append({"layout": name, "label": meta["label"], "verdict": v, "state": st, "age_sec": round(age),
                         "changed_frac": last.get("changed_frac"), "new_blank": last.get("new_blank"),
                         "reason": _clip(last.get("reason")), "history": hist,
                         "panels_moved": _names(last.get("panels_moved")), "panels_blank": _names(last.get("panels_blank")),
                         "fails": sum(1 for x in hist if x != "PASS"), "regions_stale": restale})
            newest = age if newest is None else min(newest, age)
        worst = st if rank[st] > rank[worst] else worst
    n_pass = sum(1 for l in lays if l["verdict"] == "PASS")
    if all(l["state"] == "MISSING" for l in lays):
        detail = "no layout check yet; scripts/zoora_shot_check.sh after a restart"
    else:
        parts = []
        for l in lays:
            if l["verdict"] is None:
                parts.append(f"{l['label']} not checked")
            else:
                pct = f" {round(100 * l['changed_frac'])}% cells moved" if isinstance(l.get("changed_frac"), (int, float)) else ""
                parts.append(f"{l['label']} {l['verdict']}{pct}")
        detail = f"{n_pass}/{len(lays)} layouts pass vs blessed baseline · " + " · ".join(parts)
    fail = next((l for l in lays if l["state"] == "FAIL"), None)
    if fail and fail.get("reason"):
        detail += f" · {fail['label']}: {fail['reason']}"
    rs = [f"{l['label']} {', '.join(l['regions_stale'])}" for l in lays if l.get("regions_stale")]
    if rs:   # informational: the verdict stands, but a blind region should be re-measured (aai shot-check regions)
        detail += " · re-measure regions: " + "; ".join(rs)
    return {"ok": None if worst == "MISSING" else worst != "FAIL", "state": worst, "detail": detail[:240],
            "age_sec": newest, "layouts": lays}


def health() -> dict:
    """Optional healthcheck row (never required): reads the last recorded verdicts only; no browser."""
    s = summary()
    return {"ok": s["ok"], "status": s["state"].lower(), "detail": s["detail"],
            "layouts": {l["layout"]: l.get("verdict") for l in s["layouts"]}}


def pipe_row(path: Path | None = None, now: float | None = None) -> dict:
    try:
        s = summary(path, now)
    except Exception as e:  # noqa: BLE001  a bad result file must never break the overview
        return {"id": "layout_check", "name": "HUD layout check", "state": "ERROR", "detail": f"read failed: {type(e).__name__}"}
    row = {"id": "layout_check", "name": "HUD layout check", "state": s["state"], "detail": s["detail"], "layouts": s["layouts"]}
    if isinstance(s.get("age_sec"), (int, float)):
        row["age_sec"] = s["age_sec"]
    return row
