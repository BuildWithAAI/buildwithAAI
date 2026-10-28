"""Hireable specialists. A brain is a specialist, not a wallet.

Registration does not grant execution. A specialist that cannot produce
NO_EXECUTION is refused.
"""
from __future__ import annotations

import json

SPECIALISTS = (
    {
        "specialist_id": "fly_hemibrain_adverse_v1",
        "kind": "BRAIN",
        "task": "adverse_move_after_fee_v1",
        "verification_floor": 40,
        "execution_allowed": False,
    },
    {
        "specialist_id": "frozen_prior_control_v1",
        "kind": "CONTROL",
        "task": "adverse_move_after_fee_v1",
        "verification_floor": 0,
        "execution_allowed": False,
    },
    {
        "specialist_id": "no_trade_control_v1",
        "kind": "CONTROL",
        "task": "adverse_move_after_fee_v1",
        "verification_floor": 0,
        "execution_allowed": False,
    },
)


class RegistryError(ValueError):
    pass


def register(entries=SPECIALISTS) -> dict:
    seen = set()
    clean = []
    for entry in entries:
        if entry.get("execution_allowed") is not False:
            raise RegistryError("EXECUTION_LEAK")
        sid = entry["specialist_id"]
        if sid in seen:
            raise RegistryError("DUPLICATE_SPECIALIST")
        seen.add(sid)
        clean.append(dict(entry, action="NO_EXECUTION"))
    return {"specialists": clean, "count": len(clean), "action": "NO_EXECUTION"}


def get(registry: dict, specialist_id: str) -> dict:
    for entry in registry["specialists"]:
        if entry["specialist_id"] == specialist_id:
            return entry
    raise RegistryError("UNKNOWN_SPECIALIST")


def self_check() -> dict:
    registry = register()
    if registry["count"] != 3 or get(registry, "no_trade_control_v1")["kind"] != "CONTROL":
        raise RegistryError("REGISTRY_MISMATCH")
    return {"count": registry["count"], "action": "NO_EXECUTION"}


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
