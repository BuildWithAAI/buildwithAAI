"""HUD layout check in the cycle: bless/check record verdict facts; healthcheck + pipelines row + alarm read them."""
import json
import subprocess
import sys
import time
from pathlib import Path

import pytest

from aai import shotcheck
from aai.shotdiff import write_png


def _img(path, w, h, blank_from=None):
    """Textured RGB image; rows from `blank_from` down are flat (an emptied panel)."""
    rows = []
    for y in range(h):
        if blank_from is not None and y >= blank_from:
            rows.append(bytes([10, 10, 10]) * w)
        else:
            rows.append(bytes(((x * 7 + y * 13) % 255 if (x // 5 + y // 5) % 2 else 20) for x in range(w) for _ in range(3)))
    write_png(path, w, h, rows)
    return path


@pytest.fixture
def small_layouts(monkeypatch):
    monkeypatch.setattr(shotcheck, "LAYOUTS", {"desk": {"size": [96, 64], "suffix": "?nosse=1", "label": "DESK"},
                                               "phone": {"size": [48, 64], "suffix": "?nosse=1", "label": "PHONE"}})


def test_missing_until_checked_is_optional(small_layouts):
    s = shotcheck.summary()
    assert s["state"] == "MISSING" and s["ok"] is None and "zoora_shot_check.sh" in s["detail"]
    assert shotcheck.health()["ok"] is None  # optional row: unconfigured never fails the healthcheck


def test_check_without_baseline_records_no_baseline(small_layouts, tmp_path):
    res = shotcheck.check("desk", _img(tmp_path / "d.png", 96, 64))
    assert res["verdict"] == "NO_BASELINE" and "bless" in res["reason"]
    assert shotcheck.summary()["state"] == "FAIL"


def test_bless_then_pass_and_fail(small_layouts, tmp_path):
    shotcheck.bless("desk", _img(tmp_path / "base.png", 96, 64))
    shotcheck.bless("phone", _img(tmp_path / "pb.png", 48, 64))
    assert (shotcheck.BASELINE_DIR / "desk.png").exists()
    assert shotcheck.check("desk", _img(tmp_path / "same.png", 96, 64))["verdict"] == "PASS"
    assert shotcheck.check("phone", _img(tmp_path / "p.png", 48, 64))["verdict"] == "PASS"
    s = shotcheck.summary()
    assert s["state"] == "OK" and s["ok"] is True and s["detail"].startswith("2/2 layouts pass")
    bad = shotcheck.check("desk", _img(tmp_path / "blank.png", 96, 64, blank_from=8))
    assert bad["verdict"] == "FAIL"
    s = shotcheck.summary()
    assert s["state"] == "FAIL" and s["ok"] is False and "DESK FAIL" in s["detail"]
    desk = next(l for l in s["layouts"] if l["layout"] == "desk")
    assert desk["history"] == ["PASS", "FAIL"] and desk["fails"] == 1 and desk["new_blank"] > 2
    assert ">" not in desk["reason"]  # sanitised: survives agent_guard cleaning on the HUD


def test_bless_refuses_wrong_size_and_unknown_layout(small_layouts, tmp_path):
    with pytest.raises(ValueError):
        shotcheck.bless("desk", _img(tmp_path / "x.png", 48, 64))
    with pytest.raises(ValueError):
        shotcheck.check("tablet", tmp_path / "x.png")
    assert not (shotcheck.BASELINE_DIR / "desk.png").exists()


def test_stale_after_a_week_and_history_ring(small_layouts, tmp_path):
    shotcheck.bless("desk", _img(tmp_path / "b.png", 96, 64))
    shotcheck.bless("phone", _img(tmp_path / "pb.png", 48, 64))
    old = time.time() - shotcheck.STALE_SEC - 60
    for i in range(shotcheck.HISTORY + 3):
        shotcheck.check("desk", tmp_path / "b.png", now=old)
    shotcheck.check("phone", tmp_path / "pb.png", now=old)
    s = shotcheck.summary()
    assert s["state"] == "STALE" and s["ok"] is True
    d = json.loads(shotcheck.RESULT_PATH.read_text())
    assert len(d["layouts"]["desk"]["history"]) == shotcheck.HISTORY
    assert "pixels" not in json.dumps(d) and "rows" not in d["layouts"]["desk"]["last"]


def test_corrupt_result_file_never_breaks(small_layouts):
    shotcheck.RESULT_PATH.write_text("{not json")
    assert shotcheck.summary()["state"] == "MISSING"
    shotcheck.RESULT_PATH.write_text(json.dumps({"layouts": {"desk": {"last": {"at": "x"}}}}))
    assert shotcheck.pipe_row()["state"] == "MISSING"


def test_pipelines_row_alarm_and_healthcheck(small_layouts, tmp_path, cfg, store, monkeypatch):
    from aai.adapters.registry import build
    from aai.hud import create_app
    from aai import health
    monkeypatch.delenv("AAI_HUD_TOKEN", raising=False)
    shotcheck.bless("desk", _img(tmp_path / "b.png", 96, 64))
    shotcheck.check("desk", _img(tmp_path / "blank.png", 96, 64, blank_from=8))
    c = create_app(cfg, store, build(cfg, store), heavy=False).test_client()
    ov = c.get("/api/zoora/overview").json
    row = next(p for p in ov["pipelines"] if p["id"] == "layout_check")
    assert row["state"] == "FAIL" and "DESK FAIL" in row["detail"]
    assert {l["layout"] for l in row["layouts"]} == {"desk", "phone"}
    assert any(a.get("id") == "pipe_layout_check" or "HUD layout check" in str(a.get("title")) for a in ov["alerts"])
    rep = health.run(cfg, store, network=False)
    hc = next(x for x in rep["checks"] if x["check"] == "hud_layout_shotdiff")
    assert hc["required"] is False and hc["pass"] is False and hc["detail"]["layouts"]["desk"] == "FAIL"
    assert "hud_layout_shotdiff" not in rep["failed_required"]


def test_js_renders_layout_chips_with_text_only():
    js = Path("aai/static/zoora/zoora.js").read_text()
    i = js.index("p.id === 'layout_check'")
    block = js[i:i + 2500]
    assert "innerHTML" not in block and "layout check facts" in js


def test_cli_status_and_bless_check(tmp_path):
    # the CLI uses the real module paths, so only exercise read-only status and argument errors here
    r = subprocess.run([sys.executable, "-m", "aai.cli", "shot-check", "check"], capture_output=True, text=True, cwd=Path(__file__).parent.parent)
    assert r.returncode != 0 and "needs LAYOUT PNG" in (r.stderr + r.stdout)
