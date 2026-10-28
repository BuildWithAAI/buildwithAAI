from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from typing import Any, Iterable


class ReplayMode(str, Enum):
    CANONICAL_ORDER = "CANONICAL_ORDER"
    AVAILABLE_TIME = "AVAILABLE_TIME"
    COMMITMENT_FILTERED = "COMMITMENT_FILTERED"


_COMMITMENT_RANK = {"PROCESSED": 0, "CONFIRMED": 1, "FINALIZED": 2}


def instant(value: str) -> datetime:
    if not isinstance(value, str):
        raise ValueError("available time must be a timezone-aware timestamp")
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise ValueError("available time requires a timezone")
    return parsed.astimezone(timezone.utc)


def replay(blocks: Iterable[dict[str, Any]], *, mode: ReplayMode,
           cutoff_time: str | None = None,
           minimum_commitment: str = "PROCESSED") -> list[dict[str, Any]]:
    mode = ReplayMode(mode)
    required = _COMMITMENT_RANK[minimum_commitment.upper()]
    cutoff = instant(cutoff_time) if cutoff_time is not None else None
    records = [(record, instant(record["available_time"])) for record in blocks]
    if cutoff is not None:
        records = [(record, timestamp) for record, timestamp in records if timestamp <= cutoff]
    if mode is ReplayMode.COMMITMENT_FILTERED:
        records = [(record, timestamp) for record, timestamp in records
                   if _COMMITMENT_RANK[record["commitment"].upper()] >= required]
    if mode is ReplayMode.AVAILABLE_TIME:
        records.sort(key=lambda item: (item[1], item[0]["slot"], item[0].get("raw_event_id", "")))
    else:
        records.sort(key=lambda item: (item[0]["slot"], item[1], item[0].get("raw_event_id", "")))
    return [record for record, _ in records]
