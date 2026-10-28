"""Evidence pack with the quorum.

Replay fails if a brain is missing.
"""
from __future__ import annotations

import json
from pathlib import Path

BRAINS = ("fly_hemibrain_adverse_v1", "frozen_prior_control_v1", "no_trade_control_v1")


def replay(path: Path) -> dict:
    pack = json.loads(path.read_text())
    present = {item.get("module_id") for item in pack.get("quorum", [])}
    missing = [name for name in BRAINS if name not in present]
    if missing:
        raise ValueError("BRAIN_MISSING")
    return {"complete": True, "action": "NO_EXECUTION"}


def self_check() -> dict:
    path = Path("/tmp/aai-quorum-pack.json")
    path.write_text(json.dumps({"quorum": [{"module_id": name} for name in BRAINS]}))
    good = replay(path)
    path.write_text(json.dumps({"quorum": [{"module_id": BRAINS[0]}]}))
    try:
        replay(path)
    except ValueError:
        refused = True
    else:
        refused = False
    if not good["complete"] or not refused:
        raise RuntimeError("QUORUM_PACK_MISMATCH")
    return {"complete": True, "missing_refused": refused, "action": "NO_EXECUTION"}


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
