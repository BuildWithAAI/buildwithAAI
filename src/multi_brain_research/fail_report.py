"""Report includes the first failing gate.
"""
from __future__ import annotations

import json
from pathlib import Path

from .hundred_agents import run


def write(path: Path) -> dict:
    body = run()
    path.write_text(json.dumps({"paid": body["paid"], "unpaid": body["unpaid"], "first_fail": body["first_fail"]}, indent=2))
    if not body["first_fail"]:
        raise RuntimeError("NO_FAIL")
    return {"first_fail": body["first_fail"], "action": "NO_EXECUTION"}


def self_check() -> dict:
    return write(Path("/workspace/artifacts/first_fail.txt"))


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
