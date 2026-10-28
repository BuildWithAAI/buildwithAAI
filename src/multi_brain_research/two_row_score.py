"""Score the two-row fixture with the existing first brain.

Research only. Not market skill.
"""
from __future__ import annotations

import json
from pathlib import Path

from .first_brain import load_graph, receipt, train
from .two_row_return import two_row


def score(graph_path: Path) -> dict:
    graph = load_graph(graph_path)
    row = two_row()
    values = (
        row["signed_return"],
        row["flow_imbalance"],
        row["liquidity_change"],
        row["distance_to_adverse_band"],
    )
    model = train(graph["edges"], [(values, 1)], seed=7, steps=5)
    body = receipt(graph["edges"], model, values, 100_000, graph["graph_sha256"])
    body["classification"] = "FIXTURE_TWO_ROW"
    body["market_skill"] = "NOT_ESTABLISHED"
    return body


def self_check() -> dict:
    body = score(Path("/tmp/hemibrain.json"))
    if body["action"] != "NO_EXECUTION" or body["market_skill"] != "NOT_ESTABLISHED":
        raise RuntimeError("TWO_ROW_SCORE_MISMATCH")
    return {"prediction_ppm": body["prediction_ppm"], "action": body["action"]}


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
