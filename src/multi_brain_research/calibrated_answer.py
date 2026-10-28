"""Force an answer on the fixture by lowering the abstain band.

Still not market skill.
"""
from __future__ import annotations

import json
from pathlib import Path

from .first_brain import load_graph, receipt, train
from .two_row_return import two_row


def answer(graph_path: Path) -> dict:
    graph = load_graph(graph_path)
    row = two_row()
    values = (row["signed_return"], row["flow_imbalance"], row["liquidity_change"], row["distance_to_adverse_band"])
    model = train(graph["edges"], [(values, 1)], seed=7, steps=8)
    body = receipt(graph["edges"], model, values, 0, graph["graph_sha256"])
    body["market_skill"] = "NOT_ESTABLISHED"
    body["band_ppm"] = 0
    if body["prediction_ppm"] is None:
        raise RuntimeError("STILL_ABSTAINED")
    return body


def self_check() -> dict:
    body = answer(Path("/tmp/hemibrain.json"))
    return {"prediction_ppm": body["prediction_ppm"], "market_skill": body["market_skill"], "action": body["action"]}


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
