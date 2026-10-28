"""A pack whose wallet is the curve vault fails replay.
"""
from __future__ import annotations

import json
from pathlib import Path

from .inventory_gate import CURVE


def replay(path: Path) -> dict:
    pack = json.loads(path.read_text())
    if pack.get("wallet") == CURVE:
        raise ValueError("VAULT_PACK")
    return {"complete": True, "action": "NO_EXECUTION"}


def self_check() -> dict:
    path = Path("/tmp/aai-vault-pack.json")
    path.write_text(json.dumps({"wallet": CURVE, "slot": 1}))
    try:
        replay(path)
    except ValueError:
        refused = True
    else:
        refused = False
    if not refused:
        raise RuntimeError("VAULT_PACK_ALLOWED")
    return {"refused": refused, "action": "NO_EXECUTION"}


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
