"""Shape features for launch, rug, and long-term.

Synthetic shapes. Not a live market.
"""
from __future__ import annotations

import json

from .volume_sim import path


def features(kind: str) -> dict:
    rows = path(kind)
    price_change = rows[-1]["price"] / rows[0]["price"] - 1
    volume_change = rows[-1]["volume"] / rows[0]["volume"] - 1
    return {
        "kind": kind,
        "price_change": round(price_change, 4),
        "volume_change": round(volume_change, 4),
        "synthetic": True,
        "action": "NO_EXECUTION",
    }


def self_check() -> dict:
    rug = features("rug")
    launch = features("launch")
    hold = features("long_term")
    if rug["price_change"] >= 0 or launch["price_change"] <= 0 or hold["volume_change"] > 1:
        raise RuntimeError("SHAPE_MISMATCH")
    return {"rug": rug["price_change"], "launch": launch["price_change"], "hold": hold["volume_change"], "action": "NO_EXECUTION"}


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
