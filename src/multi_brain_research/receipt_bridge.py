"""Map a first-brain receipt onto the existing ModuleOutput contract.

Does not create a second receipt language. Does not execute.
Missing or placeholder graph, model, or task pins are rejected.
"""
from __future__ import annotations

import re

from .contracts import ModuleOutput

_PIN = re.compile(r"[0-9a-f]{64}")
_PLACEHOLDERS = frozenset({"a" * 64, "0" * 64})
_PROVENANCE = ("graph_sha256", "model_sha256", "task_sha256")


def _provenance(receipt: dict, field: str) -> str:
    value = receipt.get(field)
    if type(value) is not str or _PIN.fullmatch(value) is None or value in _PLACEHOLDERS:
        raise ValueError("INVALID_PROVENANCE")
    return value


def to_module_output(receipt: dict, snapshot_sha256: str, produced_time_ms: int) -> ModuleOutput:
    if type(receipt) is not dict or receipt.get("action") != "NO_EXECUTION":
        raise ValueError("EXECUTION_LEAK")
    graph, model, task = (_provenance(receipt, field) for field in _PROVENANCE)
    if "source_id" in receipt and (type(receipt["source_id"]) is not str or not receipt["source_id"]):
        raise ValueError("INVALID_PROVENANCE")
    return ModuleOutput(
        module_id=receipt["module_id"],
        source_id=receipt.get("source_id", "research_joint"),
        graph_sha256=graph,
        model_sha256=model,
        task_sha256=task,
        horizon_ms=int(receipt.get("horizon_ms", 300_000)),
        snapshot_sha256=snapshot_sha256,
        produced_time_ms=produced_time_ms,
        prediction_ppm=receipt.get("prediction_ppm"),
        uncertainty_ppm=receipt.get("uncertainty_ppm"),
        abstain_reason=receipt.get("abstain_reason"),
    )
