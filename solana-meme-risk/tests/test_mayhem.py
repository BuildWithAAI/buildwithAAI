"""Mayhem-mode detection (smr/mayhem.py) and the Mayhem entry gate for the strategy + momentum paper books."""
from __future__ import annotations
import base64, json
from smr import mayhem as MY
from smr.paper import engine as E
from smr.paper.report import build, summary_text, unreported
from tests.test_paper import World, T0
from tests.test_momentum import MWorld


def curve_bytes(flag, size=166):
    b = bytearray(size)
    b[:8] = MY.CURVE_DISCRIMINATOR
    if size > MY.CURVE_MAYHEM_OFFSET:
        b[MY.CURVE_MAYHEM_OFFSET] = flag
    return bytes(b)


def test_curve_flag():
    assert MY.from_curve_account(curve_bytes(1)) is True
    assert MY.from_curve_account(curve_bytes(0)) is False
    assert MY.from_curve_account(curve_bytes(0, 82)) is False
    assert MY.from_curve_account(curve_bytes(0, 81)) is False          # legacy layout: pre-Mayhem
    assert MY.from_curve_account(curve_bytes(7)) is None
    assert MY.from_curve_account(b"\x00" * 166) is None                # not a BondingCurve
    assert MY.from_curve_account([base64.b64encode(curve_bytes(1)).decode(), "base64"]) is True
    assert MY.from_curve_account(None) is None


def _tx(logs, balances=(), err=None):
    return {"meta": {"err": err, "logMessages": list(logs),
                     "postTokenBalances": [{"mint": m, "owner": o, "uiTokenAmount": {"amount": str(a)}} for m, o, a in balances]}}


def test_create_tx_flag():
    v2 = "Program log: Instruction: CreateV2"
    assert MY.from_create_tx(_tx([v2, "Program log: Instruction: InitializeMayhemState"]), "M") is True
    assert MY.from_create_tx(_tx([v2], [("M", MY.MAYHEM_AGENT, 10**15)]), "M") is True
    assert MY.from_create_tx(_tx([v2], [("OTHER", MY.MAYHEM_AGENT, 10**15)]), "M") is False
    assert MY.from_create_tx(_tx(["Program log: Instruction: Create"]), "M") is False
    assert MY.from_create_tx(_tx([v2, "Log truncated"]), "M") is None
    assert MY.from_create_tx(_tx([]), "M") is None
    assert MY.from_create_tx(_tx([v2], err={"x": 1}), "M") is None
    assert MY.from_create_tx(None, "M") is None


def test_classify_any_mayhem_wins_and_unknown():
    assert MY.classify(False, False, 2e9)["mayhem"] is True                       # supply 2B overrides
    assert MY.classify(None, None, 1e9, 5.0)["mayhem"] is True                    # agent holds a balance
    assert MY.classify(None, None, 1.05e9)["source"] == "supply"                  # post-burn Mayhem (agent sold ~5%)
    r = MY.classify(False, None, 1e9, 0)
    assert r["mayhem"] is False and r["source"] == "curve_flag"
    assert MY.classify(None, None, 1e9, 0)["mayhem"] is None                      # 1B supply alone proves nothing
    assert MY.classify()["source"] == "unknown"


class _Rpc:
    def __init__(self, tx, data):
        self.tx, self.data, self.calls = tx, data, []

    def get_transaction(self, sig):
        self.calls.append(("tx", sig)); return self.tx

    def call(self, method, params, **kw):
        self.calls.append((method, params[0]))
        return {"value": {"data": [base64.b64encode(self.data).decode(), "base64"]}} if self.data else {"value": None}


class _Ctx:
    def __init__(self, rpc):
        self.rpc = rpc


def test_detect_reads_create_tx_then_curve_account():
    tx = _tx(["Program log: Instruction: CreateV2"], [("M", "CURVE", 8 * 10**14)])
    rpc = _Rpc(tx, curve_bytes(1))
    r = MY.detect(_Ctx(rpc), "M", create_sig="S")
    assert r["mayhem"] is True and r["source"] == "curve_flag" and r["curve"] == "CURVE"   # curve flag beats a clean log
    assert rpc.calls == [("tx", "S"), ("getAccountInfo", "CURVE")]
    r = MY.detect(_Ctx(_Rpc(tx, curve_bytes(0))), "M", create_sig="S")
    assert r["mayhem"] is False and r["source"] == "curve_flag+create_tx"
    r = MY.detect(_Ctx(_Rpc(None, None)), "M", create_sig="S")
    assert r["mayhem"] is None


def test_detect_tries_other_holders_when_curve_tokens_are_split():
    tx = _tx(["Program log: Instruction: CreateV2", "Log truncated"], [("M", "NOTCURVE", 793 * 10**12), ("M", "CURVE", 206 * 10**12)])
    class R(_Rpc):
        def call(self, method, params, **kw):
            self.calls.append((method, params[0]))
            d = curve_bytes(0) if params[0] == "CURVE" else b"\x01" * 165
            return {"value": {"data": [base64.b64encode(d).decode(), "base64"]}}
    rpc = R(tx, None)
    r = MY.detect(_Ctx(rpc), "M", create_sig="S")
    assert r["mayhem"] is False and r["curve"] == "CURVE" and r["source"] == "curve_flag"


# ---- engine gate ----------------------------------------------------------------------------------------------------
def test_gate_skips_mayhem_and_unknown_in_strategy_only_benchmarks_flagged(tmp_path):
    w = World(tmp_path, {"MY": "NORMAL", "OK": "NORMAL", "UN": "NORMAL"})
    w.mayhem = {"MY": True, "OK": False, "UN": None}
    st = w.cycle()
    assert w.pos("strategy", "OK") and w.pos("strategy", "MY") is None and w.pos("strategy", "UN") is None
    for m, f in (("MY", 1), ("OK", 0), ("UN", None)):
        assert w.pos("all", m) and w.pos("shadow", m)                          # benchmarks unchanged
        assert w.pos("shadow", m)["mayhem"] == f and w.pos("all", m)["mayhem"] == f
    l = w.led.one("SELECT * FROM launches WHERE mint='MY'")
    assert l["strategy_status"] == "skip_mayhem" and l["mayhem"] == 1 and l["decision"] == "NORMAL"   # tier untouched
    assert any(r.startswith("mayhem_mode:") for r in json.loads(l["gate_reasons"]))
    u = w.led.one("SELECT * FROM launches WHERE mint='UN'")
    assert u["strategy_status"] == "skip_mayhem" and u["mayhem"] is None and "mayhem_mode unknown" in u["gate_reasons"]
    mh = st["mayhem"]
    assert mh["mayhem"] == 1 and mh["not_mayhem"] == 1 and mh["unknown"] == 1
    assert mh["blocked"] == {"strategy": 1, "momentum": 1} and mh["blocked_unknown"] == {"strategy": 1, "momentum": 1}
    assert [e["mint"] for e in unreported(w.led)] == ["OK"] and unreported(w.led)[0]["mayhem"] == 0
    rep = build(w.led)
    assert rep["mayhem"]["mayhem"]["scored_and_priced"] == 1 and rep["mayhem"]["blocked_entries"] == {"strategy": 2, "momentum": 2, "unknown": 1}
    assert "Mayhem gate" in summary_text(rep)


def test_waiting_for_floor_mayhem_is_dropped_and_unknown_never_enters(tmp_path):
    w = World(tmp_path, {"A": "NORMAL", "B": "NORMAL", "C": "NORMAL"})
    w.cycle(min_mcap_usd=30_000)                                   # all $1k: waiting for the floor, not Mayhem
    # simulate rows that were waiting before the gate existed (no Mayhem status recorded)
    w.led.db.execute("UPDATE launches SET mayhem=NULL, mayhem_source=NULL, mayhem_checked_at=NULL")
    w.mayhem = {"A": True, "B": None, "C": False}
    w.clock.t += 900
    for m in "ABC":
        w.prices[m] = 5e-5                                         # $50k: all cross
    st = w.cycle(min_mcap_usd=30_000)
    assert w.led.one("SELECT strategy_status FROM launches WHERE mint='A'")["strategy_status"] == "skip_mayhem"
    assert st["mayhem"]["waiting_dropped"] == 1
    assert w.pos("strategy", "A") is None and w.pos("strategy", "B") is None
    assert w.pos("strategy", "C")["entry_trigger"] == "mcap_cross"
    assert w.led.one("SELECT strategy_status FROM launches WHERE mint='B'")["strategy_status"] == "filtered_mcap"   # still waiting
    assert st["mayhem"]["blocked_unknown"].get("strategy") == 1
    w.mayhem["B"] = False; w.clock.t += 900                       # status becomes readable -> may enter
    w.cycle(min_mcap_usd=30_000)
    assert w.pos("strategy", "B")


def test_open_mayhem_position_is_not_closed_or_voided(tmp_path):
    w = World(tmp_path, {"SJ": "NORMAL"})
    w.cycle()
    assert w.pos("strategy", "SJ")["status"] == "open"
    w.led.db.execute("UPDATE launches SET mayhem=1, mayhem_source='curve_flag' WHERE mint='SJ'")   # learned later
    w.clock.t += 900; w.cycle()
    p = w.pos("strategy", "SJ")
    assert p["status"] == "open" and p["void_reason"] is None
    w.prices["SJ"] = 2.5e-6; w.clock.t += 900; w.cycle()            # normal exit rules still apply
    assert w.pos("strategy", "SJ")["exit_reason"] == "take_profit"
    assert build(w.led)["mayhem"]["alerted_positions_in_mayhem_coins"][0]["mint"] == "SJ"


def test_momentum_vetoes_mayhem_and_unknown_and_drops_watching(tmp_path):
    w = MWorld(tmp_path, {"N1": "NORMAL", "N2": "NORMAL", "N3": "NORMAL"})
    w.mayhem = {"N1": True, "N2": None, "N3": False}
    st = w.cycle()
    assert w.pos("momentum", "N3") and w.pos("momentum", "N1") is None and w.pos("momentum", "N2") is None
    assert w.pos("momentum", "N3")["mayhem"] == 0
    for m in ("N1", "N2"):
        assert w.led.one("SELECT momentum_status FROM launches WHERE mint=?", (m,))["momentum_status"] == "skip_mayhem"
    assert st["momentum"]["vetoed_mayhem"] == 2


def test_momentum_watching_mayhem_dropped(tmp_path):
    w = MWorld(tmp_path, {"N1": "NORMAL"})
    w.prices["N1"] = 1e-5                                          # under the floor -> watching
    w.cycle(min_mcap_usd=30_000)
    assert w.led.one("SELECT momentum_status FROM launches WHERE mint='N1'")["momentum_status"] == "watching"
    w.led.db.execute("UPDATE launches SET mayhem=NULL, mayhem_checked_at=NULL")
    w.mayhem["N1"] = True; w.prices["N1"] = 5e-5; w.clock.t += 900
    st = w.cycle(min_mcap_usd=30_000)
    assert w.pos("momentum", "N1") is None and st["mayhem"]["watching_dropped"] == 1
    assert w.led.one("SELECT momentum_status FROM launches WHERE mint='N1'")["momentum_status"] == "skip_mayhem"


def test_supply_evidence_overrides_stored_not_mayhem(tmp_path):
    w = World(tmp_path, {"X": "NORMAL"})
    c = E.Cycle(None, w.led, mayhem_fn=lambda l, s=None, a=None: MY.classify(None, None, s, a))
    assert c._mayhem_status({"mint": "X", "mayhem": 0}, 2e9, None)["mayhem"] == 1
    assert c._mayhem_status({"mint": "X", "mayhem": 0, "mayhem_source": "curve_flag"}, 1e9, 0)["mayhem"] == 0
