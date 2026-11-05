"""Walk-forward paper book. Crow memory is filled only from earlier snapshots.

The holdout starts at the first snapshot after the longest gap in the store.
A memory row is written only after its later price has been observed, and
only when that outcome window ends before the holdout. Recall applies the
same gate again. The causal window matches the box runner that produced the
five closed paper trades: a 12-minute break starts a new tail, the tail keeps
48 points, and FlyVis abstains until the tail has three points.

No order is built, signed, or sent.
"""
from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

from .brain_input import features as tape_features
from .crow_brain import remember
from .giant_brain import _prepare, fuse
from .paper_trader import metrics, state
from .snapshot_feed import (
    canonical_pairs,
    load_snapshot,
    observation_from_pair,
    parse_time_ms,
    resolve_root,
    snapshot_files,
)
from .watch import replay

HISTORY_POINTS = 48
MAX_GAP_MS = 12 * 60_000
MIN_FLY_HISTORY = 3
_FEATURE_NAMES = ("signed_return", "flow_imbalance", "liquidity_change")


def _iso(ms: int) -> str:
    return datetime.fromtimestamp(ms / 1000, timezone.utc).isoformat()


def _stamped(root: Path) -> list[dict]:
    stamped = []
    for relative in snapshot_files(root):
        rows = list(canonical_pairs(load_snapshot(root, relative)).values())
        times = [row.get("ts") or row.get("fetched_at") for row in rows]
        times = [value for value in times if type(value) is str]
        if not times:
            continue
        stamp = min(times)
        stamped.append({"file": relative, "ms": parse_time_ms(stamp), "ts": stamp, "rows": rows})
    return stamped


def _holdout(stamped: list[dict]) -> dict:
    if len(stamped) < 2:
        raise ValueError("NO_HOLDOUT")
    chosen = None
    for index in range(len(stamped) - 1):
        gap = stamped[index + 1]["ms"] - stamped[index]["ms"]
        if chosen is None or gap > chosen["gap_ms"]:
            chosen = {"gap_ms": gap, "fill_through": stamped[index], "holdout": stamped[index + 1]}
    return chosen


def load_series(root: Path, files: list[str]) -> dict[str, list[dict]]:
    series: dict[str, list[dict]] = {}
    allowed = set(files)
    for item in _stamped(root):
        if item["file"] not in allowed:
            continue
        for row in item["rows"]:
            price = row.get("price_usd")
            stamp = row.get("ts") or row.get("fetched_at")
            mint = row.get("token_address")
            if type(mint) is not str or type(stamp) is not str:
                continue
            if type(price) is bool or type(price) not in (int, float) or not price > 0:
                continue
            series.setdefault(mint, []).append({
                "ts": stamp,
                "ts_ms": parse_time_ms(stamp),
                "price_usd": float(price),
                "buys_h1": row.get("buys_h1"),
                "sells_h1": row.get("sells_h1"),
                "liquidity_usd": row.get("liquidity_usd"),
                "record": row,
            })
    for points in series.values():
        points.sort(key=lambda item: item["ts_ms"])
    return series


def causal_tail(points: list[dict], now_ms: int) -> list[dict]:
    hist = [point for point in points if point["ts_ms"] <= now_ms]
    tail = []
    for point in reversed(hist):
        if tail and tail[-1]["ts_ms"] - point["ts_ms"] > MAX_GAP_MS:
            break
        tail.append(point)
    tail.reverse()
    if len(tail) > HISTORY_POINTS:
        return tail[-HISTORY_POINTS:]
    return tail


def enrich(observation: dict, hist: list[dict]) -> dict:
    """Use the contiguous tail as the prior.

    A missing previous price stays missing. The hemibrain episode uses 1.0
    quote atoms when liquidity is absent, the same fallback as `_episode`.
    """
    obs = dict(observation)
    obs["previous_price"] = None
    obs["previous_liquidity_usd"] = None
    if len(hist) >= 2:
        previous = hist[-2]
        obs["previous_price"] = previous["price_usd"]
        liquidity = previous.get("liquidity_usd")
        if type(liquidity) in (int, float) and not isinstance(liquidity, bool):
            obs["previous_liquidity_usd"] = liquidity
    fly = hist if len(hist) >= MIN_FLY_HISTORY else (hist[-1:] if hist else [])
    obs["fly_history"] = [
        {
            "price_usd": point.get("price_usd"),
            "buys_h1": point.get("buys_h1"),
            "sells_h1": point.get("sells_h1"),
            "liquidity_usd": point.get("liquidity_usd"),
        }
        for point in fly
    ]
    episode = []
    for point in hist:
        buys, sells = point.get("buys_h1"), point.get("sells_h1")
        if type(buys) in (int, float) and type(sells) in (int, float) and not isinstance(buys, bool) and not isinstance(sells, bool):
            flow = float(buys - sells)
        else:
            flow = 0.0
        liquidity = point.get("liquidity_usd")
        quote = liquidity if type(liquidity) in (int, float) and not isinstance(liquidity, bool) and liquidity else 1.0
        episode.append({
            "last_trade_price": point["price_usd"],
            "quote_atoms": quote,
            "signed_quote_flow": flow,
        })
    if len(episode) >= 2:
        obs["observations"] = episode
    else:
        obs.pop("observations", None)
    return obs


def _remember_row(series: dict[str, list[dict]], row: dict, now_ms: int, memory: Path, seen: set) -> bool:
    mint = row.get("token_address")
    if type(mint) is not str:
        return False
    hist = causal_tail(series.get(mint, []), now_ms)
    if len(hist) < 3 or hist[-1]["ts_ms"] != now_ms:
        return False
    previous, current = hist[-2], hist[-1]
    before = hist[-3]
    observed = observation_from_pair(previous["record"], before["record"])
    mapped = tape_features(_prepare(observed))
    values = mapped["features"]
    if any(type(values.get(name)) not in (int, float) or isinstance(values.get(name), bool) for name in _FEATURE_NAMES):
        return False
    digest = hashlib.sha256(json.dumps({"f": values, "mint": mint, "ts": previous["ts"]}, sort_keys=True).encode()).hexdigest()
    if digest in seen:
        return False
    if not previous["price_usd"] > 0:
        return False
    remember(memory, {
        "mint": mint,
        "features": values,
        "later_return": (current["price_usd"] - previous["price_usd"]) / previous["price_usd"],
        "observation_sha256": digest,
        "outcome_start_ms": previous["ts_ms"],
        "outcome_end_ms": current["ts_ms"],
        "action": "NO_EXECUTION",
        "execution_allowed": False,
    })
    seen.add(digest)
    return True


def fill_crow_memory(root: Path, memory: Path, *, before_ms: int) -> int:
    """Write outcomes whose window ends strictly before `before_ms`."""
    if type(before_ms) is not int or before_ms < 0:
        raise ValueError("INVALID_TIME")
    root = resolve_root(root)
    if memory.exists():
        memory.unlink()
    stamped = _stamped(root)
    series = load_series(root, [item["file"] for item in stamped if item["ms"] < before_ms])
    seen: set[str] = set()
    added = 0
    for item in stamped:
        if item["ms"] >= before_ms:
            continue
        for row in item["rows"]:
            stamp = row.get("ts") or row.get("fetched_at")
            if type(stamp) is not str:
                continue
            now_ms = parse_time_ms(stamp)
            if now_ms >= before_ms:
                continue
            if _remember_row(series, row, now_ms, memory, seen):
                added += 1
    return added


def _symbols(series: dict[str, list[dict]]) -> dict[str, str]:
    found = {}
    for mint, points in series.items():
        for point in points:
            symbol = point["record"].get("symbol")
            if type(symbol) is str:
                found[mint] = symbol
    return found


def _trades(ledger: Path, symbols: dict[str, str]) -> list[dict]:
    if not ledger.is_file():
        return []
    events = [json.loads(line) for line in ledger.read_text(encoding="utf-8").splitlines() if line.strip()]
    opened = {event["thesis_id"]: event for event in events if event.get("type") == "OPEN"}
    trades = []
    for event in events:
        if event.get("type") != "CLOSE":
            continue
        source = opened.get(event["thesis_id"], {})
        mint = event.get("mint")
        trades.append({
            "thesis_id": event["thesis_id"],
            "mint": mint,
            "symbol": symbols.get(mint) if type(mint) is str else None,
            "pair_address": source.get("pair_address"),
            "opened_ms": source.get("opened_ms"),
            "closed_ms": event.get("closed_ms"),
            "reason": event.get("reason"),
            "path": event.get("path"),
            "pnl_usd": event.get("pnl_usd"),
            "pnl_after_costs_usd": event.get("pnl_after_costs_usd"),
            "exit_policy": event.get("exit_policy"),
            "fill_model": event.get("fill_model"),
            "price_path": event.get("price_path"),
            "r_multiple": event.get("r_multiple"),
            "candles_in_window": event.get("candles_in_window"),
            "fees": event.get("fees"),
        })
    return trades


def _book(root: Path, dest: Path, series: dict, *, memory: Path | None, not_before_ms: int, limit: int, threshold_ppm: int, candle_dir: Path | None, exit_policy: str = "ladder_e", entry_floor: bool = True, gap_fill: bool = True) -> dict:
    dest.mkdir(parents=True, exist_ok=True)
    ledger = dest / "paper.jsonl"
    theses = dest / "theses"
    if ledger.exists():
        ledger.unlink()
    if theses.exists():
        for path in theses.glob("*"):
            if path.is_file():
                path.unlink()

    def score(observation, now_ms):
        hist = causal_tail(series.get(observation.get("mint"), []), now_ms)
        return fuse(enrich(observation, hist), now_ms=now_ms, memory_path=memory)

    counted = replay(
        root, ledger, theses,
        threshold_ppm=threshold_ppm, limit=limit, score=score,
        not_before_ms=not_before_ms, candle_dir=candle_dir, exit_policy=exit_policy,
        entry_floor=entry_floor, gap_fill=gap_fill,
    )
    summary = metrics(ledger)
    closed = state(ledger)["closed"]
    symbols = _symbols(series)
    return {
        "theses": len(list(theses.glob("*.json"))),
        "opened": counted["opened"],
        "closed": summary["closed"],
        "open": summary["open"],
        "exit_policy": exit_policy,
        "win_rate": summary["win_rate"],
        "avg_r": summary["avg_r"],
        "pnl_before_fees": summary["net_pnl_usd"],
        "win_rate_after_costs": summary["win_rate_after_costs"],
        "avg_win": summary["avg_win"],
        "avg_loss": summary["avg_loss"],
        "pl_ratio": summary["pl_ratio"],
        "profit_factor": summary["profit_factor"],
        "pnl_after_costs": summary["pnl_after_costs"],
        "max_drawdown_usd": summary["max_drawdown_usd"],
        "fees": "APPLIED" if exit_policy == "ladder_e" else "NOT_OBSERVED",
        "cost_model": "FEE_1PCT_SLIP_0_5PCT" if exit_policy == "ladder_e" else "ASSUMED_FROM_OBSERVED_LIQUIDITY",
        "skipped": counted["skipped"],
        "entry_skipped": counted.get("entry_skipped", 0),
        "skip_reasons": counted.get("skip_reasons") or {},
        "trades": _trades(ledger, symbols),
        "execution_allowed": False,
        "live_orders": False,
    }


def walk_forward(root: Path, work: Path, *, limit: int = 25, threshold_ppm: int = 600_000, candle_dir: Path | None = None, exit_policy: str = "ladder_e", entry_floor: bool = True, gap_fill: bool = True) -> dict:
    """Fill crow memory before the longest gap and score the later snapshots twice."""
    root = resolve_root(root)
    work.mkdir(parents=True, exist_ok=True)
    stamped = _stamped(root)
    split = _holdout(stamped)
    before_ms = split["holdout"]["ms"]
    memory = work / "crow.jsonl"
    memory_rows = fill_crow_memory(root, memory, before_ms=before_ms)
    ends = []
    if memory.is_file() and memory.read_text(encoding="utf-8").strip():
        for line in memory.read_text(encoding="utf-8").splitlines():
            if line.strip():
                ends.append(json.loads(line)["outcome_end_ms"])
    if any(end >= before_ms for end in ends):
        raise RuntimeError("HOLDOUT_LEAKED_INTO_MEMORY")
    series = load_series(root, [item["file"] for item in stamped])
    policies = {}
    for policy in ("single_target", "ladder_e"):
        policies[policy] = {
            "with_crow": _book(
                root, work / policy / "with_crow", series, memory=memory, not_before_ms=before_ms,
                limit=limit, threshold_ppm=threshold_ppm, candle_dir=candle_dir, exit_policy=policy,
                entry_floor=entry_floor, gap_fill=gap_fill,
            ),
            "without_crow": _book(
                root, work / policy / "without_crow", series, memory=None, not_before_ms=before_ms,
                limit=limit, threshold_ppm=threshold_ppm, candle_dir=candle_dir, exit_policy=policy,
                entry_floor=entry_floor, gap_fill=gap_fill,
            ),
        }
    chosen = policies[exit_policy]
    fill_files = [item["file"] for item in stamped if item["ms"] < before_ms]
    holdout_files = [item["file"] for item in stamped if item["ms"] >= before_ms]
    return {
        "protocol": "AAI_GIANT_BRAIN_WALK_FORWARD_V1",
        "mode": "PAPER",
        "action": "NO_EXECUTION",
        "execution_allowed": False,
        "live_orders": False,
        "limit": limit,
        "threshold_ppm": threshold_ppm,
        "history_points": HISTORY_POINTS,
        "max_gap_ms": MAX_GAP_MS,
        "min_fly_history": MIN_FLY_HISTORY,
        "snapshot_files": len(stamped),
        "first_file": stamped[0]["file"],
        "first_ts": stamped[0]["ts"],
        "last_file": stamped[-1]["file"],
        "last_ts": stamped[-1]["ts"],
        "fill_files": len(fill_files),
        "fill_through_file": split["fill_through"]["file"],
        "fill_through_ts": split["fill_through"]["ts"],
        "holdout_files": len(holdout_files),
        "holdout_file": split["holdout"]["file"],
        "holdout_ts": split["holdout"]["ts"],
        "holdout_ms": before_ms,
        "gap_ms": split["gap_ms"],
        "memory_rows": memory_rows,
        "memory_outcome_end_max_ms": None if not ends else max(ends),
        "memory_outcome_end_max_ts": None if not ends else _iso(max(ends)),
        "candle_dir": None if candle_dir is None else str(candle_dir),
        "exit_policy": exit_policy,
        "entry_floor": entry_floor,
        "gap_fill": gap_fill,
        "policies": policies,
        "with_crow": chosen["with_crow"],
        "without_crow": chosen["without_crow"],
    }
