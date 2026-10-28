"""Report file: paid, unpaid, first fail.
"""
from __future__ import annotations

import json
from pathlib import Path

from .hundred_agents import run as hundred


def write(path: Path) -> dict:
    body = hundred()
    path.write_text(json.dumps({"paid": body["paid"], "unpaid": body["unpaid"], "first_fail": body["first_fail"], "action": "NO_EXECUTION"}, indent=2))
    return {"path": str(path), "paid": body["paid"], "action": "NO_EXECUTION"}


def self_check() -> dict:
    return write(Path("/workspace/artifacts/gate_report.txt"))


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
