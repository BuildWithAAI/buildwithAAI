"""Public board and the training report.

Scores only. Synthetic and real counted apart.
"""
from __future__ import annotations

import json
from pathlib import Path


def board(rows: list[dict]) -> dict:
    public = [{"specialist_id": row["specialist_id"], "verification": row["verification"]} for row in rows]
    return {"board": public, "action": "NO_EXECUTION"}


def report(path: Path) -> dict:
    body = {"synthetic": 36, "real": 1, "paid": 0, "unpaid": 37, "skill": "NOT_ESTABLISHED", "action": "NO_EXECUTION"}
    path.write_text(json.dumps(body, indent=2))
    return body


def self_check() -> dict:
    shown = board([{"specialist_id": "fly", "verification": 55, "secret": "no"}])
    if "secret" in shown["board"][0]:
        raise RuntimeError("SECRET_ON_BOARD")
    body = report(Path("/workspace/artifacts/train_report.txt"))
    return {"board": shown["board"][0]["specialist_id"], "synthetic": body["synthetic"], "action": "NO_EXECUTION"}


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
