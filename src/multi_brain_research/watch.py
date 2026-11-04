"""Score snapshot files and open paper positions from the theses that clear the bar.

The default scorer is the giant-brain fusion. A caller can pass another
function in tests. Live orders are not placed.
"""
from __future__ import annotations

from pathlib import Path

from .paper_trader import PaperError, mark, open_position, state
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


def replay(root: Path, ledger: Path, theses_dir: Path, *, threshold_ppm: int = 600_000, limit: int = 25, score=None, not_before_ms: int | None = None, candle_dir: Path | None = None) -> dict:
    root = resolve_root(root)
    if score is None:
        from .giant_brain import fuse

        def score(observation, now_ms):
            return fuse(observation, now_ms=now_ms)

    opened = closed = skipped = 0
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
                signal = score(observation, now_ms)
                thesis = write_thesis(signal, record, now_ms=now_ms, threshold_ppm=threshold_ppm)
            except (SnapshotError, ThesisError, ValueError):
                skipped += 1
                continue
            if thesis is None:
                continue
            write_files(theses_dir, thesis)
            if type(record.get("price_usd")) not in (int, float):
                continue
            try:
                opened_row = open_position(
                    ledger, thesis, mark_price_usd=record["price_usd"], now_ms=now_ms, notional_usd=100,
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
        "mode": "PAPER",
        "action": "NO_EXECUTION",
        "execution_allowed": False,
        "live_orders": False,
    }
