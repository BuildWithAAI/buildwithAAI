"""Score one four-feature row with the existing first brain.

The receipt stays NO_EXECUTION. This is not market skill.
"""
from __future__ import annotations

import json
from pathlib import Path

from .brain_input import features
from .first_brain import load_graph, receipt, train


def score(row: dict, graph_path: Path) -> dict:
    graph = load_graph(graph_path)
    mapped = features(row)
    values = tuple(mapped["features"][name] for name in (
        "signed_return", "flow_imbalance", "liquidity_change", "distance_to_adverse_band"
    ))
    rows = [(values, 0)]
    model = train(graph["edges"], rows, seed=7, steps=5)
    body = receipt(graph["edges"], model, values, 100_000, graph["graph_sha256"])
    body["market_skill"] = "NOT_ESTABLISHED"
    body["classification"] = row.get("classification")
    return body


def self_check() -> dict:
    body = score(
        {"price_quote_per_base": 0.00002796, "classification": "ACCOUNT_DECODE_NOT_A_TRADE"},
        Path("/tmp/hemibrain.json"),
    )
    if body["action"] != "NO_EXECUTION" or body["market_skill"] != "NOT_ESTABLISHED":
        raise RuntimeError("SCORE_MISMATCH")
    return {"module": body["module_id"], "prediction_ppm": body["prediction_ppm"], "action": body["action"]}


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
