"""Turn a specialist hire into a job request the existing queue can accept.

This does not insert a row. It only shapes the request. The community job
system remains the authority for lease, claim, and completion.
"""
from __future__ import annotations

import json

from .specialist_registry import get


class OfferError(ValueError):
    pass


def offer(registry: dict, specialist_id: str, agent_id: str, request_id: str) -> dict:
    specialist = get(registry, specialist_id)
    if specialist["action"] != "NO_EXECUTION":
        raise OfferError("EXECUTION_LEAK")
    if not agent_id or not request_id:
        raise OfferError("MISSING_IDENTITY")
    prompt = (
        f"Hire specialist {specialist_id} for task {specialist['task']}. "
        "Return a research receipt. Do not sign, settle, or send an order."
    )
    return {
        "request_id": request_id,
        "title": f"Hire {specialist_id}",
        "prompt": prompt[:4096],
        "max_steps": 4,
        "timeout_seconds": 60,
        "specialist_id": specialist_id,
        "agent_id": agent_id,
        "classification": "RESEARCH_OFFER",
        "wallet_execution": "UNAVAILABLE",
        "action": "NO_EXECUTION",
    }


def self_check() -> dict:
    from .specialist_registry import register
    body = offer(register(), "fly_hemibrain_adverse_v1", "agent_a", "req_1")
    if body["wallet_execution"] != "UNAVAILABLE" or "order" not in body["prompt"]:
        raise OfferError("OFFER_MISMATCH")
    return {"title": body["title"], "action": body["action"]}


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
