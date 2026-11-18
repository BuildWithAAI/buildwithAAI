"""Head of Security and Head of Systems re-check of the dry-run signer."""

from __future__ import annotations

import base64
import json
import sqlite3
from pathlib import Path

import pytest
from solders.hash import Hash
from solders.instruction import AccountMeta
from solders.instruction import Instruction as SoldersInstruction
from solders.keypair import Keypair
from solders.message import MessageV0
from solders.pubkey import Pubkey
from solders.signature import Signature
from solders.transaction import VersionedTransaction

from harness import MINT, activate, build, buy
from zoora_signer.constants import BUY_V3_DISCRIMINATOR, COMPUTE_BUDGET, PUMP_PROGRAM, SELL_V3_DISCRIMINATOR, TOKEN_2022
from zoora_signer.killswitch import AgentGuardKill
from zoora_signer.message_policy import PolicyError, validate_transaction
from zoora_signer.preflight import HIGH_INTEGRITY_SID, judge_clock, parse_icacls, parse_whoami
from zoora_signer.txbuild import build_curve_buy, build_curve_sell

ROOT = Path(__file__).resolve().parents[1]
FIXTURE = json.loads((ROOT / "fixtures" / "e2e_curve.json").read_text(encoding="utf-8"))
ORDER = FIXTURE["accounts_in_order"]
USER = ORDER[8]
CURVE = base64.b64decode(FIXTURE["accounts"][ORDER[5]]["data"])
FEE = base64.b64decode(FIXTURE["accounts"][ORDER[12]]["data"])
MINT_DATA = base64.b64decode(FIXTURE["accounts"][ORDER[1]]["data"])


def _inputs(token_in: int = 10_000_000_000_000) -> dict[str, object]:
    return {
        "user": USER,
        "mint_data": MINT_DATA,
        "mint_owner": TOKEN_2022,
        "curve_data": CURVE,
        "fee_config_data": FEE,
        "buyback": ORDER[13],
        "token_in": token_in,
        "sol_usd_cents": 100_000,
        "slippage_bps": 0,
    }


def test_sticky_halt_is_not_overwritten(tmp_path: Path) -> None:
    signer, services = build(tmp_path)
    assert activate(signer).ok
    signer.halt("unexpected_sol")
    signer.halt("killed")
    signer._halt("ORACLE_DOWN")
    conn = sqlite3.connect(signer.path)
    reason = str(conn.execute("SELECT halt_reason FROM signer_state").fetchone()[0])
    conn.close()
    assert "unexpected_sol" in reason
    assert "killed" in reason
    assert "ORACLE_DOWN" in reason
    assert signer.resume().code == "HALT_PERSISTED"
    assert signer.unhalt("UNHALT").code == "RECONCILE_REQUIRED"
    conn = sqlite3.connect(signer.path)
    kept = str(conn.execute("SELECT halt_reason FROM signer_state").fetchone()[0])
    conn.close()
    assert kept == "unexpected_sol"
    assert signer.activity() == "HALTED"


def test_live_sell_stays_open_when_broadcast_is_refused(tmp_path: Path) -> None:
    signer, services = build(tmp_path)
    assert activate(signer).ok
    assert buy(signer).ok
    services.market = type("Market", (), {"sell_inputs": lambda self, mint: _inputs()})()
    assert signer.set_route("https://example.invalid/permission", "2026-11-17", "written permission").ok
    assert signer.set_mode("LIVE").ok
    decision = signer.owner_sell(MINT, 10_000_000_000_000)
    assert decision.code == "BROADCAST_REFUSED"
    conn = sqlite3.connect(signer.path)
    status = conn.execute("SELECT status FROM trades").fetchone()
    conn.close()
    assert status is not None and status[0] == "open"


def test_clock_rejects_a_forged_rpc_date() -> None:
    local = 1_000_000
    forged_rpc = local
    https = [local + 10_000, local + 10_400]
    assert judge_clock(local, https, forged_rpc) is None
    assert judge_clock(local, [local + 100, local + 400], local + 200) == 400


def _engage(root: Path) -> Path:
    """agent-guard engage() is not in this repo. It writes state/KILL_SWITCH and no heartbeat."""

    path = root / "state" / "KILL_SWITCH"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"")
    return path


def test_agent_guard_clear_requires_a_fresh_heartbeat(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    from zoora_signer.heartbeat import write_heartbeat

    now = {"ms": 1_000_000}
    guard = AgentGuardKill(tmp_path, now_ms=lambda: now["ms"])
    assert guard.poll() == "killed"
    write_heartbeat(tmp_path, now["ms"])
    assert guard.poll() == "clear"
    _engage(tmp_path)
    assert guard.poll() == "killed"
    (tmp_path / "state" / "KILL_SWITCH").unlink()
    assert guard.poll() == "clear"
    kill_file = tmp_path / "external-kill"
    kill_file.write_bytes(b"")
    monkeypatch.setenv("AGENT_GUARD_KILL_FILE", str(kill_file))
    assert guard.poll() == "killed"
    monkeypatch.delenv("AGENT_GUARD_KILL_FILE")
    assert guard.poll() == "clear"
    if __import__("os").name != "nt":
        heartbeat = tmp_path / "heartbeat.json"
        heartbeat.chmod(0o644)
        assert guard.poll() == "killed"
        heartbeat.chmod(0o600)
        assert guard.poll() == "clear"
    now["ms"] += 20_000
    assert guard.poll() == "killed"


def test_policy_rejects_foreign_accounts_and_absurd_fees() -> None:
    built = build_curve_buy(
        user=USER,
        mint_address=ORDER[1],
        mint_data=MINT_DATA,
        mint_owner=TOKEN_2022,
        curve_data=CURVE,
        fee_config_data=FEE,
        buyback_fee_recipient=ORDER[13],
        sol_usd_cents=100_000,
        stake_cents=200,
        slippage_bps=0,
        create_base_ata=False,
    )
    validate_transaction(built.raw, owner=USER, mint=ORDER[1])
    huge = SoldersInstruction(
        Pubkey.from_string(COMPUTE_BUDGET),
        bytes([3]) + (2**64 - 1).to_bytes(8, "little"),
        [],
    )
    payer = Pubkey.from_string(USER)
    message = MessageV0.try_compile(payer, [huge, _swap_ix(built, built.data)], [], Hash.default())
    raw = bytes(VersionedTransaction.populate(message, [Signature.default()]))
    with pytest.raises(PolicyError, match="CU_PRICE"):
        validate_transaction(raw, owner=USER, mint=ORDER[1])
    blown = built.data[:16] + (2**64 - 1).to_bytes(8, "little")
    message = MessageV0.try_compile(payer, [_swap_ix(built, blown)], [], Hash.default())
    raw = bytes(VersionedTransaction.populate(message, [Signature.default()]))
    with pytest.raises(PolicyError, match="MAX_SOL"):
        validate_transaction(raw, owner=USER, mint=ORDER[1])


def test_bad_discriminator_rehearsal_exits_nonzero() -> None:
    import importlib.util

    spec = importlib.util.spec_from_file_location("e2e_validator", ROOT / "scripts" / "e2e_validator.py")
    assert spec is not None and spec.loader is not None
    rehearsal = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(rehearsal)

    def simulate(payload: str) -> object:
        body = base64.b64decode(payload)
        if BUY_V3_DISCRIMINATOR not in body and SELL_V3_DISCRIMINATOR not in body:
            return {"InstructionError": [0, {"Custom": 101}]}
        return None

    bad = base64.b64encode(b"disc" + b"\xff" * 8).decode()
    buy_err, sell_err = rehearsal.run_pair(simulate, bad, bad)
    assert rehearsal.rehearsal_result(buy_err, sell_err) == 1
    good_buy = base64.b64encode(b"buy" + BUY_V3_DISCRIMINATOR).decode()
    good_sell = base64.b64encode(b"sell" + SELL_V3_DISCRIMINATOR).decode()
    assert rehearsal.rehearsal_result(*rehearsal.run_pair(simulate, good_buy, good_sell)) == 0


def test_intent_keys_and_duplicates(tmp_path: Path) -> None:
    signer, services = build(tmp_path)
    assert activate(signer).ok
    body = {
        "destination": USER,
        "intent_id": "extra",
        "issued_at_ms": services.clock.now_ms(),
        "key_id": "1",
        "max_slippage_bps": 1500,
        "mint": MINT,
        "side": "buy",
        "usd_stake_micro": 2_000_000,
    }
    raw = json.dumps(body, sort_keys=True, separators=(",", ":")).encode()
    key = signer.s.secrets.get_hmac_key()
    assert key is not None
    import hashlib
    import hmac

    from zoora_signer.constants import INTENT_PREFIX

    signature = hmac.new(key, INTENT_PREFIX + raw, hashlib.sha256).hexdigest()
    assert signer.handle_intent(raw, signature).code == "BAD_INTENT"
    duplicate = b'{"side":"buy","side":"sell"}'
    signature = hmac.new(key, INTENT_PREFIX + duplicate, hashlib.sha256).hexdigest()
    assert signer.handle_intent(duplicate, signature).code == "BAD_INTENT"


def test_acl_allowlist_and_high_integrity_sid() -> None:
    owner = "S-1-5-21-1-2-3-1001"
    assert parse_icacls(f"{owner}:(F)\nS-1-5-18:(F)\n", owner)
    assert not parse_icacls(f"{owner}:(F)\nS-1-5-18:(F)\nS-1-5-32-544:(F)\n", owner)
    assert parse_whoami(f"Group {HIGH_INTEGRITY_SID}\n")
    assert not parse_whoami("High Mandatory Level")


def test_wallet_fraction_rounds_against_the_buyer(tmp_path: Path) -> None:
    signer, _services = build(tmp_path)
    assert activate(signer).ok
    conn = sqlite3.connect(signer.path)
    conn.execute("UPDATE signer_state SET ledger_sol_lamports = ?", (250_099_000,))
    conn.commit()
    row = conn.execute("SELECT * FROM signer_state WHERE id = 1").fetchone()
    conn.close()
    del row
    ceil_cents, floor_cents = __import__(
        "zoora_signer.signer", fromlist=["_lamport_cents"]
    )._lamport_cents(250_099_000, 10_000)
    assert ceil_cents == 2501
    assert floor_cents == 2500


def test_anchor_detects_a_truncated_log(tmp_path: Path) -> None:
    signer, _services = build(tmp_path)
    assert activate(signer).ok
    assert buy(signer).ok
    anchor = Path(str(signer.path).replace(".sqlite", ".anchor"))
    if not anchor.is_file():
        anchor = Path(signer.path).with_suffix(".anchor")
    assert anchor.is_file()
    conn = sqlite3.connect(signer.path)
    conn.execute("DELETE FROM events WHERE id = (SELECT MAX(id) FROM events)")
    conn.commit()
    conn.close()
    again, _services = build(tmp_path)
    assert again.activity() == "HALTED"
    conn = sqlite3.connect(again.path)
    reason = str(conn.execute("SELECT halt_reason FROM signer_state").fetchone()[0])
    conn.close()
    assert "anchor_mismatch" in reason


def _swap_ix(built: object, data: bytes) -> SoldersInstruction:
    accounts = built.accounts  # type: ignore[attr-defined]
    flags = (
        (False, False),
        (False, False),
        (False, False),
        (False, False),
        (False, False),
        (True, False),
        (True, False),
        (True, False),
        (True, True),
        (True, False),
        (True, False),
        (True, False),
        (False, False),
        (True, False),
        (False, False),
        (False, False),
        (False, False),
    )
    metas = [
        AccountMeta(Pubkey.from_string(key), signer, writable)
        for key, (writable, signer) in zip(accounts, flags, strict=True)
    ]
    return SoldersInstruction(Pubkey.from_string(PUMP_PROGRAM), data, metas)


def test_two_signers_and_foreign_payer_are_rejected() -> None:
    built = build_curve_sell(
        user=USER,
        mint_address=ORDER[1],
        mint_data=MINT_DATA,
        mint_owner=TOKEN_2022,
        curve_data=CURVE,
        fee_config_data=FEE,
        buyback_fee_recipient=ORDER[13],
        token_in=10_000_000_000_000,
        slippage_bps=0,
    )
    flags = [(False, False)] * 17
    flags[0] = (False, True)
    flags[8] = (True, True)
    accounts = list(built.accounts)
    accounts[9] = str(Pubkey.new_unique())
    metas = [
        AccountMeta(Pubkey.from_string(key), signer, writable)
        for key, (writable, signer) in zip(accounts, flags, strict=True)
    ]
    payer = Pubkey.from_string(USER)
    message = MessageV0.try_compile(
        payer,
        [SoldersInstruction(Pubkey.from_string(PUMP_PROGRAM), built.data, metas)],
        [],
        Hash.default(),
    )
    raw = bytes(VersionedTransaction.populate(message, [Signature.default(), Signature.default()]))
    with pytest.raises(PolicyError):
        validate_transaction(raw, owner=USER, mint=ORDER[1])
    other = Keypair().pubkey()
    message = MessageV0.try_compile(
        other,
        [_swap_ix(built, built.data)],
        [],
        Hash.default(),
    )
    raw = bytes(VersionedTransaction.populate(message, [Signature.default()]))
    with pytest.raises(PolicyError):
        validate_transaction(raw, owner=USER, mint=ORDER[1])
