"""Missing curve account.

The hire stays unpaid.
"""
from __future__ import annotations

import json

from .live_pass import run_live


def run() -> dict:
    body = run_live("fixture://missing", "holder_b", 30, 50_000_000)
    if body["fee_status"] != "UNPAID":
        raise RuntimeError("MISSING_PAID")
    return body


if __name__ == "__main__":
    print(json.dumps(run(), sort_keys=True))
