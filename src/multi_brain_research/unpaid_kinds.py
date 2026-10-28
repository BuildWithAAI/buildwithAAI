"""Vault, dead, and thin cannot appear as paid.
"""
from __future__ import annotations

import json


def paid(kind: str) -> bool:
    return kind not in {"VAULT", "DEAD", "THIN"}


def self_check() -> dict:
    rows = ["VAULT", "DEAD", "THIN", "LIVE"]
    bad = [kind for kind in rows if kind != "LIVE" and paid(kind)]
    if bad or not paid("LIVE"):
        raise RuntimeError("PAID_LEAK")
    return {"blocked": rows[:3], "action": "NO_EXECUTION"}


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
