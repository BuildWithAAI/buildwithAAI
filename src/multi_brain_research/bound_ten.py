"""One command for these ten steps.
"""
from __future__ import annotations

import json

from .claim_reserved import self_check as claims
from .clean_credit import self_check as credit
from .fifty_agents import run as fifty
from .gated_live import self_check as gated
from .hash_log import self_check as hashed
from .live_pack import self_check as pack
from .receipt_pack import self_check as receipts
from .zero_base import run as zero


def run() -> dict:
    return {
        "gate": gated()["reason"],
        "pack": pack()["changed_refused"],
        "claims": claims()["locked"],
        "receipts": receipts()["receipts"],
        "zero": zero()["reason"],
        "credit": credit()["after"],
        "hash": hashed()["repeat_refused"],
        "paid": fifty()["paid"],
        "unpaid": fifty()["unpaid"],
        "action": "NO_EXECUTION",
    }


if __name__ == "__main__":
    print(json.dumps(run(), sort_keys=True))
