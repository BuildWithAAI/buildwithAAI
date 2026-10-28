"""Board history.

Keep the last ten admissions. A secret field is dropped.
"""
from __future__ import annotations

import json

SECRET = {"secret", "token", "seed", "key"}


def push(history: list[dict], row: dict) -> list[dict]:
    clean = {key: value for key, value in row.items() if key not in SECRET}
    history.append(clean)
    return history[-10:]


def self_check() -> dict:
    history: list[dict] = []
    for index in range(12):
        history = push(history, {"specialist_id": f"s{index}", "verification": index, "secret": "no"})
    if len(history) != 10 or "secret" in history[-1]:
        raise RuntimeError("HISTORY_MISMATCH")
    return {"kept": len(history), "action": "NO_EXECUTION"}


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
