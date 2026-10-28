"""Same agent twice in one command stays unpaid the second time.
"""
from __future__ import annotations

import json

from .cooldown_window import allow


def twice() -> dict:
    first = allow("agent_a", None)
    second = allow("agent_a", "agent_a")
    if not first["allowed"] or second["allowed"]:
        raise RuntimeError("COOLDOWN_COMMAND_MISMATCH")
    return {"first": "PAID", "second": "UNPAID", "action": "NO_EXECUTION"}


if __name__ == "__main__":
    print(json.dumps(twice(), sort_keys=True))
