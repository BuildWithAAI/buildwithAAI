"""Acceptance 2: 2 to 20 simultaneous intents, repeated."""

from __future__ import annotations

import threading
import uuid
from pathlib import Path

from harness import activate, build, buy
from zoora_signer.signer import Signer


def _burst(signer: Signer, count: int, cents: int = 200) -> list[str]:
    barrier = threading.Barrier(count)
    codes: list[str] = []
    lock = threading.Lock()

    def worker() -> None:
        barrier.wait()
        decision = buy(signer, cents=cents, intent_id=str(uuid.uuid4()))
        with lock:
            codes.append(decision.code)

    threads = [threading.Thread(target=worker) for _ in range(count)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    return codes


def test_open_trade_concurrency(tmp_path: Path) -> None:
    for count in range(2, 21):
        signer, services = build(tmp_path / f"n{count}")
        services.defer_settle = True
        assert activate(signer).ok
        codes = _burst(signer, count)
        assert codes.count("RESERVED") == 1
        assert len(codes) == count
    for _repeat in range(5):
        signer, services = build(tmp_path / f"rep{_repeat}")
        services.defer_settle = True
        assert activate(signer).ok
        codes = _burst(signer, 20)
        assert codes.count("RESERVED") == 1


def test_loss_and_rate_concurrency(tmp_path: Path) -> None:
    signer, services = build(tmp_path / "loss")
    services.defer_settle = True
    assert activate(signer).ok
    import sqlite3

    conn = sqlite3.connect(signer.path)
    conn.execute("UPDATE signer_state SET ledger_sol_lamports = ?", (60_000_000,))
    conn.commit()
    conn.close()
    codes = _burst(signer, 8)
    assert codes.count("RESERVED") == 1
    rate, rate_services = build(tmp_path / "rate")
    rate_services.defer_settle = True
    assert activate(rate).ok
    conn = sqlite3.connect(rate.path)
    now = rate_services.clock.now_ms()
    for index in range(3):
        conn.execute(
            """
            INSERT INTO reservations (
              intent_id, side, mint, stake_cents, status, ct_day, created_ms, reached_signing
            ) VALUES (?, 'buy', ?, 200, 'released', '2026-11-17', ?, 0)
            """,
            (f"seed-{index}", "4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf", now - 11 * 60 * 1000),
        )
    conn.commit()
    conn.close()
    codes = _burst(rate, 12)
    assert codes.count("RESERVED") == 1
    assert codes.count("RATE_LIMIT") == 11
