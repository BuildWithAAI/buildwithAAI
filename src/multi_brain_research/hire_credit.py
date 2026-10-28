"""Practice credit for a paid hire.

One demo credit. No wallet.
"""
from __future__ import annotations

import json

from .practice_settle import settle


def credit(paid: bool, credits: int) -> dict:
    return settle({"request_id": "req_receipt", "paid": paid, "action": "NO_EXECUTION"}, credits)


def self_check() -> dict:
    body = credit(True, 10_000_000)
    if body["credits_after"] != 11_000_000 or body["wallet"] != "NONE":
        raise RuntimeError("CREDIT_MISMATCH")
    return {"after": body["credits_after"], "action": "NO_EXECUTION"}


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
