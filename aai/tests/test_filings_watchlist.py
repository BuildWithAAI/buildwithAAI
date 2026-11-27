"""Owner-edited EDGAR watchlist (aai/watchlist.py + `aai filings-watch`): validated, CLI-only writer, config overlay,
invalid file never half-applied, edgar payload names the source and unresolved tickers. tmp files only (conftest
points AAI_WATCHLIST at a tmp path, so the owner's data/watchlist.json is never read or written)."""
from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

from aai import config, watchlist
from aai.intel.adapters import edgar

ROOT = Path(__file__).resolve().parents[1]
DEFAULT = ["AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META", "TSLA", "AVGO", "JPM", "COIN", "MSTR", "PLTR"]


def test_no_file_uses_config_default():
    cfg = config.load()
    assert cfg["intel"]["watchlist"] == DEFAULT and cfg["intel"]["watchlist_source"] == "config"
    e = watchlist.effective(cfg)
    assert e["source"] == "config" and e["tickers"] == DEFAULT and "error" not in e


def test_add_remove_reset_roundtrip(tmp_path, monkeypatch):
    p = tmp_path / "wl.json"
    monkeypatch.setenv("AAI_WATCHLIST", str(p))
    cfg = config.load()
    r = watchlist.edit(cfg, "add", ["brk.b", "XYZ", "xyz", "AAPL"])
    assert r["changed"] == ["BRK.B", "XYZ"] and r["unchanged"] == ["AAPL"] and r["source"] == "file"
    assert r["tickers"] == DEFAULT + ["BRK.B", "XYZ"] and r["added_vs_default"] == ["BRK.B", "XYZ"]
    cfg2 = config.load()  # overlay at load; the tracked default is kept for diffs
    assert cfg2["intel"]["watchlist"][-2:] == ["BRK.B", "XYZ"] and cfg2["intel"]["watchlist_default"] == DEFAULT
    r = watchlist.edit(cfg2, "remove", ["TSLA", "NOPE"])
    assert r["changed"] == ["TSLA"] and r["removed_vs_default"] == ["TSLA"]
    d = json.loads(p.read_text())
    assert [h["action"] for h in d["history"]] == ["add", "remove"] and "TSLA" not in d["tickers"]
    r = watchlist.edit(config.load(), "reset")
    assert r["removed_file"] is True and not p.exists() and r["tickers"] == DEFAULT and r["source"] == "config"


def test_validation_caps_and_never_empty(tmp_path, monkeypatch):
    monkeypatch.setenv("AAI_WATCHLIST", str(tmp_path / "wl.json"))
    cfg = config.load()
    for bad in ["", "1ABC", "TOO-LONG-X", "A B", "<script>", "AAPL;rm", "ÄPL"]:
        with pytest.raises(watchlist.WatchlistError):
            watchlist.edit(cfg, "add", [bad])
    with pytest.raises(watchlist.WatchlistError):
        watchlist.edit(cfg, "add", [])
    with pytest.raises(watchlist.WatchlistError):
        watchlist.edit(cfg, "add", [f"Z{c}" for c in "ABCDEFGHIJKLMN"])  # 12 + 14 > 25
    with pytest.raises(watchlist.WatchlistError):
        watchlist.edit(cfg, "remove", DEFAULT)
    assert not (tmp_path / "wl.json").exists()  # nothing half-written


def test_corrupt_or_invalid_file_keeps_default(tmp_path, monkeypatch):
    p = tmp_path / "wl.json"
    monkeypatch.setenv("AAI_WATCHLIST", str(p))
    for body in ["{not json", json.dumps({"tickers": []}), json.dumps({"tickers": ["AAPL", "bad ticker"]}),
                 json.dumps({"tickers": [f"T{i}" for i in range(30)]}), json.dumps(["AAPL"])]:
        p.write_text(body)
        cfg = config.load()
        assert cfg["intel"]["watchlist"] == DEFAULT and cfg["intel"]["watchlist_source"] == "config"
        assert "unreadable" in watchlist.effective(cfg)["error"]


def test_cli_list_add_reset(tmp_path):
    env = dict(os.environ, AAI_WATCHLIST=str(tmp_path / "wl.json"), AAI_DB=str(tmp_path / "t.db"))
    run = lambda *a: subprocess.run([sys.executable, "-m", "aai", "filings-watch", *a], cwd=ROOT, env=env, capture_output=True, text=True)
    r = run("list")
    assert r.returncode == 0 and json.loads(r.stdout)["source"] == "config"
    r = run("add", "rklb")
    j = json.loads(r.stdout)
    assert r.returncode == 0 and j["changed"] == ["RKLB"] and "HUD restart" in j["takes_effect"]
    r = run("add", "not a ticker")
    assert r.returncode == 2 and json.loads(r.stdout)["ok"] is False
    assert run("reset").returncode == 0 and not (tmp_path / "wl.json").exists()
    assert not (tmp_path / "t.db").exists()  # filings-watch never opens the DB


class _F:
    def __init__(self):
        self.calls = []

    def get(self, url, **kw):
        self.calls.append(url)
        if "company_tickers" in url:
            return {"0": {"ticker": "AAPL", "cik_str": 320193, "title": "Apple Inc."}}
        return {"filings": {"recent": {}}}


def test_edgar_payload_names_source_and_unresolved(monkeypatch):
    monkeypatch.setattr(edgar.time, "sleep", lambda s: None)
    p = edgar.fetch(_F(), {"intel": {"watchlist": ["AAPL", "ZZZQ"], "watchlist_source": "file"}})
    assert p["watchlist_source"] == "file" and p["unresolved"] == ["ZZZQ"]
    p = edgar.fetch(_F(), {"intel": {"watchlist": ["AAPL"]}})
    assert p["watchlist_source"] == "config" and p["unresolved"] == []


def test_no_hud_or_voice_writer_and_js_is_safe():
    for f in ["aai/hud.py", "aai/zoora.py", "aai/intel/service.py"]:
        src = (ROOT / f).read_text()
        assert "watchlist.edit" not in src and "filings-watch" not in src.replace("aai filings-watch", "")
    js = (ROOT / "aai/static/zoora/zoora.js").read_text()
    i = js.index("function renderFilings")
    body = js[i:js.index("\n}\n", i)]
    assert "p.unresolved" in body and "owner list" in body and "innerHTML" not in body
