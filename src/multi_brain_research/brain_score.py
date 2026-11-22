"""Score one tape row with the paper-long heuristic.

An account snapshot that lacks a return, flow, and liquidity change abstains.
This does not fit the hemibrain on a single invented label. The receipt stays
NO_EXECUTION. This is not market skill.
"""
from __future__ import annotations

import json
from pathlib import Path

from .brain_input import features


def score(row: dict, graph_path: Path) -> dict:
    mapped = features(row)
    body = {
        "module_id": "tape_heuristic_v1",
        "prediction_ppm": None,
        "uncertainty_ppm": None,
        "abstain_reason": "MISSING_DATA",
        "missing": mapped["missing"],
        "market_skill": "NOT_ESTABLISHED",
        "classification": row.get("classification"),
        "graph_path_used": False,
        "action": "NO_EXECUTION",
    }
    if any(mapped["features"][name] is None for name in (
        "signed_return", "flow_imbalance", "liquidity_change", "distance_to_adverse_band"
    )):
        return body
    from .brain_input import paper_long_support
    scored = paper_long_support(mapped)
    body.update(
        prediction_ppm=scored["prediction_ppm"],
        uncertainty_ppm=scored["uncertainty_ppm"],
        abstain_reason=scored["abstain_reason"],
        graph_path_used=graph_path is not None,
    )
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
