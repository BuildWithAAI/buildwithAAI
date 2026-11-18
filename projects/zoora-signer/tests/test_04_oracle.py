"""Acceptance 4: oracle failures refuse and halt."""

from pathlib import Path

from harness import PRICE, activate, build, buy


def test_oracle_failures_halt(tmp_path: Path) -> None:
    cases = {
        "stale": {"age_ms": 30_001},
        "confidence": {"conf": PRICE // 100 + 1},
        "disagree": {"second": PRICE * 103 // 100},
        "down": {"down": True},
    }
    for name, updates in cases.items():
        signer, services = build(tmp_path / name)
        assert activate(signer).ok
        for key, value in updates.items():
            setattr(services.oracle, key, value)
        decision = buy(signer)
        assert decision.ok is False
        assert decision.code.startswith("ORACLE")
        assert signer.activity() == "HALTED"


def test_oracle_boundaries_pass(tmp_path: Path) -> None:
    signer, services = build(tmp_path)
    assert activate(signer).ok
    services.oracle.age_ms = 30_000
    services.oracle.conf = PRICE // 100
    services.oracle.second = PRICE * 102 // 100
    assert buy(signer).ok
