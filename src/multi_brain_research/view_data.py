"""View data without a 3D render.

Price, layers, three brains, pack, CSV, reserve, other-mint refusal.
"""
from __future__ import annotations

import csv
import json
from pathlib import Path

TOKEN = "27RP3fkHt6T2QpCzsrJjk9oMZXAP5cya77VaR3UMpump"
OTHER = "4YfDqzLR2NRLcx4V4VEuhjN2Z1BS3T1aokwNQygDpump"

POINTS = [
    {"id": "two_row", "mint": TOKEN, "layer": "live", "brains": ["fly", "prior", "no_trade"], "answers": 2, "pack": True},
    {"id": "dead_1", "mint": TOKEN, "layer": "dead", "brains": ["fly", "prior"], "answers": 2, "pack": True},
    {"id": "account", "mint": TOKEN, "layer": "live", "brains": ["no_trade"], "answers": 0, "pack": False},
]


def refuse_mint(mint: str) -> bool:
    return mint == OTHER


def hire(point: dict) -> bool:
    return point["layer"] != "dead" and point["answers"] >= 2 and point["pack"] and not refuse_mint(point["mint"])


def run(csv_path: Path) -> dict:
    layers = {"live": [p["id"] for p in POINTS if p["layer"] == "live"], "dead": [p["id"] for p in POINTS if p["layer"] == "dead"]}
    hired = [p["id"] for p in POINTS if hire(p)]
    with csv_path.open("w", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=["id", "mint", "layer", "answers", "pack"])
        writer.writeheader()
        writer.writerows({key: p[key] for key in writer.fieldnames} for p in POINTS)
    if refuse_mint(TOKEN):
        raise RuntimeError("OWN_MINT_REFUSED")
    return {
        "price_quote_per_base": 0.000027958993542404472,
        "real_sol_lamports": 71,
        "complete": False,
        "layers": layers,
        "brains_on_two_row": 3,
        "hired": hired,
        "other_mint_refused": refuse_mint(OTHER),
        "legend": "FIXTURE_NOT_LIVE_MARKET",
        "future_animated": False,
        "csv": str(csv_path),
        "wallet": "NONE",
        "action": "NO_EXECUTION",
    }


if __name__ == "__main__":
    print(json.dumps(run(Path("/workspace/artifacts/feature_points.csv")), sort_keys=True))
