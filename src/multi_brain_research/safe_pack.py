"""Evidence pack stores no key.

A key field is dropped before the file is written.
"""
from __future__ import annotations

import json
from pathlib import Path

FORBIDDEN = {"private_key", "seed", "mnemonic", "api_key", "token"}


def write_safe(path: Path, pack: dict) -> dict:
    clean = {key: value for key, value in pack.items() if key not in FORBIDDEN}
    clean["action"] = "NO_EXECUTION"
    path.write_text(json.dumps(clean, sort_keys=True))
    return {"stored_key": any(key in clean for key in FORBIDDEN), "action": "NO_EXECUTION"}


def self_check() -> dict:
    path = Path("/tmp/aai-safe-pack.json")
    body = write_safe(path, {"tape": {}, "private_key": "no", "chain_sha256": "a" * 64})
    if body["stored_key"] or "private_key" in path.read_text():
        raise RuntimeError("KEY_STORED")
    return {"stored_key": False, "action": "NO_EXECUTION"}


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
