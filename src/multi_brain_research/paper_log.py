"""Paper-trading log. Records hypothetical outcomes. Sends nothing."""
from __future__ import annotations

import json
from pathlib import Path

_FORBIDDEN = {"private_key", "seed_phrase", "sendTransaction", "wallet_secret"}


def _forbidden(value) -> bool:
    if type(value) is dict:
        if _FORBIDDEN & set(value) or value.get("execution_allowed") is True:
            return True
        return any(_forbidden(item) for item in value.values())
    if type(value) is list:
        return any(_forbidden(item) for item in value)
    return False


def append(path: Path, record: dict) -> None:
    if type(record) is not dict or record.get("action") != "NO_EXECUTION" or _forbidden(record):
        raise ValueError("PAPER_ONLY")
    path.parent.mkdir(parents=True, exist_ok=True)
    line = {**record, "mode": "PAPER", "execution_allowed": False, "live_orders": False}
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(line, sort_keys=True) + "\n")
