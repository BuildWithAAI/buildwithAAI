"""Score snapshot files and open paper positions from the theses that clear the bar.

The default scorer is the giant-brain fusion. A caller can pass another
function in tests. Live orders are not placed.
"""
from __future__ import annotations

from pathlib import Path

from .paper_trader import (
    MAX_HOUR_DROP_PERCENT,
    MIN_LIQUIDITY_USD,
    MIN_MARKET_CAP_USD,
    PaperError,
    entry_skip_reasons,
    mark,
    open_position,
    skip_entry,
    state,
)
from .holder_capture import join_holder_read, load_holder_reads
from .holder_concentration import thesis_parts
from .snapshot_feed import (
    SnapshotError,
    canonical_pairs,
    load_snapshot,
    observation_from_pair,
    parse_time_ms,
    resolve_root,
    snapshot_files,
)
from .thesis import ThesisError, write_files, write_thesis


def _files(root: Path) -> list[str]:
    return snapshot_files(root)


def _point(record: dict, stamp) -> dict:
    return {
        "price_usd": record.get("price_usd"),
        "buys_h1": record.get("buys_h1"),
        "sells_h1": record.get("sells_h1"),
        "liquidity_usd": record.get("liquidity_usd"),
        "ts": stamp,
    }


def _candles_for(candle_dir: Path | None, position: dict):
    if candle_dir is None or type(position.get("pair_address")) is not str:
        return None
    from .pool_ohlcv import load_jsonl
    path = candle_dir / (position["pair_address"] + ".jsonl")
    if not path.is_file():
        return None
    return load_jsonl(path)


def replay(root: Path, ledger: Path, theses_dir: Path, *, threshold_ppm: int = 600_000, limit: int = 25, score=None, not_before_ms: int | None = None, candle_dir: Path | None = None, exit_policy: str = "ladder_e", entry_floor: bool = True, gap_fill: bool = True, min_liquidity_usd: float = MIN_LIQUIDITY_USD, min_market_cap_usd: float = MIN_MARKET_CAP_USD, max_hour_drop_percent: float = MAX_HOUR_DROP_PERCENT, use_holder_reads: bool = True) -> dict:
    root = resolve_root(root)
    holder_index = load_holder_reads(root) if use_holder_reads else {}
    holder_joined = holder_clear = holder_raised = holder_not_observed = 0
    if score is None:
        from .giant_brain import fuse

        def score(observation, now_ms):
            return fuse(observation, now_ms=now_ms)

    opened = closed = skipped = entry_skipped = 0
    skip_reasons: dict[str, int] = {}
    seen: dict[str, dict] = {}
    history: dict[str, list[dict]] = {}
    for relative in _files(root):
        records = load_snapshot(root, relative)
        pairs = list(canonical_pairs(records).values())
        pairs.sort(key=lambda row: row.get("volume_h1") or 0, reverse=True)
        for record in pairs[:limit]:
            stamp = record.get("ts") or record.get("fetched_at")
            try:
                now_ms = parse_time_ms(stamp)
            except SnapshotError:
                skipped += 1
                continue
            price = record.get("price_usd")
            if type(price) is bool or type(price) not in (int, float) or not price > 0:
                skipped += 1
                continue
            mint = record.get("token_address")
            prior = seen.get(mint) if type(mint) is str else None
            trail = list(history.get(mint, [])) if type(mint) is str else []
            trail.append(_point(record, stamp))
            thesis_id = None
            for position in state(ledger)["open"].values():
                if position["mint"] == mint and type(record.get("price_usd")) in (int, float):
                    try:
                        result = mark(
                            ledger, position["thesis_id"], mark_price_usd=record["price_usd"], now_ms=now_ms,
                            candles=_candles_for(candle_dir, position),
                        )
                    except PaperError:
                        skipped += 1
                        continue
                    if result.get("type") == "CLOSE":
                        closed += 1
                    thesis_id = position["thesis_id"]
            if type(mint) is str:
                history[mint] = trail
                seen[mint] = record
            if thesis_id is not None or (not_before_ms is not None and now_ms < not_before_ms):
                continue
            try:
                observation = observation_from_pair(record, prior)
                observation["fly_history"] = trail
                joined = join_holder_read(holder_index.get(mint, []), now_ms) if type(mint) is str else None
                scored_record = record
                if joined is not None:
                    observation["holder_concentration"] = joined
                    scored_record = dict(record)
                    scored_record["holder_concentration"] = joined
                    holder_joined += 1
                    flag, _summary = thesis_parts(joined, now_ms)
                    if flag["status"] == "CLEAR":
                        holder_clear += 1
                    elif flag["status"] == "RAISED":
                        holder_raised += 1
                    elif joined.get("status") == "NOT_OBSERVED":
                        holder_not_observed += 1
                signal = score(observation, now_ms)
                thesis = write_thesis(signal, scored_record, now_ms=now_ms, threshold_ppm=threshold_ppm)
            except (SnapshotError, ThesisError, ValueError):
                skipped += 1
                continue
            if thesis is None:
                continue
            write_files(theses_dir, thesis)
            if type(record.get("price_usd")) not in (int, float):
                continue
            if entry_floor:
                reasons = entry_skip_reasons(
                    record, min_liquidity_usd=min_liquidity_usd, min_market_cap_usd=min_market_cap_usd,
                    max_hour_drop_percent=max_hour_drop_percent,
                )
                if reasons:
                    skip_entry(
                        ledger, thesis, record, reasons, min_liquidity_usd=min_liquidity_usd,
                        min_market_cap_usd=min_market_cap_usd, max_hour_drop_percent=max_hour_drop_percent,
                    )
                    entry_skipped += 1
                    for reason in reasons:
                        skip_reasons[reason] = skip_reasons.get(reason, 0) + 1
                    continue
            try:
                flag = record.get("instant_graduation")
                opened_row = open_position(
                    ledger, thesis, mark_price_usd=record["price_usd"], now_ms=now_ms, notional_usd=100,
                    exit_policy=exit_policy,
                    instant_graduation=flag if type(flag) is bool else None,
                    gap_fill=gap_fill,
                )
            except PaperError:
                skipped += 1
                continue
            if not opened_row.get("replayed"):
                opened += 1
    return {
        "opened": opened,
        "closed": closed,
        "skipped": skipped,
        "entry_skipped": entry_skipped,
        "skip_reasons": skip_reasons,
        "holder_joined": holder_joined,
        "holder_clear": holder_clear,
        "holder_raised": holder_raised,
        "holder_not_observed": holder_not_observed,
        "mode": "PAPER",
        "action": "NO_EXECUTION",
        "execution_allowed": False,
        "live_orders": False,
    }
