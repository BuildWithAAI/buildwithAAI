"""Two disputes still cannot go below zero.
"""
from __future__ import annotations

import json

from .decay_stack import stack


def self_check() -> dict:
    body = stack(5)
    if body["score"] < 0:
        raise RuntimeError("BELOW_ZERO")
    return body


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
