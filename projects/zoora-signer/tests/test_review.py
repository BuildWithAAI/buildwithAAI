"""Head of Security and Head of Systems findings."""

from __future__ import annotations

import hashlib
import hmac
import json
import sqlite3
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import pytest

from harness import MINT, activate, build, buy
from zoora_signer.constants import INTENT_PREFIX, PYTH_RECEIVER_PROGRAM
from zoora_signer.db import connect, verify_chain
from zoora_signer.message_policy import PolicyError, validate_transaction
from zoora_signer.oracle import parse_pyth_price_account
from zoora_signer.preflight import administrators_sid_present
from zoora_signer.secrets import InvalidSigningKey, parse_signing_key
from zoora_signer.signer import ct_day


def test_d1_midnight_rollover_still_vets(tmp_path: Path) -> None:
    signer, services = build(tmp_path)
    assert activate(signer).ok
    after = int(datetime(2026, 11, 18, tzinfo=ZoneInfo("America/Chicago")).timestamp() * 1000)
    services.clock.now = after - 1_000
    day = ct_day(services.clock.now)
    conn = sqlite3.connect(signer.path)
    for index in range(10):
        conn.execute(
            """
            INSERT INTO reservations (
              intent_id, side, mint, stake_cents, status, ct_day, created_ms, reached_signing
            ) VALUES (?, 'buy', ?, 200, 'simulated', ?, ?, 1)
            """,
            (f"seed-{index}", MINT, day, services.clock.now - 3_600_000),
        )
    conn.commit()
    conn.close()

    class FailVet:
        def __init__(self) -> None:
            self.calls = 0

        def vet(self, mint: str) -> tuple[int, str, bool]:
            self.calls += 1
            body = {
                "schema": "vet/1",
                "mint": mint,
                "verdict": "FAIL",
                "allow": False,
                "evaluated_at": 1,
                "config_version": "vetcfg-20261117-v6",
                "code_version": "t",
                "reasons": [],
            }
            return 1, json.dumps(body), False

    vet = FailVet()
    services.vet = vet

    class Rolling:
        def __init__(self) -> None:
            self.calls = 0

        def now_ms(self) -> int:
            self.calls += 1
            if self.calls < 4:
                return after - 1_000
            return after + 1_000

    services.clock = Rolling()
    decision = buy(signer)
    assert decision.code != "FILLED"
    assert vet.calls >= 1


def test_d2_ten_minute_buy_limit(tmp_path: Path) -> None:
    signer, services = build(tmp_path)
    assert activate(signer).ok
    assert buy(signer).ok
    services.clock.now += 60_000
    assert buy(signer, mint="ADyA8hdefvWN2dbGGWFotbzWxrAvLW83WG6QCVXvJKqw").code == "RATE_LIMIT"


def test_d3_hash_covers_kind_ts_and_id(tmp_path: Path) -> None:
    signer, _services = build(tmp_path)
    assert activate(signer).ok
    assert buy(signer).ok
    for column, value in (("kind", "tampered"), ("ts_ms", 1), ("id", 999)):
        fresh, _services = build(tmp_path / column)
        assert activate(fresh).ok
        assert buy(fresh).ok
        conn = connect(fresh.path)
        conn.execute(f"UPDATE events SET {column} = ? WHERE id = 1", (value,))
        assert verify_chain(conn) is False
        conn.close()


def test_h1_halt_persists_until_confirmed_unhalt(tmp_path: Path) -> None:
    signer, services = build(tmp_path)
    assert activate(signer).ok
    signer.halt("owner")
    again, _services = build(tmp_path)
    assert again.activity() == "HALTED"
    assert again.resume().code == "HALT_PERSISTED"
    assert again.unhalt("no").code == "CONFIRMATION_REQUIRED"
    assert again.unhalt("UNHALT").ok
    assert again.activity() == "PAUSED"
    del services


def test_placeholder_signing_key_and_empty_hmac(tmp_path: Path) -> None:
    with pytest.raises(InvalidSigningKey):
        parse_signing_key("<owner provisions>")
    signer, services = build(tmp_path)
    assert activate(signer).ok
    body = json.dumps(
        {
            "intent_id": "forge",
            "issued_at_ms": services.clock.now_ms(),
            "key_id": "1",
            "max_slippage_bps": 1500,
            "mint": MINT,
            "side": "buy",
            "usd_stake_micro": 2_000_000,
        },
        sort_keys=True,
        separators=(",", ":"),
    ).encode()
    forged = hmac.new(b"", INTENT_PREFIX + body, hashlib.sha256).hexdigest()
    assert signer.handle_intent(body, forged).code == "BAD_HMAC"


def test_owner_sell_unknown_mark_under_kill(tmp_path: Path) -> None:
    signer, services = build(tmp_path)
    assert activate(signer).ok
    assert buy(signer).ok
    services.marks.by_mint[MINT] = None
    signer.halt("owner")
    decision = signer.owner_sell(MINT)
    assert decision.code != "UNPRICEABLE"
    assert decision.ok


def test_status_does_not_create_a_database(tmp_path: Path) -> None:
    from zoora_signer.cli import main

    db = tmp_path / "missing.sqlite"
    assert main(["--db", str(db), "status"]) == 1
    assert not db.exists()
    raw = Path(__file__).resolve().parents[1].joinpath("fixtures/pyth_sol_usd_price.bin").read_bytes()
    parsed = parse_pyth_price_account(raw, PYTH_RECEIVER_PROGRAM)
    assert parsed is not None and parsed[0] > 0
    assert parse_pyth_price_account(raw, "11111111111111111111111111111111") is None
    assert administrators_sid_present("S-1-5-32-544 Group used for deny only")


@pytest.mark.parametrize(
    ("program", "data", "code"),
    [
        ("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", bytes([4]), "TOKEN_APPROVE"),
        ("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", bytes([6]), "TOKEN_SET_AUTHORITY"),
        ("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", bytes([9]), "TOKEN_CLOSE"),
        ("11111111111111111111111111111111", (0).to_bytes(4, "little"), "SYSTEM_CREATE"),
        ("11111111111111111111111111111111", (1).to_bytes(4, "little"), "SYSTEM_ASSIGN"),
        ("11111111111111111111111111111111", (2).to_bytes(4, "little"), "SYSTEM_TRANSFER"),
        ("11111111111111111111111111111111", (11).to_bytes(4, "little"), "SYSTEM_TRANSFER_WITH_SEED"),
    ],
)
def test_message_policy_rejects_forbidden_instructions(program: str, data: bytes, code: str) -> None:
    from solders.hash import Hash
    from solders.instruction import Instruction
    from solders.keypair import Keypair
    from solders.message import Message
    from solders.pubkey import Pubkey
    from solders.transaction import Transaction

    payer = Keypair()
    ix = Instruction(Pubkey.from_string(program), data, [])
    message = Message.new_with_blockhash([ix], payer.pubkey(), Hash.default())
    raw = bytes(Transaction.new_unsigned(message))
    with pytest.raises(PolicyError, match=code):
        validate_transaction(raw)


def test_message_policy_rejects_token_transfer() -> None:
    from solders.hash import Hash
    from solders.instruction import AccountMeta, Instruction
    from solders.keypair import Keypair
    from solders.message import Message
    from solders.pubkey import Pubkey
    from solders.transaction import Transaction

    payer = Keypair()
    dest = Pubkey.new_unique()
    data = (3).to_bytes(1, "little") + (1).to_bytes(8, "little")
    ix = Instruction(
        Pubkey.from_string("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
        data,
        [AccountMeta(payer.pubkey(), True, True), AccountMeta(dest, False, True)],
    )
    message = Message.new_with_blockhash([ix], payer.pubkey(), Hash.default())
    raw = bytes(Transaction.new_unsigned(message))
    with pytest.raises(PolicyError, match="TOKEN_TRANSFER"):
        validate_transaction(raw)
