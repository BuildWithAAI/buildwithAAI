"""Training pack.

Hold receipt, one fee, signed pack, inspect, dispute hash.
Vault and the other mint are refused.
"""
from __future__ import annotations

import json

from .artifact_inspect import inspect
from .hold_receipt import accept
from .inventory_gate import CURVE, TOKEN
from .one_fee import match
from .signed_pack import sign


OTHER = "4YfDqzLR2NRLcx4V4VEuhjN2Z1BS3T1aokwNQygDpump"


def run(receipt: dict | None, blob: bytes, wallet: str, mint: str, reserve: int) -> dict:
    if wallet == CURVE:
        return {"fee_status": "UNPAID", "reason": "CURVE_VAULT", "action": "NO_EXECUTION"}
    if mint != TOKEN:
        return {"fee_status": "UNPAID", "reason": "OTHER_MINT", "action": "NO_EXECUTION"}
    if not receipt or not accept(receipt)["fee_allowed"]:
        return {"fee_status": "UNPAID", "reason": "NO_RECEIPT", "action": "NO_EXECUTION"}
    checked = inspect(blob)
    if not checked["hire_allowed"]:
        return {"fee_status": "UNPAID", "reason": checked["reason"], "action": "NO_EXECUTION"}
    same = match(reserve, reserve * 2)
    pack = {"slot": 1, "council": "WEIGHTED", "bps": 100, "reserve": reserve, "claim_sha256": "a" * 64}
    pack["pack_sha256"] = sign(pack)
    return {"fee_status": same["fee_status"], "pack_sha256": pack["pack_sha256"], "action": "NO_EXECUTION"}


def self_check() -> dict:
    receipt = {"source": "SIGNED_SNAPSHOT", "held_days": 30, "atoms": 50_000_000}
    body = run(receipt, b"receipt only", "holder_b", TOKEN, 500_000)
    vault = run(receipt, b"receipt only", CURVE, TOKEN, 500_000)
    if not body["pack_sha256"] or vault["reason"] != "CURVE_VAULT":
        raise RuntimeError("TRAIN_PACK_MISMATCH")
    return {"paid": body["fee_status"], "vault": vault["reason"], "action": "NO_EXECUTION"}


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
