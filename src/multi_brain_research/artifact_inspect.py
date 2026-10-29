"""Sandbox inspect.

An executable marker is rejected before the council. A flag is not enough.
"""
from __future__ import annotations

import json

MARKERS = ("#!/", "MZ", "\x7fELF", "PK\x03\x04")


def inspect(blob: bytes) -> dict:
    head = blob[:8]
    if any(head.startswith(marker.encode("latin1")) for marker in MARKERS):
        return {"hire_allowed": False, "reason": "EXECUTABLE", "action": "NO_EXECUTION"}
    return {"hire_allowed": True, "reason": "CLEAN", "action": "NO_EXECUTION"}


def self_check() -> dict:
    bad = inspect(b"#!/bin/sh\necho")
    good = inspect(b"receipt only")
    if bad["hire_allowed"] or not good["hire_allowed"]:
        raise RuntimeError("INSPECT_MISMATCH")
    return {"bad": bad["reason"], "good": good["reason"], "action": "NO_EXECUTION"}


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
