"""Pack adds the label and fails if it was taken from the future.
"""
from __future__ import annotations

import json
from pathlib import Path


def replay(path: Path) -> dict:
    pack = json.loads(path.read_text())
    if pack.get("label_source") == "future":
        raise ValueError("FUTURE_LABEL")
    if "label" not in pack:
        raise ValueError("LABEL_MISSING")
    return {"complete": True, "action": "NO_EXECUTION"}


def self_check() -> dict:
    path = Path("/tmp/aai-label-pack.json")
    path.write_text(json.dumps({"label": 1, "label_source": "later_observed"}))
    good = replay(path)
    path.write_text(json.dumps({"label": 1, "label_source": "future"}))
    try:
        replay(path)
    except ValueError:
        refused = True
    else:
        refused = False
    if not good["complete"] or not refused:
        raise RuntimeError("LABEL_PACK_MISMATCH")
    return {"complete": True, "future_refused": refused, "action": "NO_EXECUTION"}


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
