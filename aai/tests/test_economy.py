"""Paper economy scorecard, promotion ladder, auto-demotion and allocation (aai/economy.py, ECONOMY.md). Tmp DBs only."""
import json, sqlite3, time
import pytest
from aai import economy as ec
from aai.hud import create_app
from aai.adapters.registry import build


def trades(rs, risk=100.0, t0=1.7e9, step=86400.0):
    return [{"ts": t0 + i * step, "pnl": r * risk, "risk": risk} for i, r in enumerate(rs)]


def test_stats_basic():
    s = ec.stats(trades([1, -1, 2, -1]), capital=1000.0)
    assert s["trades"] == 4 and s["wins"] == 2 and s["net_pnl"] == 100.0
    assert s["expectancy_r"] == 0.25 and s["return_per_risk"] == 0.25
    assert s["profit_factor"] == 1.5
    # equity 1000 -> 1100 -> 1000 -> 1200 -> 1100: max dd 100/1100
    assert s["max_drawdown"] == pytest.approx(100 / 1100, abs=1e-4)
    assert s["current_drawdown"] == pytest.approx(100 / 1200, abs=1e-4)
    assert s["oos_trades"] == 2 and s["oos_expectancy_r"] == 0.5


def test_empty_is_stage0():
    s = ec.stats([], 1000.0)
    l = ec.ladder(s)
    assert s["trades"] == 0 and l["stage"] == 0 and l["next_stage"] == 1 and l["next_stage_blockers"]
    assert l["real_money_allowed"] is False and l["requires_zoorped_signoff"] is True


def _good(n):  # steady positive edge, low drawdown on a big capital base
    return trades([1.0 if i % 2 else -0.5 for i in range(n)], risk=10.0, step=86400.0)


def test_ladder_promotion_thresholds():
    assert ec.ladder(ec.stats(_good(12), 10000.0))["eligible_stage"] == 1
    s2 = ec.stats(_good(40), 10000.0)
    assert ec.ladder(s2)["eligible_stage"] == 2
    s3 = ec.stats(_good(120), 10000.0)
    l3 = ec.ladder(s3)
    assert l3["eligible_stage"] == 3 and l3["stage"] == 3 and l3["next_stage"] is None
    assert l3["real_money_allowed"] is False   # even the top paper stage never unlocks real money


def test_ladder_blocks_on_drawdown_and_oos():
    big_dd = ec.stats(_good(40), 40.0)          # same trades on tiny capital -> big drawdown
    assert ec.ladder(big_dd)["eligible_stage"] < 2
    # good in-sample, bad out-of-sample (last 30% losing) -> not stage 2
    rs = [1.0 if i % 2 else -0.5 for i in range(28)] + [-0.3] * 12
    l = ec.ladder(ec.stats(trades(rs, risk=10.0), 10000.0))
    assert l["eligible_stage"] <= 1 and any("out-of-sample" in b or "expectancy" in b for b in l["next_stage_blockers"])


def test_auto_demotion():
    s = ec.stats(_good(40), 10000.0)
    assert ec.ladder(s, killed=True)["stage"] == 0
    s = dict(s, current_drawdown=0.12)            # breaches stage-2 exit (10%)
    l = ec.ladder(s)
    assert l["eligible_stage"] == 2 and l["stage"] == 1 and l["demoted"] and l["demotion_reasons"]
    s = dict(ec.stats(_good(40), 10000.0), recent_expectancy_r=-0.4)
    assert ec.ladder(s)["stage"] == 1


def test_allocate_caps_and_zeroes():
    mk = lambda i, st, e, n=100, dem=False: {"id": i, "stats": {"expectancy_r": e, "trades": n},
                                             "ladder": {"stage": st, "demoted": dem}}
    w = ec.allocate([mk("a", 3, 0.5), mk("b", 2, 0.1), mk("c", 0, 0.9), mk("d", 2, -0.2), mk("e", 1, 0.2)])
    assert w["c"] == 0 and w["d"] == 0
    assert w["a"] == pytest.approx(ec.MAX_WEIGHT) and all(v <= ec.MAX_WEIGHT + 1e-9 for v in w.values())
    assert sum(w.values()) <= 1 + 1e-9
    assert ec.allocate([mk("x", 0, 1.0)]) == {"x": 0.0}
    one = ec.allocate([mk("x", 2, 0.3)])
    assert one["x"] == pytest.approx(ec.MAX_WEIGHT)      # a lone strategy is still capped; the rest stays cash


def _close(store, sector, source, pnl, risk, ts, reason="target"):
    iid = f"idea_{source}_{ts}"
    store.execute("INSERT INTO ideas(id,ts,sector,source,symbol,side,status) VALUES(?,?,?,?,?,?, 'filled')",
                  (iid, ts, sector, source, "SOL-USDT", "long"))
    store.execute("""INSERT INTO positions(id,idea_id,sector,symbol,side,qty,entry_px,risk_usd,opened_at,closed_at,realized_pnl,status,close_reason)
                     VALUES(?,?,?,?,?,?,?,?,?,?,?, 'closed', ?)""", ("pos_" + iid, iid, sector, "SOL-USDT", "long", 1, 100, risk, ts, ts, pnl, reason))


def _arena(tmp_path, arms, rows, kill=False):
    d = tmp_path / "perps-pipeline" / "state" / "arena"
    d.mkdir(parents=True)
    (d / "status.json").write_text(json.dumps({"arms": arms, "kill_switch": {"active": kill}}))
    c = sqlite3.connect(d / "arena.sqlite")
    c.execute("CREATE TABLE trades(arm TEXT, symbol TEXT, entry_time TEXT, exit_time TEXT, status TEXT, data TEXT)")
    for arm, xt, pnl, r in rows:
        c.execute("INSERT INTO trades VALUES(?,?,?,?,?,?)", (arm, "BTC-USDT", xt, xt, "closed", json.dumps({"net_pnl": pnl, "r_multiple": r})))
    c.commit(); c.close()
    return str(tmp_path / "perps-pipeline")


def test_scorecard_from_store_and_arena(store, cfg, tmp_path):
    t0 = time.time() - 50 * 86400
    for i in range(40):
        _close(store, "perps", "momo", 20.0 if i % 2 else -10.0, 20.0, t0 + i * 86400)
    _close(store, "perps", "zoora_voice", -1.72, 99.0, t0, reason="test_artifact")   # excluded
    root = _arena(tmp_path, {"maker": {"initial": 100.0}, "dead": {"initial": 100.0, "killed": True}},
                  [("maker", "2026-11-01T00:00:00Z", 0.5, 0.5), ("maker", "2026-11-02T00:00:00Z", -0.2, -0.2),
                   ("dead", "2026-11-01T00:00:00Z", 1.0, 1.0)])
    before = store.one("SELECT COUNT(*) AS n FROM audit_log")["n"]
    sc = ec.scorecard(store, cfg, arena_root=root)
    assert store.one("SELECT COUNT(*) AS n FROM audit_log")["n"] == before    # read-only: no writes
    ids = {r["id"]: r for r in sc["strategies"]}
    assert "aai:perps/zoora_voice" not in ids
    momo = ids["aai:perps/momo"]
    assert momo["stats"]["trades"] == 40 and momo["ladder"]["stage"] == 2 and momo["weight"] > 0
    assert ids["perps-arena:maker"]["stats"]["trades"] == 2 and ids["perps-arena:maker"]["ladder"]["stage"] == 0
    assert ids["perps-arena:dead"]["killed"] and ids["perps-arena:dead"]["weight"] == 0
    assert sc["real_money_allowed"] is False and sc["mode"] == "paper"
    assert sum(r["weight"] for r in sc["strategies"]) + sc["unallocated_weight"] == pytest.approx(1.0)


def test_global_kill_demotes_store_strategies(store, cfg, ledger):
    t0 = time.time() - 50 * 86400
    for i in range(40):
        _close(store, "perps", "momo", 20.0 if i % 2 else -10.0, 20.0, t0 + i * 86400)
    ledger.set_kill_switch(True, "test", "test")
    sc = ec.scorecard(store, cfg, include_arena=False)
    r = sc["strategies"][0]
    assert sc["global_kill"] and r["ladder"]["stage"] == 0 and r["weight"] == 0


def test_api_economy_endpoint(cfg, store):
    ad = build(cfg, store)
    app = create_app(cfg, store, ad)
    app.config["AAI_ECONOMY_ARENA"] = False
    _close(store, "perps", "evil<script>x</script>", 5.0, 10.0, time.time())
    c = app.test_client()
    r = c.get("/api/economy")
    assert r.status_code == 200 and r.json["ok"] and r.json["real_money_allowed"] is False
    assert all("<script" not in s["id"] for s in r.json["strategies"])
    assert c.post("/api/economy", json={}).status_code == 405       # read-only
