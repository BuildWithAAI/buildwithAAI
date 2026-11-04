"""Paper positions opened from theses. Prices are the caller's observed marks.

Slippage is an explicit assumption derived from observed liquidity because
these snapshots have no bid/ask. Stops and targets come from the thesis.
Nothing is sent.
"""
from __future__ import annotations

import json
from pathlib import Path

from .pool_ohlcv import WIDTH_MS, candles_in_window
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
        "pair_address": (thesis.get("pair") or {}).get("pair_address") if type(thesis.get("pair")) is dict else None,
        "replayed": False,
        "action": "NO_EXECUTION",
        "execution_allowed": False,
        "live_orders": False,
    })


def _candle_exit(position: dict, candles: list, now_ms: int):
    """Stop, target, or neither, from candles that sit strictly inside the hold.

    A candle that contains both the stop and the target closes at the stop.
    Returns None while the horizon is still open and no level has printed.
    """
    window = candles_in_window(candles, position["opened_ms"], now_ms, width_ms=WIDTH_MS)
    stop = position["stop_price_usd"]
    target = position["take_profit_price_usd"]
    for candle in window:
        hit_stop = candle["low"] <= stop
        hit_target = candle["high"] >= target
        if hit_stop:
            path = "STOP_FIRST_SAME_CANDLE" if hit_target else "CANDLE_LOW"
            return "STOP", stop, path, candle, len(window)
        if hit_target:
            return "TAKE_PROFIT", target, "CANDLE_HIGH", candle, len(window)
    if now_ms >= position["opened_ms"] + position["horizon_ms"]:
        if window:
            return "TIMEOUT", None, "CANDLES_OBSERVED_NO_HIT", None, len(window)
        return "PATH_UNOBSERVED", None, "NO_CANDLE_IN_WINDOW", None, 0
    return None


def mark(path: Path, thesis_id: str, *, mark_price_usd: float, now_ms: int, candles=None) -> dict:
    if type(mark_price_usd) is bool or type(mark_price_usd) not in (int, float) or mark_price_usd <= 0 or type(now_ms) is not int:
        raise PaperError("NO_PRICE")
    position = state(path)["open"].get(thesis_id)
    if position is None:
        raise PaperError("NO_OPEN_POSITION")
    stop = position["stop_price_usd"]
    target = position["take_profit_price_usd"]
    candle = None
    candles_in = None
    if candles is not None:
        if type(candles) is not list:
            raise PaperError("BAD_CANDLES")
        decision = _candle_exit(position, candles, now_ms)
        if decision is None:
            return {"type": "MARK", "thesis_id": thesis_id, "status": "OPEN", "action": "NO_EXECUTION", "execution_allowed": False}
        reason, raw, path_name, candle, candles_in = decision
        if raw is None:
            raw = mark_price_usd
    elif mark_price_usd <= stop:
        reason, raw, path_name = "STOP", stop, "STOP_FIRST_WHEN_ONE_MARK_CROSSES_BOTH"
    elif mark_price_usd >= target:
        reason, raw, path_name = "TAKE_PROFIT", target, "SINGLE_MARK"
    elif now_ms >= position["opened_ms"] + position["horizon_ms"]:
        reason, raw, path_name = "TIMEOUT", mark_price_usd, "SINGLE_MARK"
    else:
        return {"type": "MARK", "thesis_id": thesis_id, "status": "OPEN", "action": "NO_EXECUTION", "execution_allowed": False}
    slip = position["slippage_bps"] / 10_000
    exit_fill = raw * (1 - slip)
    pnl = (exit_fill - position["entry_fill_usd"]) * position["quantity"]
    r_multiple = pnl / position["planned_risk_usd"]
    voters = [
        name for name, brain in position["brains"].items()
        if type(brain) is dict and brain.get("shadow") is not True and brain.get("role") != "TEST_FIXTURE"
        and brain.get("role") != "SHADOW" and brain.get("council_member") is not False
        and type(brain.get("paper_long_support_ppm")) is int
    ]
    share = pnl / len(voters) if voters else 0.0
    attribution = {name: share if name in voters else 0.0 for name in position["brains"]}
    return _append(path, {
        "type": "CLOSE",
        "thesis_id": thesis_id,
        "mint": position["mint"],
        "closed_ms": now_ms if candle is None else candle["ts_ms"],
        "reason": reason,
        "path": path_name,
        "mark_price_usd": mark_price_usd,
        "candles_in_window": candles_in,
        "candle_ts_ms": None if candle is None else candle["ts_ms"],
        "candle_high": None if candle is None else candle["high"],
        "candle_low": None if candle is None else candle["low"],
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
