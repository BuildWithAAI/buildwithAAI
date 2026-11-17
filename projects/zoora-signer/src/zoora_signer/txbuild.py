"""Allowlisted instructions. A crafted intent cannot add a program."""

from __future__ import annotations

import struct
from dataclasses import dataclass

from zoora_signer.constants import (
    COMPUTE_BUDGET,
    PUMP_PROGRAM,
)


@dataclass(frozen=True)
class Instruction:
    program_id: str
    data: bytes
    accounts: tuple[str, ...]


class AllowlistError(ValueError):
    pass


class PlaceholderBuilder(AllowlistError):
    """Real buy, sell, and sweep builders are on hold. They refuse every call."""


def assert_allowlisted(instructions: list[Instruction], whitelist: set[str]) -> None:
    raise PlaceholderBuilder("PLACEHOLDER_BUILDER")


def build_buy(
    *,
    payer: str,
    mint: str,
    stake_cents: int,
    sol_usd_cents: int,
    slippage_bps: int,
    token_out: int,
    fee_lamports: int,
    ata_rent_lamports: int,
) -> list[Instruction]:
    del payer, mint, stake_cents, sol_usd_cents, slippage_bps, token_out, fee_lamports, ata_rent_lamports
    raise PlaceholderBuilder("PLACEHOLDER_BUILDER")


def build_sell(
    *,
    payer: str,
    mint: str,
    token_in: int,
    min_sol: int,
) -> list[Instruction]:
    del payer, mint, token_in, min_sol
    raise PlaceholderBuilder("PLACEHOLDER_BUILDER")


def build_sweep(*, payer: str, dest: str, lamports: int, whitelist: set[str]) -> list[Instruction]:
    del payer, dest, lamports, whitelist
    raise PlaceholderBuilder("PLACEHOLDER_BUILDER")


def _compute(priority_lamports: int) -> list[Instruction]:
    limit = bytes([2]) + struct.pack("<I", 200_000)
    price = bytes([3]) + struct.pack("<Q", priority_lamports)
    return [
        Instruction(COMPUTE_BUDGET, limit, ()),
        Instruction(COMPUTE_BUDGET, price, ()),
    ]


def max_sol_cost(ix: Instruction) -> int:
    if ix.program_id != PUMP_PROGRAM or len(ix.data) < 24:
        raise AllowlistError("NOT_A_BUY")
    _amount, cost = struct.unpack_from("<QQ", ix.data, 8)
    return int(cost)
