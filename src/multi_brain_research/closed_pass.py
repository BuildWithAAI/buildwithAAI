"""Closed economy pass.

Hold check, admit, route, settle demo credits, and append the fee log.
One call. No order is sent.
"""
from __future__ import annotations

import json
from pathlib import Path

from .economy_pass import run
from .fee_log import append
from .hold_check import from_accounts
from .inventory_gate import TOKEN
from .practice_settle import settle


def close(agent_id: str, wallet: str, accounts: list[dict], held_days: int,
          fee_lamports: int, answers: list[dict], credits: int, log_path: Path) -> dict:
    hold = from_accounts(wallet, accounts, held_days)
    atoms = sum(item["amount"] for item in accounts) if hold["reason"] != "CURVE_VAULT" else 0
    result = run(agent_id, wallet, held_days, atoms, fee_lamports, answers)
    if not hold["fee_allowed"]:
        result["chain"]["paid"] = False
    settled = settle(result["chain"], credits)
    logged = append(log_path, result["chain"])
    return {
        "hold": hold["reason"],
        "admitted": result["admission"].get("admitted"),
        "paid": result["chain"]["paid"],
        "credits_after": settled["credits_after"],
        "logged": logged["appended"],
        "token": TOKEN,
        "action": "NO_EXECUTION",
    }


def self_check() -> dict:
    path = Path("/tmp/aai-closed-pass.jsonl")
    if path.exists():
        path.unlink()
    paid = close(
        "agent_a", "holder_b", [{"mint": TOKEN, "amount": 50_000_000}], 30,
        1_000_000,
        [{"specialist_id": "fly_hemibrain_adverse_v1", "verification": 70,
          "receipt": {"prediction_ppm": 620000, "action": "NO_EXECUTION"}}],
        10_000_000, path,
    )
    if not paid["paid"] or paid["credits_after"] != 11_000_000:
        raise RuntimeError("CLOSE_MISMATCH")
    return paid


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
