"""Points for the 3D view.

Account decode is included and marked as not a trade.
"""
from __future__ import annotations

import json
import math

POINTS = [
    {"id": "two_row", "x": -0.2, "y": -0.2, "z": -0.2, "label": 1, "kind": "FIXTURE", "brain": "answered", "answers": 2, "fate": "live"},
    {"id": "quiet", "x": 0.0, "y": 0.0, "z": 0.0, "label": 0, "kind": "FIXTURE", "brain": "abstained", "answers": 1, "fate": "live"},
    {"id": "dead_1", "x": -0.4, "y": -0.3, "z": -0.25, "label": 1, "kind": "FIXTURE", "brain": "answered", "answers": 2, "fate": "dead"},
    {"id": "account", "x": 0.0, "y": 0.0, "z": 0.15, "label": None, "kind": "ACCOUNT_DECODE_NOT_A_TRADE", "brain": "abstained", "answers": 0, "fate": "live"},
]


def finite(point: dict) -> bool:
    return all(math.isfinite(point[key]) for key in ("x", "y", "z") if point[key] is not None)


def selectable(point: dict) -> bool:
    return point["fate"] != "dead" and point["answers"] >= 2 and point["kind"] != "ACCOUNT_DECODE_NOT_A_TRADE"


def export(path) -> dict:
    clean = []
    for point in POINTS:
        if not finite(point):
            raise ValueError("NON_FINITE")
        if point.get("label_source") == "future":
            raise ValueError("FUTURE_LABEL")
        clean.append({**point, "selectable": selectable(point), "wallet": "NONE"})
    path.write_text(json.dumps(clean, indent=2))
    return {"points": len(clean), "path": str(path), "action": "NO_EXECUTION"}


if __name__ == "__main__":
    from pathlib import Path
    print(json.dumps(export(Path("/workspace/artifacts/feature_points.json")), sort_keys=True))
