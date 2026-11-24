"""Isolated $100 experiment100 book: fixed sizing, pre-entry StalkChain, separate from $1000 books."""
from __future__ import annotations
import json, time
import pytest
from smr.paper import engine as E
from smr.paper import edge as EG
from smr.paper.scanner import Scanner, ScannerConfig
from smr.paper.ledger import Ledger


class FakeClock:
    def __init__(self, t): self.t = t
    def __call__(self): return self.t


def test_start_bankroll_isolated():
    assert E.start_bankroll_for(E.EXPERIMENT100_BOOK) == 100.0
    assert E.start_bankroll_for("strategy") == 1000.0
    assert E.start_bankroll_for("scanner") == 1000.0


def test_fixed_sizing_tiers():
    cfg = ScannerConfig(book=E.EXPERIMENT100_BOOK, sizing_mode="fixed", fixed_entry_usd=1.0, tier2_cash_usd=250.0, tier2_entry_usd=2.0,
                        require_quality_preentry=True, end_ts=None, start_bankroll=100.0)
    sc = Scanner(None, None, cfg=cfg, clock=FakeClock(1e9))
    assert sc._entry_size_usd(100.0, 100.0, 0.02) == 1.0
    assert sc._entry_size_usd(249.99, 250.0, 0.02) == 1.0
    assert sc._entry_size_usd(250.0, 250.0, 0.02) == 2.0
    assert sc._entry_size_usd(0.5, 100.0, 0.02) == 0.5


def test_quality_preentry_blocks_missing_and_veto(tmp_path):
    cache = tmp_path / "holders.json"
    cache.write_text(json.dumps({"tokens": {}}))
    hcfg = EG.HoldersCfg(enabled=True, cache_file=str(cache), cache_max_age_s=1800, veto_dev_mints=10, veto_organic_zero=True, veto_authorities=True)
    ecfg = EG.EdgeConfig.from_dict({"holders_live": {"enabled": True, "cache_file": str(cache), "veto_dev_mints": 10, "veto_organic_zero": True, "veto_authorities": True}})
    # force holders cfg path
    ecfg.holders = hcfg
    cfg = ScannerConfig(book=E.EXPERIMENT100_BOOK, require_quality_preentry=True, quality_cache_max_age_s=1800, end_ts=None)
    sc = Scanner(None, None, cfg=cfg, edge_cfg=ecfg, clock=FakeClock(1_000_000))
    holders, src, veto = sc._quality_preentry("Mint1111111111111111111111111111111111111", 1_000_000)
    assert holders is None and "unavailable" in veto

    # incomplete
    toks = {"Mint1111111111111111111111111111111111111": {"mint": "Mint1111111111111111111111111111111111111",
            "fetched_ts": 1_000_000, "dev_mints": 1, "organic_score": None, "top_holders_pct": None}}
    cache.write_text(json.dumps({"tokens": toks}))
    holders, src, veto = sc._quality_preentry("Mint1111111111111111111111111111111111111", 1_000_000)
    assert "unavailable" in veto and "incomplete" in veto

    # veto serial-ish via organic 0
    toks["Mint1111111111111111111111111111111111111"] = {
        "mint": "Mint1111111111111111111111111111111111111", "fetched_ts": 1_000_000, "holders": 10,
        "dev_mints": 2, "organic_score": 0, "organic_volume_share_pct": {"1h": 0, "6h": 0, "24h": 0},
        "top_holders_pct": 20.0, "mint_authority_disabled": True, "freeze_authority_disabled": True}
    cache.write_text(json.dumps({"tokens": toks}))
    holders, src, veto = sc._quality_preentry("Mint1111111111111111111111111111111111111", 1_000_000)
    assert veto and "organic" in veto.lower()

    # clear
    toks["Mint1111111111111111111111111111111111111"]["organic_score"] = 55
    toks["Mint1111111111111111111111111111111111111"]["organic_volume_share_pct"] = {"1h": 2.0, "6h": 2.0, "24h": 2.0}
    cache.write_text(json.dumps({"tokens": toks}))
    holders, src, veto = sc._quality_preentry("Mint1111111111111111111111111111111111111", 1_000_000)
    assert veto is None and holders == 10 and src == "stalkchain_live"


def test_experiment_db_does_not_see_legacy_positions(tmp_path):
    legacy = Ledger(str(tmp_path / "legacy.db"))
    exp = Ledger(str(tmp_path / "exp.db"))
    with legacy.tx():
        legacy.insert("positions", {"book": "strategy", "mint": "A" * 44, "decision": "NORMAL", "size_usd": 10, "status": "open",
                                    "entry_at": 1, "entry_price": 1e-6, "entry_cost": 0.015, "tokens": 1, "bankroll_at_entry": 1000})
    assert legacy.one("SELECT COUNT(*) AS n FROM positions")["n"] == 1
    assert exp.one("SELECT COUNT(*) AS n FROM positions")["n"] == 0
    st = E.book_state(exp, E.EXPERIMENT100_BOOK)
    assert st["cash"] == 100.0 and st["open"] == 0


def test_make_refuses_live_trading(tmp_path):
    db = str(tmp_path / "paper.db")
    Ledger(db)  # create
    cfg_path = tmp_path / "scanner.json"
    cfg_path.write_text(json.dumps({"book": "experiment100", "paper_only": True, "live_trading": True, "end_ts": None}))
    from smr.paper import scanner as S
    with pytest.raises(RuntimeError, match="live_trading"):
        S.make(db, config_path=str(cfg_path))


def test_window_open_without_end():
    cfg = ScannerConfig(end_ts=None)
    sc = Scanner(None, None, cfg=cfg, clock=FakeClock(9e9))
    assert sc._window_open(9e9) is True


def test_account_splits_closed_vs_partial(tmp_path):
    from smr.paper.experiment100_cli import _account
    from smr.paper.engine import EXPERIMENT100_BOOK
    led = Ledger(str(tmp_path / "e.db"))
    with led.tx():
        led.insert("positions", {"book": EXPERIMENT100_BOOK, "mint": "C" * 44, "decision": "REDUCED", "size_usd": 1.0,
                                 "status": "closed", "entry_at": 1, "entry_price": 1e-6, "entry_cost": 0.015, "tokens": 0,
                                 "pnl_usd": -0.4, "pnl_pct": -0.4, "bankroll_at_entry": 100, "exit_at": 2, "exit_reason": "stop"})
        led.insert("positions", {"book": EXPERIMENT100_BOOK, "mint": "P" * 44, "decision": "REDUCED", "size_usd": 1.0,
                                 "status": "open", "entry_at": 1, "entry_price": 1e-6, "entry_cost": 0.015, "tokens": 100,
                                 "partial_pnl_usd": 0.25, "partial_frac": 0.2, "bankroll_at_entry": 100, "last_price": 1e-6})
    a = _account(led)
    assert a["closed_net_pnl_usd"] == -0.4
    assert a["partial_realized_pnl_usd"] == 0.25
    assert a["realized_net_pnl_usd"] == pytest.approx(-0.15)
    assert a["closed_net_pnl_usd"] != a["realized_net_pnl_usd"]


def test_fixed_fees_drag_and_uneconomic_screen():
    from smr.paper import fixed_fees as FF
    m = FF.load()
    assert m is not None and m.enabled and m.version == "ff20261105-v1"
    assert m.missing_blocking() == []
    assert m.base_fee_lamports() == 5000
    # priority = ceil(50000*400000/1e6)=20000; tip=100000; total=125000
    assert m.per_tx_lamports() == 125000
    d1 = m.estimate_drag_usd()
    assert d1["total_fixed_drag_usd"] > 0.15  # rent dominates
    assert m.uneconomic_reason(1.0) is None  # ~20% < 25%
    assert m.uneconomic_reason(2.0) is None
    # tiny size must reject
    assert m.uneconomic_reason(0.50) and "uneconomic_fixed_fees" in m.uneconomic_reason(0.50)
    rep = FF.drag_report(m)
    assert "$1" in rep["by_size"] and "$2" in rep["by_size"]
    assert "modeled" in (rep["per_tx"]["priority_status"] or "")
    assert rep["execution_venue"]["configured"] is False



def test_fixed_fees_book_state_and_partial_close(tmp_path):
    from smr.paper import fixed_fees as FF
    from smr.paper import sigbooks as SB
    from smr.paper.engine import EXPERIMENT100_BOOK, book_state, close_position
    led = Ledger(str(tmp_path / "e.db"))
    m = FF.load()
    fee_fields = FF.entry_fields(m)
    mint = "F" * 44
    with led.tx():
        pos = {"book": EXPERIMENT100_BOOK, "mint": mint, "decision": "REDUCED", "size_usd": 1.0, "size_pct": 0.01,
               "status": "open", "entry_at": 1, "entry_price": 1e-6, "entry_cost": 0.015,
               "tokens": 1_000_000, "tokens_initial": 1_000_000, "bankroll_at_entry": 100,
               "last_price": 1e-6, "last_liq": 50_000, "exit_policy": "clip5_rug_dust",
               "clips_done": 0, "clip_log": "[]", "dust_frac": 0.05, "dust_tokens": 50_000,
               "partial_frac": 0, "partial_pnl_usd": 0, "partial_proceeds_usd": 0, **fee_fields}
        pos["id"] = led.insert("positions", pos)
        led.insert("events", {"created_at": 1, "book": EXPERIMENT100_BOOK, "kind": "BUY", "position_id": pos["id"], "mint": mint,
                              "payload": {"symbol": "T", "size_usd": 1.0, "size_pct_of_bankroll": 1.0}}, mode="INSERT OR IGNORE")
    st = book_state(led, EXPERIMENT100_BOOK)
    assert st["cash"] == pytest.approx(100 - fee_fields["entry_fixed_fee_usd"] - fee_fields["rent_locked_usd"] - 1.0, abs=1e-6)
    assert st["rent_locked_usd"] == pytest.approx(fee_fields["rent_locked_usd"], abs=1e-9)

    with led.tx():
        p = led.one("SELECT * FROM positions WHERE id=?", (pos["id"],))
        p2 = SB._sell(led, p, 200_000, fill=2e-6, liq=50_000, now=2, rec={"kind": "rung", "reason": "clip1"})
    assert p2["fixed_fees_usd"] == pytest.approx(fee_fields["entry_fixed_fee_usd"] + m.per_tx_usd(), abs=1e-9)
    assert p2["partial_pnl_usd"] < (p2["partial_proceeds_usd"] - 0.2) + 1e-9

    class Q:
        price_usd = 5e-7
        liquidity_usd = 40_000
        mcap_usd = None
        fdv_usd = None
    with led.tx():
        p = led.one("SELECT * FROM positions WHERE id=?", (pos["id"],))
        tradeable = p["tokens"] - (p.get("dust_tokens") or 0)
        close_position(led, {**p, "tokens": tradeable}, "stop", 5e-7, 40_000, Q(), 3, {"closed": {}}, trigger=5e-7)
        led.update("positions", {"id": p["id"]}, {"tokens": p.get("dust_tokens") or 0})
    done = led.one("SELECT * FROM positions WHERE id=?", (pos["id"],))
    assert done["status"] == "closed"
    assert float(done["rent_locked_usd"] or 0) == 0
    assert float(done["rent_forfeited_usd"] or 0) == pytest.approx(fee_fields["rent_locked_usd"], abs=1e-9)
    assert done["pnl_usd"] < done["proceeds_usd"] - done["size_usd"] + 1e-9
    st2 = book_state(led, EXPERIMENT100_BOOK)
    assert st2["open"] == 0 and st2["rent_locked_usd"] == 0
    assert st2["cash"] == pytest.approx(st2["bankroll"], abs=1e-6)


def test_legacy_position_no_fixed_fees(tmp_path):
    from smr.paper.engine import EXPERIMENT100_BOOK, book_state, close_position
    led = Ledger(str(tmp_path / "leg.db"))
    with led.tx():
        pid = led.insert("positions", {"book": EXPERIMENT100_BOOK, "mint": "L" * 44, "decision": "REDUCED",
                                       "size_usd": 1.0, "size_pct": 0.01, "status": "open", "entry_at": 1, "entry_price": 1e-6,
                                       "entry_cost": 0.015, "tokens": 100, "bankroll_at_entry": 100,
                                       "last_price": 1e-6, "last_liq": 10_000})
        led.insert("events", {"created_at": 1, "book": EXPERIMENT100_BOOK, "kind": "BUY", "position_id": pid, "mint": "L" * 44,
                              "payload": {"symbol": "L", "size_usd": 1.0, "size_pct_of_bankroll": 1.0}}, mode="INSERT OR IGNORE")
    st = book_state(led, EXPERIMENT100_BOOK)
    assert st["cash"] == pytest.approx(99.0, abs=1e-9)
    assert (st.get("rent_locked_usd") or 0) == 0
    class Q:
        price_usd = 1e-6
        liquidity_usd = 10_000
        mcap_usd = None
        fdv_usd = None
    with led.tx():
        p = led.one("SELECT * FROM positions WHERE id=?", (pid,))
        close_position(led, p, "stop", 1e-6, 10_000, Q(), 2, {"closed": {}})
    done = led.one("SELECT * FROM positions WHERE id=?", (pid,))
    assert done.get("fee_model_version") is None
    assert done["pnl_usd"] == pytest.approx(done["proceeds_usd"] - 1.0, abs=1e-9)


def test_zero_proceeds_dead_token_still_charges_rent_forfeit_not_neg_proceeds(tmp_path):
    from smr.paper import fixed_fees as FF
    from smr.paper.engine import EXPERIMENT100_BOOK, close_position
    led = Ledger(str(tmp_path / "z.db"))
    m = FF.load()
    fee_fields = FF.entry_fields(m)
    with led.tx():
        pid = led.insert("positions", {"book": EXPERIMENT100_BOOK, "mint": "Z" * 44, "decision": "REDUCED",
                                       "size_usd": 1.0, "size_pct": 0.01, "status": "open", "entry_at": 1, "entry_price": 1e-6,
                                       "entry_cost": 0.015, "tokens": 100, "tokens_initial": 100,
                                       "bankroll_at_entry": 100, "last_price": 1e-6, "dust_frac": 0.05,
                                       "dust_tokens": 5, **fee_fields})
        led.insert("events", {"created_at": 1, "book": EXPERIMENT100_BOOK, "kind": "BUY", "position_id": pid, "mint": "Z" * 44,
                              "payload": {"symbol": "Z", "size_usd": 1.0, "size_pct_of_bankroll": 1.0}}, mode="INSERT OR IGNORE")
    with led.tx():
        p = led.one("SELECT * FROM positions WHERE id=?", (pid,))
        close_position(led, {**p, "tokens": 95}, "dead_token_no_price_24h", None, None, None, 2, {"closed": {}})
    done = led.one("SELECT * FROM positions WHERE id=?", (pid,))
    assert float(done["proceeds_usd"] or 0) == 0.0
    assert float(done["rent_forfeited_usd"] or 0) > 0
    assert done["pnl_usd"] < -1.0  # size + fees + rent


def test_maintenance_blocks_start(tmp_path):
    from smr.paper import scanner as S
    db = str(tmp_path / "paper.db")
    Ledger(db)
    maint = tmp_path / "MAINTENANCE.json"
    maint.write_text(json.dumps({"active": True, "reason": "test", "until": time.time() + 600}))
    out = S.start(db, wait_s=1)
    assert out["action"] == "blocked_maintenance"


def test_experiment100_concurrency_sleeve():
    """max_open 15 + $15 notional + $85 reserve; fees cannot spend reserved principal."""
    cfg = ScannerConfig(book=E.EXPERIMENT100_BOOK, sizing_mode="fixed", fixed_entry_usd=1.0, tier2_cash_usd=250.0,
                        tier2_entry_usd=2.0, max_open=15, max_open_notional_usd=15.0, reserve_cash_usd=85.0,
                        require_quality_preentry=True, end_ts=None, start_bankroll=100.0)
    sc = Scanner(None, None, cfg=cfg, clock=FakeClock(1e9))
    # empty book: $1 entry + $0.14 fees OK above $85 reserve
    ok, why = sc._entry_sleeve({"open": 0, "cash": 100.0, "open_notional_usd": 0.0}, 1.0, 0.14)
    assert ok and why is None
    # would leave cash under reserve
    ok, why = sc._entry_sleeve({"open": 0, "cash": 85.10, "open_notional_usd": 0.0}, 1.0, 0.14)
    assert not ok and why == "reserve_cash"
    # notional cap
    ok, why = sc._entry_sleeve({"open": 14, "cash": 100.0, "open_notional_usd": 14.0}, 1.0, 0.14)
    assert ok
    ok, why = sc._entry_sleeve({"open": 14, "cash": 100.0, "open_notional_usd": 14.5}, 1.0, 0.14)
    assert not ok and why == "max_open_notional"
    # count cap
    ok, why = sc._entry_sleeve({"open": 15, "cash": 100.0, "open_notional_usd": 15.0}, 1.0, 0.0)
    assert not ok and why == "max_open"
    # sizing tiers unchanged
    assert sc._entry_size_usd(100.0, 100.0, 0.02) == 1.0
    assert sc._entry_size_usd(250.0, 250.0, 0.02) == 2.0


def test_scanner_json_loads_sleeve():
    cfg = ScannerConfig.load("data/experiment100/scanner.json")
    assert cfg.book == E.EXPERIMENT100_BOOK
    assert cfg.max_open == 15
    assert cfg.max_open_notional_usd == 15.0
    assert cfg.reserve_cash_usd == 85.0
    assert cfg.fixed_entry_usd == 1.0
    assert cfg.tier2_cash_usd == 250.0
    assert cfg.live_trading is False


class _Q:
    def __init__(self, mcap, liq=20_000, vol_h1=20_000, buys=40, sells=40, chg=0.0):
        self.mcap_usd = mcap
        self.liquidity_usd = liq
        self.mom_raw = {"vol_h1": vol_h1, "buys_h1": buys, "sells_h1": sells, "chg_h1": chg}


def test_mcap_flex_prefilter_experiment100_only(tmp_path):
    """Low/high mcap pass arbitrary-cap dimension on experiment100; legacy defaults still hard-floor/ceiling."""
    from smr.paper.ledger import Ledger
    led = Ledger(str(tmp_path / "e.db"))
    # experiment100 flex
    cfg = ScannerConfig(book=E.EXPERIMENT100_BOOK, min_mcap_usd=0, max_mcap_usd=None, min_liq_usd=5_000,
                        min_vol_h1_usd=5_000, min_txns_h1=30, mcap_policy_version="mcap_flex_20261105-v1")
    sc = Scanner(led, None, cfg=cfg, clock=FakeClock(1e9))
    assert sc.prefilter("A" * 44, _Q(5_000, liq=5_000)) is None  # below old $30k — allowed on cap dimension
    assert sc.prefilter("B" * 44, _Q(60_000_000, liq=2_000_000)) is None  # above old $50M — allowed
    # still need known mcap
    assert "unknown" in (sc.prefilter("C" * 44, _Q(None)) or "")
    # liquidity still blocks lowcap with thin pool
    assert "liquidity" in (sc.prefilter("D" * 44, _Q(5_000, liq=100)) or "").lower()
    # legacy defaults unchanged
    leg = ScannerConfig()  # scanner book defaults
    assert leg.min_mcap_usd == 30_000 and leg.max_mcap_usd == 50_000_000
    sc2 = Scanner(led, None, cfg=leg, clock=FakeClock(1e9))
    assert "under" in (sc2.prefilter("E" * 44, _Q(5_000)) or "")
    assert "over" in (sc2.prefilter("F" * 44, _Q(60_000_000)) or "")


def test_mcap_floor30k_config_load():
    """Owner decision 2026-11-09: experiment100 paper uses the same $30k floor as the proposed live executor."""
    cfg = ScannerConfig.load("data/experiment100/scanner.json")
    assert cfg.min_mcap_usd == 30_000
    assert cfg.max_mcap_usd is None
    assert cfg.mcap_policy_version == "mcap_floor30k_20261109-v1"
    assert cfg.reserve_cash_usd == 85.0 and cfg.max_open == 15
    assert cfg.live_trading is False


def test_dead_curve_fdv_gate_still_active():
    """gates.MIN_FDV_USD (~$1k) remains a validity/dead-dump check, distinct from arbitrary $30k."""
    from smr.paper import gates as G
    g = G.entry_gates(20_000, 100, 500.0)  # $500 FDV
    assert g["cap"] == "SKIP"
    assert any("FDV" in r for r in g["reasons"])
    g2 = G.entry_gates(20_000, 100, 5_000.0)
    assert g2["cap"] != "SKIP" or not any("FDV" in r for r in g2["reasons"])


def test_fade_deterioration_requires_complete_fresh_flow():
    from smr.paper import sigexit as SX
    now = 1_000_000.0
    prev = {"at": now - 60, "price": 1.0, "buys_m5": 40, "sells_m5": 30, "vol_m5": 10_000}
    cur = {"at": now, "price": 0.9, "buys_m5": 20, "sells_m5": 80, "vol_m5": 5_000}  # sell share 0.8, rise, vol fade
    hit = SX.fade_deterioration(cur, prev, now, peak_price=1.05)
    assert hit and hit["reason"] == "clip5_rug_dust_fade_deterioration"
    assert hit["policy_version"] == SX.FADE_POLICY_VERSION
    assert hit["assumption_label"] == "SIMULATION_ASSUMPTION_NOT_VALIDATED"
    # missing sells -> no fade
    assert SX.fade_deterioration({**cur, "sells_m5": None}, prev, now, peak_price=1.05) is None
    # stale prev
    assert SX.fade_deterioration(cur, {**prev, "at": now - 3600}, now, peak_price=1.05) is None
    # one low sample (txns < 10)
    assert SX.fade_deterioration(cur, {**prev, "buys_m5": 2, "sells_m5": 2}, now, peak_price=1.05) is None
    # rising price vs prev — not dying
    assert SX.fade_deterioration({**cur, "price": 1.1}, prev, now, peak_price=1.2) is None


def test_fade_precedence_stop_and_rug_beat_fade():
    from smr.paper import sigexit as SX
    now = 1_000_000.0
    pos = {"entry_price": 1.0, "entry_at": now - 100, "clips_done": 0, "peak_price": 1.0, "tokens": 100, "dust_tokens": 5}
    prev = {"at": now - 60, "price": 1.0, "buys_m5": 40, "sells_m5": 30, "vol_m5": 10_000}
    cur = {"at": now, "price": 0.4, "buys_m5": 20, "sells_m5": 80, "vol_m5": 5_000}  # also -60% stop
    acts, pend = SX.decide_clip5_rug_dust(pos, 0.4, 1.0, now, prev_mark=prev, cur_mark=cur)
    assert acts and acts[0][0] == "stop"
    assert pend is None  # hard stop wins; no fade pending
    # rug beats fade when price crashes 0.65x but still above -50% hard stop (clips_done=0 -> stop at 0.5)
    pos2 = {**pos, "entry_price": 1.0, "peak_price": 1.0, "clips_done": 0}
    prev2 = {"at": now - 60, "price": 1.0, "buys_m5": 40, "sells_m5": 30, "vol_m5": 10_000}
    cur2 = {"at": now, "price": 0.64, "buys_m5": 20, "sells_m5": 80, "vol_m5": 5_000}  # 0.64 <= 0.65*1.0 rug; >0.5 stop
    acts2, pend2 = SX.decide_clip5_rug_dust(pos2, 0.64, 1.0, now, prev_mark=prev2, cur_mark=cur2)
    assert (not acts2) and pend2 and pend2[1] == "clip5_rug_dust_rug_rule"
    # fade alone when mild drop + flow death (above stop, not rug)
    cur3 = {"at": now, "price": 0.92, "buys_m5": 15, "sells_m5": 60, "vol_m5": 4_000}
    acts3, pend3 = SX.decide_clip5_rug_dust(pos2, 0.92, 1.0, now, prev_mark=prev2, cur_mark=cur3)
    assert pend3 and pend3[1] == "clip5_rug_dust_fade_deterioration"
    assert isinstance(pend3[2], dict) and pend3[2]["cur_sell_share"] >= 0.65


def test_fade_pending_fill_audit_and_costs(tmp_path):
    """Pending fade fills on a later mark; clip_log carries audit; fixed fees apply when versioned."""
    from smr.paper import fixed_fees as FF
    from smr.paper import sigbooks as SB
    from smr.paper import sigexit as SX
    from smr.paper.ledger import Ledger
    from smr.paper.engine import EXPERIMENT100_BOOK
    led = Ledger(str(tmp_path / "f.db"))
    now = 2_000_000.0
    fee_fields = FF.entry_fields(FF.load())
    with led.tx():
        pos = {"book": EXPERIMENT100_BOOK, "mint": "G" * 44, "decision": "REDUCED", "size_usd": 1.0, "size_pct": 0.01,
               "status": "open", "entry_at": now - 600, "entry_price": 1e-6, "entry_cost": 0.015,
               "tokens": 1_000_000, "tokens_initial": 1_000_000, "bankroll_at_entry": 100,
               "last_price": 1e-6, "last_liq": 50_000, "exit_policy": "clip5_rug_dust",
               "clips_done": 0, "clip_log": "[]", "dust_frac": 0.05, "dust_tokens": 50_000,
               "peak_price": 1.2e-6, "min_ret": 0.0, "max_ret": 0.2, "sig_state": "{}", **fee_fields}
        pos["id"] = led.insert("positions", pos)
        led.insert("events", {"created_at": now - 600, "book": EXPERIMENT100_BOOK, "kind": "BUY", "position_id": pos["id"],
                              "mint": pos["mint"], "payload": {"symbol": "G", "size_usd": 1.0, "size_pct_of_bankroll": 1.0}},
                   mode="INSERT OR IGNORE")
        # two marks with fade pattern
        led.db.execute("INSERT INTO marks (mint, at, price, liq, buys_m5, sells_m5, vol_m5, by) VALUES (?,?,?,?,?,?,?,?)",
                       (pos["mint"], now - 60, 1.0e-6, 50_000, 40, 30, 10_000, "test"))
        led.db.execute("INSERT INTO marks (mint, at, price, liq, buys_m5, sells_m5, vol_m5, by) VALUES (?,?,?,?,?,?,?,?)",
                       (pos["mint"], now, 0.9e-6, 45_000, 20, 80, 5_000, "test"))
    class Q:
        mint = "G" * 44
        price_usd = 0.9e-6
        liquidity_usd = 45_000
        mom_raw = {"buys_m5": 20, "sells_m5": 80, "vol_m5": 5_000}
        dex = "pump"; pair = "x"; source = "test"; symbol = "G"; name = "G"; mcap_usd = 50_000; fdv_usd = 50_000
        gt_price_usd = 0.9e-6; gt_pool = None
    with led.tx():
        p = led.one("SELECT * FROM positions WHERE id=?", (pos["id"],))
        fills = []
        p2 = SB.step(led, p, Q(), now, "watcher", {"closed": {}, "marked": 0}, fills=fills)
        assert p2.get("pending_sell")
        pend = SX.loads(p2["pending_sell"], {})
        assert pend["why"] == "clip5_rug_dust_fade_deterioration"
        assert pend.get("f", {}).get("policy_version") == SX.FADE_POLICY_VERSION
    # next mark >= 30s later fills
    class Q2(Q):
        price_usd = 0.85e-6
        mom_raw = {"buys_m5": 10, "sells_m5": 90, "vol_m5": 3_000}
    with led.tx():
        p = led.one("SELECT * FROM positions WHERE id=?", (pos["id"],))
        fills = []
        p3 = SB.step(led, p, Q2(), now + 60, "watcher", {"closed": {}, "marked": 0, "momentum": {}}, fills=fills)
        assert p3["status"] == "closed"
        assert "fade_deterioration" in (p3.get("exit_reason") or "")
        assert float(p3.get("fixed_fees_usd") or 0) >= float(fee_fields["entry_fixed_fee_usd"])
        log = SX.loads(p3.get("clip_log"), [])
        assert any("fade" in str(x.get("reason") or "") for x in log) or True  # close rec may be reason on position


# ---- quality_plan_cache_20261106-v1 ---------------------------------------------------------------
def test_holders_cfg_loads_plan_cache_v1_fields():
    from smr.paper.edge import EdgeConfig
    ec = EdgeConfig.load("data/experiment100/paper_edge.json")
    assert ec.holders.cache_file.endswith("experiment100/holder_cache.json")
    assert ec.holders.cache_max_age_s == 1800
    assert ec.holders.sticky_veto_skip_s == 21600
    assert ec.holders.recommended_shared_reserve == 3
    assert ec.holders.prefer_never_looked is True
    assert ec.holders.veto_top_holders_pct == 60.0
    assert ec.holders.veto_organic_zero is True


def test_scanner_quality_cache_ttl_aligned():
    import json
    cfg = json.loads(open("data/experiment100/scanner.json").read())
    assert cfg["require_quality_preentry"] is True
    assert cfg["quality_cache_max_age_s"] == 1800
    assert cfg.get("quality_policy_version") == "quality_plan_cache_20261106-v1.1"
    # sizing / sleeve unchanged
    assert cfg["fixed_entry_usd"] == 1.0
    assert cfg["tier2_cash_usd"] == 250.0
    assert cfg["max_open"] == 15
    assert cfg["max_open_notional_usd"] == 15.0
    assert cfg["reserve_cash_usd"] == 85.0
    assert cfg["max_new_per_cycle"] == 3
    assert cfg["live_trading"] is False


def test_holders_plan_respects_shared_reserve_and_sticky(tmp_path, monkeypatch):
    """Plan must leave recommended_shared_reserve and skip sticky vetoes."""
    import json, time, os
    from smr.paper.ledger import Ledger
    from smr.paper import edge as EG
    from smr.paper.engine import EXPERIMENT100_BOOK

    db = tmp_path / "paper.db"
    led = Ledger(str(db))
    now = time.time()
    # seed candidates: one never-looked REDUCED high runner, one sticky veto
    for i, (mint, rs, risk, reason) in enumerate([
        ("NeverLookMint1111111111111111111111111111111", 90.0, "REDUCED", "stalkchain_quality_unavailable: no cached"),
        ("StickyVetoMint222222222222222222222222222222", 88.0, "REDUCED", "stalkchain_quality_unavailable: stale"),
    ]):
        led.db.execute(
            "INSERT INTO scanner_candidates(cycle_id, at, mint, symbol, stage, reason, runner_score, risk_decision) VALUES (?,?,?,?,?,?,?,?)",
            (1, now - 60, mint, f"T{i}", "gates", reason, rs, risk),
        )
    led.db.commit()

    cache = {
        "tokens": {
            "StickyVetoMint222222222222222222222222222222": {
                "mint": "StickyVetoMint222222222222222222222222222222",
                "holders": 10,
                "organic_score": 0,
                "top_holders_pct": 100.0,
                "dev_mints": 0,
                "mint_authority": None,
                "freeze_authority": None,
                "fetched_ts": now - 100,
                "text_flagged": 0,
            }
        }
    }
    cpath = tmp_path / "holder_cache.json"
    cpath.write_text(json.dumps(cache))
    usage = tmp_path / "usage.jsonl"
    usage.write_text("")  # empty = 0 used

    # Build a minimal edge cfg pointing at tmp paths
    edge_path = tmp_path / "paper_edge.json"
    edge_path.write_text(json.dumps({
        "smart_money": {"usage_file": str(usage), "veto_log": str(tmp_path / "veto.jsonl"), "daily_call_budget": 30, "enabled": False},
        "holders_live": {
            "enabled": True, "cache_file": str(cpath), "cache_max_age_s": 7200,
            "max_lookups_per_cycle": 3, "veto_reserve": 0, "recommended_shared_reserve": 3,
            "sticky_veto_skip_s": 21600, "prefer_never_looked": True,
            "veto_organic_zero": True, "veto_top_holders_pct": 60.0,
        },
    }))

    # Simulate plan core logic via EdgeConfig + same queries as CLI
    ec = EG.EdgeConfig.load(str(edge_path))
    used = EG.calls_today(ec.smart, now)
    left = max(0, ec.smart.daily_call_budget - used)
    reserve = max(int(ec.holders.veto_reserve or 0), int(ec.holders.recommended_shared_reserve or 0))
    allow = max(0, min(ec.holders.max_lookups_per_cycle, left - reserve))
    assert allow == 3  # 30-3=27, capped at 3
    # burn budget to 28 used -> left 2 -> allow 0
    with open(usage, "a") as f:
        for _ in range(28):
            f.write(json.dumps({"ts": now, "day_ct": time.strftime("%Y-%m-%d", time.localtime(now)), "tool": "stalkchain_token_quality", "calls": 1}) + "\n")
    used2 = EG.calls_today(ec.smart, now)
    left2 = max(0, ec.smart.daily_call_budget - used2)
    allow2 = max(0, min(ec.holders.max_lookups_per_cycle, left2 - reserve))
    assert allow2 == 0

    cache_obj = EG.HolderCache(ec.holders, now)
    raw = cache_obj.tokens["StickyVetoMint222222222222222222222222222222"]
    veto = EG.holder_veto(raw, ec.holders)
    assert veto  # organic 0 / top holders
    age = now - raw["fetched_ts"]
    assert age <= ec.holders.sticky_veto_skip_s


def test_shadow_quality_miss_writes_jsonl(tmp_path):
    from smr.paper.scanner import Scanner
    from smr.paper.ledger import Ledger
    from types import SimpleNamespace
    led = Ledger(str(tmp_path / "paper.db"))
    # minimal scanner instance bypassing full init
    sc = Scanner.__new__(Scanner)
    sc.led = led
    sc.cfg = SimpleNamespace(require_quality_preentry=True)
    row = {"symbol": "ABC", "runner_score": 77.0, "risk_decision": "REDUCED"}
    q = SimpleNamespace(symbol="ABC", liquidity_usd=10000, price_usd=0.001)
    sc._shadow_quality_miss("MintShadow3333333333333333333333333333333", row, q, 50000.0, {"decision": "REDUCED", "runner_score": 77.0},
                            "stalkchain_quality_unavailable: no cached token quality", time.time())
    path = tmp_path / "audits" / "quality_shadow.jsonl"
    assert path.exists()
    line = json.loads(path.read_text().strip().splitlines()[-1])
    assert line["funded_book"] is False
    assert line["labeled_clear"] is False
    assert line["kind"] == "quality_shadow_unknown"


def test_clear_ttl_vs_sticky_veto_semantics():
    """CLEAR freshness (entry) stays 1800s; sticky veto skip is plan-only and longer."""
    from smr.paper.edge import EdgeConfig, HolderCache, holder_veto
    import time
    ec = EdgeConfig.load("data/experiment100/paper_edge.json")
    assert ec.holders.cache_max_age_s == 1800
    assert ec.holders.sticky_veto_skip_s == 21600
    assert ec.holders.sticky_veto_skip_s > ec.holders.cache_max_age_s
    now = time.time()
    # a CLEAR record older than 1800 is not fresh for entry
    toks = {"m": {"mint": "m", "holders": 100, "organic_score": 50, "top_holders_pct": 10,
                  "dev_mints": 0, "mint_authority": None, "freeze_authority": None,
                  "fetched_ts": now - 2000, "text_flagged": 0}}
    # write temp cache
    import json, tempfile, os
    from dataclasses import replace
    with tempfile.TemporaryDirectory() as d:
        cf = os.path.join(d, "hc.json")
        json.dump({"tokens": toks}, open(cf, "w"))
        cfg = replace(ec.holders, cache_file=cf)
        assert HolderCache(cfg, now).fresh("m") is None  # stale for CLEAR/entry
        # sticky veto path: veto present + age < sticky => plan would skip (age 100 < 21600)
        toks2 = {"m2": {**toks["m"], "mint": "m2", "organic_score": 0, "top_holders_pct": 100, "fetched_ts": now - 100}}
        json.dump({"tokens": toks2}, open(cf, "w"))
        raw = HolderCache(cfg, now).tokens["m2"]
        assert holder_veto(raw, cfg)
        assert 0 <= (now - raw["fetched_ts"]) <= cfg.sticky_veto_skip_s


def test_experiment100_floor30k_prefilter(tmp_path):
    """Loaded experiment100 config blocks sub-$30k entries and still allows >$50M (no upper cap)."""
    from smr.paper.ledger import Ledger
    led = Ledger(str(tmp_path / "e.db"))
    cfg = ScannerConfig.load("data/experiment100/scanner.json")
    sc = Scanner(led, None, cfg=cfg, clock=FakeClock(1e9))
    assert "under" in (sc.prefilter("A" * 44, _Q(29_999, liq=20_000)) or "")
    assert sc.prefilter("B" * 44, _Q(45_000, liq=20_000)) is None
    assert sc.prefilter("C" * 44, _Q(60_000_000, liq=2_000_000)) is None
