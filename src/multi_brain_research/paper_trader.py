"""Paper positions opened from theses. Prices are the caller's observed marks.

`single_target` keeps the thesis stop and target. Slippage for that policy is
an explicit assumption from observed liquidity, because these snapshots have
no bid/ask. `ladder_e` is the default for a new position: sell 50% at 2x the
entry mark, 25% at 4x, and the last 25% on a trail from the running high.
Costs on that policy are a 1% fee and 0.5% slippage on the buy and on each
sell. Nothing is sent.
"""
from __future__ import annotations

import copy
import json
from pathlib import Path

from .pool_ohlcv import WIDTH_MS, candles_in_window
from .thesis import ThesisError, validate_thesis

SLIP_NUMERATOR_USD = 50_000.0
SLIP_MIN_BPS = 5
SLIP_MAX_BPS = 300
FEE_RATE = 0.01
SLIPPAGE_RATE = 0.005
STOP_MULTIPLE = 0.5
LADDER_HORIZON_MS = 48 * 60 * 60 * 1000
INSTANT_TRAIL_PCT = 0.20
STANDARD_TRAIL_PCT = 0.40
FILL_MODEL_LADDER = "FEE_1PCT_SLIP_0_5PCT"
FILL_MODEL_SINGLE = "ASSUMED_FROM_OBSERVED_LIQUIDITY"
_LADDER_RUNGS = ((2.0, 0.50), (4.0, 0.25))
_POSITION_SKIP = frozenset({"type", "action", "execution_allowed", "live_orders", "replayed", "status"})


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


def _buy_fill(mark: float) -> float:
    return mark * (1 + SLIPPAGE_RATE) * (1 + FEE_RATE)


def _sell_fill(raw: float) -> float:
    return raw * (1 - SLIPPAGE_RATE) * (1 - FEE_RATE)


def modeled_cost_pnl(entry_mark: float, exit_raw: float, notional: float) -> float:
    """Round-trip pnl after the 1% fee and 0.5% slippage on both sides."""
    buy = _buy_fill(entry_mark)
    quantity = notional / buy
    return (_sell_fill(exit_raw) - buy) * quantity


def _leg_pnl(entry_fill: float, raw: float, quantity: float, fraction: float) -> float:
    return (_sell_fill(raw) - entry_fill) * quantity * fraction


def _trail_for(instant_graduation) -> tuple[float, str]:
    if instant_graduation is True:
        return INSTANT_TRAIL_PCT, "INSTANT"
    if instant_graduation is False:
        return STANDARD_TRAIL_PCT, "STANDARD"
    return STANDARD_TRAIL_PCT, "NOT_OBSERVED"


def _ladder_levels() -> list[dict]:
    return [
        {"multiple": multiple, "fraction": fraction, "filled_at": None, "fill_price": None}
        for multiple, fraction in _LADDER_RUNGS
    ]


def _first_rung_filled(position: dict) -> bool:
    levels = position.get("tp_levels") or []
    return bool(levels) and levels[0].get("filled_at") is not None


def _trail_stop(position: dict):
    if not _first_rung_filled(position):
        return None
    high = position.get("running_high")
    trail = position.get("trail_pct")
    if type(high) not in (int, float) or isinstance(high, bool) or type(trail) not in (int, float) or isinstance(trail, bool):
        return None
    return high * (1 - trail)


def state(path: Path) -> dict:
    open_positions = {}
    closed = []
    for event in _events(path):
        kind = event.get("type")
        thesis_id = event.get("thesis_id")
        if kind == "OPEN":
            open_positions[thesis_id] = dict(event)
        elif kind in ("PARTIAL", "UPDATE") and thesis_id in open_positions:
            current = open_positions[thesis_id]
            for key, value in event.items():
                if key in _POSITION_SKIP:
                    continue
                current[key] = value
            current["type"] = "OPEN"
        elif kind == "CLOSE":
            open_positions.pop(thesis_id, None)
            closed.append(event)
    return {"open": open_positions, "closed": closed}


def open_position(path: Path, thesis: dict, *, mark_price_usd: float, now_ms: int, notional_usd: float, exit_policy: str = "ladder_e", instant_graduation=None) -> dict:
    try:
        validate_thesis(thesis)
    except ThesisError as error:
        raise PaperError(str(error)) from error
    if type(mark_price_usd) is bool or type(mark_price_usd) not in (int, float) or mark_price_usd <= 0:
        raise PaperError("NO_PRICE")
    if type(now_ms) is not int or type(notional_usd) is bool or type(notional_usd) not in (int, float) or notional_usd <= 0:
        raise PaperError("BAD_SIZE")
    if exit_policy not in ("ladder_e", "single_target"):
        raise PaperError("EXIT_POLICY")
    if instant_graduation is not None and type(instant_graduation) is not bool:
        raise PaperError("GRADUATION_FLAG")
    proposal = thesis["proposal"]
    if proposal.get("stop_price_usd") is None or proposal.get("take_profit_price_usd") is None:
        raise PaperError("THESIS_HAS_NO_LEVELS")
    book = state(path)
    if thesis["thesis_id"] in book["open"] or any(row["thesis_id"] == thesis["thesis_id"] for row in book["closed"]):
        return {"replayed": True, "thesis_id": thesis["thesis_id"], "action": "NO_EXECUTION", "execution_allowed": False}
    liquidity = thesis["observed"].get("liquidity_usd")
    pair_address = (thesis.get("pair") or {}).get("pair_address") if type(thesis.get("pair")) is dict else None
    if exit_policy == "ladder_e":
        trail_pct, graduation = _trail_for(instant_graduation)
        entry_fill = _buy_fill(mark_price_usd)
        quantity = notional_usd / entry_fill
        stop_fill = _sell_fill(mark_price_usd * STOP_MULTIPLE)
        planned_risk = (entry_fill - stop_fill) * quantity
        if planned_risk <= 0:
            raise PaperError("NON_POSITIVE_RISK")
        return _append(path, {
            "type": "OPEN",
            "exit_policy": "ladder_e",
            "fill_model": FILL_MODEL_LADDER,
            "fee_rate": FEE_RATE,
            "slippage_rate": SLIPPAGE_RATE,
            "thesis_id": thesis["thesis_id"],
            "mint": thesis["mint"],
            "opened_ms": now_ms,
            "last_mark_ms": now_ms,
            "horizon_ms": LADDER_HORIZON_MS,
            "mark_price_usd": mark_price_usd,
            "entry_price_usd": mark_price_usd,
            "entry_fill_usd": entry_fill,
            "quantity": quantity,
            "notional_usd": notional_usd,
            "stop_price_usd": proposal["stop_price_usd"],
            "take_profit_price_usd": proposal["take_profit_price_usd"],
            "tp_levels": _ladder_levels(),
            "trail_pct": trail_pct,
            "stop_multiple": STOP_MULTIPLE,
            "running_high": mark_price_usd,
            "trail_stop_usd": None,
            "realized_partial_pnl_usd": 0.0,
            "remaining_fraction": 1.0,
            "graduation": graduation,
            "instant_graduation": instant_graduation,
            "liquidity_usd": liquidity,
            "planned_risk_usd": planned_risk,
            "brains": thesis["brains"],
            "pair_address": pair_address,
            "replayed": False,
            "action": "NO_EXECUTION",
            "execution_allowed": False,
            "live_orders": False,
        })
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
        "exit_policy": "single_target",
        "fill_model": FILL_MODEL_SINGLE,
        "thesis_id": thesis["thesis_id"],
        "mint": thesis["mint"],
        "opened_ms": now_ms,
        "horizon_ms": thesis["horizon_ms"],
        "mark_price_usd": mark_price_usd,
        "entry_price_usd": mark_price_usd,
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
        "pair_address": pair_address,
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


def _reached(price: float, level: float) -> bool:
    return price >= level * (1 - 1e-12)


def _voters(position: dict) -> list[str]:
    return [
        name for name, brain in position["brains"].items()
        if type(brain) is dict and brain.get("shadow") is not True and brain.get("role") != "TEST_FIXTURE"
        and brain.get("role") != "SHADOW" and brain.get("council_member") is not False
        and type(brain.get("paper_long_support_ppm")) is int
    ]


def _attribution(position: dict, pnl: float) -> dict:
    voters = _voters(position)
    share = pnl / len(voters) if voters else 0.0
    return {name: share if name in voters else 0.0 for name in position["brains"]}


def _paper(event: dict) -> dict:
    event.update(action="NO_EXECUTION", execution_allowed=False, live_orders=False)
    return event


def _ladder_bar(position: dict, low: float, high: float, filled_at: int) -> tuple[str | None, float | None, list[dict]]:
    """Apply one bar. The low is checked before the high can raise the trail."""
    entry = position["entry_price_usd"]
    partials = []
    if not _first_rung_filled(position):
        stop_px = entry * position["stop_multiple"]
        if low <= stop_px:
            return "STOP", stop_px, partials
    else:
        trail_px = position["running_high"] * (1 - position["trail_pct"])
        if low <= trail_px:
            return "TRAIL", trail_px, partials
    for level in position["tp_levels"]:
        if level.get("filled_at") is not None:
            continue
        rung = entry * level["multiple"]
        if not _reached(high, rung):
            continue
        level["filled_at"] = filled_at
        level["fill_price"] = rung
        pnl = _leg_pnl(position["entry_fill_usd"], rung, position["quantity"], level["fraction"])
        position["realized_partial_pnl_usd"] = position.get("realized_partial_pnl_usd", 0.0) + pnl
        position["remaining_fraction"] = position["remaining_fraction"] - level["fraction"]
        partials.append({
            "multiple": level["multiple"],
            "fraction": level["fraction"],
            "filled_at": filled_at,
            "fill_price": rung,
            "exit_fill_usd": _sell_fill(rung),
            "partial_pnl_usd": pnl,
        })
    if high > position["running_high"]:
        position["running_high"] = high
    position["trail_stop_usd"] = _trail_stop(position)
    return None, None, partials


def _ladder_steps(position: dict, mark_price_usd: float, now_ms: int, candles):
    last = position.get("last_mark_ms", position["opened_ms"])
    if candles is not None:
        if type(candles) is not list:
            raise PaperError("BAD_CANDLES")
        window = [
            candle for candle in candles_in_window(candles, position["opened_ms"], now_ms, width_ms=WIDTH_MS)
            if candle["ts_ms"] >= last
        ]
        if window:
            return [
                (candle["low"], candle["high"], candle["ts_ms"], "MINUTE_CANDLE", candle)
                for candle in window
            ], len(window)
    return [(mark_price_usd, mark_price_usd, now_ms, "SNAPSHOT_MARK", None)], None


def _snapshot(position: dict, *, kind: str, now_ms: int, price_path: str, candles_in) -> dict:
    body = {
        "type": kind,
        "status": "OPEN" if kind != "CLOSE" else "CLOSED",
        "exit_policy": "ladder_e",
        "fill_model": FILL_MODEL_LADDER,
        "fee_rate": FEE_RATE,
        "slippage_rate": SLIPPAGE_RATE,
        "thesis_id": position["thesis_id"],
        "mint": position["mint"],
        "opened_ms": position["opened_ms"],
        "last_mark_ms": position["last_mark_ms"],
        "horizon_ms": position["horizon_ms"],
        "entry_price_usd": position["entry_price_usd"],
        "entry_fill_usd": position["entry_fill_usd"],
        "quantity": position["quantity"],
        "notional_usd": position["notional_usd"],
        "tp_levels": position["tp_levels"],
        "trail_pct": position["trail_pct"],
        "stop_multiple": position["stop_multiple"],
        "running_high": position["running_high"],
        "trail_stop_usd": position.get("trail_stop_usd"),
        "realized_partial_pnl_usd": position["realized_partial_pnl_usd"],
        "remaining_fraction": position["remaining_fraction"],
        "graduation": position["graduation"],
        "price_path": price_path,
        "mark_price_usd": position.get("mark_price_usd"),
        "candles_in_window": candles_in,
        "planned_risk_usd": position["planned_risk_usd"],
        "pair_address": position.get("pair_address"),
    }
    if kind != "CLOSE":
        body["mark_ms"] = now_ms
    return _paper(body)


def _mark_ladder(path: Path, position: dict, mark_price_usd: float, now_ms: int, candles) -> dict:
    last = position.get("last_mark_ms", position["opened_ms"])
    if last > now_ms:
        raise PaperError("MARK_BEFORE_LAST")
    if last >= now_ms and now_ms != position["opened_ms"]:
        return {"type": "MARK", "thesis_id": position["thesis_id"], "status": "OPEN", "action": "NO_EXECUTION", "execution_allowed": False, "live_orders": False}
    working = copy.deepcopy(position)
    steps, candles_in = _ladder_steps(working, mark_price_usd, now_ms, candles)
    price_path = steps[-1][3]
    exit_reason = None
    exit_raw = None
    exit_at = now_ms
    for low, high, stamp, source, _candle in steps:
        reason, raw, partials = _ladder_bar(working, low, high, stamp)
        for partial in partials:
            event = _snapshot(working, kind="PARTIAL", now_ms=stamp, price_path=source, candles_in=candles_in)
            event.update(partial)
            _append(path, event)
        if reason is not None:
            exit_reason, exit_raw, exit_at, price_path = reason, raw, stamp, source
            break
        working["last_mark_ms"] = stamp + (WIDTH_MS if source == "MINUTE_CANDLE" else 0)
        if source == "SNAPSHOT_MARK":
            working["last_mark_ms"] = now_ms
    if exit_reason is None and now_ms >= working["opened_ms"] + working["horizon_ms"]:
        exit_reason, exit_raw, exit_at = "TIMEOUT", mark_price_usd, now_ms
        if candles is not None and candles_in:
            price_path = "MINUTE_CANDLE"
        else:
            price_path = "SNAPSHOT_MARK"
    if exit_reason is None:
        if working["last_mark_ms"] < now_ms and (candles is None or not candles_in):
            working["last_mark_ms"] = now_ms
        elif working["last_mark_ms"] < now_ms and candles_in:
            working["last_mark_ms"] = now_ms
        event = _snapshot(working, kind="UPDATE", now_ms=now_ms, price_path=price_path, candles_in=candles_in)
        return _append(path, event)
    final_pnl = _leg_pnl(working["entry_fill_usd"], exit_raw, working["quantity"], working["remaining_fraction"])
    realized = working["realized_partial_pnl_usd"]
    total = realized + final_pnl
    working["remaining_fraction"] = 0.0
    working["last_mark_ms"] = now_ms
    event = _snapshot(working, kind="CLOSE", now_ms=now_ms, price_path=price_path, candles_in=candles_in)
    event.update({
        "closed_ms": exit_at,
        "reason": exit_reason,
        "path": price_path,
        "exit_raw_usd": exit_raw,
        "exit_fill_usd": _sell_fill(exit_raw),
        "final_leg_pnl_usd": final_pnl,
        "realized_partial_pnl_usd": realized,
        "pnl_usd": total,
        "pnl_after_costs_usd": total,
        "r_multiple": total / working["planned_risk_usd"],
        "attribution_usd": _attribution(working, total),
        "fees": "APPLIED",
        "mark_price_usd": mark_price_usd,
    })
    return _append(path, event)


def mark(path: Path, thesis_id: str, *, mark_price_usd: float, now_ms: int, candles=None) -> dict:
    if type(mark_price_usd) is bool or type(mark_price_usd) not in (int, float) or mark_price_usd <= 0 or type(now_ms) is not int:
        raise PaperError("NO_PRICE")
    position = state(path)["open"].get(thesis_id)
    if position is None:
        raise PaperError("NO_OPEN_POSITION")
    if position.get("exit_policy") == "ladder_e":
        return _mark_ladder(path, position, mark_price_usd, now_ms, candles)
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
    attribution = _attribution(position, pnl)
    price_path = "MINUTE_CANDLE" if candles is not None and candles_in else "SNAPSHOT_MARK"
    return _append(path, {
        "type": "CLOSE",
        "exit_policy": position.get("exit_policy") or "single_target",
        "fill_model": position.get("fill_model") or FILL_MODEL_SINGLE,
        "price_path": price_path,
        "thesis_id": thesis_id,
        "mint": position["mint"],
        "closed_ms": now_ms if candle is None else candle["ts_ms"],
        "reason": reason,
        "path": path_name,
        "mark_price_usd": mark_price_usd,
        "entry_price_usd": position.get("entry_price_usd", position.get("mark_price_usd")),
        "candles_in_window": candles_in,
        "candle_ts_ms": None if candle is None else candle["ts_ms"],
        "candle_high": None if candle is None else candle["high"],
        "candle_low": None if candle is None else candle["low"],
        "exit_raw_usd": raw,
        "exit_fill_usd": exit_fill,
        "pnl_usd": pnl,
        "pnl_after_costs_usd": modeled_cost_pnl(position.get("entry_price_usd", position["mark_price_usd"]), raw, position["notional_usd"]),
        "r_multiple": r_multiple,
        "attribution_usd": attribution,
        "fees": "NOT_OBSERVED",
        "action": "NO_EXECUTION",
        "execution_allowed": False,
        "live_orders": False,
    })


def _cost_stats(values: list[float]) -> dict:
    wins = [value for value in values if value > 0]
    losses = [value for value in values if value < 0]
    avg_win = None if not wins else sum(wins) / len(wins)
    avg_loss = None if not losses else sum(losses) / len(losses)
    pl_ratio = None
    if avg_win is not None and avg_loss not in (None, 0):
        pl_ratio = avg_win / abs(avg_loss)
    profit_factor = None
    if losses:
        profit_factor = sum(wins) / abs(sum(losses))
    return {
        "win_rate_after_costs": None if not values else len(wins) / len(values),
        "avg_win": avg_win,
        "avg_loss": avg_loss,
        "pl_ratio": pl_ratio,
        "profit_factor": profit_factor,
        "pnl_after_costs": None if not values else sum(values),
    }


def metrics(path: Path) -> dict:
    closed = state(path)["closed"]
    equity = peak = max_drawdown = 0.0
    wins = 0
    r_values = []
    attribution = {}
    after_costs = []
    for row in closed:
        pnl = row["pnl_usd"]
        equity += pnl
        peak = max(peak, equity)
        max_drawdown = max(max_drawdown, peak - equity)
        if pnl > 0:
            wins += 1
        if type(row.get("r_multiple")) in (int, float) and not isinstance(row.get("r_multiple"), bool):
            r_values.append(row["r_multiple"])
        cost = row.get("pnl_after_costs_usd")
        if type(cost) in (int, float) and not isinstance(cost, bool):
            after_costs.append(cost)
        for name, share in (row.get("attribution_usd") or {}).items():
            attribution[name] = attribution.get(name, 0.0) + share
    count = len(closed)
    stats = _cost_stats(after_costs) if len(after_costs) == count else {
        "win_rate_after_costs": None,
        "avg_win": None,
        "avg_loss": None,
        "pl_ratio": None,
        "profit_factor": None,
        "pnl_after_costs": None,
    }
    return {
        "closed": count,
        "open": len(state(path)["open"]),
        "win_rate": None if count == 0 else wins / count,
        "avg_r": None if not r_values else sum(r_values) / len(r_values),
        "max_drawdown_usd": max_drawdown,
        "net_pnl_usd": equity,
        "attribution_usd": attribution,
        **stats,
        "mode": "PAPER",
        "action": "NO_EXECUTION",
        "execution_allowed": False,
        "live_orders": False,
    }
