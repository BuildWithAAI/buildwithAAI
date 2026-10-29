"""ELF and ZIP markers are rejected the same as a script.
"""
from __future__ import annotations

import json

from .artifact_inspect import inspect


def self_check() -> dict:
    elf = inspect(b"\x7fELF")
    zip_ = inspect(b"PK\x03\x04")
    if elf["hire_allowed"] or zip_["hire_allowed"]:
        raise RuntimeError("MARKER_PASSED")
    return {"elf": elf["reason"], "zip": zip_["reason"], "action": "NO_EXECUTION"}


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
