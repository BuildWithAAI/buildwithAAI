from __future__ import annotations

from enum import Enum
from typing import Any, Iterable


class ReplayMode(str, Enum):
    CANONICAL_ORDER = "CANONICAL_ORDER"
    AVAILABLE_TIME = "AVAILABLE_TIME"
    COMMITMENT_FILTERED = "COMMITMENT_FILTERED"


_COMMITMENT_RANK = {"PROCESSED": 0, "CONFIRMED": 1, "FINALIZED": 2}


def replay(blocks: Iterable[dict[str, Any]], *, mode: ReplayMode,
           cutoff_time: str | None = None,
           minimum_commitment: str = "PROCESSED") -> list[dict[str, Any]]:
    records = list(blocks)
    if cutoff_time is not None:
        records = [r for r in records if r["available_time"] <= cutoff_time]
    if mode is ReplayMode.COMMITMENT_FILTERED:
        required = _COMMITMENT_RANK[minimum_commitment.upper()]
        records = [r for r in records
                   if _COMMITMENT_RANK[r["commitment"].upper()] >= required]
    if mode is ReplayMode.AVAILABLE_TIME:
        return sorted(records, key=lambda r: (r["available_time"], r["slot"]))
    return sorted(records, key=lambda r: (r["slot"], r["available_time"]))
