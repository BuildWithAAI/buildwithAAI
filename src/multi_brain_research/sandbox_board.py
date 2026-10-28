"""Sandbox agent on the board.

Malicious. Score 0.
"""
from __future__ import annotations

import json


def show() -> dict:
    return {"specialist_id": "sandbox_reject", "state": "MALICIOUS", "verification": 0, "action": "NO_EXECUTION"}


def self_check() -> dict:
    body = show()
    if body["verification"] or body["state"] != "MALICIOUS":
        raise RuntimeError("SANDBOX_BOARD_MISMATCH")
    return body


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
