"""Volume simulator and AAI.fun training rows.

Synthetic. Labeled. Not a live market. No send.
"""
from __future__ import annotations

import json
from pathlib import Path


def path(kind: str, steps: int = 12) -> list[dict]:
    rows = []
    price = 1.0
    for index in range(steps):
        if kind == "launch":
            price *= 1.15
            volume = 100 + index * 20
        elif kind == "rug":
            price *= 0.55 if index > 6 else 1.1
            volume = 400 if index > 6 else 80
        else:
            price *= 1.01
            volume = 40
        rows.append({"kind": kind, "step": index, "price": round(price, 6), "volume": volume, "synthetic": True})
    return rows


def train(rows: list[dict]) -> dict:
    last = rows[-1]["price"]
    first = rows[0]["price"]
    label = "adverse" if last < first * 0.5 else "hold"
    return {"label": label, "synthetic": True, "skill": "NOT_ESTABLISHED", "action": "NO_EXECUTION"}


def self_check() -> dict:
    rug = train(path("rug"))
    hold = train(path("long_term"))
    if rug["label"] != "adverse" or hold["label"] != "hold":
        raise RuntimeError("SIM_MISMATCH")
    Path("/workspace/artifacts/aai_fun_train.json").write_text(json.dumps({
        "source": "synthetic_volume_simulator",
        "not_live_market": True,
        "rug": rug,
        "long_term": hold,
        "action": "NO_EXECUTION",
    }, indent=2))
    return {"rug": rug["label"], "long_term": hold["label"], "action": "NO_EXECUTION"}


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
