"""HoSec re-check 7. A reboot must not bless a tampered book."""

from __future__ import annotations

import shutil
import sqlite3
from pathlib import Path

import pytest

from harness import MINT, activate, build, buy, record_state
from zoora_signer.cli import _RpcChain, main
from zoora_signer.constants import BUY_MIN_INTERVAL_MS
from zoora_signer.ports import BroadcasterKind
from zoora_signer.signer import RefuseBroadcaster, Signer


def _reboot(monkeypatch: pytest.MonkeyPatch, services: object, path: Path) -> None:
    monkeypatch.setattr("zoora_signer.cli._services", lambda args, create=True: services)
    assert main(["--db", str(path), "reboot"]) == 0


def _refuse_after_reboot(monkeypatch: pytest.MonkeyPatch, signer: Signer, services: object) -> None:
    _reboot(monkeypatch, services, Path(signer.path))
    again = Signer.open(services)  # type: ignore[arg-type]
    conn = sqlite3.connect(again.path)
    ledger = conn.execute("SELECT ledger_sol_lamports FROM signer_state WHERE id = 1").fetchone()
    conn.close()
    assert ledger is not None
    services.chain.sol = int(ledger[0])  # type: ignore[attr-defined]
    services.chain.authoritative = True  # type: ignore[attr-defined]
    decision = again.reanchor("REANCHOR")
    assert decision.code == "RECONCILE_REQUIRED"
    assert again.last_reanchor_diff
    assert "state_sha256" in again.last_reanchor_diff
    assert not again.unhalt("UNHALT").ok
    assert buy(again).code != "FILLED"


def test_clean_reboot_still_stamps_and_can_reanchor(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    signer, services = build(tmp_path)
    assert activate(signer).ok
    _reboot(monkeypatch, services, Path(signer.path))
    again = Signer.open(services)
    conn = sqlite3.connect(again.path)
    ledger = conn.execute("SELECT ledger_sol_lamports FROM signer_state WHERE id = 1").fetchone()
    conn.close()
    assert ledger is not None
    services.chain.sol = int(ledger[0])
    services.chain.authoritative = True
    assert again.reanchor("REANCHOR").code == "REANCHORED"
    assert again.last_reanchor_diff == {}


@pytest.mark.parametrize(
    "name",
    [
        "route_approved",
        "whitelist",
        "equity_start",
        "equity_deposits",
        "decisions",
        "expected_deposit",
        "recovered",
        "extra_closed",
        "extra_reservation",
        "reservation_stake",
        "hmac_version",
        "route_source",
    ],
)
def test_reboot_does_not_absorb_a_tamper(tmp_path: Path, monkeypatch: pytest.MonkeyPatch, name: str) -> None:
    signer, services = build(tmp_path)
    assert activate(signer).ok
    assert buy(signer).code != "ANCHOR_MISMATCH"
    if name == "recovered":
        conn = sqlite3.connect(signer.path)
        conn.execute(
            """
            INSERT INTO trades (mint, cost_cents, recovered_cents, tokens, status, opened_ms)
            VALUES (?, 100, 0, 1, 'closed', 1)
            """,
            (MINT,),
        )
        conn.commit()
        conn.close()
        record_state(signer)
    conn = sqlite3.connect(signer.path)
    if name == "route_approved":
        conn.execute("UPDATE signer_state SET route_approved = 1 WHERE id = 1")
    elif name == "whitelist":
        conn.execute("INSERT INTO whitelist (address, added_ms) VALUES (?, 1)", (MINT,))
    elif name == "equity_start":
        assert conn.execute("UPDATE equity_day SET start_equity_cents = start_equity_cents - 100").rowcount == 1
    elif name == "equity_deposits":
        assert conn.execute("UPDATE equity_day SET deposits_cents = deposits_cents + 500").rowcount == 1
    elif name == "decisions":
        assert conn.execute("DELETE FROM decisions").rowcount >= 1
    elif name == "expected_deposit":
        conn.execute(
            "INSERT INTO expected_deposits (lamports, ttl_ms, created_ms, consumed) VALUES (5000000000, 1000, 1, 0)"
        )
    elif name == "recovered":
        assert conn.execute("UPDATE trades SET recovered_cents = recovered_cents + 50").rowcount >= 1
    elif name == "extra_closed":
        conn.execute(
            """
            INSERT INTO trades (mint, cost_cents, recovered_cents, tokens, status, opened_ms)
            VALUES (?, 100, 80, 1, 'closed', 1)
            """,
            (MINT,),
        )
    elif name == "extra_reservation":
        conn.execute(
            """
            INSERT INTO reservations
                (intent_id, side, mint, stake_cents, status, ct_day, created_ms, reached_signing)
            VALUES ('extra', 'buy', ?, 200, 'done', '2026-11-17', 1, 1)
            """,
            (MINT,),
        )
    elif name == "reservation_stake":
        assert conn.execute("UPDATE reservations SET stake_cents = stake_cents + 25").rowcount >= 1
    elif name == "hmac_version":
        conn.execute("UPDATE signer_state SET hmac_version = hmac_version + 1 WHERE id = 1")
    elif name == "route_source":
        conn.execute("UPDATE signer_state SET route_source = 'forged' WHERE id = 1")
    conn.commit()
    conn.close()
    _refuse_after_reboot(monkeypatch, signer, services)


def test_empty_anchor_and_a_rolled_back_db_do_not_reset_buys(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    signer, services = build(tmp_path)
    assert activate(signer).ok
    for index in range(3):
        services.clock.now += BUY_MIN_INTERVAL_MS  # type: ignore[attr-defined]
        assert buy(signer, intent_id=f"buy-{index}").code != "ANCHOR_MISMATCH"
    held = sqlite3.connect(signer.path)
    held.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    held.close()
    db = Path(signer.path)
    anchor = db.with_suffix(".anchor")
    shutil.copy(db, tmp_path / "before.sqlite")
    shutil.copy(anchor, tmp_path / "before.anchor")
    services.clock.now += 10 * BUY_MIN_INTERVAL_MS  # type: ignore[attr-defined]
    buy(signer, intent_id="later")
    held = sqlite3.connect(signer.path)
    held.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    held.close()
    shutil.copy(tmp_path / "before.sqlite", db)
    for suffix in ("-wal", "-shm"):
        extra = Path(str(db) + suffix)
        if extra.exists():
            extra.unlink()
    anchor.write_text("", encoding="utf-8")
    _reboot(monkeypatch, services, db)
    again = Signer.open(services)
    assert again.activity() == "HALTED"
    assert buy(again, intent_id="after-rollback").code != "FILLED"


def test_balance_outage_and_a_missing_wallet_keep_halt_and_the_owner_exit(
    tmp_path: Path,
) -> None:
    signer, services = build(tmp_path)
    assert activate(signer).ok
    stored = sqlite3.connect(signer.path).execute("SELECT ledger_sol_lamports FROM signer_state").fetchone()
    assert stored is not None
    before = int(stored[0])

    def down() -> int:
        raise RuntimeError("rpc down")

    services.chain.sol_lamports = down  # type: ignore[method-assign]
    booted = Signer.open(services)
    row = sqlite3.connect(booted.path).execute(
        "SELECT ledger_sol_lamports, buy_halt_reason FROM signer_state"
    ).fetchone()
    assert row is not None
    assert int(row[0]) == before
    assert row[1] == "reconcile_unknown"
    assert booted.halt("owner").code == "HALTED"
    assert booted.owner_sell(MINT, confirmation="OWNER_SELL").code != ""
    with pytest.raises(RuntimeError, match="BALANCE_UNAVAILABLE"):
        _RpcChain(object(), None).sol_lamports()

    services.chain.sol_lamports = lambda: before  # type: ignore[method-assign]
    recovered = Signer.open(services)
    reason = sqlite3.connect(recovered.path).execute("SELECT buy_halt_reason FROM signer_state").fetchone()
    assert reason is not None and reason[0] is None


def test_getbalance_rejects_a_value_above_u64() -> None:
    import httpx

    from zoora_signer.rpc import HeliusRpc

    def handler(request: httpx.Request) -> httpx.Response:
        del request
        return httpx.Response(200, json={"jsonrpc": "2.0", "id": 1, "result": {"value": 2**64}})

    rpc = HeliusRpc(
        lambda: "https://mainnet.helius-rpc.com/?api-key=test",
        type("Clock", (), {"now_ms": lambda self: 1})(),
        client=httpx.Client(transport=httpx.MockTransport(handler)),
    )
    with pytest.raises(RuntimeError, match="BALANCE_UNAVAILABLE"):
        _RpcChain(rpc, MINT).sol_lamports()


def test_owner_exit_high_fee_needs_its_own_confirm_and_doctor_warns(tmp_path: Path) -> None:
    import struct

    from test_recheck2 import FEE, _arm
    from test_recheck2 import MINT as CHAIN_MINT

    signer, services = build(tmp_path)
    _arm(signer, services)
    forged = bytearray(FEE)
    struct.pack_into("<QQQ", forged, 8 + 1 + 32, 0, 200, 0)
    struct.pack_into("<I", forged, 8 + 1 + 32 + 24, 0)
    original = services.chain.account_info

    def account_info(address: str) -> object:
        found = original(address)
        if isinstance(found, tuple) and len(found) == 5 and found[4].startswith(FEE[:8]):
            return (found[0], found[1], len(forged), found[3], bytes(forged))
        return found

    services.chain.account_info = account_info  # type: ignore[method-assign]
    owner = signer._owner_pubkey()
    assert owner is not None
    assert signer._chain_trade_facts(owner, CHAIN_MINT, False) is None
    assert signer._chain_trade_facts(owner, CHAIN_MINT, False, fee_cap=500) is not None
    assert signer.owner_sell(CHAIN_MINT, confirmation="OWNER_SELL").code == "BROADCAST_REFUSED"
    assert signer.owner_sell(CHAIN_MINT, confirmation="OWNER_SELL_HIGH_FEE").code == "OWNER_SELL_SIMULATED"
    assert any(line.startswith("chain_fee: warn") for line in signer.doctor_lines())
    struct.pack_into("<QQQ", forged, 8 + 1 + 32, 0, 600, 0)
    signer._chain_fee_bps = None
    assert signer.owner_sell(CHAIN_MINT, confirmation="OWNER_SELL_HIGH_FEE").code == "BROADCAST_REFUSED"


def test_a_database_with_no_event_key_halts_instead_of_raising(tmp_path: Path) -> None:
    signer, services = build(tmp_path)
    assert activate(signer).ok
    services.secrets.event_hmac = None  # type: ignore[attr-defined]
    booted = Signer.open(services)
    assert booted.activity() == "HALTED"
    assert booted.halt("owner").code == "HALTED"


def test_only_a_live_broadcaster_kind_may_submit(tmp_path: Path) -> None:
    from test_recheck2 import MINT as CHAIN_MINT
    from test_recheck2 import ORDER, _arm

    signer, services = build(tmp_path)
    assert RefuseBroadcaster.kind is BroadcasterKind.REFUSE
    _arm(signer, services)

    class Market:
        def sell_inputs(self, mint: str) -> dict[str, object]:
            return {"buyback": str(ORDER[13]), "token_in": 1_000_000_000_000, "slippage_bps": 1500}

    services.market = Market()

    class Live:
        kind = BroadcasterKind.LIVE
        enabled = True
        calls = 0

        def submit(self, payload: bytes) -> None:
            self.calls += 1

    live = Live()
    services.broadcaster = live  # type: ignore[assignment]
    accepted = signer._broadcast_sell(CHAIN_MINT, 1_000_000_000_000)
    assert accepted.code == "BROADCAST_ACCEPTED"
    assert live.calls == 1
    kind = sqlite3.connect(signer.path).execute("SELECT kind FROM events ORDER BY id DESC LIMIT 1").fetchone()
    assert kind is not None and kind[0] == "broadcast_result"
    ledger = sqlite3.connect(signer.path).execute("SELECT ledger_sol_lamports FROM signer_state").fetchone()
    assert ledger is not None and int(ledger[0]) == 100_000_000

    class Boom(Live):
        def submit(self, payload: bytes) -> None:
            raise RuntimeError("BROADCAST_DISABLED")

    services.broadcaster = Boom()  # type: ignore[assignment]
    failed = signer._broadcast_sell(CHAIN_MINT, 1_000_000_000_000)
    assert failed.code == "BROADCAST_FAILED"
    services.broadcaster = RefuseBroadcaster()
    assert signer._broadcast_sell(CHAIN_MINT, 1_000_000_000_000).code == "BROADCASTER_NOT_ENABLED"
