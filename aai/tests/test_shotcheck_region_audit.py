"""Layout regions re-measure on bless: region_audit flags rects on empty page; blank rule uses baseline-live cells."""
import json
import subprocess
import sys
from pathlib import Path

from aai import shotcheck, shotdiff as sd
from aai.shotdiff import write_png


def _img(w, h, flat=()):
    """Textured image; pixels inside any rect in `flat` (x0, y0, x1, y1 px) are a flat dark fill."""
    rows = []
    for y in range(h):
        r = bytearray()
        for x in range(w):
            if any(f[0] <= x < f[2] and f[1] <= y < f[3] for f in flat):
                r += bytes([10, 10, 10])
            else:
                v = (x * 7 + y * 13) % 255 if (x // 3 + y // 3) % 2 else 20
                r += bytes([v, v, v])
        rows.append(bytes(r))
    return (w, h, 3, rows)


def _w(p, im):
    write_png(p, im[0], im[1], im[3])
    return p


REG = [("left", 0.0, 0.0, 0.5, 1.0), ("right", 0.5, 0.0, 1.0, 1.0)]


def test_region_audit_flags_rect_on_empty_page():
    # right half: only its top quarter has content; 6 of its 8 cells are empty page -> stale
    img = _img(96, 64, flat=[(48, 16, 96, 64)])
    a = sd.region_audit(img, REG, cols=4, rows=4)
    assert a["regions"]["right"] == {"cells": 8, "live": 2, "flat": 6}
    assert a["regions_stale"] == ["right"] and a["regions"]["left"]["flat"] == 0


def test_region_audit_partial_and_missing_region():
    img = _img(96, 64, flat=[(48, 48, 96, 64)])          # right: 2 of 8 cells flat -> partial, still checked
    a = sd.region_audit(img, REG + [("ghost", 0.9, 0.9, 0.95, 0.95)], cols=4, rows=4)
    assert a["regions_partial"] == ["right"] and "ghost" in a["regions_stale"] and a["regions"]["ghost"]["cells"] == 0


def test_blank_rule_uses_live_cells_so_partly_empty_rect_still_fires():
    base = _img(96, 64, flat=[(48, 32, 96, 64)])          # right rect: top half content, bottom half empty page
    new = _img(96, 64, flat=[(48, 0, 96, 64)])            # the panel's content went blank
    res = sd.compare(base, new, cols=4, rows=4, regions=REG)
    assert res["regions"]["right"]["live"] == 4 and res["regions"]["right"]["new_blank"] == 4
    assert res["verdict"] == "FAIL" and res["panels_blank"] == ["right"]   # old all-cells rule (4 != 8) missed this


def test_bless_warns_and_records_stale_region(tmp_path, monkeypatch):
    monkeypatch.setattr(shotcheck, "LAYOUTS", {"desk": {"size": [96, 64], "suffix": "?nosse=1", "label": "DESK", "regions": REG}})
    res = shotcheck.bless("desk", _w(tmp_path / "b.png", _img(96, 64, flat=[(48, 16, 96, 64)])))
    assert res["ok"] and res["regions_stale"] == ["right"] and "re-measure" in res["warning"] and "right" in res["warning"]
    rec = json.loads(Path(shotcheck.RESULT_PATH).read_text())["layouts"]["desk"]["blessed"]
    assert rec["regions_audit"]["regions_stale"] == ["right"] and rec["regions_audit"]["regions"]["right"] == {"cells": 48, "live": 12, "flat": 36}
    shotcheck.check("desk", _w(tmp_path / "n.png", _img(96, 64, flat=[(48, 16, 96, 64)])))
    s = shotcheck.summary()
    assert s["state"] == "OK" and s["layouts"][0]["regions_stale"] == ["right"]   # informational, verdict stands
    assert "re-measure regions: DESK right" in s["detail"]
    assert shotcheck.pipe_row()["layouts"][0]["regions_stale"] == ["right"]


def test_bless_clean_baseline_has_no_warning(tmp_path, monkeypatch):
    monkeypatch.setattr(shotcheck, "LAYOUTS", {"desk": {"size": [96, 64], "suffix": "?nosse=1", "label": "DESK", "regions": REG}})
    res = shotcheck.bless("desk", _w(tmp_path / "b.png", _img(96, 64)))
    assert res["ok"] and res["regions_stale"] == [] and "warning" not in res
    assert "re-measure" not in shotcheck.summary()["detail"]


def test_hostile_result_file_names_are_cleaned(tmp_path, monkeypatch):
    p = Path(shotcheck.RESULT_PATH)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps({"layouts": {"desk": {"blessed": {"regions_audit": {"regions_stale": ["<img src=x onerror=1>", 5, None]}},
                                                  "last": {"at": 1.0, "verdict": "PASS"}}}}))
    lay = next(l for l in shotcheck.summary(now=2.0)["layouts"] if l["layout"] == "desk")
    assert lay["regions_stale"] == ["img srcx onerror1"]


def test_real_baselines_regions_fit():
    """The blessed baselines in the repo: no named desk/phone region sits on empty page (re-measure if this fails)."""
    for lay in shotcheck.LAYOUTS:
        base = Path(__file__).resolve().parent.parent / "docs" / "screenshots" / "baseline" / f"{lay}.png"
        if not base.exists():
            continue
        a = sd.region_audit(sd.read_png(str(base)), shotcheck.LAYOUTS[lay]["regions"])
        assert a["regions_stale"] == [], (lay, a["regions_stale"])


def test_cli_regions_on_png_does_not_record(tmp_path):
    png = _w(tmp_path / "p.png", _img(390, 844))
    r = subprocess.run([sys.executable, "-m", "aai.cli", "shot-check", "regions", "phone", str(png)],
                       capture_output=True, text=True, timeout=120, cwd=str(Path(__file__).resolve().parent.parent))
    assert r.returncode == 0, r.stderr
    out = json.loads(r.stdout)
    assert out[0]["layout"] == "phone" and out[0]["ok"] is True and out[0]["image"] == "p.png"


def test_hud_renders_stale_region_chip_as_text():
    js = (Path(__file__).resolve().parent.parent / "aai" / "static" / "zoora" / "zoora.js").read_text()
    assert "lcNames(l.regions_stale)" in js and "re-measure ${rs[0]}" in js
    seg = js[js.index("lcNames(l.regions_stale)"):][:900]
    assert "innerHTML" not in seg
