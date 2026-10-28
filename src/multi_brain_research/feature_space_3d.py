"""3D view of the first-brain feature space.

Axes are signed return, flow, and liquidity. Color is the adverse label.
This is fixture data, not a live market.
"""
from __future__ import annotations

import json
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

POINTS = [
    (-0.20, -0.20, -0.20, 1),
    (-0.05, 0.10, 0.00, 0),
    (0.15, 0.20, 0.10, 0),
    (-0.40, -0.30, -0.25, 1),
    (0.00, 0.00, 0.00, 0),
    (-0.16, -0.05, -0.10, 1),
    (0.30, 0.10, 0.20, 0),
    (-0.22, -0.18, -0.12, 1),
]


def draw(path: Path) -> dict:
    fig = plt.figure(figsize=(8, 6))
    ax = fig.add_subplot(111, projection="3d")
    for x, y, z, label in POINTS:
        ax.scatter(x, y, z, c="#c0392b" if label else "#2980b9", s=60)
    ax.set_xlabel("signed return")
    ax.set_ylabel("flow")
    ax.set_zlabel("liquidity")
    ax.set_title("Fixture feature space — red adverse, blue not")
    fig.tight_layout()
    fig.savefig(path, dpi=140)
    return {"points": len(POINTS), "path": str(path), "classification": "FIXTURE", "action": "NO_EXECUTION"}


if __name__ == "__main__":
    print(json.dumps(draw(Path("/workspace/artifacts/feature_space_3d.png")), sort_keys=True))
