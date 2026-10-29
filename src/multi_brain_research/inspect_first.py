"""Inspect before quorum.

An executable never reaches a vote.
"""
from __future__ import annotations

import json

from .artifact_inspect import inspect
from .council_brains import accept


def run(blob: bytes, votes: list[dict]) -> dict:
    checked = inspect(blob)
    if not checked["hire_allowed"]:
        return {"voted": False, "reason": checked["reason"], "action": "NO_EXECUTION"}
    return {"voted": True, "decision": accept(votes), "action": "NO_EXECUTION"}


def self_check() -> dict:
    body = run(b"#!/bin/sh", [{"source": "brain"}])
    if body["voted"]:
        raise RuntimeError("EXECUTABLE_VOTED")
    return body


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
