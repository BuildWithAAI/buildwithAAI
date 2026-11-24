"""clip5 momentum exit + shadow controls (ladder E, x1): pure policy rules and the engine integration (SIMULATION ONLY)."""
from __future__ import annotations
import json, sqlite3
import pytest
from smr.paper import edge as EG
from smr.paper import engine as E
from smr.paper import exits as X
from smr.paper.ledger import Ledger
from smr.paper.prices import Quote
from smr.paper.report import build, summary_text, unreported
from tests.test_paper import T0
from tests.test_momentum import MWorld

P0 = 1e-6          # World's default price


def pos(**kw):
    p = {"entry_price": 1.0, "entry_at": T0, "clips_done": 0, "peak_price": 1.0, "grad_at_launch": None}
    p.update(kw); return p


def ecfg(enabled=True, controls=("ladder", "x1")):
    c = EG.EdgeConfig()
    c.mexit = EG.MomentumExitCfg(enabled=enabled, policy="clip5", controls=list(controls))
    return c


# ---- pure rules ---------------------------------------------------------------------------------------------
def test_clip5_rungs_single_and_multi_with_conservative_fill():
    c = X.get("clip5")
    assert X.evaluate(c, pos(), 1.9, T0) == []
    assert X.evaluate(c, pos(peak_price=2.1), 2.1, T0) == [("clip", 1, 2.0, 0.2, 2.0, 2.0)]        # fills at the rung, not the mark
    a = X.evaluate(c, pos(peak_price=4.5), 4.5, T0)                                                 # gap up past 3 rungs
    assert [(x[1], x[2], x[5]) for x in a] == [(1, 2.0, 2.0), (2, 3.0, 3.0), (3, 4.0, 4.0)]
    a = X.evaluate(c, pos(clips_done=3, peak_price=12), 12, T0)
    assert [(x[1], x[2]) for x in a] == [(4, 6.0), (5, 10.0)]
    assert X.sold_frac(c, 5) >= X.FULL and X.next_rung(c, 5, 1.0) is None and X.next_rung(c, 2, 1.0)["multiple"] == 4.0


def test_clip5_stop_moves_and_gap_through():
    c = X.get("clip5")
    assert X.stop_level(c, 1.0, 0, 1.8) == 0.5                       # -50% until the first clip, whatever the peak
    assert X.stop_level(c, 1.0, 1, 2.1) == 1.26                      # 0.60 x peak
    assert X.stop_level(c, 1.0, 1, 1.5) == 1.0                       # never under entry once a clip filled
    assert X.evaluate(c, pos(), 0.51, T0) == []
    assert X.evaluate(c, pos(), 0.30, T0) == [("stop", "clip5_stop_loss", 0.5, 0.30)]           # gap-through: fill at the mark
    assert X.evaluate(c, pos(clips_done=2, peak_price=3.5), 2.0, T0) == [("stop", "clip5_trailing_stop", pytest.approx(2.1), 2.0)]
    assert X.evaluate(c, pos(clips_done=1, peak_price=1.2), 0.9, T0) == [("stop", "clip5_breakeven_stop", 1.0, 0.9)]


def test_max_hold_48h_all_policies():
    for name in ("clip5", "ladder", "x1"):
        pol = X.get(name)
        assert X.evaluate(pol, pos(), 1.1, T0 + 48 * 3600 - 1) == []
        assert X.evaluate(pol, pos(), 1.1, T0 + 48 * 3600) == [("max_hold", f"{name}_max_hold_48h", None, 1.1)]
        assert X.evaluate(pol, pos(), 0.4, T0 + 49 * 3600)[0][0] == "stop"          # a stop beats max hold
    assert X.evaluate(X.get("clip5"), pos(), 1.0, T0 + 30 * 3600) == []             # no 24h pre-clip time exit


def test_ladder_rungs_and_trail_by_graduation():
    lad = X.get("ladder")
    a = X.evaluate(lad, pos(peak_price=4.2), 4.2, T0)
    assert [(x[1], x[2], x[3]) for x in a] == [(1, 2.0, 0.5), (2, 4.0, 0.25)]
    assert X.sold_frac(lad, 2) == 0.75 and X.next_rung(lad, 2, 1.0) is None           # last 25% rides the trail
    assert X.stop_level(lad, 1.0, 0, 3.0) == 0.5
    assert X.stop_level(lad, 1.0, 2, 5.0, grad=0) == 3.0                              # 40% trail
    assert X.stop_level(lad, 1.0, 2, 5.0, grad=None) == 3.0                           # unknown -> 40%
    assert X.stop_level(lad, 1.0, 2, 5.0, grad=1) == 4.0                              # graduated at launch: 20% trail
    assert X.stop_level(lad, 1.0, 1, 1.1, grad=1) == 1.0                              # breakeven floor
    assert X.evaluate(lad, pos(clips_done=2, peak_price=5.0, grad_at_launch=1), 3.9, T0)[0][1] == "ladder_trailing_stop"
    assert X.evaluate(lad, pos(clips_done=2, peak_price=5.0, grad_at_launch=0), 3.9, T0) == []


def test_x1_rungs_and_breakeven():
    x1 = X.get("x1")
    assert [(x[1], x[3]) for x in X.evaluate(x1, pos(peak_price=3.2), 3.2, T0)] == [(1, 0.5), (2, 0.5)]
    assert X.sold_frac(x1, 2) >= X.FULL
    assert X.stop_level(x1, 1.0, 1, 2.9) == 1.0                                       # breakeven, no trail
    assert X.evaluate(x1, pos(clips_done=1, peak_price=2.9), 1.4, T0) == []
    assert X.evaluate(x1, pos(clips_done=1, peak_price=2.9), 0.97, T0) == [("stop", "x1_breakeven_stop", 1.0, 0.97)]


# ---- engine --------------------------------------------------------------------------------------------------
def step(w, price, cfg, dt=900):
    w.prices["N1"] = price; w.clock.t += dt
    return w.cycle(edge_cfg=cfg)


def test_entry_mirrors_controls_no_events_and_separate_bankrolls(tmp_path):
    w = MWorld(tmp_path, {"N1": "NORMAL"}); cfg = ecfg()
    st = w.cycle(edge_cfg=cfg)
    m, lad, x1 = (w.pos(b, "N1") for b in ("momentum", "momentum_ladder", "momentum_x1"))
    assert m["exit_policy"] == "clip5" and lad["exit_policy"] == "ladder" and x1["exit_policy"] == "x1"
    for c in (lad, x1):
        assert c["mirror_of"] == m["id"] and c["size_usd"] == m["size_usd"] and c["tokens"] == m["tokens"] and c["entry_price"] == m["entry_price"]
    assert m["stop_price"] == pytest.approx(0.5 * P0) and m["grad_at_launch"] == 0 and m["grad_source"] == "on pump.fun curve at entry"
    assert st["momentum"]["control_entries"] == 2
    assert {e["book"] for e in unreported(w.led, "strategy,momentum,momentum_ladder,momentum_x1")} == {"strategy", "momentum"}
    assert w.led.one("SELECT COUNT(*) AS n FROM events WHERE book LIKE 'momentum_%'")["n"] == 0
    assert E.book_state(w.led, "momentum")["cash"] == pytest.approx(980) and E.book_state(w.led, "momentum_x1")["cash"] == pytest.approx(980)
    b = [e for e in unreported(w.led, "momentum") if e["kind"] == "BUY"][0]
    assert b["exit_policy"] == "clip5" and b["stop_level_usd"] == pytest.approx(0.5 * P0) and "clip5: 20% at 2x" in b["text"]


def test_engine_clip5_multi_clip_events_trailing_stop_and_controls(tmp_path):
    w = MWorld(tmp_path, {"N1": "NORMAL"}); cfg = ecfg()
    w.cycle(edge_cfg=cfg)
    m0 = w.pos("momentum", "N1"); t0 = m0["tokens"]
    step(w, 2.2 * P0, cfg)                                   # clip 1 (2x)
    m = w.pos("momentum", "N1")
    assert m["clips_done"] == 1 and m["tokens"] == pytest.approx(0.8 * t0) and m["partial_frac"] == pytest.approx(0.2)
    assert m["stop_price"] == pytest.approx(0.6 * 2.2 * P0)
    log = json.loads(m["clip_log"])
    assert log[0]["trigger_price_usd"] == pytest.approx(2 * P0) and log[0]["mark_price_usd"] == pytest.approx(2.2 * P0) and log[0]["fill_price_usd"] == pytest.approx(2 * P0)
    ev = [e for e in unreported(w.led, "momentum") if e["kind"] == "PARTIAL_SELL"]
    assert len(ev) == 1 and ev[0]["clip_label"] == "clip 1/5" and ev[0]["clip_share_sold_pct"] == 20.0
    for k in ("profit_locked_usd", "remaining_pct_of_original", "stop_level_usd", "clip_trigger_price_usd", "clip_mark_price_usd", "next_rung"):
        assert ev[0][k] is not None, k
    assert ev[0]["remaining_pct_of_original"] == 80.0 and "PARTIAL SELL clip 1/5" in ev[0]["text"] and "stop now" in ev[0]["text"]
    lad = w.pos("momentum_ladder", "N1"); x1 = w.pos("momentum_x1", "N1")
    assert lad["clips_done"] == 1 and lad["tokens"] == pytest.approx(0.5 * t0) and x1["clips_done"] == 1 and x1["stop_price"] == pytest.approx(P0)
    step(w, 4.5 * P0, cfg)                                   # clips 2 and 3 in one mark (3x, 4x); x1 completes at 3x
    m = w.pos("momentum", "N1")
    assert m["clips_done"] == 3 and m["tokens"] == pytest.approx(0.4 * t0)
    ev = [e for e in unreported(w.led, "momentum") if e["kind"] == "PARTIAL_SELL"]
    assert sorted(e["clip_no"] for e in ev) == [1, 2, 3]                         # one event per clip (events seq)
    x1 = w.pos("momentum_x1", "N1")
    assert x1["status"] == "closed" and x1["exit_reason"] == "x1_all_clips_filled" and x1["tokens"] == 0
    assert x1["proceeds_usd"] == pytest.approx(x1["partial_proceeds_usd"]) and x1["pnl_usd"] > 0
    assert w.pos("momentum_ladder", "N1")["clips_done"] == 2
    # 2.6x: under 0.60 x 4.5x = 2.7x -> clip5 trailing stop; the ladder (40% trail -> 2.7x) stops too
    step(w, 2.6 * P0, cfg)
    m = w.pos("momentum", "N1")
    assert m["status"] == "closed" and m["exit_reason"] == "clip5_trailing_stop"
    assert m["exit_trigger_price"] == pytest.approx(2.7 * P0) and m["exit_price"] == pytest.approx(2.6 * P0)
    se = [e for e in unreported(w.led, "momentum") if e["kind"] == "SELL"][0]
    assert se["exit_trigger_price_usd"] == pytest.approx(2.7 * P0) and "3/5 clips filled" in se["text"] and "trigger" in se["text"]
    assert m["pnl_usd"] == pytest.approx(m["proceeds_usd"] - 20) and E.book_state(w.led, "momentum")["bankroll"] == pytest.approx(1000 + m["pnl_usd"])
    assert w.pos("momentum_ladder", "N1")["exit_reason"] == "ladder_trailing_stop"
    r = build(w.led)
    mx = r["momentum_exits"]["books"]
    assert set(mx) == {"momentum", "momentum_ladder", "momentum_x1", "momentum_clip5_rug_dust", "momentum_sighv"} and mx["momentum"]["clips_filled"] == 3 and mx["momentum_x1"]["clips_filled"] == 2
    assert mx["momentum"]["stop_mark_vs_trigger_mean_pct"] == pytest.approx((2.6 / 2.7 - 1) * 100, abs=0.01)
    s = summary_text(r)
    assert "Momentum exits side by side" in s and "clip5 (alerted)" in s and "ladder E" in s and "x1" in s
    assert r["momentum"]["profit_locked_usd"] == pytest.approx(m["partial_pnl_usd"], abs=0.01)


def test_engine_clip5_all_five_clips_closes_and_gap_down_stop(tmp_path):
    w = MWorld(tmp_path, {"N1": "NORMAL", "N2": "NORMAL"}); cfg = ecfg(controls=())
    w.cycle(edge_cfg=cfg)
    w.prices["N2"] = 0.2 * P0; step(w, 11 * P0, cfg)         # N1 gaps through all 5 rungs; N2 gaps far through the -50% stop
    m = w.pos("momentum", "N1")
    assert m["status"] == "closed" and m["exit_reason"] == "clip5_all_clips_filled" and m["clips_done"] == 5 and m["tokens"] == 0
    fills = [c["fill_price_usd"] / P0 for c in json.loads(m["clip_log"])]
    assert fills == pytest.approx([2, 3, 4, 6, 10])
    assert len([e for e in unreported(w.led, "momentum") if e["kind"] == "PARTIAL_SELL" and e["mint"] == "N1"]) == 5
    n2 = w.pos("momentum", "N2")
    assert n2["exit_reason"] == "clip5_stop_loss" and n2["exit_trigger_price"] == pytest.approx(0.5 * P0) and n2["exit_price"] == pytest.approx(0.2 * P0)
    assert w.pos("momentum_ladder", "N1") is None                                     # controls off


def test_engine_max_hold_and_legacy_rows_keep_moon_exit(tmp_path):
    w = MWorld(tmp_path, {"N1": "NORMAL"})
    w.cycle()                                                                          # edge off: legacy moon-bag row
    assert w.pos("momentum", "N1")["exit_policy"] is None
    (tmp_path / "b").mkdir()
    w2 = MWorld(tmp_path / "b", {"N2": "NORMAL"}); cfg = ecfg()
    w2.cycle(edge_cfg=cfg)
    step(w2, 2.1 * P0, cfg, dt=900)                         # clip 1
    w2.prices["N2"] = 1.5 * P0; w2.clock.t = T0 + 48 * 3600 + 60; w2.cycle(edge_cfg=cfg)
    m = w2.pos("momentum", "N2")
    assert m["status"] == "closed" and m["exit_reason"] == "clip5_max_hold_48h" and m["exit_trigger_price"] is None
    assert w2.pos("momentum_x1", "N2")["exit_reason"] == "x1_max_hold_48h"


def test_void_momentum_voids_its_controls(tmp_path):
    w = MWorld(tmp_path, {"N1": "NORMAL"}); cfg = ecfg()
    w.cycle(edge_cfg=cfg)
    r = E.void_position(w.led, "test", mint="N1", book="momentum", now=w.clock())
    assert r["control_positions_voided"] == 2
    assert w.pos("momentum_ladder", "N1")["void_reason"] == "test" and w.pos("strategy", "N1")["void_reason"] is None


def test_grad_at_launch_proxy(tmp_path):
    eng = object.__new__(E.Cycle); eng.ecfg = ecfg(); eng._grads = {"G2": 1000.0 + 300}
    q = lambda dex, pc=None: Quote("M", 1, 1, 1, "x", "p", dex, "S", "N", 0, mom_raw={"pair_created_ms": pc})
    assert E.Cycle._grad_at_launch(eng, {"mint": "M", "created_at": 1000}, q("pumpswap", 1030_000)) == (1, "dexscreener_pair_created")
    assert E.Cycle._grad_at_launch(eng, {"mint": "M", "created_at": 1000}, q("pumpswap", 1200_000))[0] == 0
    assert E.Cycle._grad_at_launch(eng, {"mint": "G2", "created_at": 1000}, q("raydium")) == (0, "graduations_jsonl")
    assert E.Cycle._grad_at_launch(eng, {"mint": "M", "created_at": 1000}, q("pumpfun"))[0] == 0
    assert E.Cycle._grad_at_launch(eng, {"mint": "M", "created_at": 1000}, q("raydium")) == (None, "unknown")


def test_events_migration_allows_multiple_partials(tmp_path):
    db = tmp_path / "old.db"
    c = sqlite3.connect(db)
    c.execute("CREATE TABLE events (id INTEGER PRIMARY KEY AUTOINCREMENT, created_at REAL NOT NULL, book TEXT NOT NULL, kind TEXT NOT NULL, "
              "position_id INTEGER NOT NULL, mint TEXT NOT NULL, payload TEXT NOT NULL, reported_at REAL, void_reason TEXT, UNIQUE(position_id, kind))")
    c.execute("INSERT INTO events (created_at, book, kind, position_id, mint, payload) VALUES (1, 'momentum', 'PARTIAL_SELL', 7, 'M', '{}')")
    c.commit(); c.close()
    led = Ledger(str(db))
    assert "UNIQUE(position_id, kind, seq)" in led.one("SELECT sql FROM sqlite_master WHERE name='events'")["sql"]
    assert led.one("SELECT id, seq FROM events") == {"id": 1, "seq": 0}
    led.insert("events", {"created_at": 2, "book": "momentum", "kind": "PARTIAL_SELL", "position_id": 7, "mint": "M", "seq": 2, "payload": "{}"})
    led.insert("events", {"created_at": 3, "book": "momentum", "kind": "PARTIAL_SELL", "position_id": 7, "mint": "M", "seq": 2, "payload": "{}"},
               mode="INSERT OR IGNORE")
    assert led.one("SELECT COUNT(*) AS n FROM events")["n"] == 2
    Ledger(str(db))                                                                   # idempotent
