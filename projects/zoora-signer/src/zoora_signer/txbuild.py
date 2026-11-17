"""Allowlisted instructions. A crafted intent cannot add a program."""

from __future__ import annotations

import struct
from dataclasses import dataclass

from zoora_signer.constants import (
    BUY_V2_DISCRIMINATOR,
    COMPUTE_BUDGET,
    INSTRUCTION_ALLOWLIST,
    PUMP_PROGRAM,
    SELL_V2_DISCRIMINATOR,
    SYSTEM_PROGRAM,
)
from zoora_signer.quote import lamports_for_cents


@dataclass(frozen=True)
class Instruction:
    program_id: str
    data: bytes
    accounts: tuple[str, ...]


class AllowlistError(ValueError):
    pass


def assert_allowlisted(instructions: list[Instruction], whitelist: set[str]) -> None:
    for ix in instructions:
        if ix.program_id not in INSTRUCTION_ALLOWLIST:
            raise AllowlistError("PROGRAM_NOT_ALLOWLISTED")
        if ix.program_id == SYSTEM_PROGRAM and _is_system_transfer(ix.data):
            dest = ix.accounts[1] if len(ix.accounts) > 1 else ""
            if dest not in whitelist:
                raise AllowlistError("TRANSFER_NOT_WHITELISTED")


def _is_system_transfer(data: bytes) -> bool:
    return len(data) >= 4 and int.from_bytes(data[:4], "little") == 2


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
    budget = lamports_for_cents(stake_cents, sol_usd_cents)
    if budget is None:
        raise AllowlistError("UNPRICEABLE")
    overhead = fee_lamports + ata_rent_lamports
    if overhead > budget:
        raise AllowlistError("FEES_EXCEED_STAKE")
    max_sol = budget - overhead
    min_tokens = token_out * (10_000 - slippage_bps) // 10_000
    if min_tokens < 1:
        min_tokens = 1
    data = BUY_V2_DISCRIMINATOR + struct.pack("<QQ", min_tokens, max_sol) + bytes([0])
    return [
        *_compute(fee_lamports),
        Instruction(PUMP_PROGRAM, data, (payer, mint)),
    ]


def build_sell(
    *,
    payer: str,
    mint: str,
    token_in: int,
    min_sol: int,
) -> list[Instruction]:
    data = SELL_V2_DISCRIMINATOR + struct.pack("<QQ", token_in, min_sol)
    return [*_compute(0), Instruction(PUMP_PROGRAM, data, (payer, mint))]


def build_sweep(*, payer: str, dest: str, lamports: int, whitelist: set[str]) -> list[Instruction]:
    if dest not in whitelist:
        raise AllowlistError("TRANSFER_NOT_WHITELISTED")
    data = struct.pack("<IQ", 2, lamports)
    ix = Instruction(SYSTEM_PROGRAM, data, (payer, dest))
    assert_allowlisted([ix], whitelist)
    return [ix]


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
