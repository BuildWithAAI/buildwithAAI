"""Bounded bonding-curve event decoder.

Accepts only the fields named in BONDING_CURVE.md. Missing fields fail.
Absent events are omitted, never stored as zero trades. This does not
contact a network and does not send an order.
"""
from __future__ import annotations

import hashlib
import json

REQUIRED = (
    "mint",
    "curve_account",
    "virtual_reserves",
    "real_reserves",
    "fee_bps",
    "slot",
    "signature",
)
CLASSIFICATION = "CURVE_FIXTURE_NOT_CHAIN_ATTESTED"


class CurveError(ValueError):
    pass


def _canonical(value: object) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True, allow_nan=False).encode("ascii")


def decode_curve_event(event: dict) -> dict:
    if type(event) is not dict:
        raise CurveError("EVENT_NOT_OBJECT")
    missing = [name for name in REQUIRED if name not in event]
    if missing:
        raise CurveError("MISSING_CURVE_FIELD")
    mint = event["mint"]
    curve = event["curve_account"]
    signature = event["signature"]
    if any(type(value) is not str or not value for value in (mint, curve, signature)):
        raise CurveError("INVALID_IDENTITY")
    reserves = event["virtual_reserves"]
    real = event["real_reserves"]
    if type(reserves) is not dict or type(real) is not dict:
        raise CurveError("INVALID_RESERVES")
    for book in (reserves, real):
        for side in ("base", "quote"):
            amount = book.get(side)
            if type(amount) is not int or amount < 0:
                raise CurveError("INVALID_RESERVE_AMOUNT")
    fee = event["fee_bps"]
    slot = event["slot"]
    if type(fee) is not int or not 0 <= fee <= 10_000:
        raise CurveError("INVALID_FEE")
    if type(slot) is not int or slot < 0:
        raise CurveError("INVALID_SLOT")
    quote = reserves["quote"]
    base = reserves["base"]
    if base == 0:
        raise CurveError("ZERO_BASE_RESERVE")
    price = quote / base
    body = {
        "protocol": "AAI_CURVE_EVENT_V1",
        "classification": CLASSIFICATION,
        "mint": mint,
        "curve_account": curve,
        "signature": signature,
        "slot": slot,
        "fee_bps": fee,
        "virtual_reserves": reserves,
        "real_reserves": real,
        "observed_price": price,
        "action": "NO_EXECUTION",
    }
    body["event_sha256"] = hashlib.sha256(b"BUILDWITHAAI_CURVE_V1\0" + _canonical(body)).hexdigest()
    return body


def observation_from_curve(decoded: dict) -> dict:
    """Shape the feature loader can read. Curve price is not a PumpSwap last trade."""
    return {
        "last_trade_price": decoded["observed_price"],
        "quote_atoms": decoded["virtual_reserves"]["quote"],
        "signed_quote_flow": 0,
        "source": "CURVE",
        "classification": decoded["classification"],
        "action": "NO_EXECUTION",
    }


def self_check() -> dict:
    good = {
        "mint": "mint111",
        "curve_account": "curve111",
        "virtual_reserves": {"base": 1_000_000, "quote": 2_000_000},
        "real_reserves": {"base": 10, "quote": 20},
        "fee_bps": 100,
        "slot": 42,
        "signature": "sig111",
    }
    decoded = decode_curve_event(good)
    if decoded["action"] != "NO_EXECUTION" or decoded["observed_price"] != 2:
        raise CurveError("DECODE_MISMATCH")
    incomplete = dict(good)
    del incomplete["fee_bps"]
    try:
        decode_curve_event(incomplete)
    except CurveError as err:
        if str(err) != "MISSING_CURVE_FIELD":
            raise
    else:
        raise CurveError("MISSING_FIELD_ACCEPTED")
    return {
        "classification": CLASSIFICATION,
        "event_sha256": decoded["event_sha256"],
        "omitted_not_zero": True,
        "action": "NO_EXECUTION",
    }


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
