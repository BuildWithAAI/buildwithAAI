"""Read a wallet hold of Anything AI.

Default path is a fixture. A live read is optional, HTTPS only, one method,
this mint only. It never sends.
"""
from __future__ import annotations

import json
from urllib.request import Request, build_opener

from .inventory_gate import CURVE, TOKEN, gate

READ_METHOD = "getTokenAccountsByOwner"


class HoldError(ValueError):
    pass


def from_accounts(wallet: str, accounts: list[dict], held_days: int) -> dict:
    if wallet == CURVE:
        return gate(wallet, held_days, 0)
    atoms = 0
    for account in accounts:
        if account.get("mint") != TOKEN:
            raise HoldError("OTHER_MINT")
        if type(account.get("amount")) is not int:
            raise HoldError("BAD_AMOUNT")
        atoms += account["amount"]
    return gate(wallet, held_days, atoms)


def live_read(wallet: str, endpoint: str, held_days: int) -> dict:
    if not endpoint.startswith("https://") or wallet == CURVE:
        raise HoldError("REFUSED")
    body = json.dumps({
        "jsonrpc": "2.0",
        "id": 1,
        "method": READ_METHOD,
        "params": [wallet, {"mint": TOKEN}, {"encoding": "jsonParsed"}],
    }).encode()
    request = Request(endpoint, data=body, headers={"Content-Type": "application/json"}, method="POST")
    with build_opener().open(request, timeout=15) as response:
        payload = json.loads(response.read(1_048_576))
    accounts = []
    for item in payload.get("result", {}).get("value", []):
        info = item["account"]["data"]["parsed"]["info"]
        if info["mint"] != TOKEN:
            continue
        accounts.append({"mint": TOKEN, "amount": int(info["tokenAmount"]["amount"])})
    return from_accounts(wallet, accounts, held_days)


def self_check() -> dict:
    held = from_accounts("holder_b", [{"mint": TOKEN, "amount": 50_000_000}], 30)
    vault = from_accounts(CURVE, [{"mint": TOKEN, "amount": 10**12}], 90)
    if not held["fee_allowed"] or vault["fee_allowed"]:
        raise HoldError("HOLD_MISMATCH")
    return {"holder": held["score"], "vault": vault["reason"], "action": "NO_EXECUTION"}


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
