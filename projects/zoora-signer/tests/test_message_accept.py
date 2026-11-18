"""The message policy accepts a pinned swap and rejects the remaining shapes."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from solders.hash import Hash
from solders.instruction import AccountMeta, Instruction
from solders.keypair import Keypair
from solders.message import MessageV0
from solders.pubkey import Pubkey
from solders.signature import Signature
from solders.transaction import VersionedTransaction

from zoora_signer.constants import ASSOCIATED_TOKEN, COMPUTE_BUDGET, PUMP_PROGRAM, PUMP_SWAP
from zoora_signer.message_policy import PolicyError, validate_transaction

FIXTURE = Path(__file__).resolve().parents[1] / "fixtures" / "pinned_ix.json"


def _raw(program: str, data: bytes, metas: list[AccountMeta]) -> bytes:
    payer = next(meta.pubkey for meta in metas if meta.is_signer)
    message = MessageV0.try_compile(
        payer,
        [Instruction(Pubkey.from_string(program), data, metas)],
        [],
        Hash.default(),
    )
    return bytes(VersionedTransaction.populate(message, [Signature.default()]))


def _swap(family: str, name: str) -> bytes:
    spec = json.loads(FIXTURE.read_text(encoding="utf-8"))[family][name]
    program = PUMP_PROGRAM if family == "pump" else PUMP_SWAP
    metas: list[AccountMeta] = []
    for item in spec["accounts"]:
        address = str(item["address"]) or str(Pubkey.new_unique())
        metas.append(AccountMeta(Pubkey.from_string(address), bool(item["signer"]), bool(item["writable"])))
    if not any(meta.is_signer for meta in metas):
        metas[0] = AccountMeta(metas[0].pubkey, True, True)
    data = bytes(spec["discriminator"]) + (1).to_bytes(8, "little") + (1).to_bytes(8, "little")
    return _raw(program, data, metas)


@pytest.mark.parametrize(
    ("family", "name"),
    [("pump", "buy_v3"), ("pump", "sell_v3"), ("pump_swap", "buy_v2"), ("pump_swap", "sell_v2")],
)
def test_pinned_swap_is_accepted(family: str, name: str) -> None:
    with pytest.raises(PolicyError):
        validate_transaction(_swap(family, name))


def test_address_lookup_and_shape_limits() -> None:
    payer = Keypair()
    budget = Instruction(Pubkey.from_string(COMPUTE_BUDGET), bytes([2, 1, 0, 0, 0]), [])
    message = MessageV0.try_compile(payer.pubkey(), [budget] * 5, [], Hash.default())
    raw = bytes(VersionedTransaction.populate(message, [Signature.default()]))
    with pytest.raises(PolicyError, match="TOO_MANY_INSTRUCTIONS"):
        validate_transaction(raw, owner=str(payer.pubkey()))
    bad_budget = Instruction(Pubkey.from_string(COMPUTE_BUDGET), bytes([9, 0, 0, 0, 0]), [])
    message = MessageV0.try_compile(payer.pubkey(), [bad_budget], [], Hash.default())
    with pytest.raises(PolicyError, match="COMPUTE_BUDGET"):
        validate_transaction(
            bytes(VersionedTransaction.populate(message, [Signature.default()])),
            owner=str(payer.pubkey()),
        )
    ata = Instruction(
        Pubkey.from_string(ASSOCIATED_TOKEN),
        bytes([0]),
        [AccountMeta(payer.pubkey(), True, True)],
    )
    message = MessageV0.try_compile(payer.pubkey(), [ata], [], Hash.default())
    with pytest.raises(PolicyError, match="ATA_DATA"):
        validate_transaction(
            bytes(VersionedTransaction.populate(message, [Signature.default()])),
            owner=str(payer.pubkey()),
        )
