"""Four-feature memory.

Keeps the last row. A row marked as future is refused.
"""
from __future__ import annotations

import json


class MemoryError(ValueError):
    pass


def remember(last: dict | None, row: dict) -> dict:
    if row.get("time") == "future":
        raise MemoryError("FUTURE_ROW")
    return {"last": row, "previous": last, "action": "NO_EXECUTION"}


def self_check() -> dict:
    first = remember(None, {"signed_return": -0.2, "time": "now"})
    try:
        remember(first["last"], {"time": "future"})
    except MemoryError:
        refused = True
    else:
        refused = False
    if not refused:
        raise MemoryError("FUTURE_ACCEPTED")
    return {"kept": first["last"]["signed_return"], "future_refused": refused, "action": "NO_EXECUTION"}


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
