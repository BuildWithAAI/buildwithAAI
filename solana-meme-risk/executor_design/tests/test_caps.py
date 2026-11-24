from pathlib import Path

import pytest

from executor_design import caps as C
from executor_design.breaker import Breaker
from executor_design.outcomes import Pending
from executor_design.tests.test_signal import MINT, make

NOW_S = 1000.0
OWNER = C.OwnerConfig(deposit_basis_usd=100.0, limits_confirmed_by_owner=False, mode="shadow")


def sw(tmp_path):
    return C.Switches(kill_file=tmp_path / "KILL", halt_buys_file=tmp_path / "HALT_BUYS")


def st(**kw):
    s = C.State(last_heartbeat_ts=NOW_S, hot_wallet_value_usd=20.0)
    for k, val in kw.items():
        setattr(s, k, val)
    return s


def chk(sig, state, tmp_path, mcap=45000.0, mayhem=False, owner=OWNER, chain_time=NOW_S, breaker=None):
    return C.check(sig, state, C.Caps(), owner, sw(tmp_path), now_s=NOW_S, chain_time_s=chain_time,
                   executor_mcap_usd=mcap, executor_mayhem=mayhem, breaker=breaker)


def pend(side="BUY", mint=MINT, status="UNKNOWN"):
    return Pending("sigX", "sid", mint, side, 1.0, 100, status)


def test_buy_passes_and_clamps_no_manual_approval(tmp_path):
    out = chk(make(size={"usd": 50.0}, max_slippage_bps=3000), st(), tmp_path)
    assert out == {"size_usd": 1.0, "slippage_bps": 1000}
    assert "needs_approval" not in out and not hasattr(C.Caps(), "manual_approval_first_n")


def test_live_blocked_until_owner_confirms(tmp_path):
    live = C.OwnerConfig(deposit_basis_usd=100.0, limits_confirmed_by_owner=False, mode="live")
    with pytest.raises(C.CapRejected) as e:
        chk(make(), st(), tmp_path, owner=live)
    assert e.value.code == "live_blocked_limits_not_confirmed_by_owner"
    ok = C.OwnerConfig(deposit_basis_usd=100.0, limits_confirmed_by_owner=True, mode="live")
    assert chk(make(), st(), tmp_path, owner=ok)["size_usd"] == 1.0


def test_total_kill_blocks_buy_and_sell(tmp_path):
    (tmp_path / "KILL").write_text("")
    for sig in (make(), make(side="SELL", size={"fraction_bps": 10000})):
        with pytest.raises(C.CapRejected) as e:
            chk(sig, st(open_positions={MINT: {"notional_usd": 1}}), tmp_path)
        assert e.value.code == "kill_switch_total"


def test_buy_halt_allows_sell(tmp_path):
    (tmp_path / "HALT_BUYS").write_text("")
    with pytest.raises(C.CapRejected) as e:
        chk(make(), st(), tmp_path)
    assert e.value.code == "buys_halted"
    out = chk(make(side="SELL", size={"fraction_bps": 5000}), st(open_positions={MINT: {"notional_usd": 1}}), tmp_path)
    assert out["fraction_bps"] == 5000


# ---- float cap: 30% of owner-set deposit basis ---------------------------------------------------------------

def test_float_cap_is_30pct_of_deposit():
    assert C.float_cap_usd(C.Caps(), C.OwnerConfig(deposit_basis_usd=200.0)) == pytest.approx(60.0)
    assert C.float_cap_usd(C.Caps(), C.OwnerConfig(deposit_basis_usd=None)) is None


def test_deposit_basis_unset_blocks_buys(tmp_path):
    with pytest.raises(C.CapRejected) as e:
        chk(make(), st(), tmp_path, owner=C.OwnerConfig(deposit_basis_usd=None))
    assert e.value.code == "deposit_basis_unset"


def test_float_over_30pct_blocks_buy_and_alerts_never_moves_funds(tmp_path):
    state = st(hot_wallet_value_usd=30.01, open_positions={MINT: {"notional_usd": 1}})   # deposit 100 -> cap 30
    with pytest.raises(C.CapRejected) as e:
        chk(make(mint="11111111111111111111111111111111"), state, tmp_path)
    assert e.value.code == "float_over_cap"
    assert state.alerts and state.alerts[-1]["code"] == "float_over_cap" and "never moves funds" in state.alerts[-1]["action"]
    assert not hasattr(C, "sweep") and not hasattr(C, "transfer")
    # SELL still allowed when over the float cap
    assert chk(make(side="SELL", size={"fraction_bps": 10000}), state, tmp_path)["fraction_bps"] == 10000


def test_float_at_cap_still_ok(tmp_path):
    assert chk(make(), st(hot_wallet_value_usd=30.0), tmp_path)["size_usd"] == 1.0


# ---- other BUY caps -------------------------------------------------------------------------------------------

@pytest.mark.parametrize("kw,mcap,mayhem,code", [
    ({}, 29_999.0, False, "mcap_below_min_or_unknown"),
    ({}, None, False, "mcap_below_min_or_unknown"),
    ({}, 45000.0, None, "mayhem_or_unknown"),
    ({}, 45000.0, True, "mayhem_or_unknown"),
    ({"daily_pnl_usd": -10.0}, 45000.0, False, "daily_loss_stop"),
    ({"open_positions": {MINT: {"notional_usd": 1}}}, 45000.0, False, "duplicate_open_mint"),
    ({"open_positions": {f"m{i}": {"notional_usd": 1} for i in range(5)}}, 45000.0, False, "max_open_positions"),
    ({"entries_ts": [900.0, 950.0, 990.0]}, 45000.0, False, "rate_5min"),
    ({"last_sell_ts": {MINT: 700.0}}, 45000.0, False, "rebuy_cooldown"),
    ({"deny_mints": {MINT}}, 45000.0, False, "mint_denied"),
    ({"last_heartbeat_ts": 0.0}, 45000.0, False, "producer_heartbeat_stale"),
])
def test_buy_caps(tmp_path, kw, mcap, mayhem, code):
    with pytest.raises(C.CapRejected) as e:
        chk(make(), st(**kw), tmp_path, mcap=mcap, mayhem=mayhem)
    assert e.value.code == code


def test_signal_risk_gates(tmp_path):
    for risk, code in [({"score": 90, "decision": "SKIP", "mayhem": False, "quality": "CLEAR"}, "risk_skip"),
                       ({"score": 30, "decision": "NORMAL", "mayhem": False, "quality": "UNKNOWN"}, "quality_not_clear"),
                       ({"score": 30, "decision": "NORMAL", "mayhem": None, "quality": "CLEAR"}, "mayhem_or_unknown")]:
        with pytest.raises(C.CapRejected) as e:
            chk(make(risk=risk), st(), tmp_path)
        assert e.value.code == code


@pytest.mark.parametrize("chain_time", [None, NOW_S - 11, NOW_S + 11])
def test_clock_skew_blocks(tmp_path, chain_time):
    with pytest.raises(C.CapRejected) as e:
        chk(make(), st(), tmp_path, chain_time=chain_time)
    assert e.value.code == "clock_skew_or_chain_time_unknown"


def test_sell_allowed_during_daily_stop_breaker_and_stale_heartbeat(tmp_path):
    b = Breaker(deposit_basis_usd=100.0)
    b._trip("test")
    state = st(daily_pnl_usd=-50.0, hot_wallet_value_usd=99.0, last_heartbeat_ts=0.0,
               open_positions={MINT: {"notional_usd": 1}})
    out = chk(make(side="SELL", size={"fraction_bps": 2000}, max_slippage_bps=4000), state, tmp_path, mcap=None, breaker=b)
    assert out == {"fraction_bps": 2000, "slippage_bps": 2500}
    with pytest.raises(C.CapRejected) as e:
        chk(make(mint="11111111111111111111111111111111"), st(), tmp_path, breaker=b)
    assert e.value.code == "circuit_breaker_tripped"


def test_sell_requires_position(tmp_path):
    with pytest.raises(C.CapRejected) as e:
        chk(make(side="SELL", size={"fraction_bps": 10000}), st(), tmp_path)
    assert e.value.code == "sell_without_position"


# ---- UNKNOWN outcomes in caps ---------------------------------------------------------------------------------

def test_unknown_buy_blocks_same_mint_buy_and_sell(tmp_path):
    state = st(pending={"sigX": pend()})
    with pytest.raises(C.CapRejected) as e:
        chk(make(), state, tmp_path)
    assert e.value.code == "unknown_outcome_pending"
    state.open_positions[MINT] = {"notional_usd": 1}
    with pytest.raises(C.CapRejected) as e:
        chk(make(side="SELL", size={"fraction_bps": 10000}), state, tmp_path)
    assert e.value.code == "unknown_outcome_pending"


def test_unknown_buy_counts_as_open_at_max_exposure(tmp_path):
    other = [f"M{i}" for i in range(4)]
    state = st(pending={f"s{i}": pend(mint=m) for i, m in enumerate(other)},
               open_positions={"OPEN1": {"notional_usd": 1}})
    with pytest.raises(C.CapRejected) as e:      # 1 open + 4 UNKNOWN = 5 = max_open
        chk(make(), state, tmp_path)
    assert e.value.code == "max_open_positions"


def test_resolved_pending_no_longer_blocks(tmp_path):
    state = st(pending={"sigX": pend(status="EXPIRED_NOT_LANDED")})
    assert chk(make(), state, tmp_path)["size_usd"] == 1.0
