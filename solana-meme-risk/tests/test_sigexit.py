"""Silent signal control books (momentum_clip5_rug_dust, momentum_sighv) and the 1-minute exit watcher (SIMULATION ONLY)."""
from __future__ import annotations
import json, os, subprocess, sys, time
import pytest
from smr.paper import edge as EG
from smr.paper import engine as E
from smr.paper import sigbooks as SB
from smr.paper import sigexit as SX
from smr.paper import watcher as W
from smr.paper.report import build, summary_text, unreported
from tests.test_paper import T0
from tests.test_momentum import MWorld

P0 = 1e-6
ALL4 = ("ladder", "x1", "clip5_rug_dust", "sighv")


def ecfg(controls=ALL4):
    c = EG.EdgeConfig()
    c.mexit = EG.MomentumExitCfg(enabled=True, policy="clip5", controls=list(controls))
    return c


def mk(at, price, b=None, s=None):
    return {"at": at, "price": price, "buys_m5": b, "sells_m5": s}


def nofeat(**kw):
    f = {"rug": False, "newhigh": False, "dd": 0.0, "bigsell": False, "pressure": 0, "ext": False, "vol": 0.0}
    f.update(kw); return f


# ---- pure rules -------------------------------------------------------------------------------------------------
def test_features_rug_red_share_wick_bigsell_and_vol():
    ms = [mk(T0, 1.0), mk(T0 + 60, 1.0), mk(T0 + 120, 0.64)]
    f = SX.features(ms, [], 1.0)
    assert f["rug"] and f["prev_price"] == 1.0 and f["dd"] == pytest.approx(0.36) and f["dd35"] and f["vol_src"] == "marks"
    assert not SX.features([mk(T0, 1.0), mk(T0 + 60, 0.66)], [], 1.0)["rug"]                   # 0.66 > 0.65x
    assert not SX.features([mk(T0, 1.0), mk(T0 + 1300, 0.5)], [], 1.0)["rug"]                  # previous mark too old
    f = SX.features([mk(T0, 1.0), mk(T0 + 60, 1.0, b=3, s=9)], [], 1.0)
    assert f["red5"] and f["red_src"] == "dexscreener_m5_counts"
    assert not SX.features([mk(T0, 1.0), mk(T0 + 60, 1.0, b=1, s=5)], [], 1.0)["red5"]          # < 10 txns: no signal
    now = T0 + 3600
    bars = [[now - 60 * (k + 1), 1.0, 1.02, 0.99, 1.01, 10.0] for k in range(20, 0, -1)]
    bars.append([now - 60, 1.0, 1.0, 0.7, 0.8, 100.0])                                            # big red, 10x volume
    f = SX.features([mk(now - 60, 1.0), mk(now, 0.8)], bars, 1.0)
    assert f["bigsell"] and f["red5"] and f["red_src"] == "gt_candles" and f["vol_src"] == "gt_candles"
    wb = bars[:-1] + [[now - 60, 1.0, 1.5, 0.95, 1.0, 10.0]]                                      # long upper wick at the high
    assert SX.features([mk(now - 60, 1.0), mk(now, 1.0)], wb, 1.5)["wick"]


def test_decide_sighv_floor_gate_vstep_pressure_heat_and_rug():
    e = 1.0
    assert SX.decide_sighv({}, e, T0, 0.5, 1.0, nofeat(), T0 + 60)[0] == ("stop", "sighv_stop_loss", 0.5)
    assert SX.decide_sighv({}, e, T0, 1.2, 1.2, nofeat(), T0 + 48 * 3600)[0][0] == "max_hold"
    assert SX.decide_sighv({}, e, T0, 1.9, 1.9, nofeat(pressure=4), T0 + 60)[:2] == (None, None)   # under 2x: no profit-taking
    imm, pend, st = SX.decide_sighv({}, e, T0, 0.8, 1.3, nofeat(rug=True), T0 + 60)
    assert imm is None and pend == (1.0, "sighv_rug_rule")                                         # the rug rule works below 2x
    imm, pend, st = SX.decide_sighv({}, e, T0, 2.0, 2.0, nofeat(newhigh=True, vol=0.05), T0 + 60)
    assert pend == (0.2, "sighv_vstep_0.25") and st == {"tier": 0, "ref": 2.0, "clipped": True}
    assert SX.decide_sighv(st, e, T0, 2.4, 2.4, nofeat(), T0 + 120)[1] is None                    # < ref x 1.25
    assert SX.decide_sighv(st, e, T0, 2.5, 2.5, nofeat(), T0 + 120)[1][1] == "sighv_vstep_0.25"
    assert SX.decide_sighv(st, e, T0, 2.4, 2.4, nofeat(ext=True, newhigh=True), T0 + 120)[1] == (0.15, "sighv_heat")
    _, pend, st2 = SX.decide_sighv(st, e, T0, 2.3, 2.5, nofeat(pressure=3), T0 + 120)
    assert pend == (0.25, "sighv_pressure_3") and st2["tier"] == 3
    assert SX.decide_sighv(st2, e, T0, 2.3, 2.5, nofeat(pressure=3), T0 + 180)[1] is None         # same tier fires once
    assert SX.decide_sighv(st2, e, T0, 2.3, 2.5, nofeat(pressure=4), T0 + 180)[1] == (0.5, "sighv_pressure_4")
    assert SX.decide_sighv(st2, e, T0, 1.4, 2.5, nofeat(), T0 + 180)[0] == ("stop", "sighv_floor", 1.5)  # 0.6 x peak once clipped


def test_decide_clip5_rug_dust_uses_live_rungs_plus_rug():
    p = {"entry_price": 1.0, "entry_at": T0, "clips_done": 0, "peak_price": 2.1, "grad_at_launch": None}
    acts, pend = SX.decide_clip5_rug_dust(p, 2.1, 2.0, T0 + 60)
    assert acts == [("clip", 1, 2.0, 0.2, 2.0, 2.0)] and pend is None
    acts, pend = SX.decide_clip5_rug_dust({**p, "peak_price": 1.0}, 0.6, 1.0, T0 + 60)
    assert acts == [] and pend == (1.0, "clip5_rug_dust_rug_rule")
    acts, pend = SX.decide_clip5_rug_dust({**p, "peak_price": 1.0}, 0.45, 1.0, T0 + 60)
    assert acts[0][:2] == ("stop", "clip5_rug_dust_stop_loss") and pend is None                  # a stop beats the rug rule
    assert "rug rule" in SX.describe("clip5_rug_dust") and "dust" in SX.describe("sighv")


# ---- engine integration ---------------------------------------------------------------------------------------
def test_entry_mirrors_four_controls_with_dust_and_no_events(tmp_path):
    w = MWorld(tmp_path, {"N1": "NORMAL"})
    st = w.cycle(edge_cfg=ecfg())
    m = w.pos("momentum", "N1")
    assert st["momentum"]["control_entries"] == 4
    for b in ("momentum_clip5_rug_dust", "momentum_sighv"):
        c = w.pos(b, "N1")
        assert c["mirror_of"] == m["id"] and c["size_usd"] == m["size_usd"] and c["tokens"] == m["tokens"]
        assert c["dust_tokens"] == pytest.approx(0.05 * m["tokens"]) and c["stop_price"] == pytest.approx(0.5 * P0)
        assert E.book_state(w.led, b)["cash"] == pytest.approx(980)
    assert w.led.one("SELECT COUNT(*) AS n FROM events WHERE book LIKE 'momentum_%'")["n"] == 0
    asked = "strategy,momentum,momentum_clip5_rug_dust,momentum_sighv"
    assert {e["book"] for e in unreported(w.led, asked)} == {"strategy", "momentum"}
    assert unreported(w.led, "momentum_sighv,momentum_clip5_rug_dust") == []
    assert w.pos("momentum", "N1")["exit_policy"] == "clip5"                                      # live exit unchanged


def test_cycle_fallback_rug_rule_fills_next_mark_keeps_dust_and_reports_both_ways(tmp_path):
    w = MWorld(tmp_path, {"N1": "NORMAL"}); cfg = ecfg()
    w.cycle(edge_cfg=cfg)
    t0 = w.pos("momentum_clip5_rug_dust", "N1")["tokens"]
    w.prices["N1"] = 0.6 * P0; w.clock.t += 900
    st = w.cycle(edge_cfg=cfg)                                         # no watcher lease -> the cycle steps the signal books
    assert st["momentum"]["signal_books_cycle_fallback"] == 2
    c = w.pos("momentum_clip5_rug_dust", "N1")
    assert c["status"] == "open" and json.loads(c["pending_sell"])["why"] == "clip5_rug_dust_rug_rule"
    assert w.pos("momentum", "N1")["status"] == "open"                 # live clip5: -40% is above its -50% stop
    w.prices["N1"] = 0.55 * P0; w.clock.t += 900
    w.cycle(edge_cfg=cfg)
    c = w.pos("momentum_clip5_rug_dust", "N1")
    assert c["status"] == "closed" and c["exit_reason"] == "clip5_rug_dust_rug_rule" and c["exit_price"] == pytest.approx(0.55 * P0)
    assert c["tokens"] == pytest.approx(0.05 * t0) and c["dust_last_price"] == pytest.approx(0.55 * P0)
    rec = json.loads(c["clip_log"])[-1]
    assert rec["intended_price_usd"] == pytest.approx(0.6 * P0) and rec["actual_fill_price_usd"] == pytest.approx(0.55 * P0)
    assert rec["fill_vs_intended_pct"] == pytest.approx(-8.33, abs=0.01) and rec["filled_by"] == "cycle"
    s = w.pos("momentum_sighv", "N1")
    assert s["status"] == "closed" and s["exit_reason"] == "sighv_rug_rule"
    r = build(w.led)
    x = r["momentum_exits"]["books"]["momentum_clip5_rug_dust"]
    assert x["positions_with_dust"] == 1 and x["dust_value_closed_at_last_price_usd"] > 0
    assert x["equity_dust_at_last_price"] > x["equity_dust_at_zero"] and x["signal_fills"] == 1
    assert "clip5+rug+5% dust" in summary_text(r) and "SIG-HV" in summary_text(r) and "at zero" in summary_text(r)
    assert w.led.one("SELECT COUNT(*) AS n FROM events WHERE book LIKE 'momentum_%'")["n"] == 0


def test_rug_dust_rungs_fill_at_rung_and_last_rung_keeps_dust(tmp_path):
    w = MWorld(tmp_path, {"N1": "NORMAL"}); cfg = ecfg()
    w.cycle(edge_cfg=cfg)
    t0 = w.pos("momentum_clip5_rug_dust", "N1")["tokens"]
    w.prices["N1"] = 2.2 * P0; w.clock.t += 900; w.cycle(edge_cfg=cfg)
    c = w.pos("momentum_clip5_rug_dust", "N1")
    assert c["clips_done"] == 1 and c["tokens"] == pytest.approx(0.8 * t0) and json.loads(c["clip_log"])[0]["fill_price_usd"] == pytest.approx(2 * P0)
    w.prices["N1"] = 11 * P0; w.clock.t += 900; w.cycle(edge_cfg=cfg)  # rungs 2..5; the 5th sells all but the dust
    c = w.pos("momentum_clip5_rug_dust", "N1")
    assert c["status"] == "closed" and c["exit_reason"] == "clip5_rug_dust_all_clips_filled" and c["tokens"] == pytest.approx(0.05 * t0)
    assert c["pnl_usd"] > 0 and E.book_state(w.led, "momentum_clip5_rug_dust")["bankroll"] == pytest.approx(1000 + c["pnl_usd"])


def test_void_voids_signal_mirrors(tmp_path):
    w = MWorld(tmp_path, {"N1": "NORMAL"}); w.cycle(edge_cfg=ecfg())
    m = w.pos("momentum", "N1")
    E.void_position(w.led, "test", position_id=m["id"], book="momentum", now=w.clock.t)
    for b in SX.SIGNAL_BOOKS:
        assert w.led.one("SELECT void_reason FROM positions WHERE book=?", (b,))["void_reason"]


# ---- watcher ------------------------------------------------------------------------------------------------------
def watcher(w, tmp_path, **kw):
    return W.Watcher(w.led, w.quotes, kw.pop("gt_fn", None), clock=w.clock, pid=4242,
                     heartbeat_path=str(tmp_path / "hb.json"), **kw)


def test_watcher_owns_signal_books_no_double_apply_and_leaves_live_book_alone(tmp_path):
    w = MWorld(tmp_path, {"N1": "NORMAL"}); cfg = ecfg()
    w.cycle(edge_cfg=cfg)
    wt = watcher(w, tmp_path)
    m_before = w.pos("momentum", "N1")
    w.prices["N1"] = 2.1 * P0; w.clock.t += 60
    r = wt.tick()
    assert r["open_positions"] == 5 and r["dex_calls"] == 1 and r["quoted"] == 1
    s = w.pos("momentum_sighv", "N1"); c = w.pos("momentum_clip5_rug_dust", "N1")
    assert json.loads(s["pending_sell"])["why"].startswith("sighv_vstep") and s["clips_done"] == 0
    assert c["clips_done"] == 1                                                     # rung 1 at 2x, same as live, but at 1-min
    m = w.pos("momentum", "N1")
    assert m["clips_done"] == 0 and m["last_price"] == m_before["last_price"]       # watcher never writes the live book
    assert r["would"] and r["would"][0]["actions"][0][0] == "clip"                 # ...it only logs what 1-min would do
    assert SB.lease_active(w.led, w.clock.t)
    # a paper cycle while the lease is live must not touch the signal books
    w.clock.t += 30
    st = w.cycle(edge_cfg=cfg)
    assert st["momentum"]["signal_books_skipped_watcher_owns"] >= 2 and "signal_books_cycle_fallback" not in st["momentum"]
    assert w.pos("momentum_sighv", "N1")["pending_sell"] == s["pending_sell"]
    assert w.pos("momentum", "N1")["clips_done"] == 1                               # the cycle still runs live clip5 + events
    assert len([e for e in unreported(w.led, "momentum") if e["kind"] == "PARTIAL_SELL"]) == 1
    w.prices["N1"] = 2.05 * P0; w.clock.t += 30
    r = wt.tick()
    s = w.pos("momentum_sighv", "N1")
    sig = [x for x in json.loads(s["clip_log"]) if x["kind"] == "signal"]
    assert len(sig) == 1 and s["pending_sell"] is None and len(r["fills"]) == 1    # executed exactly once
    assert sig[0]["intended_price_usd"] == pytest.approx(2.1 * P0) and sig[0]["actual_fill_price_usd"] == pytest.approx(2.05 * P0)
    assert s["tokens"] == pytest.approx(w.pos("momentum", "N1")["tokens_initial"] * (1 - 0.95 * 0.2))
    wt.tick()
    assert len([x for x in json.loads(w.pos("momentum_sighv", "N1")["clip_log"]) if x["kind"] == "signal"]) == 1
    hb = json.load(open(tmp_path / "hb.json"))
    assert hb["ticks"] == 3 and hb["calls_last_hour"]["dexscreener"] == 3 and hb["last_tick"]["open_mints"] == 1
    n = w.led.one("SELECT COUNT(*) AS n FROM marks WHERE mint='N1'")["n"]
    assert n >= 2
    # lease expired -> the cycle takes the signal books back
    w.clock.t += 600
    st = w.cycle(edge_cfg=cfg)
    assert st["momentum"]["signal_books_cycle_fallback"] == 2


def test_watcher_marks_dust_of_closed_rows_and_survives_dex_errors(tmp_path):
    w = MWorld(tmp_path, {"N1": "NORMAL"}); cfg = ecfg()
    w.cycle(edge_cfg=cfg)
    wt = watcher(w, tmp_path)
    w.prices["N1"] = 0.3 * P0; w.clock.t += 60
    wt.tick()                                                                       # -70%: stop at the crossing mark
    for b in SX.SIGNAL_BOOKS:
        assert w.pos(b, "N1")["status"] == "closed" and w.pos(b, "N1")["tokens"] > 0
    w.cycle(edge_cfg=cfg)                                                           # live book stops via the cycle
    assert w.pos("momentum", "N1")["status"] == "closed"
    w.prices["N1"] = 0.9 * P0; w.clock.t += 16 * 60
    r = wt.tick()
    assert r["open_positions"] == 0 and r["dust_marked"] == 2 and r["dex_calls"] == 1
    assert w.pos("momentum_sighv", "N1")["dust_last_price"] == pytest.approx(0.9 * P0)
    bad = W.Watcher(w.led, lambda m: (_ for _ in ()).throw(RuntimeError("boom")), None, clock=w.clock, pid=1)
    w.clock.t += 16 * 60
    assert bad.tick()["errors"]


def test_watcher_gt_budget_and_pause_during_cycle(tmp_path):
    w = MWorld(tmp_path, {"N1": "NORMAL", "N2": "NORMAL"}); cfg = ecfg()
    w.cycle(edge_cfg=cfg)
    calls = []
    def gt(pool):
        calls.append(pool); return [[w.clock.t - 120, P0, P0, P0, P0, 1.0]]
    wt = watcher(w, tmp_path, gt_fn=gt, gt_per_min=1)
    w.clock.t += 60
    r = wt.tick()
    assert r["gt_calls"] == 1 and len(calls) == 1                                  # 1/min budget with 2 sighv positions
    with w.led.tx():
        w.led.insert("cycles", {"started_at": w.clock.t})
    w.clock.t += 60
    assert wt.tick()["gt_calls"] == 0 and wt.tick()["cycle_running"]


def test_watcher_cli_start_is_idempotent_status_and_stop(tmp_path):
    db = str(tmp_path / "paper.db")
    from smr.paper.ledger import Ledger
    Ledger(db)
    env = {**os.environ, "PYTHONPATH": os.getcwd()}
    def cli(*a):
        out = subprocess.run([sys.executable, "-m", "risk", "paper", "watcher", *a, "--db", db, "--interval", "5", "--gt-per-min", "0"],
                             capture_output=True, text=True, env=env, timeout=60)
        return out.returncode, (json.loads(out.stdout) if out.stdout.strip() else {}), out.stderr
    try:
        rc, s, err = cli("start")
        assert rc == 0 and s["action"] == "started" and s["running"], err
        rc, s2, _ = cli("start")
        assert s2["action"] == "already_running" and s2["pid"] == s["pid"]
        rc, st, _ = cli("status", "--check")
        assert rc == 0 and st["healthy"] and st["heartbeat_age_s"] < 30
        assert os.path.exists(tmp_path / "watcher.heartbeat.json") and os.path.exists(tmp_path / "watcher.log")
    finally:
        rc, s3, _ = cli("stop")
    assert s3["action"] in ("stopped", "killed") and not cli("status")[1]["running"]
    assert cli("status", "--check")[0] == 1


def test_watcher_backs_off_on_429_without_blocking(tmp_path):
    w = MWorld(tmp_path, {"N1": "NORMAL", "N2": "NORMAL"}); cfg = ecfg()
    w.cycle(edge_cfg=cfg)
    calls = []
    def gt(pool):
        calls.append(pool); raise RuntimeError("geckoterminal GET /x failed: 429")
    wt = watcher(w, tmp_path, gt_fn=gt, gt_per_min=10)
    w.clock.t += 60
    r = wt.tick()
    assert len(calls) == 1 and wt.gt_429 == 1 and any("429" in e for e in r["errors"])          # stops after the first 429
    w.clock.t += 60
    assert wt.tick()["gt_calls"] == 0 and len(calls) == 1                                       # paused for GT_PAUSE_S
    w.clock.t += W.GT_PAUSE_S
    wt.tick(); assert len(calls) == 2
    dex = lambda mints: w.quotes(mints)
    dex.cooldown = lambda: 30.0                                                                 # DexScreener 429 cooldown
    wt2 = W.Watcher(w.led, dex, None, clock=w.clock, pid=7)
    r = wt2.tick()
    assert r["dex_calls"] == 0 and "cooldown" in r["errors"][0] and SB.lease_active(w.led, w.clock.t)
