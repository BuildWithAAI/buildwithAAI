"""Account tape row with the computed price and the missing-field list.
"""
from __future__ import annotations

import json

from .account_tape import tape_from_account
from .curve_price import price


def join(raw_account: dict) -> dict:
    tape = tape_from_account(raw_account)
    quoted = price(tape["virtual_reserves"])
    tape["price_quote_per_base"] = quoted["price_quote_per_base"]
    tape["price_source"] = quoted["source"]
    return tape


def self_check() -> dict:
    from pathlib import Path
    row = join(json.loads(Path("/tmp/curve-account.json").read_text()))
    if "fee_bps" not in row["missing"] or row["price_quote_per_base"] <= 0:
        raise RuntimeError("JOIN_MISMATCH")
    return {"price": row["price_quote_per_base"], "missing": row["missing"], "action": "NO_EXECUTION"}


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
