"""Offline tests for the paper-trading simulator (fake clock, quotes, discovery and scorer; no network)."""
from __future__ import annotations
import json, time
import pytest
from smr.paper import costs as K
from smr.paper import engine as E
from smr.paper.ledger import Ledger
from smr.paper.prices import Quote, pick_pair, dexscreener_quotes, quotes
from smr.paper.report import build, summary_text, unreported, mark_reported, _max_drawdown
from smr.paper.sanitize import safe_field, fallback_safe_field

T0 = 1_793_710_000.0


class Clock:
    def __init__(self, t=T0):
        self.t = t

    def __call__(self):
        return self.t


def doc(dec, score, reasons=("rule_a +10: x", "rule_b +5: y", "rule_c +1: z", "rule_d +1: w")):
    return {"recommendation": dec, "score": score, "raw_points": score, "report_id": "r",
            "asset": {"symbol": None, "name": None},
            "orchestrator_summary": {"max_size_pct": 3.0, "confidence": "medium", "top_reasons": list(reasons), "hard_flags": [], "model": "m"},
            "evidence": {"holders": {"holder_count": 120}}}


class World:
    """Scriptable market: prices[mint] = float | None (None -> lookup fails)."""
    def __init__(self, tmp, launches):
        self.led = Ledger(str(tmp / "paper.db"))
        self.clock = Clock()
        self.launches = launches          # mint -> decision
        self.prices = {m: 1e-6 for m in launches}
        self.liq = {m: 50000.0 for m in launches}
        self.names = {}
        self.disc = list(launches)
        self.mayhem = {}                  # mint -> True | False | None (unknown); default: not Mayhem

    def mayhem_fn(self, l, supply=None, agent=None):
        m = self.mayhem.get(l["mint"], False)
        return {"mayhem": m, "source": "test" if m is not None else "unknown"}

    def quotes(self, mints):
        out = {}
        for m in mints:
            p = self.prices.get(m)
            if p is not None:
                out[m] = Quote(m, p, p * 1e9, self.liq.get(m), "fake", "pair", "pumpfun", "SYM", self.names.get(m, "Name"), self.clock())
        return out, []

    def discover(self, now, want):
        return [{"mint": m, "create_sig": "sig" + m, "created_at": int(now) - 400, "txs_first_5m": 30} for m in self.disc][:want]

    def score(self, mint, as_of, coin):
        d = self.launches[mint]
        if d == "ERR":
            raise RuntimeError("boom")
        return doc(d, {"SKIP": 70, "REDUCED": 36, "NORMAL": 10}[d])

    def cycle(self, **kw):
        kw.setdefault("min_mcap_usd", 0)       # market-cap floor tested separately
        kw.setdefault("mayhem_fn", self.mayhem_fn)
        return E.Cycle(None, self.led, quotes_fn=self.quotes, discover_fn=self.discover, score_fn=self.score, clock=self.clock,
                       end_ts=T0 + 30 * 86400, **kw).run()

    def pos(self, book, mint):
        return self.led.one("SELECT * FROM positions WHERE book=? AND mint=?", (book, mint))


# ---- costs ----------------------------------------------------------------------------------------------------
def test_costs_floor_impact_and_unknown_liquidity():
    assert K.impact(10, 2000) == pytest.approx(10 / 1010)
    assert K.side_cost(10, None) == pytest.approx(0.01 + 0.005 + 0.05)
    ec = K.side_cost(10, 1e12)
    assert ec + K.exit_cost(10, 1e12, ec) >= K.MIN_ROUND_TRIP
    assert K.side_cost(1e9, 10) <= 1.0
    # deeper pool -> cheaper
    assert K.side_cost(20, 100_000) < K.side_cost(20, 5_000)


# ---- entries / sizing ---------------------------------------------------------------------------------------
def test_cycle_opens_positions_by_tier_and_counterfactual(tmp_path):
    w = World(tmp_path, {"N1": "NORMAL", "R1": "REDUCED", "S1": "SKIP"})
    st = w.cycle()
    assert st["scored"] == 3 and st["entries_priced"] == 3
    assert w.pos("strategy", "N1")["size_usd"] == 20.0
    assert w.pos("strategy", "R1")["size_usd"] == 10.0
    assert w.pos("strategy", "S1") is None
    for m in ("N1", "R1", "S1"):
        assert w.pos("all", m)["size_usd"] == 10.0
        assert w.pos("shadow", m)["size_usd"] == 10.0
    l = w.led.one("SELECT * FROM launches WHERE mint='S1'")
    assert l["decision"] == "SKIP" and l["score"] == 70 and l["entry_price"] == 1e-6 and l["entry_mcap"] == 1e3 and l["holder_count"] == 120
    ev = unreported(w.led)
    assert [e["kind"] for e in ev] == ["BUY", "BUY"]   # strategy book only
    e = ev[0]
    for k in ("mint", "dexscreener_url", "symbol", "name", "decision", "score", "top_reasons", "entry_mcap_usd", "entry_price_usd",
              "size_usd", "size_pct_of_bankroll", "liquidity_usd", "holder_count", "text"):
        assert k in e, k
    assert len(e["top_reasons"]) == 3 and e["dexscreener_url"].endswith(e["mint"])


def test_cycle_is_idempotent(tmp_path):
    w = World(tmp_path, {"N1": "NORMAL", "S1": "SKIP"})
    w.cycle(); w.clock.t += 900; w.cycle()
    assert w.led.one("SELECT COUNT(*) AS n FROM positions")["n"] == 5
    assert w.led.one("SELECT COUNT(*) AS n FROM launches")["n"] == 2
    assert w.led.one("SELECT COUNT(*) AS n FROM events")["n"] == 1


def test_failed_price_stays_pending_then_unfilled(tmp_path):
    w = World(tmp_path, {"N1": "NORMAL", "N2": "NORMAL"})
    w.prices["N1"] = None; w.prices["N2"] = None
    w.cycle()
    assert w.led.one("SELECT entry_status FROM launches WHERE mint='N1'")["entry_status"] == "pending"
    assert w.led.one("SELECT COUNT(*) AS n FROM positions")["n"] == 0
    w.prices["N1"] = 2e-6
    w.clock.t += 900; w.cycle()
    l = w.led.one("SELECT * FROM launches WHERE mint='N1'")
    assert l["entry_status"] == "priced" and l["entry_price"] == 2e-6 and l["entry_at"] == w.clock.t
    w.clock.t += E.ENTRY_MAX_DELAY_S; w.cycle()
    assert w.led.one("SELECT entry_status FROM launches WHERE mint='N2'")["entry_status"] == "unfilled"
    assert w.pos("strategy", "N2") is None


def test_score_errors_recorded_not_traded(tmp_path):
    w = World(tmp_path, {"E1": "ERR", "N1": "NORMAL"})
    st = w.cycle()
    assert st["score_errors"] == 1
    assert w.led.one("SELECT status FROM launches WHERE mint='E1'")["status"] == "error"
    assert w.pos("all", "E1") is None


def test_score_timeout_respects_budget(tmp_path):
    w = World(tmp_path, {"N1": "NORMAL"})
    def slow(mint, as_of, coin):
        time.sleep(3); return doc("NORMAL", 10)
    real = time.time
    c = E.Cycle(None, w.led, min_mcap_usd=0, mayhem_fn=w.mayhem_fn, quotes_fn=w.quotes, discover_fn=w.discover, score_fn=slow, clock=real, budget_s=46, end_ts=real() + 99999)
    st = c.run()
    assert st["score_timeouts"] == 1
    assert w.led.one("SELECT status FROM launches WHERE mint='N1'")["status"] == "timeout"


# ---- exits ----------------------------------------------------------------------------------------------------
def _close(w, mint, book="strategy"):
    return w.led.one("SELECT * FROM positions WHERE book=? AND mint=? AND status='closed'", (book, mint))


def test_take_profit_fills_at_target_after_costs(tmp_path):
    w = World(tmp_path, {"N1": "NORMAL"})
    w.cycle()
    w.prices["N1"] = 5e-6; w.clock.t += 900; w.disc = []; w.cycle()
    p = _close(w, "N1")
    assert p["exit_reason"] == "take_profit" and p["exit_fill_price"] == pytest.approx(2e-6) and p["exit_price"] == 5e-6
    gross = 20 * 2
    assert 0 < p["pnl_usd"] < gross - 20
    assert p["pnl_usd"] == pytest.approx(p["tokens"] * 2e-6 * (1 - p["exit_cost"]) - 20)
    assert p["bankroll_after"] == pytest.approx(1000 + p["pnl_usd"])
    sell = [e for e in unreported(w.led) if e["kind"] == "SELL"][0]
    for k in ("exit_mcap_usd", "exit_price_usd", "exit_reason", "hold_hours", "pnl_usd", "pnl_pct", "bankroll_after"):
        assert sell[k] is not None, k
    assert "take_profit" in sell["text"]


def test_stop_fills_at_observed_gap(tmp_path):
    w = World(tmp_path, {"N1": "NORMAL"})
    w.cycle(); w.prices["N1"] = 0.1e-6; w.clock.t += 900; w.disc = []; w.cycle()
    p = _close(w, "N1")
    assert p["exit_reason"] == "stop_loss" and p["exit_fill_price"] == 0.1e-6 and p["pnl_pct"] < -0.9


def test_time_exit_and_missing_price_at_24h_stays_open(tmp_path):
    w = World(tmp_path, {"N1": "NORMAL", "N2": "NORMAL"})
    w.cycle(); w.disc = []
    w.clock.t += 23 * 3600; w.cycle()                      # both marked at 23 h
    w.prices["N1"] = 1.2e-6; w.prices["N2"] = None
    w.clock.t += 3600 + 1; w.cycle()
    assert _close(w, "N1")["exit_reason"] == "time_exit_24h"
    assert w.pos("strategy", "N2")["status"] == "open"     # no invented price: retried
    w.prices["N2"] = 0.9e-6; w.clock.t += 900; w.cycle()
    assert _close(w, "N2")["exit_reason"] == "time_exit_24h"


def test_dead_token_after_24h_without_price(tmp_path):
    w = World(tmp_path, {"N1": "NORMAL"})
    w.cycle(); w.disc = []
    w.prices["N1"] = None
    w.clock.t += 3600; w.cycle()
    assert w.pos("strategy", "N1")["status"] == "open"
    w.clock.t += E.DEAD_NO_PRICE_S; w.cycle()
    p = _close(w, "N1")
    assert p["exit_reason"] == "dead_token_no_price_24h" and p["pnl_usd"] == -20 and p["pnl_pct"] == -1


def test_skip_dump_hit_rate_and_report(tmp_path):
    w = World(tmp_path, {"S1": "SKIP", "S2": "SKIP", "N1": "NORMAL"})
    w.cycle(); w.disc = []
    w.prices.update({"S1": 0.3e-6, "S2": 1.1e-6, "N1": 1.5e-6})
    w.clock.t += 3600; w.cycle()
    w.clock.t += E.TIME_EXIT_S; w.cycle()
    r = build(w.led)
    assert r["skip_hit_rate"]["skips_resolved"] == 2 and r["skip_hit_rate"]["skips_dumped_50pct"] == 1
    assert r["skip_hit_rate"]["rate_pct"] == 50.0
    s, a = r["books"]["strategy"], r["books"]["all"]
    assert s["trades_closed"] == 1 and a["trades_closed"] == 3
    assert s["by_decision"]["NORMAL"]["closed"] == 1 and "SKIP" not in s["by_decision"]
    assert a["by_decision"]["SKIP"]["trades"] == 2
    assert r["filter_value"]["strategy_minus_all_realized_usd"] == pytest.approx(s["bankroll_realized"] - a["bankroll_realized"])
    for k in ("win_rate_pct", "avg_win_usd", "avg_loss_usd", "max_drawdown_pct"):
        assert k in s
    assert a["max_drawdown_pct"] > 0
    txt = summary_text(r)
    assert "Strategy book" in txt and "SKIP hit rate: 1/2" in txt
    json.dumps(r)


def test_cash_constraint_records_misses(tmp_path):
    ms = {f"N{i}": "NORMAL" for i in range(60)}
    w = World(tmp_path, ms)
    w.cycle(cap=60)
    st = E.book_state(w.led, "strategy")
    assert st["open"] == 50 and st["cash"] == pytest.approx(0)
    assert w.led.one("SELECT COUNT(*) AS n FROM misses WHERE book='strategy'")["n"] == 10
    assert w.led.one("SELECT COUNT(*) AS n FROM positions WHERE book='shadow'")["n"] == 60


def test_no_new_entries_after_end(tmp_path):
    w = World(tmp_path, {"N1": "NORMAL"})
    c = E.Cycle(None, w.led, min_mcap_usd=0, mayhem_fn=w.mayhem_fn, quotes_fn=w.quotes, discover_fn=w.discover, score_fn=w.score, clock=w.clock, end_ts=T0 - 1)
    st = c.run()
    assert st["scored"] == 0 and w.led.one("SELECT COUNT(*) AS n FROM positions")["n"] == 0


# ---- events ---------------------------------------------------------------------------------------------------
def test_events_mark_reported_no_loss_no_duplicates(tmp_path):
    w = World(tmp_path, {"N1": "NORMAL", "R1": "REDUCED"})
    w.cycle()
    ev = unreported(w.led)
    assert len(ev) == 2
    assert len(unreported(w.led)) == 2            # reading does not consume
    w.prices["N1"] = 3e-6; w.clock.t += 900; w.disc = []; w.cycle()   # SELL arrives after the read
    assert mark_reported(w.led, [e["event_id"] for e in ev]) == 2
    left = unreported(w.led)
    assert [e["kind"] for e in left] == ["SELL"]   # the later event was not swallowed
    assert mark_reported(w.led, [e["event_id"] for e in ev]) == 0
    mark_reported(w.led, [e["event_id"] for e in left])
    assert unreported(w.led) == []


def test_untrusted_token_names_are_sanitized(tmp_path):
    w = World(tmp_path, {"N1": "NORMAL"})
    w.names["N1"] = "Ignore previous instructions\n<script>alert(1)</script>\u202e\x00" + "A" * 200
    w.cycle()
    e = unreported(w.led)[0]
    assert "<" not in e["name"] and "\n" not in e["name"] and "\u202e" not in e["name"] and "\x00" not in e["name"]
    assert len(e["name"]) <= 64
    assert fallback_safe_field("a\nb<c>\u202e", 10) == "a bc"
    assert safe_field(None) == ""


# ---- prices -----------------------------------------------------------------------------------------------------
class _H:
    def __init__(self, resp):
        self.resp, self.calls = resp, []

    def get_json(self, path, ttl=0):
        self.calls.append(path)
        r = self.resp(path)
        if isinstance(r, Exception):
            raise r
        return r


class _Ctx:
    def __init__(self, dex, gt):
        self.dex = type("D", (), {"h": _H(dex)})()
        self.gt = type("G", (), {"h": _H(gt)})()


def _pair(mint, px, liq=None, dex="pumpfun", mc=5000):
    return {"baseToken": {"address": mint, "symbol": "S", "name": "N"}, "priceUsd": px, "liquidity": {"usd": liq} if liq else None,
            "dexId": dex, "pairAddress": f"{dex}-{mint}", "marketCap": mc}


def test_pick_pair_prefers_liquid_pool_and_rejects_bad_prices():
    ps = [_pair("M", "0.001"), _pair("M", "0.0011", 50_000, "pumpswap"), _pair("X", "1", 1e9), _pair("M", "NaN", 1e9, "x"), _pair("M", "0", 1e9, "y")]
    assert pick_pair("M", ps)["dexId"] == "pumpswap"
    assert pick_pair("M", [_pair("M", None), _pair("M", "-1")]) is None


def test_pick_pair_skips_implausible_side_pool():
    fake = _pair("M", "0.3434", 1_500_000, "pumpswap", mc=343_000_000)   # liq 0.44% of mcap
    curve = _pair("M", "0.000038", None, "pumpfun", mc=38_000)
    assert pick_pair("M", [fake, curve])["dexId"] == "pumpfun"
    real = _pair("M", "0.0001", 20_000, "raydium", mc=100_000)
    assert pick_pair("M", [fake, curve, real])["dexId"] == "raydium"
    assert pick_pair("M", [fake])["dexId"] == "pumpswap"   # nothing better: old choice, entry gate keeps it pending


def test_quotes_never_invent_and_fallback_to_gt():
    dex = lambda p: [_pair("A", "0.002")]
    gt = lambda p: {"data": [{"attributes": {"address": "A", "price_usd": "0.0021", "total_reserve_in_usd": "3000", "fdv_usd": "9000"}},
                             {"attributes": {"address": "B", "price_usd": "0.5", "total_reserve_in_usd": "100"}}]}
    q, errs = quotes(_Ctx(dex, gt), ["A", "B", "C"])
    assert q["A"].price_usd == 0.002 and q["A"].liquidity_usd == 3000 and q["A"].source == "dexscreener+gt_liquidity"
    assert q["B"].source == "geckoterminal" and "C" not in q
    q, errs = quotes(_Ctx(lambda p: RuntimeError("HTTP 429"), lambda p: RuntimeError("HTTP 503")), ["A"])
    assert q == {} and len(errs) == 2


def test_dexscreener_batches_of_30():
    c = _Ctx(lambda p: [], lambda p: {})
    dexscreener_quotes(c, [f"M{i}" for i in range(65)])
    assert len(c.dex.h.calls) == 3


def test_max_drawdown():
    assert _max_drawdown([1000, 1100, 880, 1200]) == 20.0


# ---- contract -------------------------------------------------------------------------------------------------
def test_cli_registers_paper_and_keeps_contract():
    from smr.cli import build_parser
    ap = build_parser()
    assert ap.parse_args(["paper", "cycle"]).paper_cmd == "cycle"
    a = ap.parse_args(["paper", "events", "--since-unreported", "--mark-reported"])
    assert a.mark_reported and a.since_unreported
    assert ap.parse_args(["paper", "report", "--summary", "--json"]).summary
    assert ap.parse_args(["score", "MINT"]).mint == "MINT"
    assert ap.parse_args(["watch", "--minutes", "1"]).minutes == 1
    assert ap.parse_args(["health", "--quick"]).quick


def test_pumpfun_stub_never_calls_network():
    s = E._NoPumpFun()
    with pytest.raises(RuntimeError):
        s.coin("x")
    with pytest.raises(RuntimeError):
        s.created_by("w", limit=1)
    assert "disabled" in s.h.snapshot()


def test_entry_priced_right_after_each_score(tmp_path):
    w = World(tmp_path, {"N1": "NORMAL", "N2": "NORMAL"})
    calls = []
    orig = w.quotes
    def q(mints):
        calls.append(sorted(mints)); return orig(mints)
    w.quotes = q
    w.cycle(parallel=1)
    assert ["N1"] in calls and ["N2"] in calls     # one entry lookup per scored launch


def test_reason_signs_survive_sanitizer():
    assert "under 48.0h" in E.safe_reason("1/3 buyers were < 48.0h old")
    assert "<" not in E.safe_reason("x <script>")


# ---- entry-time market gates (follow-up: pre-gate bug) --------------------------------------------------------
from smr.paper import gates as G


def test_gate_rules_match_live_market_gates():
    assert G.entry_gates(1500, 200, 5000)["cap"] == "SKIP"                 # liquidity < $2k
    assert G.entry_gates(5000, 200, 5000)["cap"] == "REDUCED"              # liquidity < $10k
    assert G.entry_gates(50_000, 10, 5000)["cap"] == "REDUCED"             # holders < 75
    assert G.entry_gates(50_000, None, 5000)["cap"] == "REDUCED"           # unknown holders: conservative
    assert G.entry_gates(50_000, 200, 5000)["cap"] == "NORMAL"
    g = G.entry_gates(50_000, 200, 400)                                     # drained curve
    assert g["cap"] == "SKIP" and any("FDV" in r for r in g["reasons"])
    assert G.stricter("NORMAL", "REDUCED") == "REDUCED" and G.stricter("SKIP", "NORMAL") == "SKIP" and G.stricter("REDUCED", "NORMAL") == "REDUCED"
    assert G.PUMP_LAUNCH_PRICE_SOL == pytest.approx(2.796e-8, rel=1e-3)


def test_liq_mcap_reduced_gate():
    """liq/mcap < 0.3 at entry -> at most REDUCED (Next F1, shipped 2026-11-06). Below quote_sanity's 0.02 the
    quote never reaches entry_gates (pending); this covers the thin-but-plausible band."""
    # $12k liq on $50k fdv = 0.24 < 0.3; liq >= $10k and holders >= 75 so live market gates alone are NORMAL
    g = G.entry_gates(12_000, 200, 50_000)
    assert g["cap"] == "REDUCED" and any("liq/mcap" in r for r in g["reasons"])
    assert g["thresholds"]["liq_mcap_reduced"] == G.LIQ_MCAP_REDUCED == 0.3
    # $20k / $50k = 0.40 >= 0.3 -> no thin-liq downgrade
    assert G.entry_gates(20_000, 200, 50_000)["cap"] == "NORMAL"
    # Already SKIP from dead FDV stays SKIP (stricter), even with thin liq/mcap
    g2 = G.entry_gates(12_000, 200, 400)
    assert g2["cap"] == "SKIP"
    # Missing fdv or liq: rule does not fire
    assert "liq/mcap" not in " ".join(G.entry_gates(20_000, 200, None)["reasons"])
    assert "liq/mcap" not in " ".join(G.entry_gates(None, 200, 50_000)["reasons"])


def test_entry_gates_downgrade_and_record_both_decisions(tmp_path):
    w = World(tmp_path, {"A": "NORMAL", "B": "NORMAL", "C": "REDUCED", "D": "NORMAL"})
    w.liq.update({"A": 800.0, "B": 5000.0, "C": 900.0, "D": 50_000.0})
    st = w.cycle()
    assert st["decisions"] == {"SKIP": 0, "REDUCED": 1, "NORMAL": 3}
    assert st["decisions_after_gates"] == {"SKIP": 2, "REDUCED": 1, "NORMAL": 1}
    a = w.led.one("SELECT * FROM launches WHERE mint='A'")
    assert a["asof_decision"] == "NORMAL" and a["decision"] == "SKIP" and a["gate_cap"] == "SKIP" and "liquidity" in a["gate_reasons"]
    assert a["gate_holders"] == 120 and a["holder_source"] == "as_of_reconstruction"
    assert w.pos("strategy", "A") is None and w.pos("strategy", "C") is None
    assert w.pos("strategy", "B")["size_usd"] == 10.0 and w.pos("strategy", "B")["asof_decision"] == "NORMAL"
    assert w.pos("strategy", "D")["size_usd"] == 20.0
    assert w.pos("all", "A")["decision"] == "SKIP"           # counterfactual still buys it, tagged with the final decision
    ev = {e["mint"]: e for e in unreported(w.led)}
    assert set(ev) == {"B", "D"}
    assert ev["B"]["asof_decision"] == "NORMAL" and ev["B"]["decision"] == "REDUCED" and "downgraded from NORMAL" in ev["B"]["text"]
    assert {d["mint"] for d in st["gate_downgrades"]} == {"A", "B", "C"}


def test_entry_low_holders_and_dead_fdv(tmp_path):
    w = World(tmp_path, {"H": "NORMAL", "F": "NORMAL"})
    w.prices["F"] = 1e-7                    # FDV 1e-7 x 1e9 = $100
    e = E.Cycle(None, w.led, min_mcap_usd=0, mayhem_fn=w.mayhem_fn, quotes_fn=w.quotes, discover_fn=w.discover, score_fn=w.score, clock=w.clock, end_ts=T0 + 86400,
                holders_fn=lambda l: (3, "test") if l["mint"] == "H" else (500, "test"))
    st = e.run()
    h = w.led.one("SELECT * FROM launches WHERE mint='H'"); f = w.led.one("SELECT * FROM launches WHERE mint='F'")
    assert h["decision"] == "REDUCED" and "holders" in h["gate_reasons"]
    assert f["decision"] == "SKIP" and "FDV" in f["gate_reasons"]


def test_mayhem_mcap_excludes_agent_billion_when_balance_unknown(tmp_path):
    # Mayhem coin: 2B on-chain, agent balance unreadable -> 1B curve basis (= DexScreener/pump.fun), not 2B
    w = World(tmp_path, {"M": "NORMAL"})
    w.prices["M"] = 2e-6
    E.Cycle(None, w.led, min_mcap_usd=0, mayhem_fn=w.mayhem_fn, quotes_fn=w.quotes, discover_fn=w.discover, score_fn=w.score, clock=w.clock, end_ts=T0 + 86400,
            supply_fn=lambda m: 2e9, agent_balance_fn=lambda m: None).run()
    l = w.led.one("SELECT * FROM launches WHERE mint='M'")
    assert l["supply"] == 2e9 and l["circ_supply"] == 1e9
    assert l["entry_fdv"] == pytest.approx(2000) and l["entry_mcap"] == pytest.approx(2000)
    assert json.loads(l["entry_note"])["dexscreener_mcap_usd"] == pytest.approx(2000)
    assert unreported(w.led)[0]["entry_mcap_usd"] == pytest.approx(2000)


def test_mayhem_floor_uses_supply_minus_agent_balance(tmp_path):
    # the two 2026-11-03 buys: Soljack 3.625e-5 with the agent holding 1,017,344,759 -> $35.6k (passes $30k);
    # spon 2.621e-5 with the agent holding 1,026,980,357 -> $25.5k (fails; was $52.4k on the 2B basis)
    w = World(tmp_path, {"SLJK": "NORMAL", "SPON": "NORMAL", "NORM": "NORMAL"})
    w.prices.update({"SLJK": 3.625e-5, "SPON": 2.621e-5, "NORM": 3.2e-5})
    agent = {"SLJK": 1_017_344_759.074785, "SPON": 1_026_980_357.088088}
    asked = []

    def ab(m):
        asked.append(m); return agent.get(m, 0.0)
    w.cycle(min_mcap_usd=30_000, supply_fn=lambda m: 1e9 if m == "NORM" else 2e9, agent_balance_fn=ab)
    sl = w.led.one("SELECT * FROM launches WHERE mint='SLJK'"); sp = w.led.one("SELECT * FROM launches WHERE mint='SPON'")
    assert sl["entry_mcap"] == pytest.approx(3.625e-5 * (2e9 - agent["SLJK"])) and 35_000 < sl["entry_mcap"] < 36_000
    assert sl["strategy_status"] == "entered" and w.pos("strategy", "SLJK") is not None
    assert sp["entry_mcap"] == pytest.approx(2.621e-5 * (2e9 - agent["SPON"])) and sp["entry_mcap"] < 30_000
    assert sp["strategy_status"] == "filtered_mcap" and w.pos("strategy", "SPON") is None
    assert json.loads(sp["entry_note"])["mayhem_agent_balance"] == pytest.approx(agent["SPON"])
    n = w.led.one("SELECT * FROM launches WHERE mint='NORM'")
    assert n["entry_mcap"] == pytest.approx(32_000) and n["strategy_status"] == "entered"
    assert "NORM" not in asked                     # normal 1B coins never query the agent


def test_circulating_supply_and_fdv_of_units():
    q = Quote("X", 1e-5, 9e3, 1e4, "fake", "pair", "pumpfun", "S", "N", T0, 2e4)
    assert E.circulating_supply(1e9) == 1e9
    assert E.circulating_supply(982_726_445.78) == pytest.approx(982_726_445.78)    # normal coin after burns: as is
    assert E.circulating_supply(1.05e9) == 1.05e9                                  # post-burn Mayhem (agent sold 5%)
    assert E.circulating_supply(2e9) == 1e9                                        # pre-burn Mayhem, agent unknown
    assert E.circulating_supply(2e9, 1.2e9) == pytest.approx(0.8e9)
    assert E.circulating_supply(None) is None
    assert E.fdv_of(q, 1e9) == pytest.approx(1e4)
    assert E.fdv_of(q, 2e9) == pytest.approx(1e4)                                  # legacy ledger rows: no 2x
    assert E.fdv_of(q, 2e9, 9.8e8) == pytest.approx(9.8e3)
    assert E.fdv_of(q, None) == 9e3                                                # DexScreener mcap before GT fdv
    assert E.fdv_of(None, 1e9) is None


def test_unknown_liquidity_or_price_disagreement_keeps_entry_pending(tmp_path):
    w = World(tmp_path, {"U": "NORMAL", "X": "NORMAL"})
    w.liq["U"] = None
    base = w.quotes

    def qf(mints):
        out, errs = base(mints)
        if "X" in out:
            out["X"].gt_price_usd = out["X"].price_usd * 1.6
        return out, errs
    st = E.Cycle(None, w.led, min_mcap_usd=0, mayhem_fn=w.mayhem_fn, quotes_fn=qf, discover_fn=w.discover, score_fn=w.score, clock=w.clock, end_ts=T0 + 86400).run()
    assert st["entries_priced"] == 0 and w.led.one("SELECT COUNT(*) AS n FROM positions")["n"] == 0
    assert all(r["entry_status"] == "pending" for r in w.led.q("SELECT * FROM launches"))
    assert any("disagree" in h for h in st["entries_held"]) and any("liquidity unknown" in h for h in st["entries_held"])
    w.clock.t += E.ENTRY_MAX_DELAY_S + 60
    E.Cycle(None, w.led, min_mcap_usd=0, mayhem_fn=w.mayhem_fn, quotes_fn=qf, discover_fn=lambda n, k: [], score_fn=w.score, clock=w.clock, end_ts=T0 + 86400).run()
    assert all(r["entry_status"] == "unfilled" for r in w.led.q("SELECT * FROM launches"))


def test_void_cycle_excludes_from_pnl_resets_books_and_never_sends(tmp_path):
    w = World(tmp_path, {"N1": "NORMAL", "R1": "REDUCED", "S1": "SKIP"})
    w.cycle()
    w.prices["N1"] = 0.4e-6; w.clock.t += 900; w.cycle()        # N1 stopped out: realized loss in every book
    assert E.book_state(w.led, "strategy")["bankroll"] < 1000
    assert len(unreported(w.led)) == 3
    r = E.void_cycle(w.led, 1, "pre_gate_bug", now=w.clock())
    assert r["launches"] == 3 and r["positions"] == 8 and r["events_marked"] == 3
    for b in E.BOOKS:
        st = E.book_state(w.led, b)
        assert st["bankroll"] == 1000 and st["open"] == 0 and st["cash"] == 1000
    assert unreported(w.led) == []
    assert w.led.one("SELECT COUNT(*) AS n FROM positions WHERE void_reason='pre_gate_bug'")["n"] == 8   # kept for audit
    assert w.led.one("SELECT COUNT(*) AS n FROM events WHERE void_reason='pre_gate_bug' AND reported_at IS NOT NULL")["n"] == 3
    rep = build(w.led)
    s = rep["books"]["strategy"]
    assert s["equity_mark_to_market"] == 1000 and s["trades_total"] == 0 and s["max_drawdown_pct"] == 0
    assert rep["launches"]["scored"] == 0 and rep["tiers"]["SKIP"]["scored_and_priced"] == 0
    assert rep["voided"]["pre_gate_bug"] == {"launches": 3, "positions": 8}
    assert "Voided (pre_gate_bug)" in summary_text(rep)
    # voided positions are no longer marked or exited, and a later cycle trades from a clean $1,000
    w.clock.t += 900
    w.launches["N2"] = "NORMAL"; w.prices["N2"] = 1e-6; w.liq["N2"] = 50_000.0; w.disc = ["N2"]
    w.cycle()
    assert w.pos("strategy", "N2")["bankroll_at_entry"] == 1000 and w.pos("strategy", "R1")["status"] == "open"
    assert [e["mint"] for e in unreported(w.led)] == ["N2"]
    assert E.void_cycle(w.led, 1, "pre_gate_bug")["positions"] == 0      # idempotent


def test_quotes_entry_mode_cross_checks_gt_and_takes_real_fdv():
    dex = lambda p: [_pair("A", "0.000002", 40_000, "pumpswap", mc=2000)]
    gt = lambda p: {"data": [{"attributes": {"address": "A", "price_usd": "0.0000021", "total_reserve_in_usd": "60000", "fdv_usd": "4200"}}]}
    q, _ = quotes(_Ctx(dex, gt), ["A"])
    assert q["A"].gt_price_usd is None and q["A"].liquidity_usd == 40_000      # marks: DS liquidity known -> no GT call
    q, _ = quotes(_Ctx(dex, gt), ["A"], gt_all=True)
    assert q["A"].gt_price_usd == pytest.approx(2.1e-6) and q["A"].fdv_usd == 4200 and q["A"].liquidity_usd == 60_000
    assert q["A"].mcap_usd == 2000


# ---- market-cap floor for the strategy book (Zoorped, 2026-11-03) -----------------------------------------------
def test_mcap_floor_default_and_env(tmp_path, monkeypatch):
    led = Ledger(str(tmp_path / "p.db"))
    assert E.Cycle(None, led).min_mcap_usd == 30_000
    monkeypatch.setenv("SMR_PAPER_MIN_MCAP_USD", "50000")
    assert E.Cycle(None, led).min_mcap_usd == 50_000 and E.Cycle(None, led, min_mcap_usd=1).min_mcap_usd == 1


def test_mcap_floor_filters_strategy_only(tmp_path):
    w = World(tmp_path, {"LO": "NORMAL", "HI": "NORMAL", "SK": "SKIP"})
    w.prices["HI"] = 1e-4                      # FDV $100k
    st = w.cycle(min_mcap_usd=30_000)
    assert st["filtered_mcap"] == 1
    lo = w.led.one("SELECT * FROM launches WHERE mint='LO'")
    assert lo["strategy_status"] == "filtered_mcap" and lo["score"] == 10 and lo["first_priced_mcap"] == pytest.approx(1000)
    assert w.led.one("SELECT strategy_status FROM launches WHERE mint='HI'")["strategy_status"] == "entered"
    assert w.led.one("SELECT strategy_status FROM launches WHERE mint='SK'")["strategy_status"] == "skip"
    assert w.pos("strategy", "LO") is None and w.pos("all", "LO") and w.pos("shadow", "LO")
    assert w.pos("strategy", "HI")["size_usd"] == 20.0
    assert [e["mint"] for e in unreported(w.led)] == ["HI"]
    rep = build(w.led)
    assert rep["mcap_filter"]["filtered_waiting"] == 1 and rep["mcap_filter"]["min_entry_mcap_usd"] == 30_000
    assert "Market-cap floor $30,000" in summary_text(rep)


def test_mcap_cross_enters_with_regated_decision_and_records_cross(tmp_path):
    w = World(tmp_path, {"LO": "NORMAL"})
    w.cycle(min_mcap_usd=30_000)
    all_entry = w.pos("all", "LO")["entry_price"]
    # crosses the floor but liquidity is now $1k -> live gates say SKIP: stays filtered
    w.clock.t += 900; w.prices["LO"] = 5e-5; w.liq["LO"] = 1000.0
    st = w.cycle(min_mcap_usd=30_000)
    assert w.pos("strategy", "LO") is None and st["mcap_cross_gated"]
    assert w.led.one("SELECT strategy_status FROM launches WHERE mint='LO'")["strategy_status"] == "filtered_mcap"
    # next cycle liquidity $5k -> REDUCED (liquidity under $10k), enters at the current price
    w.clock.t += 900; w.liq["LO"] = 5000.0
    st = w.cycle(min_mcap_usd=30_000)
    assert st["mcap_crossings"] == 1
    p = w.pos("strategy", "LO")
    assert p["entry_price"] == 5e-5 and p["entry_trigger"] == "mcap_cross" and p["decision"] == "REDUCED" and p["size_usd"] == 10.0
    assert w.pos("all", "LO")["entry_price"] == all_entry         # counterfactual books keep the first-price entry
    l = w.led.one("SELECT * FROM launches WHERE mint='LO'")
    assert l["strategy_status"] == "entered_on_cross" and l["mcap_at_cross"] == pytest.approx(50_000) and l["cross_decision"] == "REDUCED"
    (e,) = unreported(w.led)
    assert e["entry_trigger"] == "mcap_cross" and e["mcap_at_cross_usd"] == pytest.approx(50_000) and e["entry_mcap_usd"] == pytest.approx(50_000)
    assert e["first_priced_mcap_usd"] == pytest.approx(1000) and "crossing the $30,000 market-cap floor at $50,000" in e["text"]
    w.clock.t += 900; w.cycle(min_mcap_usd=30_000)
    assert w.led.one("SELECT COUNT(*) AS n FROM positions WHERE book='strategy'")["n"] == 1    # idempotent


def test_mcap_recheck_expires_after_24h_from_launch(tmp_path):
    w = World(tmp_path, {"LO": "REDUCED"})
    w.cycle(min_mcap_usd=30_000)
    w.clock.t += E.MCAP_RECHECK_S; w.prices["LO"] = 1e-4
    st = w.cycle(min_mcap_usd=30_000)
    assert st["mcap_expired"] == 1 and w.pos("strategy", "LO") is None
    assert w.led.one("SELECT strategy_status FROM launches WHERE mint='LO'")["strategy_status"] == "expired_mcap"


def test_void_position_only_touches_one_book_refunds_and_hides(tmp_path):
    w = World(tmp_path, {"N1": "NORMAL", "N2": "NORMAL"})
    w.cycle()
    w.prices["N1"] = 1.2e-6; w.clock.t += 900; w.cycle()          # N1 up a bit, still open everywhere
    before = E.book_state(w.led, "strategy")
    assert before["open"] == 2 and before["cash"] < 1000
    pid = w.pos("strategy", "N1")["id"]
    r = E.void_position(w.led, "below_floor_bug", position_id=pid, now=w.clock())
    assert r["found"] and r["positions"] == 1 and r["book"] == "strategy" and r["events_marked"] == 1
    st = E.book_state(w.led, "strategy")
    assert st["open"] == 1 and st["bankroll"] == 1000
    assert st["cash"] == pytest.approx(1000 - w.pos("strategy", "N2")["size_usd"])
    # other books' N1 positions are unchanged
    for b in ("all", "shadow"):
        assert w.pos(b, "N1")["void_reason"] is None and w.pos(b, "N1")["status"] == "open"
    assert w.pos("strategy", "N1")["void_reason"] == "below_floor_bug"         # row kept for audit
    assert [e["mint"] for e in unreported(w.led)] == ["N2"]
    rep = build(w.led)
    s = rep["books"]["strategy"]
    assert s["trades_total"] == 1 and [p["mint"] for p in rep["open_positions"]] == ["N2"]
    assert rep["books"]["all"]["trades_total"] == 2
    assert rep["voided"]["below_floor_bug"] == {"positions": 1}
    assert rep["launches"]["scored"] == 2                                    # the launch itself stays valid
    assert w.led.one("SELECT strategy_status FROM launches WHERE mint='N1'")["strategy_status"] == "voided"
    assert w.led.one("SELECT COUNT(*) AS n FROM equity WHERE book='strategy' AND void_reason IS NULL")["n"] == 0
    assert w.led.one("SELECT COUNT(*) AS n FROM equity WHERE book='all' AND void_reason IS NULL")["n"] == 2
    # later cycles never mark, close or re-enter it
    w.prices["N1"] = 5e-6; w.clock.t += 900; w.cycle()
    assert w.pos("strategy", "N1")["status"] == "open" and w.pos("all", "N1")["status"] == "closed"
    assert w.led.one("SELECT COUNT(*) AS n FROM positions WHERE book='strategy' AND mint='N1'")["n"] == 1
    assert [e["mint"] for e in unreported(w.led)] == ["N2"]
    # idempotent
    assert E.void_position(w.led, "below_floor_bug", mint="N1")["positions"] == 0


def test_void_position_closed_drops_realized_pnl_and_by_mint(tmp_path):
    w = World(tmp_path, {"N1": "NORMAL"})
    w.cycle()
    w.prices["N1"] = 0.4e-6; w.clock.t += 900; w.cycle()           # stopped out
    assert E.book_state(w.led, "strategy")["bankroll"] < 1000
    mark_reported(w.led, [e["event_id"] for e in unreported(w.led)])
    r = E.void_position(w.led, "bug", mint="N1", book="strategy", now=w.clock())
    assert r["positions"] == 1 and r["status"] == "closed" and r["bankroll_after"] == 1000 and r["bankroll_before"] < 1000
    assert E.book_state(w.led, "all")["bankroll"] < 1000                     # other book keeps its loss
    assert w.led.one("SELECT COUNT(*) AS n FROM events WHERE mint='N1' AND void_reason='bug'")["n"] == 2
    assert E.void_position(w.led, "bug", mint="NOPE")["found"] is False
    with pytest.raises(ValueError):
        E.void_position(w.led, "bug")


def test_cli_void_position_and_cycle_args(tmp_path, capsys):
    import argparse
    from smr.paper import cli
    w = World(tmp_path, {"N1": "NORMAL"})
    w.cycle()
    pa = argparse.ArgumentParser(); cli.add_parser(pa.add_subparsers(dest="cmd"))
    db = str(tmp_path / "paper.db")
    with pytest.raises(SystemExit):
        a = pa.parse_args(["paper", "void", "--reason", "x", "--db", db]); a.fn(a)
    with pytest.raises(SystemExit):
        a = pa.parse_args(["paper", "void", "--cycle", "1", "--mint", "N1", "--reason", "x", "--db", db]); a.fn(a)
    capsys.readouterr()
    a = pa.parse_args(["paper", "void", "--mint", "N1", "--reason", "x", "--db", db]); a.fn(a)
    out = json.loads(capsys.readouterr().out)
    assert out["positions"] == 1 and out["book"] == "strategy"
    assert Ledger(db).one("SELECT void_reason FROM positions WHERE book='all' AND mint='N1'")["void_reason"] is None


def test_quote_sanity_rejects_mispriced_side_pool():
    from smr.paper import gates as G
    # 2QUUWXGM (2026-11-03): $343M mcap on $1.5M liquidity -> implausible, keep pending
    r = G.quote_sanity(1_499_221.98, 343_398_345.97)
    assert r and "implausible quote" in r
    # tiny liquidity on a $76k mcap is also rejected (0.000004%)
    assert G.quote_sanity(0.0029, 76_168.6)
    # normal graduated pool (~5-25% liq/mcap) and unknown values pass
    assert G.quote_sanity(127_090.74, 2_519_304.15) is None
    assert G.quote_sanity(28_419.76, 136_306.22) is None
    assert G.quote_sanity(None, 50_000) is None
    assert G.quote_sanity(5_000, None) is None
