import pytest

from executor_design.breaker import Breaker, BreakerConfig
from executor_design.outcomes import Pending, may_submit_new_intent, resolve


def br():
    return Breaker(deposit_basis_usd=100.0)


def test_consecutive_losses_trip_and_win_resets_counter():
    b = br()
    for p in (-1, -1, -1):
        b.record_trade_closed(p)
    assert not b.tripped
    b.record_trade_closed(+0.5)
    assert b.consecutive_losses == 0
    for _ in range(4):
        b.record_trade_closed(-0.2)
    assert b.tripped and "consecutive_losses" in b.reason


def test_exec_errors_trip():
    b = br()
    b.record_exec_result(False, "simulate"); b.record_exec_result(False, "send")
    assert not b.tripped
    b.record_exec_result(False, "inspector")
    assert b.tripped and "exec_errors" in b.reason


def test_rpc_health_trips():
    b = br()
    for _ in range(3):
        b.record_rpc_health(False)
    assert b.tripped and "rpc_unhealthy" in b.reason


def test_drawdown_trips_at_20pct_of_deposit():
    b = br()
    b.record_equity(100.0); b.record_equity(110.0); b.record_equity(90.5)
    assert not b.tripped
    b.record_equity(90.0)
    assert b.tripped and "drawdown" in b.reason


def test_missing_deposit_basis_trips():
    b = Breaker(deposit_basis_usd=None)
    b.record_equity(10.0)
    assert b.tripped and b.reason == "deposit_basis_unset"


def test_trip_is_sticky_and_needs_manual_owner_reset(tmp_path):
    b = br()
    for _ in range(3):
        b.record_rpc_health(False)
    b.record_rpc_health(True); b.record_exec_result(True); b.record_trade_closed(5.0)   # recovery does NOT auto-clear
    assert b.tripped
    with pytest.raises(PermissionError):
        b.reset(confirm="yes", actor="owner")
    with pytest.raises(PermissionError):
        b.reset(confirm="RESET", actor="llm")
    p = tmp_path / "breaker.json"
    b.save(p)
    b2 = Breaker.load(p)
    assert b2.tripped and isinstance(b2.cfg, BreakerConfig)        # survives restart
    b2.reset(confirm="RESET", actor="owner")
    assert not b2.tripped and b2.history[-1]["event"] == "reset"


# ---- UNKNOWN outcome resolution -------------------------------------------------------------------------------

def P():
    return Pending("sig1", "sid1", "MINT", "BUY", 1.0, last_valid_block_height=1000)


def test_not_found_before_expiry_stays_unknown_and_no_resend():
    p = P()
    assert resolve(p, sig_status=None, current_block_height=999, balance_delta_seen=False) == "UNKNOWN"
    assert not may_submit_new_intent(p)


def test_processed_stays_unknown():
    assert resolve(P(), sig_status="processed", current_block_height=1001, balance_delta_seen=True) == "UNKNOWN"


def test_confirmed_with_balances_is_confirmed():
    p = P()
    assert resolve(p, sig_status="finalized", current_block_height=1001, balance_delta_seen=True) == "CONFIRMED"
    assert not may_submit_new_intent(p)


def test_confirmed_but_balance_mismatch_stays_unknown():
    assert resolve(P(), sig_status="confirmed", current_block_height=1001, balance_delta_seen=False) == "UNKNOWN"


def test_expired_and_no_balance_change_is_not_landed():
    p = P()
    assert resolve(p, sig_status=None, current_block_height=1001, balance_delta_seen=False) == "EXPIRED_NOT_LANDED"
    assert may_submit_new_intent(p)


def test_expired_but_balances_unreadable_or_changed_stays_unknown():
    assert resolve(P(), sig_status=None, current_block_height=1001, balance_delta_seen=None) == "UNKNOWN"
    assert resolve(P(), sig_status=None, current_block_height=1001, balance_delta_seen=True) == "UNKNOWN"
    assert resolve(P(), sig_status=None, current_block_height=None, balance_delta_seen=False) == "UNKNOWN"


def test_failed_status():
    p = P()
    assert resolve(p, sig_status="failed", current_block_height=1001, balance_delta_seen=False) == "FAILED"
    assert may_submit_new_intent(p)
    assert resolve(P(), sig_status="failed", current_block_height=1001, balance_delta_seen=True) == "UNKNOWN"
