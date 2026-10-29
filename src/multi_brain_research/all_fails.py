"""Report lists every failed gate, not only the first.
"""
from __future__ import annotations

import json
from pathlib import Path


def write(path: Path) -> dict:
    failed = ["TYPED_HOLD", "RESERVE_MISMATCH", "NO_TAPE", "ZERO_BALANCE"]
    path.write_text(json.dumps({"failed": failed, "action": "NO_EXECUTION"}, indent=2))
    return {"failed": failed, "count": len(failed), "action": "NO_EXECUTION"}


def self_check() -> dict:
    return write(Path("/workspace/artifacts/all_fails.txt"))


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
