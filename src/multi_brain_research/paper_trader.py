"""Paper positions opened from theses. Prices are the caller's observed marks.

Slippage is an explicit assumption derived from observed liquidity because
these snapshots have no bid/ask. Stops and targets come from the thesis.
Nothing is sent.
"""
from __future__ import annotations

import json
from pathlib import Path

from .thesis import ThesisError, validate_thesis

SLIP_NUMERATOR_USD = 50_000.0
SLIP_MIN_BPS = 5
SLIP_MAX_BPS = 300


class PaperError(ValueError):
    pass


def assumed_slippage_bps(liquidity_usd: float) -> int:
    if type(liquidity_usd) is bool or type(liquidity_usd) not in (int, float) or liquidity_usd <= 0:
        raise PaperError("SLIPPAGE_REQUIRES_OBSERVED_LIQUIDITY")
    raw = int(round(SLIP_NUMERATOR_USD / float(liquidity_usd)))
    return max(SLIP_MIN_BPS, min(SLIP_MAX_BPS, raw))


def _events(path: Path) -> list[dict]:
    if not path.exists() or not path.read_text().strip():
        return []
    return [json.loads(line) for line in path.read_text().splitlines() if line.strip()]


def _append(path: Path, event: dict) -> dict:
    if event.get("action") != "NO_EXECUTION" or event.get("execution_allowed") is not False:
        raise PaperError("PAPER_ONLY")
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(event, sort_keys=True) + "\n")
    return event


def state(path: Path) -> dict:
    open_positions = {}
    closed = []
    for event in _events(path):
        if event.get("type") == "OPEN":
            open_positions[event["thesis_id"]] = event
        elif event.get("type") == "CLOSE":
            open_positions.pop(event["thesis_id"], None)
            closed.append(event)
    return {"open": open_positions, "closed": closed}


def open_position(path: Path, thesis: dict, *, mark_price_usd: float, now_ms: int, notional_usd: float) -> dict:
    try:
        validate_thesis(thesis)
    except ThesisError as error:
        raise PaperError(str(error)) from error
    if type(mark_price_usd) is bool or type(mark_price_usd) not in (int, float) or mark_price_usd <= 0:
        raise PaperError("NO_PRICE")
    if type(now_ms) is not int or type(notional_usd) is bool or type(notional_usd) not in (int, float) or notional_usd <= 0:
        raise PaperError("BAD_SIZE")
    proposal = thesis["proposal"]
    if proposal.get("stop_price_usd") is None or proposal.get("take_profit_price_usd") is None:
        raise PaperError("THESIS_HAS_NO_LEVELS")
    book = state(path)
    if thesis["thesis_id"] in book["open"] or any(row["thesis_id"] == thesis["thesis_id"] for row in book["closed"]):
        return {"replayed": True, "thesis_id": thesis["thesis_id"], "action": "NO_EXECUTION", "execution_allowed": False}
    liquidity = thesis["observed"].get("liquidity_usd")
    slip_bps = assumed_slippage_bps(liquidity)
    slip = slip_bps / 10_000
    entry = mark_price_usd * (1 + slip)
    quantity = notional_usd / entry
    stop_fill = proposal["stop_price_usd"] * (1 - slip)
    planned_risk = (entry - stop_fill) * quantity
    if planned_risk <= 0:
        raise PaperError("NON_POSITIVE_RISK")
    return _append(path, {
        "type": "OPEN",
        "thesis_id": thesis["thesis_id"],
        "mint": thesis["mint"],
        "opened_ms": now_ms,
        "horizon_ms": thesis["horizon_ms"],
        "mark_price_usd": mark_price_usd,
        "entry_fill_usd": entry,
        "quantity": quantity,
        "notional_usd": notional_usd,
        "stop_price_usd": proposal["stop_price_usd"],
        "take_profit_price_usd": proposal["take_profit_price_usd"],
        "slippage_bps": slip_bps,
        "slippage": "ASSUMED_FROM_OBSERVED_LIQUIDITY",
        "slip_numerator_usd": SLIP_NUMERATOR_USD,
        "liquidity_usd": liquidity,
        "planned_risk_usd": planned_risk,
        "brains": thesis["brains"],
        "replayed": False,
        "action": "NO_EXECUTION",
        "execution_allowed": False,
        "live_orders": False,
    })


def mark(path: Path, thesis_id: str, *, mark_price_usd: float, now_ms: int) -> dict:
    if type(mark_price_usd) is bool or type(mark_price_usd) not in (int, float) or mark_price_usd <= 0 or type(now_ms) is not int:
        raise PaperError("NO_PRICE")
    position = state(path)["open"].get(thesis_id)
    if position is None:
        raise PaperError("NO_OPEN_POSITION")
    stop = position["stop_price_usd"]
    target = position["take_profit_price_usd"]
    if mark_price_usd <= stop:
        reason, raw = "STOP", stop
    elif mark_price_usd >= target:
        reason, raw = "TAKE_PROFIT", target
    elif now_ms >= position["opened_ms"] + position["horizon_ms"]:
        reason, raw = "TIMEOUT", mark_price_usd
    else:
        return {"type": "MARK", "thesis_id": thesis_id, "status": "OPEN", "action": "NO_EXECUTION", "execution_allowed": False}
    slip = position["slippage_bps"] / 10_000
    exit_fill = raw * (1 - slip)
    pnl = (exit_fill - position["entry_fill_usd"]) * position["quantity"]
    r_multiple = pnl / position["planned_risk_usd"]
    voters = [name for name, brain in position["brains"].items() if type(brain.get("paper_long_support_ppm")) is int]
    share = pnl / len(voters) if voters else 0.0
    attribution = {name: share if name in voters else 0.0 for name in position["brains"]}
    return _append(path, {
        "type": "CLOSE",
        "thesis_id": thesis_id,
        "mint": position["mint"],
        "closed_ms": now_ms,
        "reason": reason,
        "path": "STOP_FIRST_WHEN_ONE_MARK_CROSSES_BOTH" if reason == "STOP" else "SINGLE_MARK",
        "mark_price_usd": mark_price_usd,
        "exit_raw_usd": raw,
        "exit_fill_usd": exit_fill,
        "pnl_usd": pnl,
        "r_multiple": r_multiple,
        "attribution_usd": attribution,
        "fees": "NOT_OBSERVED",
        "action": "NO_EXECUTION",
        "execution_allowed": False,
        "live_orders": False,
    })


def metrics(path: Path) -> dict:
    closed = state(path)["closed"]
    equity = peak = max_drawdown = 0.0
    wins = 0
    r_values = []
    attribution = {}
    for row in closed:
        pnl = row["pnl_usd"]
        equity += pnl
        peak = max(peak, equity)
        max_drawdown = max(max_drawdown, peak - equity)
        if pnl > 0:
            wins += 1
        if type(row.get("r_multiple")) in (int, float):
            r_values.append(row["r_multiple"])
        for name, share in (row.get("attribution_usd") or {}).items():
            attribution[name] = attribution.get(name, 0.0) + share
    count = len(closed)
    return {
        "closed": count,
        "open": len(state(path)["open"]),
        "win_rate": None if count == 0 else wins / count,
        "avg_r": None if not r_values else sum(r_values) / len(r_values),
        "max_drawdown_usd": max_drawdown,
        "net_pnl_usd": equity,
        "attribution_usd": attribution,
        "mode": "PAPER",
        "action": "NO_EXECUTION",
        "execution_allowed": False,
        "live_orders": False,
    }
