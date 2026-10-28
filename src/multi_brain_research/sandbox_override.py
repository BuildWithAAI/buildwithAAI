"""Sandbox reject overrides a weighted agree.
"""
from __future__ import annotations

import json

from .sandbox_council import vote_with_sandbox


def run() -> dict:
    body = vote_with_sandbox((-0.2, -0.2, -0.2, 0.15), True)
    if body["hire_allowed"] or body["reason"] != "SANDBOX_REJECT":
        raise RuntimeError("SANDBOX_DID_NOT_OVERRIDE")
    return {"fee_status": "UNPAID", "reason": body["reason"], "action": "NO_EXECUTION"}


if __name__ == "__main__":
    print(json.dumps(run(), sort_keys=True))
