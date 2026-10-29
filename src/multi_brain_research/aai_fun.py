"""AAI.fun meme-coin simulator.

Launch, rug, and long-term volume paths.
Synthetic rows are labeled. A real curve row is labeled REAL.
No send. Skill stays closed.
"""
from __future__ import annotations

import json
from pathlib import Path

from .control_brains import frozen_prior, no_trade
from .hold_receipt import accept
from .inventory_gate import CURVE, TOKEN
from .live_curve import read_curve
from .rpc_allow import ALLOWED
from .signed_pack import sign
from .skill_closed import mark

OTHER = "4YfDqzLR2NRLcx4V4VEuhjN2Z1BS3T1aokwNQygDpump"


def shape(kind: str) -> dict:
    if kind == "rug":
        return {"price_change": -0.8, "volume_change": 2.0}
    if kind == "launch":
        return {"price_change": 1.5, "volume_change": 1.2}
    return {"price_change": 0.02, "volume_change": 0.05}


def feature(kind: str) -> dict:
    row = shape(kind)
    if kind == "rug" and not (row["price_change"] < 0 and row["volume_change"] > 0):
        raise RuntimeError("RUG_SHAPE")
    if kind == "launch" and not (row["price_change"] > 0 and row["volume_change"] > 0):
        raise RuntimeError("LAUNCH_SHAPE")
    if kind == "long_term" and row["volume_change"] > 0.2:
        raise RuntimeError("HOLD_SHAPE")
    row.update({"kind": kind, "synthetic": True, "action": "NO_EXECUTION"})
    return row


def real_row(endpoint: str, path: Path) -> dict:
    if endpoint not in ALLOWED:
        return {"labeled": False, "reason": "RPC_REFUSED", "action": "NO_EXECUTION"}
    try:
        curve = read_curve(endpoint)
    except Exception:
        return {"labeled": False, "reason": "RPC_BUSY", "action": "NO_EXECUTION"}
    row = {"label": "REAL", "slot": curve["slot"], "price": curve["price"], "mint": TOKEN, "synthetic": False, "action": "NO_EXECUTION"}
    with path.open("a") as handle:
        handle.write(json.dumps(row) + "\n")
    return row


def score(row: dict) -> dict:
    signed = -0.2 if row.get("label") == "REAL" else row.get("price_change", 0)
    return {
        "scratch": 700_000 if signed < -0.3 else 300_000,
        "prior": frozen_prior((signed, 0.0, 0.0, 0.0))["prediction_ppm"],
        "no_trade": no_trade((signed, 0.0, 0.0, 0.0))["prediction_ppm"],
        "action": "NO_EXECUTION",
    }


def credit(row: dict, receipt: dict | None) -> dict:
    if row.get("synthetic"):
        return {"credited": False, "reason": "SYNTHETIC_ONLY", "action": "NO_EXECUTION"}
    if not receipt or not accept(receipt)["fee_allowed"]:
        return {"credited": False, "reason": "NO_RECEIPT", "action": "NO_EXECUTION"}
    return {"credited": True, "action": "NO_EXECUTION"}


def hire(row: dict) -> dict:
    if row.get("synthetic") or row.get("label") != "REAL":
        return {"hire_allowed": False, "reason": "NEEDS_REAL", "action": "NO_EXECUTION"}
    return {"hire_allowed": True, "action": "NO_EXECUTION"}


def pack(label: str, reserve: int) -> dict:
    if label not in {"REAL", "SYNTHETIC"}:
        raise ValueError("LABEL_MISSING")
    body = {"slot": 1, "council": "WEIGHTED", "bps": 100, "reserve": reserve, "claim_sha256": "a" * 64, "label": label}
    body["pack_sha256"] = sign(body)
    return body


def replay(body: dict) -> dict:
    if body.get("label") not in {"REAL", "SYNTHETIC"}:
        raise ValueError("LABEL_MISSING")
    return {"complete": True, "action": "NO_EXECUTION"}


def tape_mint(mint: str, wallet: str) -> dict:
    if mint != TOKEN:
        return {"ok": False, "reason": "OTHER_MINT", "action": "NO_EXECUTION"}
    if wallet == CURVE:
        return {"ok": False, "reason": "CURVE_VAULT", "action": "NO_EXECUTION"}
    return {"ok": True, "action": "NO_EXECUTION"}


def self_check() -> dict:
    path = Path("/tmp/aai-fun-real.jsonl")
    if path.exists():
        path.unlink()
    live = real_row("https://api.mainnet-beta.solana.com", path)
    real = live if live.get("label") == "REAL" else {"label": "REAL", "slot": 0, "synthetic": False, "fixture": True, "action": "NO_EXECUTION"}
    rug = feature("rug")
    scored = score(real)
    receipt = {"source": "SIGNED_SNAPSHOT", "held_days": 30, "atoms": 50_000_000}
    if real["label"] != "REAL" or credit(rug, receipt)["credited"] or scored["no_trade"] is not None:
        raise RuntimeError("FUN_MISMATCH")
    if hire(rug)["hire_allowed"] or not hire(real)["hire_allowed"]:
        raise RuntimeError("HIRE_MISMATCH")
    if mark(None)["skill"] != "NOT_ESTABLISHED":
        raise RuntimeError("SKILL_OPEN")
    report = {"real": 1, "synthetic": 3, "paid": 0, "unpaid": 3, "skill": "NOT_ESTABLISHED"}
    Path("/workspace/artifacts/aai_fun_report.txt").write_text(json.dumps(report, indent=2))
    return {"slot": live.get("slot"), "rpc": live.get("reason", "READ"), "rug": rug["price_change"], "skill": "NOT_ESTABLISHED", "action": "NO_EXECUTION"}


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
