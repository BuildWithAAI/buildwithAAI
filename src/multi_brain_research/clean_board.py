"""Board drops a secret field.
"""
from __future__ import annotations

import json

SECRET = {"secret", "token", "seed", "key"}


def show(row: dict) -> dict:
    return {key: value for key, value in row.items() if key not in SECRET}


def self_check() -> dict:
    body = show({"specialist_id": "fly", "verification": 55, "secret": "no"})
    if "secret" in body:
        raise RuntimeError("SECRET_KEPT")
    return {"kept": list(body), "action": "NO_EXECUTION"}


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
