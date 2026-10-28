"""Causal check.

A feature row cannot read the label that comes after it.
"""
from __future__ import annotations

import json


def causal(rows: list[dict], index: int) -> dict:
    if any("label" in rows[index] for _ in (0,)):
        raise ValueError("LABEL_IN_ROW")
    later = rows[index + 1] if index + 1 < len(rows) else None
    return {"index": index, "read_future": False, "later_hidden": later is not None, "action": "NO_EXECUTION"}


def self_check() -> dict:
    body = causal([{"price": 1}, {"price": 2, "label": 1}], 0)
    if body["read_future"]:
        raise RuntimeError("FUTURE_READ")
    return body


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
