"""Remaining fail-closed checks from the review batch."""

from __future__ import annotations

import multiprocessing
import sqlite3
from pathlib import Path

from harness import MINT, activate, build, buy
from race_worker import child
from zoora_signer.signer import Signer


def test_unknown_mark_does_not_lower_the_day_snapshot(tmp_path: Path) -> None:
    signer, services = build(tmp_path)
    assert activate(signer).ok
    assert buy(signer).ok
    services.marks.by_mint[MINT] = None
    services.clock.now += 36 * 60 * 60 * 1000
    assert signer.resume().ok
    conn = sqlite3.connect(signer.path)
    days = conn.execute("SELECT COUNT(*) FROM equity_day").fetchone()
    assert days is not None and int(days[0]) == 1
    conn.close()
    assert buy(signer, mint="ADyA8hdefvWN2dbGGWFotbzWxrAvLW83WG6QCVXvJKqw").code == "UNKNOWN_MARK"


def test_live_halt_does_not_fill_and_settle_errors_release(tmp_path: Path) -> None:
    signer, services = build(tmp_path)
    assert activate(signer).ok
    assert signer.set_route("https://example.invalid/permission", "2026-11-17", "written permission").ok
    assert signer.set_mode("LIVE").ok
    services.defer_settle = True
    reserved = buy(signer)
    assert reserved.code == "RESERVED"
    signer.halt("owner")
    conn = sqlite3.connect(signer.path)
    row = conn.execute("SELECT id FROM reservations WHERE status = 'reserved'").fetchone()
    assert row is not None
    from zoora_signer.models import Intent

    intent = Intent(
        intent_id="settle",
        side="buy",
        mint=MINT,
        issued_at_ms=services.clock.now_ms(),
        max_slippage_bps=1500,
        usd_stake_cents=200,
        token_amount=None,
        key_id="1",
    )
    released = signer._settle_buy(intent, services.oracle.quote(services.clock.now_ms()), int(row[0]), 200)
    assert released.code == "KILL_HOLD"
    trades = conn.execute("SELECT COUNT(*) FROM trades").fetchone()
    assert trades is not None and int(trades[0]) == 0
    conn.close()

    dry, services = build(tmp_path / "dry")
    assert activate(dry).ok

    def explode(*_args: object, **_kwargs: object) -> None:
        raise RuntimeError("settle failed")

    dry._fill = explode  # type: ignore[method-assign]
    assert buy(dry).code == "SETTLE_ERROR"
    conn = sqlite3.connect(dry.path)
    status = conn.execute("SELECT status FROM reservations").fetchone()
    assert status is not None and str(status[0]) == "released"
    conn.close()


def test_sticky_unhalt_requires_reconciliation(tmp_path: Path) -> None:
    signer, _services = build(tmp_path)
    assert activate(signer).ok
    signer.halt("unexpected_sol")
    assert signer.unhalt("UNHALT").code == "RECONCILE_REQUIRED"
    assert signer.activity() == "HALTED"


def test_two_processes_cannot_both_buy(tmp_path: Path) -> None:
    signer, _services = build(tmp_path)
    assert activate(signer).ok
    ctx = multiprocessing.get_context("spawn")
    with ctx.Pool(2) as pool:
        codes = pool.map(child, [signer.path, signer.path])
    assert codes.count("FILLED") == 1
    assert "RATE_LIMIT" in codes
    assert Signer.attach  # the children must not boot
