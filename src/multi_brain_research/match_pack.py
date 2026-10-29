"""That pass writes a signed pack with the matching reserve.
"""
from __future__ import annotations

import json
from pathlib import Path

from .pass_pack import write
from .snapshot_pay import self_check as paid


def self_check() -> dict:
    body = paid()
    pack = write(Path("/tmp/aai-match-pack.json"), 1, body["reserve"])
    if not pack["complete"] or body["reserve"] != 5000:
        raise RuntimeError("MATCH_PACK_MISMATCH")
    return {"reserve": body["reserve"], "complete": True, "action": "NO_EXECUTION"}


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
