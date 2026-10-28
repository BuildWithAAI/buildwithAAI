"""Fee reserve never exceeds the cap.
"""
from __future__ import annotations

import json

from .fee_cap import CAP, cap


def reserve(amount: int) -> dict:
    body = cap(amount)
    if body["reserve"] > CAP:
        raise RuntimeError("OVER_CAP_RESERVED")
    return {"reserve": body["reserve"], "cap": CAP, "action": "NO_EXECUTION"}


def self_check() -> dict:
    return reserve(5_000_000)


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
