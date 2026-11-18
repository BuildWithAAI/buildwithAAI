"""Decode a real Solana message and enforce the instruction allowlist.

The builders emit v0 messages with no address lookup tables. This module
accepts exactly that shape and rejects anything else.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

from zoora_signer.constants import (
    ASSOCIATED_TOKEN,
    COMPUTE_BUDGET,
    FEE_PROGRAM,
    PUMP_PROGRAM,
    PUMP_SWAP,
    SPL_TOKEN,
    TOKEN_2022,
)

# SPL Token instruction tags from the program interface (first byte).
TOKEN_TRANSFER = 3
TOKEN_APPROVE = 4
TOKEN_SET_AUTHORITY = 6
TOKEN_CLOSE = 9
# System instruction tags (little-endian u32).
SYSTEM_CREATE = 0
SYSTEM_ASSIGN = 1
SYSTEM_TRANSFER = 2
SYSTEM_TRANSFER_WITH_SEED = 11
ATA_CREATE_IDEMPOTENT = 1
_TOKEN_PROGRAMS = {SPL_TOKEN, TOKEN_2022}
_SYSTEM = "11111111111111111111111111111111"


class PolicyError(ValueError):
    pass


@dataclass(frozen=True)
class _Role:
    writable: bool
    signer: bool
    address: str


_CURRENT = {"pump": {"buy_v3", "sell_v3"}, "pump_swap": {"buy_v2", "sell_v2"}}
# One pinned version from pump-public-docs 639b87fb45c3adeffa6f7c4a1bf0cb85e392bf22.
# Curve trades are v3. PumpSwap trades are v2. Older discs are rejected.


def _load_pinned() -> tuple[dict[tuple[str, bytes], tuple[_Role, ...]], set[tuple[str, bytes]]]:
    path = Path(__file__).resolve().parents[2] / "fixtures" / "pinned_ix.json"
    if not path.is_file():
        path = Path(__file__).resolve().parents[3] / "projects" / "zoora-signer" / "fixtures" / "pinned_ix.json"
    document = json.loads(path.read_text(encoding="utf-8"))
    specs: dict[tuple[str, bytes], tuple[_Role, ...]] = {}
    retired: set[tuple[str, bytes]] = set()
    program_for = {"pump": PUMP_PROGRAM, "pump_swap": PUMP_SWAP}
    for family, program in program_for.items():
        for name, spec in document[family].items():
            disc = bytes(spec["discriminator"])
            if name not in _CURRENT[family]:
                retired.add((program, disc))
                continue
            roles = tuple(
                _Role(bool(item["writable"]), bool(item["signer"]), str(item.get("address") or ""))
                for item in spec["accounts"]
            )
            specs[(program, disc)] = roles
    return specs, retired


_SPECS, _RETIRED = _load_pinned()


def validate_transaction(
    raw: bytes,
    *,
    owner: str | None = None,
    mint: str | None = None,
    max_all_in_lamports: int | None = None,
    expected_token_amount: int | None = None,
    expected_limit_lamports: int | None = None,
) -> None:
    """Reject anything that is not the pinned v3 (or PumpSwap v2) shape."""

    message, lookups = _decode(raw)
    if lookups:
        raise PolicyError("ADDRESS_LOOKUP_TABLE")
    header = message.header  # type: ignore[attr-defined]
    if int(header.num_required_signatures) != 1:
        raise PolicyError("SIGNER_COUNT")
    instructions = _instructions(message)
    if owner is not None:
        payer = _fee_payer(message)
        if payer != owner:
            raise PolicyError("FEE_PAYER")
    if len(instructions) > 4:
        raise PolicyError("TOO_MANY_INSTRUCTIONS")
    swaps = 0
    budgets = 0
    atas = 0
    seen_limit = False
    seen_price = False
    for program, data, metas in instructions:
        forbidden = _forbidden(program, data)
        if forbidden:
            raise PolicyError(forbidden)
        if program == COMPUTE_BUDGET:
            kind = _budget_kind(data)
            if kind == "limit":
                if seen_limit:
                    raise PolicyError("COMPUTE_BUDGET")
                seen_limit = True
            elif kind == "price":
                if seen_price:
                    raise PolicyError("COMPUTE_BUDGET")
                seen_price = True
            else:
                raise PolicyError("COMPUTE_BUDGET")
            budgets += 1
            continue
        if program == ASSOCIATED_TOKEN:
            if data != bytes([ATA_CREATE_IDEMPOTENT]):
                raise PolicyError("ATA_DATA")
            if owner is not None and (len(metas) < 3 or metas[2][0] != owner):
                raise PolicyError("ATA_OWNER")
            atas += 1
            continue
        roles = _SPECS.get((program, data[:8]))
        if roles is None:
            if _retired(program, data[:8]):
                raise PolicyError("WRONG_VERSION")
            raise PolicyError("SWAP_DISCRIMINATOR")
        _check_roles(metas, roles)
        _check_derived(program, data, metas, owner, mint)
        _check_amounts(
            data,
            max_all_in_lamports=max_all_in_lamports,
            expected_token_amount=expected_token_amount,
            expected_limit_lamports=expected_limit_lamports,
        )
        swaps += 1
    _check_budget(instructions, max_all_in_lamports)
    if budgets > 2 or atas > 1 or swaps != 1:
        raise PolicyError("INSTRUCTION_SHAPE")


_BUYBACKS = frozenset(
    {
        "5YxQFdt3Tr9zJLvkFccqXVUwhdTWJQc1fFg2YPbxvxeD",
        "9M4giFFMxmFGXtc3feFzRai56WbBqehoSeRE5GK7gf7",
        "GXPFM2caqTtQYC2cJ5yJRi9VDkpsYZXzYdwYpGnLmtDL",
        "3BpXnfJaUTiwXnJNe7Ej1rcbzqTTQUvLShZaWazebsVR",
        "5cjcW9wExnJJiqgLjq7DEG75Pm6JBgE1hNv4B2vHXUW6",
        "EHAAiTxcdDwQ3U4bU6YcMsQGaekdzLS3B5SmYo46kJtL",
        "5eHhjP8JaYkz83CWwvGU2uMUXefd3AazWGx4gpcuEEYD",
        "A7hAgCzFw14fejgCp387JUJRMNyz4j89JKnhtKU8piqW",
    }
)
_MAX_PRIORITY_LAMPORTS = 50_000_000
_MAX_SOL_LAMPORTS = 50_000_000_000


def _retired(program: str, disc: bytes) -> bool:
    return (program, disc) in _RETIRED


def _fee_payer(message: object) -> str:
    keys = message.account_keys  # type: ignore[attr-defined]
    return str(keys[0])


def _pda(seeds: list[bytes], program: str) -> str:
    from solders.pubkey import Pubkey

    return str(Pubkey.find_program_address(seeds, Pubkey.from_string(program))[0])


def _ata(owner: str, token_program: str, mint: str) -> str:
    from solders.pubkey import Pubkey

    return _pda(
        [bytes(Pubkey.from_string(owner)), bytes(Pubkey.from_string(token_program)), bytes(Pubkey.from_string(mint))],
        ASSOCIATED_TOKEN,
    )


def _key_bytes(value: str) -> bytes:
    from solders.pubkey import Pubkey

    return bytes(Pubkey.from_string(value))


def _check_derived(
    program: str,
    data: bytes,
    metas: list[tuple[str, bool, bool]],
    owner: str | None,
    mint: str | None,
) -> None:
    del data
    if owner is None or mint is None or len(metas) < 17:
        return
    if program == PUMP_PROGRAM:
        token_program = metas[3][0]
        curve = _pda([b"bonding-curve", _key_bytes(mint)], PUMP_PROGRAM)
        if metas[0][0] != _pda([b"global"], PUMP_PROGRAM):
            raise PolicyError("GLOBAL")
        if metas[5][0] != curve:
            raise PolicyError("BONDING_CURVE")
        if metas[6][0] != _ata(curve, token_program, mint):
            raise PolicyError("ASSOCIATED_BONDING_CURVE")
        if metas[8][0] != owner:
            raise PolicyError("FEE_PAYER")
        if metas[9][0] != _ata(owner, token_program, mint):
            raise PolicyError("ASSOCIATED_USER")
        volume = _pda([b"user_volume_accumulator", _key_bytes(owner)], PUMP_PROGRAM)
        if metas[11][0] != volume:
            raise PolicyError("VOLUME")
        fee = _pda([b"fee_config", _key_bytes(PUMP_PROGRAM)], FEE_PROGRAM)
        if metas[12][0] != fee:
            raise PolicyError("FEE_CONFIG")
        if metas[13][0] not in _BUYBACKS:
            raise PolicyError("FEE_RECIPIENT")
        return
    if program == PUMP_SWAP:
        if metas[1][0] != owner:
            raise PolicyError("FEE_PAYER")
        if metas[2][0] != _pda([b"global_config"], PUMP_SWAP):
            raise PolicyError("GLOBAL")
        if metas[14][0] not in _BUYBACKS:
            raise PolicyError("FEE_RECIPIENT")


def _check_amounts(
    data: bytes,
    *,
    max_all_in_lamports: int | None,
    expected_token_amount: int | None,
    expected_limit_lamports: int | None,
) -> None:
    import struct

    if len(data) < 24:
        raise PolicyError("SWAP_DATA")
    amount, limit = struct.unpack_from("<QQ", data, 8)
    ceiling = max_all_in_lamports if max_all_in_lamports is not None else _MAX_SOL_LAMPORTS
    if amount == 0 or limit > ceiling:
        raise PolicyError("MAX_SOL")
    if expected_token_amount is not None and amount != expected_token_amount:
        raise PolicyError("TOKEN_AMOUNT")
    if expected_limit_lamports is not None and limit != expected_limit_lamports:
        raise PolicyError("LIMIT_LAMPORTS")


def _check_budget(instructions: list[tuple[str, bytes, list[tuple[str, bool, bool]]]], max_all_in: int | None) -> None:
    limit = 0
    price = 0
    for program, data, _metas in instructions:
        if program != COMPUTE_BUDGET:
            continue
        if data[:1] == b"\x02" and len(data) == 5:
            limit = int.from_bytes(data[1:], "little")
        elif data[:1] == b"\x03" and len(data) == 9:
            price = int.from_bytes(data[1:], "little")
    if limit == 0 and price == 0:
        return
    fee = (limit * price + 999_999) // 1_000_000 if limit and price else 0
    cap = max_all_in if max_all_in is not None else _MAX_PRIORITY_LAMPORTS
    if price > 2**32 or fee > cap:
        raise PolicyError("CU_PRICE")


def _budget_kind(data: bytes) -> str:
    if data[:1] == b"\x02" and len(data) == 5:
        return "limit"
    if data[:1] == b"\x03" and len(data) == 9:
        return "price"
    return ""


def _forbidden(program: str, data: bytes) -> str:
    if program in _TOKEN_PROGRAMS and data:
        tag = data[0]
        if tag == TOKEN_TRANSFER:
            return "TOKEN_TRANSFER"
        if tag == TOKEN_APPROVE:
            return "TOKEN_APPROVE"
        if tag == TOKEN_SET_AUTHORITY:
            return "TOKEN_SET_AUTHORITY"
        if tag == TOKEN_CLOSE:
            return "TOKEN_CLOSE"
    if program == _SYSTEM and len(data) >= 4:
        tag = int.from_bytes(data[:4], "little")
        if tag == SYSTEM_CREATE:
            return "SYSTEM_CREATE"
        if tag == SYSTEM_ASSIGN:
            return "SYSTEM_ASSIGN"
        if tag == SYSTEM_TRANSFER:
            return "SYSTEM_TRANSFER"
        if tag == SYSTEM_TRANSFER_WITH_SEED:
            return "SYSTEM_TRANSFER_WITH_SEED"
    return ""


def _check_roles(metas: list[tuple[str, bool, bool]], roles: tuple[_Role, ...]) -> None:
    if len(metas) != len(roles):
        raise PolicyError("ACCOUNT_COUNT")
    for (pubkey, signer, writable), role in zip(metas, roles, strict=True):
        if signer != role.signer or writable != role.writable:
            raise PolicyError("ACCOUNT_ROLE")
        if role.address and pubkey != role.address:
            raise PolicyError("ACCOUNT_ADDRESS")


def _decode(raw: bytes) -> tuple[object, bool]:
    from solders.transaction import Transaction, VersionedTransaction

    try:
        versioned = VersionedTransaction.from_bytes(raw)
    except Exception:
        versioned = None
    if versioned is not None:
        message = versioned.message
        lookups = bool(getattr(message, "address_table_lookups", []))
        return message, lookups
    try:
        legacy = Transaction.from_bytes(raw)
    except Exception as exc:
        raise PolicyError("UNDECODABLE") from exc
    return legacy.message, False


def _instructions(message: object) -> list[tuple[str, bytes, list[tuple[str, bool, bool]]]]:
    keys = [str(key) for key in message.account_keys]  # type: ignore[attr-defined]
    header = message.header  # type: ignore[attr-defined]
    signed = int(header.num_required_signatures)
    readonly_signed = int(header.num_readonly_signed_accounts)
    readonly_unsigned = int(header.num_readonly_unsigned_accounts)
    signed_writable = signed - readonly_signed
    unsigned_writable_end = len(keys) - readonly_unsigned

    def flags(index: int) -> tuple[bool, bool]:
        is_signer = index < signed
        if index < signed_writable:
            return is_signer, True
        if index < signed:
            return is_signer, False
        if index < unsigned_writable_end:
            return False, True
        return False, False

    compiled = message.instructions  # type: ignore[attr-defined]
    out: list[tuple[str, bytes, list[tuple[str, bool, bool]]]] = []
    for ix in compiled:
        program = keys[int(ix.program_id_index)]
        metas: list[tuple[str, bool, bool]] = []
        for account_index in ix.accounts:
            signer, writable = flags(int(account_index))
            metas.append((keys[int(account_index)], signer, writable))
        out.append((program, bytes(ix.data), metas))
    return out
