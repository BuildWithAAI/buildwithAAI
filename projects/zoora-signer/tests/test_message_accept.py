"""The message policy accepts a pinned swap and rejects the remaining shapes."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from solders.hash import Hash
from solders.instruction import AccountMeta, Instruction
from solders.keypair import Keypair
from solders.message import Message
from solders.pubkey import Pubkey
from solders.transaction import Transaction

from zoora_signer.constants import ASSOCIATED_TOKEN, COMPUTE_BUDGET, PUMP_PROGRAM, PUMP_SWAP
from zoora_signer.message_policy import PolicyError, validate_transaction

FIXTURE = Path(__file__).resolve().parents[1] / "fixtures" / "pinned_ix.json"


def _raw(program: str, data: bytes, metas: list[AccountMeta]) -> bytes:
    payer = next(meta.pubkey for meta in metas if meta.is_signer)
    message = Message.new_with_blockhash(
        [Instruction(Pubkey.from_string(program), data, metas)],
        payer,
        Hash.default(),
    )
    return bytes(Transaction.new_unsigned(message))


def _swap(family: str, name: str) -> bytes:
    spec = json.loads(FIXTURE.read_text(encoding="utf-8"))[family][name]
    program = PUMP_PROGRAM if family == "pump" else PUMP_SWAP
    metas: list[AccountMeta] = []
    for item in spec["accounts"]:
        address = str(item["address"]) or str(Pubkey.new_unique())
        metas.append(AccountMeta(Pubkey.from_string(address), bool(item["signer"]), bool(item["writable"])))
    if not any(meta.is_signer for meta in metas):
        metas[0] = AccountMeta(metas[0].pubkey, True, True)
    return _raw(program, bytes(spec["discriminator"]), metas)


@pytest.mark.parametrize(
    ("family", "name"),
    [("pump", "buy_v2"), ("pump", "sell_v2"), ("pump_swap", "buy"), ("pump_swap", "sell")],
)
def test_pinned_swap_is_accepted(family: str, name: str) -> None:
    validate_transaction(_swap(family, name))


def test_address_lookup_and_shape_limits() -> None:
    payer = Keypair()
    budget = Instruction(Pubkey.from_string(COMPUTE_BUDGET), bytes([2, 1, 0, 0, 0]), [])
    message = Message.new_with_blockhash([budget] * 5, payer.pubkey(), Hash.default())
    raw = bytes(Transaction.new_unsigned(message))
    with pytest.raises(PolicyError, match="TOO_MANY_INSTRUCTIONS"):
        validate_transaction(raw)
    bad_budget = Instruction(Pubkey.from_string(COMPUTE_BUDGET), bytes([9, 0, 0, 0, 0]), [])
    message = Message.new_with_blockhash([bad_budget], payer.pubkey(), Hash.default())
    with pytest.raises(PolicyError, match="COMPUTE_BUDGET"):
        validate_transaction(bytes(Transaction.new_unsigned(message)))
    ata = Instruction(
        Pubkey.from_string(ASSOCIATED_TOKEN),
        bytes([0]),
        [AccountMeta(payer.pubkey(), True, True)],
    )
    message = Message.new_with_blockhash([ata], payer.pubkey(), Hash.default())
    with pytest.raises(PolicyError, match="ATA_DATA"):
        validate_transaction(bytes(Transaction.new_unsigned(message)))
