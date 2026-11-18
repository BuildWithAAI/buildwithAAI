"""Acceptance 1: every cap at the boundary and one step past it."""

from __future__ import annotations

import sqlite3
from pathlib import Path

from harness import MINT, activate, build, buy
from zoora_signer.signer import Signer


def ready(path: Path) -> Signer:
    path.mkdir(parents=True, exist_ok=True)
    signer, _services = build(path)
    assert activate(signer).ok
    return signer


def _close_open(signer: Signer) -> None:
    from harness import record_state

    conn = sqlite3.connect(signer.path)
    conn.execute("UPDATE trades SET status = 'closed', tokens = 0 WHERE status IN ('open', 'moon')")
    conn.execute("UPDATE signer_state SET ledger_sol_lamports = 100000000 WHERE id = 1")
    conn.commit()
    conn.close()
    record_state(signer)


def _set(signer: Signer, sql: str, params: tuple[object, ...] = ()) -> None:
    from harness import record_state

    conn = sqlite3.connect(signer.path)
    conn.execute(sql, params)
    conn.commit()
    conn.close()
    record_state(signer)


def test_stake_boundary(tmp_path: Path) -> None:
    signer = ready(tmp_path)
    assert buy(signer, 200).code == "FILLED"
    assert buy(signer, 201, mint="ADyA8hdefvWN2dbGGWFotbzWxrAvLW83WG6QCVXvJKqw").code == "STAKE"


def test_open_trades_boundary(tmp_path: Path) -> None:
    signer, services = build(tmp_path)
    assert activate(signer).ok
    mints = [
        MINT,
        "ADyA8hdefvWN2dbGGWFotbzWxrAvLW83WG6QCVXvJKqw",
        "So11111111111111111111111111111111111111112",
    ]
    for index, mint in enumerate(mints):
        if index:
            services.clock.now += 601_000
        assert buy(signer, mint=mint).ok
    assert signer.open_trade_count() == 3
    services.clock.now += 601_000
    refused = buy(signer, mint="TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA")
    assert refused.code == "OPEN_TRADES"


def test_buys_per_day_and_rate_boundary(tmp_path: Path) -> None:
    signer, services = build(tmp_path)
    assert activate(signer).ok
    mints = [
        MINT,
        "ADyA8hdefvWN2dbGGWFotbzWxrAvLW83WG6QCVXvJKqw",
        "So11111111111111111111111111111111111111112",
    ]
    for index in range(4):
        if index:
            services.clock.now += 601_000
        if signer.open_trade_count() >= 3:
            _close_open(signer)
        assert buy(signer, mint=mints[index % 3]).ok
    services.clock.now += 601_000
    assert buy(signer).code == "RATE_LIMIT"
    services.clock.now += 61 * 60 * 1000
    for index in range(4, 10):
        if signer.open_trade_count() >= 3:
            _close_open(signer)
        services.clock.now += 601_000
        if index == 8:
            services.clock.now += 61 * 60 * 1000
        assert buy(signer, mint=mints[index % 3]).ok
    services.clock.now += 61 * 60 * 1000
    _close_open(signer)
    assert buy(signer).code == "BUYS_DAY"


def test_daily_loss_boundary(tmp_path: Path) -> None:
    at_cap = ready(tmp_path / "at")
    _set(at_cap, "UPDATE signer_state SET ledger_sol_lamports = ?", (60_000_000,))
    assert buy(at_cap, 200).code == "FILLED"
    over = ready(tmp_path / "over")
    _set(over, "UPDATE signer_state SET ledger_sol_lamports = ?", (59_900_000,))
    assert buy(over, 200).code == "DAILY_LOSS"
    halted = ready(tmp_path / "halt")
    _set(halted, "UPDATE signer_state SET ledger_sol_lamports = ?", (40_000_000,))
    assert buy(halted, 1).code in {"DAILY_LOSS", "BUY_HALT"}
    assert halted.activity() == "ACTIVE"


def test_exposure_boundary(tmp_path: Path) -> None:
    at_cap = ready(tmp_path / "at")
    assert buy(at_cap).ok
    _set(at_cap, "UPDATE reservations SET created_ms = created_ms - 700000")
    _set(at_cap, "UPDATE trades SET cost_cents = 1800")
    _set(at_cap, "UPDATE signer_state SET ledger_sol_lamports = 0")
    assert buy(at_cap, 200, mint="ADyA8hdefvWN2dbGGWFotbzWxrAvLW83WG6QCVXvJKqw").ok
    over = ready(tmp_path / "over")
    assert buy(over).ok
    _set(over, "UPDATE reservations SET created_ms = created_ms - 700000")
    _set(over, "UPDATE trades SET cost_cents = 1801")
    _set(over, "UPDATE signer_state SET ledger_sol_lamports = 0")
    assert buy(over, 200, mint="ADyA8hdefvWN2dbGGWFotbzWxrAvLW83WG6QCVXvJKqw").code == "EXPOSURE"


def test_wallet_and_slippage_boundary(tmp_path: Path) -> None:
    at_cap = ready(tmp_path / "at")
    _set(at_cap, "UPDATE signer_state SET ledger_sol_lamports = ?", (250_000_000,))
    assert buy(at_cap, 200).ok
    over = ready(tmp_path / "over")
    _set(over, "UPDATE signer_state SET ledger_sol_lamports = ?", (250_100_000,))
    assert buy(over, 200).code in {"WALLET", "BUY_HALT"}
    slip = ready(tmp_path / "slip")
    assert buy(slip, slippage=1500).ok
    assert buy(slip, slippage=1501, mint="ADyA8hdefvWN2dbGGWFotbzWxrAvLW83WG6QCVXvJKqw").code == "SLIPPAGE"
