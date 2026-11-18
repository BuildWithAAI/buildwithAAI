"""Decode a real Solana message and enforce the instruction allowlist.

The builders emit v0 messages with no address lookup tables. This module
accepts exactly that shape and rejects anything else.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

from zoora_signer.constants import ASSOCIATED_TOKEN, COMPUTE_BUDGET, PUMP_PROGRAM, PUMP_SWAP, SPL_TOKEN, TOKEN_2022

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


def _load_specs() -> dict[tuple[str, bytes], tuple[_Role, ...]]:
    path = Path(__file__).resolve().parents[2] / "fixtures" / "pinned_ix.json"
    # src/zoora_signer/message_policy.py -> parents[2] is projects/zoora-signer
    if not path.is_file():
        path = Path(__file__).resolve().parents[3] / "projects" / "zoora-signer" / "fixtures" / "pinned_ix.json"
    document = json.loads(path.read_text(encoding="utf-8"))
    specs: dict[tuple[str, bytes], tuple[_Role, ...]] = {}
    program_for = {"pump": PUMP_PROGRAM, "pump_swap": PUMP_SWAP}
    for family, program in program_for.items():
        for spec in document[family].values():
            disc = bytes(spec["discriminator"])
            roles = tuple(
                _Role(bool(item["writable"]), bool(item["signer"]), str(item.get("address") or ""))
                for item in spec["accounts"]
            )
            specs[(program, disc)] = roles
    return specs


_SPECS = _load_specs()


def validate_transaction(raw: bytes) -> None:
    """Reject anything that is not the pinned swap shape. Address lookup tables fail closed."""

    message, lookups = _decode(raw)
    if lookups:
        raise PolicyError("ADDRESS_LOOKUP_TABLE")
    instructions = _instructions(message)
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
            atas += 1
            continue
        roles = _SPECS.get((program, data[:8]))
        if roles is None:
            raise PolicyError("SWAP_DISCRIMINATOR")
        _check_roles(metas, roles)
        swaps += 1
    if budgets > 2 or atas > 1 or swaps != 1:
        raise PolicyError("INSTRUCTION_SHAPE")


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
