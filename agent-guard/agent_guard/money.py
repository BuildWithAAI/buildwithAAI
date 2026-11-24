"""HARD BLOCK on withdrawals / transfers / any off-exchange money movement.

Wrap every function that could move funds off an exchange or out of a wallet:

    from agent_guard.money import money_movement

    @money_movement("withdraw")
    def withdraw(asset, amount, address, *, agent, approval_id=None): ...

or call guard_money_movement(...) directly before the side effect. With no matching single-use
human approval token the call raises MoneyMovementBlocked and nothing runs. The kill switch
blocks it even with a token.
"""
from __future__ import annotations

import functools
import inspect

from . import approvals, audit_log, config, killswitch
from .errors import ApprovalRequired, MoneyMovementBlocked

ACTIONS = {"withdraw", "transfer", "internal_transfer", "send_onchain", "bridge", "approve_spender",
           "sub_account_transfer", "wire", "ach", "close_account", "change_withdraw_address"}


def guard_money_movement(*, agent: str, action: str, asset: str, amount: float, destination: str,
                         approval_id: str | None = None) -> dict:
    data = {"action": action, "asset": asset, "amount": amount, "destination": destination, "approval_id": approval_id}
    try:
        killswitch.require_not_engaged(agent, f"{action} {amount} {asset}")
    except Exception as e:
        raise MoneyMovementBlocked(str(e)) from e
    if action not in ACTIONS:
        audit_log.append("money_movement_blocked", agent, {**data, "reason": "unknown action"}, "denied")
        raise MoneyMovementBlocked(f"unknown money-movement action {action!r}")
    try:
        allowed = (config.load().get("money_movement") or {}).get("allowed_destinations") or []
    except Exception as e:  # noqa: BLE001
        raise MoneyMovementBlocked(f"config unreadable: {e}") from e
    if allowed and destination not in allowed:
        audit_log.append("money_movement_blocked", agent, {**data, "reason": "destination not allowlisted"}, "denied")
        raise MoneyMovementBlocked(f"destination {destination!r} not in money_movement.allowed_destinations")
    if not approval_id:
        audit_log.append("money_movement_blocked", agent, {**data, "reason": "no human approval token"}, "denied")
        raise MoneyMovementBlocked(f"{action} is blocked for agents: needs a human approval token "
                                   f"(agent-guard approve --agent {agent} --action {action} ...)")
    try:
        approvals.consume(approval_id, agent=agent, action=action, asset=asset, amount=amount, destination=destination)
    except ApprovalRequired as e:
        raise MoneyMovementBlocked(str(e)) from e
    audit_log.append("money_movement_approved", agent, data)
    return {"allowed": True}


def money_movement(action: str):
    """Decorator. The wrapped function must accept keyword args agent, asset, amount, and one of
    destination/address/to; approval_id is optional (missing => blocked)."""
    def deco(fn):
        sig = inspect.signature(fn)

        @functools.wraps(fn)
        def wrapper(*args, **kwargs):
            b = sig.bind_partial(*args, **kwargs)
            a = b.arguments
            dest = a.get("destination") or a.get("address") or a.get("to")
            guard_money_movement(agent=str(a.get("agent", "unknown")), action=action, asset=str(a.get("asset")),
                                 amount=float(a.get("amount") or 0), destination=str(dest),
                                 approval_id=a.get("approval_id"))
            return fn(*args, **kwargs)
        wrapper.__agent_guard__ = action
        return wrapper
    return deco
