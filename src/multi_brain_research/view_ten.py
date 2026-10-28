"""Build the view and run the ten view steps.
"""
from __future__ import annotations

import json
from pathlib import Path

from .feature_points import POINTS, export, finite, selectable
from .second_camera import camera


def run() -> dict:
    account = next(point for point in POINTS if point["kind"] == "ACCOUNT_DECODE_NOT_A_TRADE")
    abstained = [point for point in POINTS if point["brain"] == "abstained"]
    if any(point.get("label_source") == "future" for point in POINTS):
        raise RuntimeError("FUTURE_IN_VIEW")
    hired = [point["id"] for point in POINTS if selectable(point)]
    dead = [point["id"] for point in POINTS if point["fate"] == "dead"]
    path = Path("/workspace/artifacts/feature_points.json")
    exported = export(path)
    if not all(finite(point) for point in POINTS):
        raise RuntimeError("NON_FINITE")
    return {
        "account": account["id"],
        "abstained": len(abstained),
        "hired": hired,
        "dead_rendered": dead,
        "exported": exported["points"],
        "camera": camera()["complete"],
        "wallet": "NONE",
        "market_skill": "NOT_ESTABLISHED",
        "action": "NO_EXECUTION",
    }


if __name__ == "__main__":
    print(json.dumps(run(), sort_keys=True))
