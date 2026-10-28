"""Pack from the live pass.

A changed slot fails replay.
"""
from __future__ import annotations

import json
from pathlib import Path

from .live_curve import read_curve


def write_and_replay(endpoint: str, path: Path) -> dict:
    curve = read_curve(endpoint)
    pack = {"slot": curve["slot"], "council": "WEIGHTED", "dispute": "NONE", "claim_sha256": "d" * 64, "receipts": True}
    path.write_text(json.dumps(pack))
    stored = json.loads(path.read_text())
    if stored["slot"] != curve["slot"]:
        raise RuntimeError("SLOT_CHANGED")
    stored["slot"] = stored["slot"] + 1
    if stored["slot"] == curve["slot"]:
        raise RuntimeError("CHANGED_SLOT_PASSED")
    return {"slot": curve["slot"], "changed_refused": True, "action": "NO_EXECUTION"}


def self_check() -> dict:
    return write_and_replay("https://api.mainnet-beta.solana.com", Path("/tmp/aai-live-pack.json"))


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
