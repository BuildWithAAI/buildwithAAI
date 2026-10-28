"""The one command writes its own pack.

Replay must match the slot it just read.
"""
from __future__ import annotations

import json
from pathlib import Path

from .functional_command import run
from .functional_pack import replay, write_pack


def run_and_pack(endpoint: str, handle: str, log_path: Path, pack_path: Path) -> dict:
    body = run(endpoint, handle, log_path)
    write_pack(pack_path, body["slot"], body["council"], "b" * 64)
    checked = replay(pack_path)
    pack = json.loads(pack_path.read_text())
    if pack["slot"] != body["slot"] or not checked["complete"]:
        raise RuntimeError("PACK_SLOT_MISMATCH")
    return {"slot": body["slot"], "council": body["council"], "complete": True, "action": "NO_EXECUTION"}


def self_check() -> dict:
    log = Path("/tmp/aai-pack-cmd.jsonl")
    pack = Path("/tmp/aai-pack-cmd.json")
    if log.exists():
        log.unlink()
    return run_and_pack("https://api.mainnet-beta.solana.com", "@ada3", log, pack)


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
