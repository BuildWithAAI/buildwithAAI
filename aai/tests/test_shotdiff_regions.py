"""Layout check names the panel: grid cells map to named regions; a fully blank named panel fails on its own."""
import json
from pathlib import Path

from aai import shotcheck, shotdiff as sd
from aai.shotdiff import write_png


def _img(w, h, flat=None):
    """Textured image; pixels inside `flat` (x0, y0, x1, y1 px) are a flat dark fill (an emptied panel)."""
    rows = []
    for y in range(h):
        r = bytearray()
        for x in range(w):
            if flat and flat[0] <= x < flat[2] and flat[1] <= y < flat[3]:
                r += bytes([10, 10, 10])
            else:
                v = (x * 7 + y * 13) % 255 if (x // 3 + y // 3) % 2 else 20
                r += bytes([v, v, v])
        rows.append(bytes(r))
    return (w, h, 3, rows)


REG = [("left", 0.0, 0.0, 0.5, 1.0), ("tiny", 0.5, 0.0, 1.0, 0.25)]


def test_region_cells_cover_grid_and_first_match_wins():
    cells = sd.region_cells(REG + [("dup", 0.0, 0.0, 1.0, 1.0)], 4, 4)
    assert len(cells["left"]) == 8 and len(cells["tiny"]) == 2 and len(cells["dup"]) == 6
    assert sum(len(v) for v in cells.values()) == 16
    assert "other" in sd.region_cells(REG, 4, 4) and "dup" not in sd.region_cells(REG, 4, 4)


def test_small_blank_panel_fails_and_is_named():
    base = _img(96, 64)
    new = _img(96, 64, flat=(48, 0, 96, 16))   # "tiny" = 2 cells on a 4x4 grid: under max_new_blank, still a FAIL
    plain = sd.compare(base, new, cols=4, rows=4)
    assert plain["verdict"] == "PASS"            # the old whole-page rule misses it
    res = sd.compare(base, new, cols=4, rows=4, regions=REG)
    assert res["verdict"] == "FAIL" and res["panels_blank"] == ["tiny"]
    assert "panel went blank: tiny" in res["reason"] and res["regions"]["tiny"] == {"cells": 2, "changed": 2, "new_blank": 2, "live": 2}
    assert res["panels_moved"][0] == "tiny" and "moved: tiny 2/2" in res["reason"]


def test_stable_with_regions_passes_without_moved_note():
    res = sd.compare(_img(96, 64), _img(96, 64), cols=4, rows=4, regions=REG)
    assert res["verdict"] == "PASS" and res["reason"] == "layout stable" and res["panels_moved"] == []


def test_real_layout_regions_cover_named_panels():
    desk = sd.region_cells(shotcheck.DESK_REGIONS, 12, 8)
    for name in ("risk", "positions", "long-term", "data freshness", "voice orb", "ideas", "audit log",
                 "pipelines", "meme-risk/security", "economy ladder"):
        assert desk.get(name), name
    phone = sd.region_cells(shotcheck.PHONE_REGIONS, 12, 8)
    assert set(phone) == {"header", "alarm strip", "voice orb", "voice console"}
    assert all(l.get("regions") for l in shotcheck.LAYOUTS.values())


def test_shotcheck_records_panel_names(tmp_path, monkeypatch):
    monkeypatch.setattr(shotcheck, "LAYOUTS", {"desk": {"size": [96, 64], "suffix": "?nosse=1", "label": "DESK",
                                                        "regions": [("tiny", 0.5, 0.0, 1.0, 0.25), ("rest", 0.0, 0.0, 1.0, 1.0)]}})
    w = lambda p, im: (write_png(p, im[0], im[1], im[3]), p)[1]
    shotcheck.bless("desk", w(tmp_path / "b.png", _img(96, 64)))
    bad = w(tmp_path / "n.png", _img(96, 64, flat=(48, 0, 96, 16)))
    res = shotcheck.check("desk", bad)
    assert res["verdict"] == "FAIL" and res["recorded"]["panels_blank"] == ["tiny"]
    lay = shotcheck.summary()["layouts"][0]
    assert lay["panels_blank"] == ["tiny"] and "tiny" in lay["reason"]
    row = shotcheck.pipe_row()
    assert row["state"] == "FAIL" and "tiny" in row["detail"]
    # a hand-edited result file with junk panel lists never breaks the row
    d = json.loads(shotcheck.RESULT_PATH.read_text())
    d["layouts"]["desk"]["last"]["panels_moved"] = [1, None, "<b>x</b>"]
    shotcheck.RESULT_PATH.write_text(json.dumps(d))
    assert shotcheck.summary()["layouts"][0]["panels_moved"] == ["bx/b"]


def test_js_layout_panel_chip_is_text_only():
    js = Path("aai/static/zoora/zoora.js").read_text()
    i = js.index("const lcNames")
    block = js[i:i + 3000]
    assert "innerHTML" not in block and "panels_blank" in block and "blank panel" in block
