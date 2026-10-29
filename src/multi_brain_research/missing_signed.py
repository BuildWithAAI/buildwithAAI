"""One missing field in the signed pack fails replay.
"""
from __future__ import annotations

import json

from .signed_pack import replay, sign


def self_check() -> dict:
    pack = {"slot": 1, "council": "WEIGHTED", "bps": 100, "reserve": 5_000, "claim_sha256": "a" * 64}
    pack["pack_sha256"] = sign(pack)
    del pack["bps"]
    try:
        replay(pack)
    except (ValueError, KeyError):
        refused = True
    else:
        refused = False
    if not refused:
        raise RuntimeError("MISSING_REPLAYED")
    return {"refused": refused, "action": "NO_EXECUTION"}


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
