"""ECONOMY.md E6: daily economy snapshot + stage-change feed (aai/snapshots.py). Tmp DBs only; never data/aai.db."""
import datetime as dt, sqlite3, time
import pytest
from aai import economy as ec, grants, snapshots as sn
from aai.cli import main as cli_main
from test_economy import _close
from test_economy_grants import _momo
from test_zoora import FAKE_EXT, ad, app, client, say  # noqa: F401  (pytest fixtures)

CT = sn.TZ


def _at(y, m, d, h, mi=0):
    return dt.datetime(y, m, d, h, mi, tzinfo=CT).timestamp()


def _row(sid, stage, killed=False, granted=0, trades=20, reasons=()):
    return {"id": sid, "killed": killed, "weight": 0.1, "stats": {"trades": trades, "expectancy_r": 0.3, "current_drawdown": 0.01},
            "ladder": {"stage": stage, "eligible_stage": stage, "demoted": False, "demotion_reasons": list(reasons)},
            "grant": {"granted_stage": granted, "effective_stage": min(granted, stage)}}


def test_diff_pure():
    a = sn.compact({"strategies": [_row("x", 1), _row("y", 2), _row("z", 1), _row("gone", 0)]})
    b = sn.compact({"strategies": [_row("x", 2), _row("y", 1, reasons=["current drawdown 9% >= 8% stage-2 exit"]),
                                   _row("z", 0, killed=True), _row("new1", 0)]})
    assert sn.diff(None, b) == []                       # first snapshot is a baseline, no events
    ev = {(e["strategy"], e["kind"]): e for e in sn.diff(a, b)}
    assert ev[("x", "promoted")]["sev"] == "warn" and "economy-grant" in ev[("x", "promoted")]["detail"]
    assert ev[("y", "demoted")]["from_stage"] == 2 and "at or above" in ev[("y", "demoted")]["detail"]
    assert ev[("z", "killed")]["sev"] == "high" and ("z", "demoted") not in ev
    assert ("new1", "new") in ev and ("gone", "removed") in ev
    assert sn.diff(b, b) == []


def test_take_once_per_day_and_events(store, cfg):
    seq = iter([{"strategies": [_row("x", 1)]}] * 2 + [{"strategies": [_row("x", 2)]}] * 2)
    fn = lambda: next(seq)
    d1, d2 = _at(2026, 11, 3, 8), _at(2026, 11, 4, 8)
    r1 = sn.take(store, cfg, actor="cli", now=d1, sc_fn=fn)
    assert r1["baseline"] and r1["events"] == [] and r1["day"] == "2026-11-03"
    assert sn.take(store, cfg, actor="cli", now=d1 + 3600, sc_fn=fn)["skipped"] is True
    r2 = sn.take(store, cfg, actor="scheduler", now=d2, sc_fn=fn)
    assert [e["kind"] for e in r2["events"]] == ["promoted"]
    h = sn.history(store)
    assert h["last_snapshot"]["day"] == "2026-11-04" and len(h["snapshots"]) == 2 and h["events"][0]["kind"] == "promoted"
    assert h["snapshots"][0]["by_stage"][2] == 1
    with pytest.raises(sn.SnapshotError):
        sn.take(store, cfg, actor="hud", now=d2 + 86400, sc_fn=fn)
    with pytest.raises(sqlite3.DatabaseError, match="append-only"):
        store.execute("DELETE FROM economy_stage_events")
    with pytest.raises(sqlite3.DatabaseError, match="append-only"):
        store.execute("UPDATE economy_snapshots SET day='x'")


def test_take_reconciles_grants_and_never_promotes(store, cfg):
    _momo(store)
    sc_fn = lambda: ec.scorecard(store, cfg, include_arena=False)
    grants.grant(store, cfg, "aai:perps/momo", 2, by="Zoorped", quote="paper stage 2", confirm="GRANT")
    sn.take(store, cfg, now=_at(2026, 11, 3, 9), sc_fn=sc_fn)
    t = time.time()
    for i in range(12):                                  # a losing streak trips the recent-expectancy exit
        _close(store, "perps", "momo", -20.0, 20.0, t - 3600 + i)
    r = sn.take(store, cfg, actor="scheduler", now=_at(2026, 11, 4, 9), sc_fn=sc_fn)
    kinds = {e["kind"] for e in r["events"]}
    assert "demoted" in kinds and "grant_demoted" in kinds
    assert r["auto_demotions"] and grants.current(store)["aai:perps/momo"]["action"] == "auto_demotion"
    assert all(e["kind"] not in ("granted",) for e in r["events"])


def test_scheduler_due_window(store, cfg):
    s = sn.DailyScheduler(store, cfg)
    early, late = _at(2026, 11, 3, 6, 30), _at(2026, 11, 3, 7, 5)
    assert sn.due(store, early) is False and s.tick(early) is None
    s.store, s.cfg = store, cfg
    import aai.snapshots as mod
    orig = mod.economy.scorecard
    mod.economy.scorecard = lambda *a, **k: {"strategies": []}
    try:
        assert s.tick(late)["baseline"] is True
        assert s.tick(late + 600) is None and s.last_error is None
    finally:
        mod.economy.scorecard = orig


def test_api_feed_alert_and_intent(app, client, store, cfg):
    app.config["AAI_ECONOMY_ARENA"] = False
    d = client.get("/api/economy/history").json
    assert d["ok"] and d["events"] == [] and d["last_snapshot"] is None and d["stale"] is True
    assert client.post("/api/economy/history", json={}).status_code == 405       # read-only: the browser never snapshots
    a = {"strategies": [_row("aai:perps/momo", 2)]}
    b = {"strategies": [_row("aai:perps/momo", 1, reasons=["last 10 trades -0.5R < 0R"])]}
    seq = iter([a, a, b, b])
    now = time.time()
    sn.take(store, cfg, now=now - 86400, sc_fn=lambda: next(seq))
    sn.take(store, cfg, now=now, force=True, sc_fn=lambda: next(seq))
    d = client.get("/api/economy/history?n=5").json
    assert d["events"][0]["kind"] == "demoted" and d["stale"] is False and d["scheduler"]["running"] is False
    ov = client.get("/api/zoora/overview").json
    al = [x for x in ov["alerts"] if x["id"].startswith("econ_")]
    assert al and al[0]["sev"] == "high" and "DEMOTED" in al[0]["title"] and "S2 to S1" in al[0]["detail"]
    _momo(store)
    code, r = say(client, "economy ladder")
    assert code == 200 and "last stage change" in r["reply"].lower()


def test_cli_snapshot(cfg, store, monkeypatch, capsys, tmp_path):
    monkeypatch.setenv("AAI_WORKSPACE", str(tmp_path))
    monkeypatch.setattr("aai.config.load", lambda *a, **k: cfg)
    cli_main(["economy-snapshot"])
    assert '"baseline": true' in capsys.readouterr().out
    cli_main(["economy-snapshot"])
    assert '"skipped": true' in capsys.readouterr().out
    cli_main(["economy-events", "-n", "5"])
    assert '"snapshots"' in capsys.readouterr().out


def test_static_feed_textcontent_only():
    from pathlib import Path
    root = Path(__file__).resolve().parents[1] / "aai" / "static" / "zoora"
    js = (root / "zoora.js").read_text()
    seg = js.split("Stage-change feed (GET /api/economy/history")[1].split("/* ---")[0]
    assert "renderEconFeed" in seg and "innerHTML" not in seg
    assert 'id="econEvents"' in (root / "index.html").read_text()
