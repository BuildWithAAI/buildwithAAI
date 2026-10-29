"""AAI.fun meme-coin volume simulator.

Synthetic launch, rug, and long-term shapes.
A real row is labeled REAL only if it came from the allowlisted RPC.
Synthetic is not historical. No send. Skill stays closed.
"""
from __future__ import annotations

import json
from pathlib import Path

TOKEN = "27RP3fkHt6T2QpCzsrJjk9oMZXAP5cya77VaR3UMpump"
OTHER = "4YfDqzLR2NRLcx4V4VEuhjN2Z1BS3T1aokwNQygDpump"
CURVE = "Eq93BkkDVBLkjgHxZU6qVk7hrnzTnAyVfCNrXCVix1PL"
ALLOWED = {"https://api.mainnet-beta.solana.com"}


def shape(kind: str) -> dict:
    if kind == "rug":
        row = {"price_change": -0.8, "volume_change": 2.0}
    elif kind == "launch":
        row = {"price_change": 1.5, "volume_change": 1.2}
    elif kind == "long_term":
        row = {"price_change": 0.02, "volume_change": 0.05}
    else:
        raise ValueError("UNKNOWN_SHAPE")
    row.update({"kind": kind, "label": "SYNTHETIC", "synthetic": True, "mint": TOKEN, "action": "NO_EXECUTION"})
    return row


def accept_mint(mint: str, wallet: str) -> dict:
    if mint != TOKEN:
        return {"ok": False, "reason": "OTHER_MINT", "action": "NO_EXECUTION"}
    if wallet == CURVE:
        return {"ok": False, "reason": "CURVE_VAULT", "action": "NO_EXECUTION"}
    return {"ok": True, "action": "NO_EXECUTION"}


def real_row(endpoint: str, path: Path) -> dict:
    if endpoint not in ALLOWED:
        return {"labeled": False, "reason": "RPC_REFUSED", "action": "NO_EXECUTION"}
    from multi_brain_research.live_curve import read_curve

    try:
        curve = read_curve(endpoint)
    except Exception:
        return {"labeled": False, "reason": "RPC_BUSY", "action": "NO_EXECUTION"}
    row = {
        "label": "REAL",
        "slot": curve["slot"],
        "price": curve["price"],
        "real_quote": curve["real_quote"],
        "mint": TOKEN,
        "synthetic": False,
        "action": "NO_EXECUTION",
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a") as handle:
        handle.write(json.dumps(row) + "\n")
    return row


def hire(row: dict) -> dict:
    if row.get("label") != "REAL" or row.get("synthetic"):
        return {"hire_allowed": False, "reason": "NEEDS_REAL", "skill": "NOT_ESTABLISHED", "action": "NO_EXECUTION"}
    return {"hire_allowed": True, "skill": "NOT_ESTABLISHED", "action": "NO_EXECUTION"}


def self_check() -> dict:
    rug = shape("rug")
    launch = shape("launch")
    hold = shape("long_term")
    if rug["price_change"] >= 0 or launch["volume_change"] <= 0 or hold["volume_change"] > 0.2:
        raise RuntimeError("SHAPE_MISMATCH")
    if hire(rug)["hire_allowed"] or accept_mint(OTHER, "holder")["ok"]:
        raise RuntimeError("GATE_MISMATCH")
    return {"rug": rug["price_change"], "launch": launch["price_change"], "skill": "NOT_ESTABLISHED", "action": "NO_EXECUTION"}


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
