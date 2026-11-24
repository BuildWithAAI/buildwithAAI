import random, time, pytest
from aai.models import Idea
from aai.risk import RiskEngine, per_unit_loss

EQ = 10_000.0


def st(open_positions=(), kill=False, equity=EQ):
    return {"equity": equity, "mode": "paper", "kill_switch": {"on": kill, "reason": "t"}, "open_positions": list(open_positions)}


def perp(**kw):
    d = dict(sector="perps", symbol="BTC-USDT", side="long", entry=100.0, stop=95.0, target=110.0, venue=None)
    d.update(kw)
    return Idea(**d)


def test_sizing_loss_at_stop_equals_budget(cfg):
    eng = RiskEngine(cfg)
    d = eng.evaluate(perp(requested_risk=0.02), st())
    assert d.approved, d.reasons
    fill, ul = per_unit_loss("long", 100, 95, cfg["risk"]["slippage_bps"] / 1e4, cfg["risk"]["fee_bps"] / 1e4)
    assert d.qty * ul == pytest.approx(EQ * 0.02, rel=1e-9)
    assert d.risk_usd == pytest.approx(200.0)


def test_request_above_cap_is_clamped_never_honoured(cfg):
    d = RiskEngine(cfg).evaluate(perp(requested_risk=0.10), st())
    assert d.approved and d.risk_frac <= 0.02 + 1e-9          # perps sector cap 2%
    d = RiskEngine(cfg).evaluate(Idea(sector="solana_meme", symbol="M", side="long", entry=1e-5, stop=None, requested_risk=0.5),
                                 st(), signal={"recommendation": "NORMAL", "score": 5, "ts": time.time(), "id": 1})
    assert d.approved and d.risk_frac <= 0.01 + 1e-9


def test_request_below_min_raised_to_1pct(cfg):
    d = RiskEngine(cfg).evaluate(perp(requested_risk=0.001), st())
    assert d.approved and d.risk_frac == pytest.approx(0.01)


def test_property_never_exceeds_3pct(cfg):
    rng = random.Random(7)
    eng = RiskEngine(cfg)
    for _ in range(3000):
        side = rng.choice(["long", "short"])
        e = rng.uniform(0.0001, 100000)
        s = e * (1 - rng.uniform(0.001, 0.3)) if side == "long" else e * (1 + rng.uniform(0.001, 0.3))
        sector = rng.choice(["perps", "solana_meme"])
        idea = Idea(sector=sector, symbol=f"S{rng.random()}", side=side, entry=e, stop=None if sector == "solana_meme" and rng.random() < .5 else s,
                    requested_risk=rng.uniform(0, 1))
        eq = rng.uniform(100, 1e7)
        d = eng.evaluate(idea, st(equity=eq), signal={"recommendation": rng.choice(["NORMAL", "REDUCED"]), "score": 1, "ts": time.time()})
        if d.approved:
            assert d.risk_usd / eq <= 0.03 + 1e-9
            assert d.risk_usd > 0


def test_kill_switch_blocks(cfg):
    d = RiskEngine(cfg).evaluate(perp(), st(kill=True))
    assert not d.approved and "kill_switch_off" in d.failed


def test_stale_idea_rejected(cfg):
    d = RiskEngine(cfg).evaluate(perp(ts=time.time() - 3600), st())
    assert "idea_fresh" in d.failed


def test_wrong_side_stop_rejected(cfg):
    assert "stop_defined" in RiskEngine(cfg).evaluate(perp(stop=105), st()).failed
    assert "stop_defined" in RiskEngine(cfg).evaluate(perp(side="short", stop=95, target=90), st()).failed


def test_missing_stop_rejected_for_perps(cfg):
    assert "stop_defined" in RiskEngine(cfg).evaluate(perp(stop=None), st()).failed


def test_reward_risk(cfg):
    assert "reward_risk" in RiskEngine(cfg).evaluate(perp(target=102), st()).failed


def test_too_wide_stop(cfg):
    assert "stop_distance" in RiskEngine(cfg).evaluate(perp(stop=50, target=300), st()).failed


def test_total_open_risk_cap(cfg):
    opens = [{"sector": "x", "symbol": f"s{i}", "risk_usd": 150} for i in range(3)]   # 450 = 4.5%
    d = RiskEngine(cfg).evaluate(perp(requested_risk=0.02), st(opens))              # +200 -> 6.5% > 6%
    assert "total_open_risk" in d.failed


def test_sector_cap(cfg):
    opens = [{"sector": "perps", "symbol": "ETH-USDT", "risk_usd": 300}]            # perps cap 4% = 400
    d = RiskEngine(cfg).evaluate(perp(requested_risk=0.02), st(opens))
    assert "sector_cap" in d.failed


def test_max_positions_and_duplicates(cfg):
    opens = [{"sector": "x", "symbol": f"s{i}", "risk_usd": 1} for i in range(6)]
    assert "max_open_positions" in RiskEngine(cfg).evaluate(perp(), st(opens)).failed
    assert "no_duplicate_position" in RiskEngine(cfg).evaluate(perp(), st([{"sector": "perps", "symbol": "BTC-USDT", "risk_usd": 1}])).failed


def test_billy_and_placeholders_rejected(cfg):
    eng = RiskEngine(cfg)
    assert "not_research_only" in eng.evaluate(perp(sector="billy"), st()).failed
    for s in ("forex", "stocks"):
        assert "sector_enabled" in eng.evaluate(perp(sector=s), st()).failed
    d = eng.evaluate(perp(sector="longterm"), st())
    assert not d.approved and "trading_bucket_only" in d.failed


def test_meme_gates(cfg):
    eng = RiskEngine(cfg)
    idea = lambda: Idea(sector="solana_meme", symbol="MINT", side="long", entry=1e-5, stop=None)
    assert "signal_gate" in eng.evaluate(idea(), st(), signal=None).failed
    skip = {"recommendation": "SKIP", "score": 75, "ts": time.time(), "payload": {"reasons": ["bundle"]}}
    assert "signal_gate" in eng.evaluate(idea(), st(), signal=skip).failed
    old = {"recommendation": "NORMAL", "score": 5, "ts": time.time() - 7200}
    assert "signal_fresh" in eng.evaluate(idea(), st(), signal=old).failed
    d = eng.evaluate(idea(), st(), signal={"recommendation": "REDUCED", "score": 40, "ts": time.time()})
    assert d.approved and d.risk_frac == pytest.approx(0.01)
    # full-loss sizing: notional (incl. fees) equals risk budget
    assert d.notional <= d.risk_usd + 1e-9


def test_contract_lot_rounding_reduces_risk(cfg):
    inst = {"contract_value": 0.001, "lot_size": 1, "min_size": 1}
    d = RiskEngine(cfg).evaluate(perp(entry=77000, stop=76000, target=80000), st(), instrument=inst)
    assert d.approved
    assert d.qty == int(d.qty) and d.risk_usd <= 200 + 1e-9


def test_min_size_rejects(cfg):
    inst = {"contract_value": 1.0, "lot_size": 1, "min_size": 1}
    d = RiskEngine(cfg).evaluate(perp(entry=77000, stop=60000, target=120000, requested_risk=0.01), st(equity=1000), instrument=inst)
    assert "size_positive" in d.failed


def test_leverage_cap_cuts_size(cfg):
    d = RiskEngine(cfg).evaluate(perp(entry=100, stop=99.99, target=101, requested_risk=0.02), st())   # tight stop -> huge size
    assert d.approved and d.notional <= EQ * cfg["risk"]["max_leverage"] + 1e-6
    assert any(c.name == "leverage_cap" for c in d.checks)
