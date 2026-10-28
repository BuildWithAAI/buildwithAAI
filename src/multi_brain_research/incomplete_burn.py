"""An incomplete pack cannot burn.
"""
from __future__ import annotations

import json
from pathlib import Path

from .pack_burn import mark


def self_check() -> dict:
    path = Path("/tmp/aai-incomplete-burn.json")
    path.write_text(json.dumps({"slot": 1}))
    body = mark(path)
    if body["reason"] != "PACK_INCOMPLETE":
        raise RuntimeError("INCOMPLETE_BURNED")
    return body


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
