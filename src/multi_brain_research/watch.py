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
)
from .thesis import ThesisError, write_files, write_thesis


def _files(root: Path) -> list[str]:
    found = []
    folder = root / "snapshots"
    if not folder.is_dir():
        return found
    for path in sorted(folder.rglob("*.jsonl")) + sorted(folder.rglob("*.jsonl.gz")):
        found.append(str(path.relative_to(root)))
    return found


def replay(root: Path, ledger: Path, theses_dir: Path, *, threshold_ppm: int = 600_000, limit: int = 25, score=None) -> dict:
    root = resolve_root(root)
    if score is None:
        from .giant_brain import fuse

        def score(observation, now_ms):
            return fuse(observation, now_ms=now_ms)

    opened = closed = skipped = 0
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
            thesis_id = None
            for position in state(ledger)["open"].values():
                if position["mint"] == record.get("token_address") and type(record.get("price_usd")) in (int, float):
                    try:
                        result = mark(ledger, position["thesis_id"], mark_price_usd=record["price_usd"], now_ms=now_ms)
                    except PaperError:
                        skipped += 1
                        continue
                    if result.get("type") == "CLOSE":
                        closed += 1
                    thesis_id = position["thesis_id"]
            if thesis_id is not None:
                continue
            try:
                signal = score(observation_from_pair(record), now_ms)
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
