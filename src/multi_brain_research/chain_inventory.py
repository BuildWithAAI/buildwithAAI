"""Real inventory lookup.

Read-only token accounts for the AAI mint. Vault and zero stay unpaid.
"""
from __future__ import annotations

import json
from urllib.request import Request, build_opener

from .inventory_gate import CURVE, TOKEN
from .rpc_allow import allow

RPC = "https://api.mainnet-beta.solana.com"


def lookup(wallet: str) -> dict:
    if wallet == CURVE:
        return {"fee_allowed": False, "reason": "CURVE_VAULT", "atoms": 0, "action": "NO_EXECUTION"}
    if not allow(RPC, 49)["ok"]:
        return {"fee_allowed": False, "reason": "RPC_REFUSED", "action": "NO_EXECUTION"}
    body = json.dumps({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "getTokenAccountsByOwner",
        "params": [wallet, {"mint": TOKEN}, {"encoding": "jsonParsed"}],
    }).encode()
    request = Request(RPC, data=body, headers={"Content-Type": "application/json"}, method="POST")
    with build_opener().open(request, timeout=20) as response:
        payload = json.loads(response.read(262144))
    accounts = (payload.get("result") or {}).get("value") or []
    atoms = sum(int(row["account"]["data"]["parsed"]["info"]["tokenAmount"]["amount"]) for row in accounts)
    if atoms <= 0:
        return {"fee_allowed": False, "reason": "ZERO_BALANCE", "atoms": 0, "action": "NO_EXECUTION"}
    return {"fee_allowed": True, "reason": "CHAIN_READ", "atoms": atoms, "action": "NO_EXECUTION"}


def self_check() -> dict:
    vault = lookup(CURVE)
    if vault["fee_allowed"]:
        raise RuntimeError("VAULT_LOOKED_UP")
    return {"vault": vault["reason"], "action": "NO_EXECUTION"}


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
