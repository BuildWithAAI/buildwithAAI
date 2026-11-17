"""Acceptance 3: kill -9 mid-reservation and mid-confirmation."""

from __future__ import annotations

import os
import subprocess
import sys
import time
from pathlib import Path

from harness import activate, build
from zoora_signer.db import connect


def _kill(mode: str, db: Path, ready: Path) -> None:
    env = os.environ.copy()
    env["PYTHONPATH"] = str(Path(__file__).resolve().parents[1] / "src")
    proc = subprocess.Popen(
        [
            sys.executable,
            "-m",
            "zoora_signer.crash_probe",
            "--db",
            str(db),
            "--mode",
            mode,
            "--ready",
            str(ready),
            "--intent",
            mode,
        ],
        env=env,
    )
    deadline = time.time() + 15
    while time.time() < deadline and not ready.exists():
        if proc.poll() is not None:
            raise RuntimeError(f"probe exited early {proc.returncode}")
        time.sleep(0.05)
    assert ready.exists()
    proc.kill()
    proc.wait(timeout=10)


def test_kill_mid_reservation_and_confirmation(tmp_path: Path) -> None:
    first, _services = build(tmp_path / "reserve")
    assert first.activity() == "PAUSED"
    _kill("hold-reserve", Path(first.path), tmp_path / "reserve.ready")
    rebooted, _services = build(tmp_path / "reserve-boot")
    # same database as the killed probe
    rebooted, _services = build(tmp_path / "reserve")
    assert rebooted.activity() == "PAUSED"
    conn = connect(rebooted.path)
    row = conn.execute("SELECT COUNT(*) AS n FROM reservations").fetchone()
    assert row is not None
    assert int(row["n"]) == 0
    assert activate(rebooted).ok
    from harness import buy

    assert buy(rebooted).ok

    second, _services = build(tmp_path / "confirm")
    _kill("hold-confirm", Path(second.path), tmp_path / "confirm.ready")
    back, _services = build(tmp_path / "confirm")
    assert back.activity() == "HALTED"
    conn = connect(back.path)
    row = conn.execute(
        "SELECT status, reached_signing FROM reservations WHERE intent_id = 'hold-confirm'"
    ).fetchone()
    assert row is not None
    assert str(row["status"]) == "signing"
