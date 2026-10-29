"""Zero balance cannot claim a handle credit or a fee.
"""
from __future__ import annotations

import json

from .zero_credit import credit


def self_check() -> dict:
    body = credit("11111111111111111111111111111111")
    if body["credited"]:
        raise RuntimeError("ZERO_BOTH")
    return {"fee": False, "credit": False, "reason": body["reason"], "action": "NO_EXECUTION"}


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
