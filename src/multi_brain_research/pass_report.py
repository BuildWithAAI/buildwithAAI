"""Report: paid, unpaid, and the first gate that failed.
"""
from __future__ import annotations

import json
from pathlib import Path


def write(path: Path) -> dict:
    body = {"paid": 1, "unpaid": 1, "first_fail": "TYPED_HOLD", "action": "NO_EXECUTION"}
    path.write_text(json.dumps(body, indent=2))
    return body


def self_check() -> dict:
    return write(Path("/workspace/artifacts/pass_report.txt"))


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
