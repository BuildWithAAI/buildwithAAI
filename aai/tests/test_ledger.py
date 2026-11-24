import pytest
from aai import audit
from aai.models import Idea
from conftest import meme_signal


def idea(**kw):
    d = dict(sector="perps", symbol="ETH-USDT", side="long", entry=2000.0, stop=1900.0, target=2300.0, requested_risk=0.02)
    d.update(kw); return Idea(**d)


def test_fill_and_stop_loss_equals_planned_risk(ledger):
    d = ledger.submit(idea())
    assert d.approved
    assert len(ledger.open_positions()) == 1
    closed = ledger.mark("ETH-USDT", 1900.0)
    assert closed and closed[0]["close_reason"] == "stop"
    assert closed[0]["realized_pnl"] == pytest.approx(-d.risk_usd, rel=1e-9)
    assert ledger.equity()["equity"] == pytest.approx(10000 - d.risk_usd)


def test_target_profit(ledger):
    d = ledger.submit(idea())
    c = ledger.mark("ETH-USDT", 2400.0)[0]
    assert c["close_reason"] == "target" and c["realized_pnl"] > 0 and c["r_multiple"] > 2.5


def test_gap_through_stop_is_reported(ledger):
    d = ledger.submit(idea())
    c = ledger.mark("ETH-USDT", 1500.0)[0]
    assert c["realized_pnl"] < -d.risk_usd
    ev = audit.tail(ledger.s, 5)
    assert any("gap through stop" in " ".join(e["reasons"]) for e in ev)


def test_short_position(ledger):
    d = ledger.submit(idea(side="short", entry=2000, stop=2100, target=1700))
    assert d.approved
    c = ledger.mark("ETH-USDT", 2100.0)[0]
    assert c["realized_pnl"] == pytest.approx(-d.risk_usd, rel=1e-9)


def test_rejected_idea_recorded_with_reasons(ledger):
    d = ledger.submit(idea(sector="billy"))
    assert not d.approved
    row = ledger.ideas()[0]
    assert row["status"] == "rejected" and row["approved"] == 0
    ev = [e for e in audit.tail(ledger.s, 10) if e["event"] == "risk_decision"][0]
    assert ev["outcome"] == "rejected" and any("not_research_only" in r for r in ev["reasons"])


def test_every_step_audited_and_chain_ok(ledger):
    ledger.submit(idea()); ledger.mark("ETH-USDT", 1900.0)
    events = [e["event"] for e in reversed(audit.tail(ledger.s, 50))]
    for e in ("idea_received", "risk_decision", "paper_fill", "position_closed"):
        assert e in events
    assert audit.verify(ledger.s)["ok"]


def test_circuit_breaker_trips_kill_switch(ledger, cfg):
    # 3 consecutive 2% losses (-6%) exceed the 5% daily loss limit
    for sym in ("A", "B", "C"):
        assert ledger.submit(idea(symbol=sym)).approved
        ledger.mark(sym, 1900.0)
    ks = ledger.kill_switch()
    assert ks["on"] and ks["reason"].startswith("AUTO: daily loss")
    assert "kill_switch_off" in ledger.submit(idea(symbol="D")).failed


def test_meme_flow_uses_stored_signal(ledger, store):
    meme_signal(store, "MINTX", "SKIP", 80)
    assert "signal_gate" in ledger.submit(Idea(sector="solana_meme", symbol="MINTX", side="long", entry=1e-5, stop=None)).failed
    meme_signal(store, "MINTY", "NORMAL", 10)
    d = ledger.submit(Idea(sector="solana_meme", symbol="MINTY", side="long", entry=1e-5, stop=None, requested_risk=0.03))
    assert d.approved and d.risk_frac == pytest.approx(0.01, rel=1e-6)
    c = ledger.mark("MINTY", 0.0)[0]                         # rug to zero
    assert c["realized_pnl"] >= -d.risk_usd - 1e-9
