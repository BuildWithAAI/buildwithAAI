"""HoSec re-check 8. Live balance, book digest, and the first-run CLI."""

from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest

from harness import (
    FakeChain,
    FakeClock,
    FakeKill,
    FakeOracle,
    FakeProbe,
    FakeVet,
    ScriptedFeed,
    ScriptedMarks,
    activate,
    build,
    buy,
)
from zoora_signer.cli import main
from zoora_signer.secrets import MemorySecretStore
from zoora_signer.signer import RefuseBroadcaster, Services, Signer
from zoora_signer.signing import throwaway_secret

LEDGER = 100_000_000
CHAINS = (30_000_000, 50_000_000, 1_100_000_000)


def _enter_live(tmp: Path) -> tuple[Signer, object]:
    signer, services = build(tmp)
    assert activate(signer).ok
    services.chain.sol = LEDGER  # type: ignore[attr-defined]
    assert signer.set_route("https://example.invalid/permission", "2026-11-17", "written permission").ok
    assert signer.set_mode("LIVE").ok
    return signer, services


def _reason(path: str) -> str:
    row = sqlite3.connect(path).execute("SELECT halt_reason, buy_halt_reason FROM signer_state").fetchone()
    assert row is not None
    return f"{row[0] or ''}|{row[1] or ''}"


def test_a_failed_balance_stays_a_buy_halt_through_resume(tmp_path: Path) -> None:
    signer, services = build(tmp_path)

    def down() -> int:
        raise RuntimeError("rpc down")

    services.chain.sol_lamports = down  # type: ignore[method-assign]
    booted = Signer.open(services)
    assert "reconcile_unknown" in _reason(booted.path)
    assert booted.resume().code == "RESUMED"
    assert "reconcile_unknown" in _reason(booted.path)
    assert buy(booted).code != "FILLED"
    services.chain.authoritative = True
    services.chain.sol_lamports = lambda: LEDGER  # type: ignore[method-assign]
    assert signer.set_route("https://example.invalid/permission", "2026-11-17", "written permission").ok
    # The halted buy halt is still set, so LIVE adoption must not be required to clear it.
    assert "reconcile_unknown" in _reason(signer.path)


@pytest.mark.parametrize("chain", CHAINS)
def test_live_balance_is_compared_at_boot_mode_poll_and_buy(tmp_path: Path, chain: int) -> None:
    boot_signer, boot_services = _enter_live(tmp_path / "boot")
    boot_services.chain.sol = chain  # type: ignore[attr-defined]
    booted = Signer.open(boot_services)
    assert "unexpected_sol" in _reason(booted.path)
    assert buy(booted).code not in {"FILLED", "SIGN_REFUSED"}

    mode_signer, mode_services = build(tmp_path / "mode")
    assert activate(mode_signer).ok
    mode_services.chain.sol = chain  # type: ignore[attr-defined]
    assert mode_signer.set_route("https://example.invalid/permission", "2026-11-17", "written permission").ok
    assert mode_signer.set_mode("LIVE").ok
    row = sqlite3.connect(mode_signer.path).execute(
        "SELECT ledger_sol_lamports, paper_pnl_cents, halt_reason FROM signer_state"
    ).fetchone()
    assert row is not None
    assert int(row[0]) == chain
    assert "unexpected_sol" not in str(row[2] or "")
    equity = sqlite3.connect(mode_signer.path).execute(
        "SELECT start_equity_cents, withdrawals_cents, deposits_cents FROM equity_day"
    ).fetchone()
    assert equity is not None
    assert int(equity[1]) == 0 and int(equity[2]) == 0

    poll_signer, poll_services = _enter_live(tmp_path / "poll")
    poll_services.chain.sol = chain  # type: ignore[attr-defined]
    poll_signer.poll()
    assert "unexpected_sol" in _reason(poll_signer.path)

    buy_signer, buy_services = _enter_live(tmp_path / "buy")
    buy_services.chain.sol = chain  # type: ignore[attr-defined]
    decision = buy(buy_signer)
    assert decision.code not in {"FILLED", "SIGN_REFUSED"}
    assert "unexpected_sol" in _reason(buy_signer.path)
    signing = sqlite3.connect(buy_signer.path).execute(
        "SELECT COUNT(*) FROM reservations WHERE reached_signing = 1"
    ).fetchone()
    assert signing is not None and int(signing[0]) == 0


def test_an_exactly_reverted_tamper_can_reanchor(tmp_path: Path) -> None:
    signer, services = build(tmp_path)
    assert activate(signer).ok
    conn = sqlite3.connect(signer.path)
    conn.execute("UPDATE signer_state SET route_approved = 1 WHERE id = 1")
    conn.commit()
    conn.close()
    Signer.open(services)
    conn = sqlite3.connect(signer.path)
    conn.execute("UPDATE signer_state SET route_approved = 0 WHERE id = 1")
    conn.commit()
    conn.close()
    again = Signer.open(services)
    services.chain.authoritative = True
    ledger = sqlite3.connect(again.path).execute("SELECT ledger_sol_lamports FROM signer_state").fetchone()
    assert ledger is not None
    services.chain.sol = int(ledger[0])
    assert again.reanchor("REANCHOR").code == "REANCHORED"
    assert again.unhalt("UNHALT").ok


def test_a_deleted_anchor_file_can_be_restored_by_reanchor(tmp_path: Path) -> None:
    signer, services = build(tmp_path)
    assert activate(signer).ok
    services.chain.authoritative = True
    ledger = sqlite3.connect(signer.path).execute("SELECT ledger_sol_lamports FROM signer_state").fetchone()
    assert ledger is not None
    services.chain.sol = int(ledger[0])
    assert signer.reanchor("REANCHOR").ok
    anchor = Path(signer.path).with_suffix(".anchor")
    anchor.unlink()
    assert signer.reanchor("REANCHOR").code == "REANCHORED"
    assert anchor.is_file()
    assert buy(signer).code != "ANCHOR_MISMATCH"


def test_readme_first_run_through_the_cli(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    clock = FakeClock()
    secrets = MemorySecretStore()
    secrets.hmac_key = b"k" * 32
    secrets.signing_key = throwaway_secret()
    secrets.rpc_url = "https://mainnet.helius-rpc.com/?api-key=not-a-real-key"
    services = Services(
        db_path=tmp_path / "signer.sqlite",
        secrets=secrets,
        oracle=FakeOracle(),
        vet=FakeVet(clock),
        clock=clock,
        chain=FakeChain(),
        marks=ScriptedMarks(),
        kill=FakeKill(),
        probe=FakeProbe(),
        broadcaster=RefuseBroadcaster(),
        hud_path=tmp_path / "hud.jsonl",
        feed=ScriptedFeed(),
    )
    monkeypatch.setattr("zoora_signer.cli._services", lambda args, create=True: services)
    db = str(services.db_path)
    assert main(["--db", db, "init-event-key"]) == 0
    assert "event key stored" in capsys.readouterr().out
    assert main(["--db", db, "status"]) == 0
    assert main(
        [
            "--db",
            db,
            "route-approved",
            "--source",
            "https://example.invalid/permission",
            "--date",
            "2026-11-17",
            "--text",
            "written permission",
        ]
    ) == 0
    assert main(["--db", db, "mode", "dry-run"]) == 0
    assert main(["--db", db, "resume"]) == 0
    resumed = capsys.readouterr().out
    assert "RESUMED" in resumed
    assert "HASH_CHAIN" not in resumed and "ANCHOR_MISMATCH" not in resumed
    ledger = sqlite3.connect(db).execute("SELECT ledger_sol_lamports FROM signer_state").fetchone()
    assert ledger is not None
    services.chain.authoritative = True
    services.chain.sol = int(ledger[0])
    assert main(["--db", db, "reanchor", "--confirm", "REANCHOR"]) == 0
    assert "REANCHORED" in capsys.readouterr().out
    assert main(["--db", db, "unhalt", "--confirm", "UNHALT"]) == 1
    refused = capsys.readouterr().out
    assert "NOT_HALTED" in refused
    assert "HASH_CHAIN" not in refused and "ANCHOR_MISMATCH" not in refused


def test_a_second_boot_does_not_repeat_halt_events(tmp_path: Path) -> None:
    signer, services = build(tmp_path)
    Path(signer.path).with_suffix(".anchor").unlink()
    Signer.open(services)
    first = sqlite3.connect(signer.path).execute("SELECT COUNT(*) FROM events WHERE kind = 'halt'").fetchone()
    Signer.open(services)
    second = sqlite3.connect(signer.path).execute("SELECT COUNT(*) FROM events WHERE kind = 'halt'").fetchone()
    assert first is not None and second is not None
    assert int(second[0]) == int(first[0])


def test_sell_all_requires_the_owner_confirmation(tmp_path: Path) -> None:
    signer, _services = build(tmp_path)
    assert activate(signer).ok
    assert buy(signer).ok
    refused = signer.sell_all()
    assert refused and refused[0].code == "CONFIRMATION_REQUIRED"
    assert signer.open_trade_count() == 1
    closed = signer.sell_all("OWNER_SELL")
    assert closed and closed[0].code == "CLOSED"
    assert signer.open_trade_count() == 0


def test_tampered_owner_exit_still_builds_without_a_ledger_write(tmp_path: Path) -> None:
    signer, _services = build(tmp_path)
    assert activate(signer).ok
    assert buy(signer).ok
    before = sqlite3.connect(signer.path).execute("SELECT ledger_sol_lamports FROM signer_state").fetchone()
    conn = sqlite3.connect(signer.path)
    conn.execute("UPDATE signer_state SET boot_id = 'edited' WHERE id = 1")
    conn.commit()
    conn.close()
    decision = signer.owner_sell(
        "4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf",
        confirmation="OWNER_SELL",
    )
    # No chain accounts, so the build is refused and the ledger is untouched.
    assert decision.code == "BROADCAST_REFUSED"
    after = sqlite3.connect(signer.path).execute("SELECT ledger_sol_lamports, halt_reason FROM signer_state").fetchone()
    assert before is not None and after is not None
    assert int(after[0]) == int(before[0])
    assert signer.open_trade_count() == 1
