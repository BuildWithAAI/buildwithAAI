"""Bonding-curve quote. Fee comes from the chain. A missing fee fails closed."""

from __future__ import annotations

import struct


def tokens_out(sol_in: int, virtual_sol: int, virtual_tokens: int, fee_bps: int | None) -> int | None:
    if fee_bps is None or fee_bps < 0 or fee_bps >= 10_000:
        return None
    if sol_in <= 0 or virtual_sol <= 0 or virtual_tokens <= 0:
        return None
    net = sol_in * (10_000 - fee_bps) // 10_000
    if net <= 0:
        return None
    return (virtual_tokens * net) // (virtual_sol + net)


def sol_out(tokens_in: int, virtual_sol: int, virtual_tokens: int, fee_bps: int | None) -> int | None:
    if fee_bps is None or fee_bps < 0 or fee_bps >= 10_000:
        return None
    if tokens_in <= 0 or virtual_sol <= 0 or virtual_tokens <= 0 or tokens_in >= virtual_tokens:
        return None
    gross = (virtual_sol * tokens_in) // (virtual_tokens + tokens_in)
    net = gross * (10_000 - fee_bps) // 10_000
    return net if net > 0 else None


def decode_global_fee_bps(data: bytes) -> int | None:
    """Layout checked against the live global account on 2026-11-17.

    8-byte Anchor discriminator, bool, two pubkeys, four u64 reserves, then fee bps.
    """

    offset = 8 + 1 + 32 + 32 + 8 * 4
    if len(data) < offset + 8:
        return None
    if data[:8] != bytes.fromhex("a7e8e8b1c86c727f"):
        return None
    (fee,) = struct.unpack_from("<Q", data, offset)
    if fee <= 0 or fee >= 10_000:
        return None
    return int(fee)


def lamports_for_cents(cents: int, sol_usd_cents: int) -> int | None:
    if cents < 0 or sol_usd_cents <= 0:
        return None
    return cents * 1_000_000_000 // sol_usd_cents
