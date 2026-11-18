"""Acceptance 13a-e: each preflight check fails closed."""

from pathlib import Path

import keyring

from harness import activate, build, buy
from zoora_signer.preflight import WindowsOsProbe


def test_13a_boot_and_sleep_pause(tmp_path: Path) -> None:
    signer, services = build(tmp_path)
    assert signer.activity() == "PAUSED"
    assert any(kind == "boot_paused" for _row, kind, _payload in signer.read_events(0))
    assert activate(signer).ok
    services.probe.wall += 60_000
    signer.run_preflight("interval")
    assert signer.activity() == "PAUSED"
    assert buy(signer).code == "PAUSED"


def test_13b_clock_skew_refuses_resume(tmp_path: Path) -> None:
    signer, services = build(tmp_path)
    services.probe.skew = 2_000
    assert activate(signer).ok
    signer, services = build(tmp_path / "over")
    services.probe.skew = 2_001
    assert activate(signer).code == "PREFLIGHT"
    assert signer.activity() == "PAUSED"
    assert buy(signer).code == "PAUSED"


def test_13c_defender_required(tmp_path: Path) -> None:
    signer, services = build(tmp_path)
    services.probe.defender = False
    assert activate(signer).code == "PREFLIGHT"
    text = " ".join(payload for _row, _kind, payload in signer.read_events(0))
    assert "defender" in text


def test_13d_standard_user_required(tmp_path: Path) -> None:
    signer, services = build(tmp_path)
    services.probe.elevated = True
    assert activate(signer).code == "PREFLIGHT"
    text = " ".join(payload for _row, _kind, payload in signer.read_events(0))
    assert "standard_user" in text


def test_13e_acl_owner_only(tmp_path: Path) -> None:
    signer, services = build(tmp_path)
    services.probe.acl = False
    assert activate(signer).code == "PREFLIGHT"
    text = " ".join(payload for _row, _kind, payload in signer.read_events(0))
    assert "acl" in text


def test_windows_probe_executes(tmp_path: Path) -> None:
    import sys

    if sys.platform != "win32":
        return
    probe = WindowsOsProbe([str(tmp_path), str(tmp_path.parent)])
    assert isinstance(probe.defender_active(), bool)
    assert isinstance(probe.elevated_or_admin(), bool)
    assert isinstance(probe.acl_owner_only(), bool)
    skew = probe.time_skew_ms()
    assert skew is None or isinstance(skew, int)
    assert "win" in type(keyring.get_keyring()).__name__.lower()


def test_preflight_interval_and_doctor(tmp_path: Path) -> None:
    signer, services = build(tmp_path)
    lines = signer.doctor_lines()
    assert "clock_sync: pass" in lines
    assert "defender: pass" in lines
    joined = "\n".join(lines)
    secret = services.secrets.get_signing_key()
    assert secret is not None
    assert secret.hex() not in joined
    assert services.secrets.get_rpc_url() not in joined
    assert activate(signer).ok
    services.clock.now += 600_000
    services.probe.defender = False
    signer.poll()
    assert signer.activity() == "PAUSED"
