"""Dry run of the host capture.

A fixture endpoint is refused before any socket opens.
"""
from __future__ import annotations

import json

from .host_capture import capture_mint


def dry_run() -> dict:
    try:
        capture_mint("fixture://local", "27RP3fkHt6T2QpCzsrJjk9oMZXAP5cya77VaR3UMpump", "curve", None)
    except ValueError as err:
        if str(err) != "REFUSED":
            raise
        return {"opened_socket": False, "reason": "REFUSED", "action": "NO_EXECUTION"}
    raise RuntimeError("DRY_RUN_OPENED")


if __name__ == "__main__":
    print(json.dumps(dry_run(), sort_keys=True))
