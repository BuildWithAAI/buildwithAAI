"""Equity sparkline: hourly marks (tmp store only), read-only curve, overview wiring."""
import json, time
from aai import equity_curve, guard, sources
from aai.hud import create_app


def test_mark_respects_interval(store, ledger):
    t = 1_800_000_000.0
    assert equity_curve.mark(store, ledger, now=t)["equity"] == ledger.equity()["equity"]
    assert equity_curve.mark(store, ledger, now=t + 1800) is None          # < 1h: no new mark
    assert equity_curve.mark(store, ledger, now=t + 3601) is not None
    assert store.one("SELECT COUNT(*) AS n FROM equity_snapshots")["n"] == 2


def test_curve_empty_and_stats(store, ledger):
    now = time.time()
    c = equity_curve.curve(store, now=now)
    assert c["points"] == [] and c["n_total"] == 0 and "change" not in c
    for i, eq in enumerate([10000, 10100, 9900, 10050]):
        store.execute("INSERT INTO equity_snapshots(ts,equity,cash_pnl,unrealized,open_risk) VALUES(?,?,?,?,?)",
                      (now - (4 - i) * 3600, eq, 0, 0, 0))
    store.execute("INSERT INTO equity_snapshots(ts,equity,cash_pnl,unrealized,open_risk) VALUES(?,?,?,?,?)",
                  (now - 30 * 86400, 1, 0, 0, 0))                       # outside the 7-day window
    c = equity_curve.curve(store, now=now, live_equity=10200)
    assert c["n_marks"] == 4 and c["n_total"] == 5 and len(c["points"]) == 5
    assert c["first"] == 10000 and c["last"] == 10200 and c["change"] == 200
    assert c["lo"] == 9900 and c["hi"] == 10200
    assert abs(c["max_dd"] - (10100 - 9900) / 10100) < 1e-9


def test_curve_downsamples(store):
    now = time.time()
    for i in range(500):
        store.execute("INSERT INTO equity_snapshots(ts,equity,cash_pnl,unrealized,open_risk) VALUES(?,?,?,?,?)",
                      (now - 6 * 86400 + i * 600, 10000 + i, 0, 0, 0))
    c = equity_curve.curve(store, now=now, max_points=50)
    assert len(c["points"]) == 50 and c["points"][0][1] == 10000 and c["points"][-1][1] == 10499


def test_overview_has_curve_and_no_marker_without_heavy(cfg, store, monkeypatch):
    monkeypatch.delenv("AAI_HUD_TOKEN", raising=False)
    monkeypatch.setattr(sources, "cheap_all", lambda: {})
    monkeypatch.setattr(guard, "global_kill", lambda: {"engaged": False, "reason": None})
    from aai.adapters.registry import build
    app = create_app(cfg, store, build(cfg, store), heavy=False)
    r = app.test_client().get("/api/zoora/overview")
    assert r.status_code == 200
    c = r.json["positions"]["curve"]
    assert len(c["points"]) == 1 and c["n_total"] == 0                      # live equity only, nothing written
    assert store.one("SELECT COUNT(*) AS n FROM equity_snapshots")["n"] == 0


def test_clamp_days():
    assert equity_curve.clamp_days(None) == 7.0
    assert equity_curve.clamp_days("nope") == 7.0
    assert equity_curve.clamp_days(1) == 1.0
    assert equity_curve.clamp_days(7) == 7.0
    assert equity_curve.clamp_days(30) == 30.0
    assert equity_curve.clamp_days(2) == 1.0          # nearest allowed
    assert equity_curve.clamp_days(20) == 30.0
    assert equity_curve.clamp_days(100) == 30.0


def test_curve_days_window(store):
    now = time.time()
    for i, eq in enumerate([10000, 10010, 10020, 10030]):
        store.execute("INSERT INTO equity_snapshots(ts,equity,cash_pnl,unrealized,open_risk) VALUES(?,?,?,?,?)",
                      (now - (3 - i) * 3600, eq, 0, 0, 0))          # last ~3h
    store.execute("INSERT INTO equity_snapshots(ts,equity,cash_pnl,unrealized,open_risk) VALUES(?,?,?,?,?)",
                  (now - 10 * 86400, 9000, 0, 0, 0))                 # 10d ago
    c1 = equity_curve.curve(store, days=1, now=now)
    c7 = equity_curve.curve(store, days=7, now=now)
    c30 = equity_curve.curve(store, days=30, now=now)
    assert c1["days"] == 1.0 and c1["n_marks"] == 4 and c1["n_total"] == 5
    assert c7["n_marks"] == 4
    assert c30["n_marks"] == 5 and c30["points"][0][1] == 9000


def test_equity_curve_endpoint(cfg, store, monkeypatch):
    monkeypatch.delenv("AAI_HUD_TOKEN", raising=False)
    monkeypatch.setattr(sources, "cheap_all", lambda: {})
    monkeypatch.setattr(guard, "global_kill", lambda: {"engaged": False, "reason": None})
    from aai.adapters.registry import build
    from pathlib import Path
    app = create_app(cfg, store, build(cfg, store), heavy=False)
    c = app.test_client()
    now = time.time()
    for i, eq in enumerate([10000, 10100, 9900]):
        store.execute("INSERT INTO equity_snapshots(ts,equity,cash_pnl,unrealized,open_risk) VALUES(?,?,?,?,?)",
                      (now - (3 - i) * 3600, eq, 0, 0, 0))
    r = c.get("/api/zoora/equity-curve?days=1")
    assert r.status_code == 200 and r.json["ok"] is True
    curve = r.json["curve"]
    assert curve["days"] == 1.0 and curve["n_marks"] == 3 and "change" in curve
    r2 = c.get("/api/zoora/equity-curve?days=999")
    assert r2.json["curve"]["days"] == 30.0                       # clamped
    ov = c.get("/api/zoora/overview").json["positions"]["curve"]
    assert ov["days"] == 7.0


def test_equity_range_chips_static():
    """Client ships 1D/7D/30D chips, zoora.eqDays memory, and a CT hover tip."""
    from pathlib import Path
    root = Path(__file__).resolve().parents[1]
    js = (root / "aai/static/zoora/zoora.js").read_text()
    css = (root / "aai/static/zoora/zoora.css").read_text()
    assert "zoora.eqDays" in js and "setEqDays" in js and "fetchEquityCurve" in js
    assert "fmtEqHover" in js and "hover the curve for a CT reading" in js
    assert "/api/zoora/equity-curve" in js
    assert ".eqc-chip" in css and ".eqc-tip" in css
