"""Decode a pump.fun TradeEvent from an Anchor "Program data" log.

The discriminator and prefix layout are the published pump-public-docs
TradeEvent (discriminator bytes 189, 219, 127, 211, 78, 230, 97, 238).
Later IDL fields may follow fee_basis_points. They are ignored. A short or
non-trade payload returns None so the caller omits the row instead of
storing zeros.

This does not contact the network and does not send an order.
"""
from __future__ import annotations

import base64
import binascii
import struct

try:
    from ..solana_research.coin_evidence import b58encode
except ImportError:  # src/ is on sys.path and this package is top-level
    from solana_research.coin_evidence import b58encode

TRADE_DISCRIMINATOR = bytes((189, 219, 127, 211, 78, 230, 97, 238))
# discriminator + mint + sol + token + is_buy + user + timestamp
# + 4 reserve u64s + fee_recipient + fee_basis_points
MIN_EVENT_BYTES = 8 + 32 + 8 + 8 + 1 + 32 + 8 + 8 + 8 + 8 + 8 + 32 + 8
PROGRAM_DATA = "Program data: "


def decode_program_data(line: str, mint: str) -> dict | None:
    if type(line) is not str or not line.startswith(PROGRAM_DATA) or type(mint) is not str:
        return None
    try:
        raw = base64.b64decode(line[len(PROGRAM_DATA):], validate=True)
    except (ValueError, binascii.Error):
        return None
    if len(raw) < MIN_EVENT_BYTES or raw[:8] != TRADE_DISCRIMINATOR:
        return None
    body = raw[8:]
    if b58encode(body[:32]) != mint:
        return None
    is_buy = body[48]
    if is_buy not in (0, 1):
        return None
    virtual_sol, virtual_token, real_sol, real_token = struct.unpack_from("<4Q", body, 89)
    fee_bps = struct.unpack_from("<Q", body, 153)[0]
    if fee_bps > 10_000 or virtual_token <= 0:
        return None
    return {
        "mint": mint,
        "is_buy": bool(is_buy),
        "virtual_reserves": {"base": virtual_token, "quote": virtual_sol},
        "real_reserves": {"base": real_token, "quote": real_sol},
        "fee_bps": fee_bps,
    }
