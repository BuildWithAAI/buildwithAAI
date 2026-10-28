"""A graduated curve pays nothing.
"""
from __future__ import annotations

import json


def pay(complete: bool) -> dict:
    if complete:
        return {"fee_status": "UNPAID", "reason": "GRADUATED", "action": "NO_EXECUTION"}
    return {"fee_status": "PAID", "action": "NO_EXECUTION"}


def self_check() -> dict:
    body = pay(True)
    if body["fee_status"] != "UNPAID":
        raise RuntimeError("GRADUATED_PAID")
    return body


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
