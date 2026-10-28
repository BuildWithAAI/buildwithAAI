"""Map a first-brain receipt onto the existing ModuleOutput contract.

Does not create a second receipt language. Does not execute.
"""
from __future__ import annotations

import hashlib
import json

from .contracts import ModuleOutput

PIN = "a" * 64


def _sha(payload: object) -> str:
    raw = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()
    return hashlib.sha256(raw).hexdigest()


def to_module_output(receipt: dict, snapshot_sha256: str, produced_time_ms: int) -> ModuleOutput:
    if receipt.get("action") != "NO_EXECUTION":
        raise ValueError("EXECUTION_LEAK")
    return ModuleOutput(
        module_id=receipt["module_id"],
        source_id=receipt.get("source_id", "research_joint"),
        graph_sha256=receipt.get("graph_sha256", PIN),
        model_sha256=receipt.get("model_sha256", PIN),
        task_sha256=receipt.get("task_sha256", _sha({"task": "adverse_move_after_fee_v1"})),
        horizon_ms=int(receipt.get("horizon_ms", 300_000)),
        snapshot_sha256=snapshot_sha256,
        produced_time_ms=produced_time_ms,
        prediction_ppm=receipt.get("prediction_ppm"),
        uncertainty_ppm=receipt.get("uncertainty_ppm"),
        abstain_reason=receipt.get("abstain_reason"),
    )
