"""A clean file reaches the council.
"""
from __future__ import annotations

import json

from .inspect_first import run


def self_check() -> dict:
    body = run(b"receipt only", [{"source": "brain", "prediction_ppm": 650_000}])
    if not body["voted"]:
        raise RuntimeError("CLEAN_BLOCKED")
    return {"voted": True, "action": "NO_EXECUTION"}


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
