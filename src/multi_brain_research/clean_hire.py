"""Clean hire: live pass, pack, credit, hash.
"""
from __future__ import annotations

import json
from pathlib import Path

from .clean_credit import credit
from .full_pack import replay
from .hash_log import log
from .live_pass import run_live


def run() -> dict:
    passed = run_live("https://api.mainnet-beta.solana.com", "holder_b", 30, 50_000_000)
    path = Path("/tmp/aai-clean.json")
    path.write_text(json.dumps({"slot": passed["slot"], "council": "WEIGHTED", "dispute": "NONE", "claim_sha256": "a" * 64}))
    replay(path)
    credited = credit(path, 10_000_000)
    hash_path = Path("/tmp/aai-clean-hash.jsonl")
    if hash_path.exists():
        hash_path.unlink()
    hashed = log(hash_path, "a" * 64)
    return {"slot": passed["slot"], "credit": credited["after"], "rows": hashed["rows"], "action": "NO_EXECUTION"}


if __name__ == "__main__":
    print(json.dumps(run(), sort_keys=True))
