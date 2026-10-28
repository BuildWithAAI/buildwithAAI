"""Evidence pack.

Tape, receipt, dispute, and chain hash in one file.
"""
from __future__ import annotations

import json
from pathlib import Path


def write_pack(path: Path, tape: dict, receipt: dict, dispute: dict, chain: str) -> dict:
    pack = {
        "tape": tape,
        "receipt": receipt,
        "dispute": dispute,
        "chain_sha256": chain,
        "action": "NO_EXECUTION",
    }
    path.write_text(json.dumps(pack, sort_keys=True))
    return {"path": str(path), "written": True, "action": "NO_EXECUTION"}


def self_check() -> dict:
    path = Path("/tmp/aai-pack.json")
    body = write_pack(path, {"slot": 1}, {"prediction_ppm": 1}, {"status": "UPHELD"}, "f" * 64)
    if not body["written"]:
        raise RuntimeError("PACK_MISMATCH")
    return body


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
